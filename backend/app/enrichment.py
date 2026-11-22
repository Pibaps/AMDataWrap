import asyncio
import json
from datetime import datetime, timezone
from typing import Any

import httpx

from .db import db_session
from .normalize import clean_group_key, normalize_basic, primary_artist_name, similarity_score


def _upgrade_artwork(url: str | None) -> str | None:
    if not url:
        return None
    return url.replace("100x100bb", "600x600bb").replace("100x100-", "600x600-")


def _extract_year(rel_date: str | None) -> int | None:
    if rel_date and len(rel_date) >= 4:
        try:
            y = int(rel_date[:4])
            if 1900 <= y <= 2030:
                return y
        except ValueError:
            pass
    return None


class EnrichmentManager:
    """Background Pass 2 enrichment engine with prioritized queue & SSE broadcasting."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._subscribers: set[asyncio.Queue] = set()
        self.state: dict[str, Any] = {
            "running": False,
            "phase": "idle",
            "total": 0,
            "completed": 0,
            "enriched": 0,
            "not_found": 0,
            "current_track": None,
            "last_update": None,
            "version": 0,
        }

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.discard(q)

    def _broadcast(self):
        self.state["last_update"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        payload = json.dumps(self.state, ensure_ascii=False)
        for q in list(self._subscribers):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    def get_snapshot(self) -> dict[str, Any]:
        with db_session() as conn:
            row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN enrichment_status = 'enriched' THEN 1 ELSE 0 END) AS enriched,
                    SUM(CASE WHEN enrichment_status = 'not_found' THEN 1 ELSE 0 END) AS not_found,
                    SUM(CASE WHEN artwork_url IS NOT NULL THEN 1 ELSE 0 END) AS with_artwork,
                    SUM(CASE WHEN artist_name IS NOT NULL THEN 1 ELSE 0 END) AS with_artist,
                    SUM(CASE WHEN release_year IS NOT NULL THEN 1 ELSE 0 END) AS with_year
                FROM tracks_catalog
                """
            ).fetchone()
        if row:
            total = row["total"] or 0
            enriched = row["enriched"] or 0
            not_found = row["not_found"] or 0
            self.state.update(
                {
                    "total": total,
                    "completed": enriched + not_found,
                    "enriched": enriched,
                    "not_found": not_found,
                    "with_artwork": row["with_artwork"] or 0,
                    "with_artist": row["with_artist"] or 0,
                    "with_year": row["with_year"] or 0,
                }
            )
        return dict(self.state)

    def start(self, force_restart: bool = False):
        curr_loop = asyncio.get_running_loop()
        if self._task and not self._task.done():
            if self._task.get_loop() is curr_loop:
                if not force_restart:
                    return
                self._stop_event.set()
                self._task.cancel()
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        self._stop_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            if self._task.get_loop() is asyncio.get_running_loop():
                try:
                    await self._task
                except (asyncio.CancelledError, RuntimeError):
                    pass
        self._task = None
        self.state["running"] = False
        self.state["phase"] = "stopped"
        self._broadcast()

    async def _run(self):
        self.state["running"] = True
        self.state["phase"] = "starting"
        self.get_snapshot()
        self._broadcast()

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(12.0),
                headers={"User-Agent": "AMDataWrap/1.0 (Local Analytics)"},
            ) as client:
                # ----------------------------------------------------------
                # Stage 2a: Batch iTunes Lookup for tracks with itunes_track_id
                # Prioritized by total_plays DESC (Top 200 enriched in < 3 sec!)
                # ----------------------------------------------------------
                self.state["phase"] = "itunes_lookup_batch"
                self._broadcast()

                with db_session() as conn:
                    id_rows = conn.execute(
                        """
                        SELECT track_key, song_name, album_name, artist_name, itunes_track_id, total_plays
                        FROM tracks_catalog
                        WHERE enrichment_status = 'local_only'
                          AND itunes_track_id IS NOT NULL
                          AND itunes_track_id != ''
                        ORDER BY total_plays DESC, total_ms DESC
                        """
                    ).fetchall()

                batch_size = 80
                for i in range(0, len(id_rows), batch_size):
                    if self._stop_event.is_set():
                        return
                    chunk = id_rows[i : i + batch_size]
                    id_to_tracks: dict[str, list[dict]] = {}
                    for r in chunk:
                        tid = str(r["itunes_track_id"])
                        id_to_tracks.setdefault(tid, []).append(dict(r))

                    ids_param = ",".join(id_to_tracks.keys())
                    self.state["current_track"] = f"Batch iTunes ({i + 1}–{min(i + batch_size, len(id_rows))}/{len(id_rows)})"
                    self._broadcast()

                    results_map: dict[str, dict[str, Any]] = {}
                    for attempt in range(3):
                        try:
                            resp = await client.get(
                                "https://itunes.apple.com/lookup",
                                params={"id": ids_param, "country": "fr"},
                            )
                            if resp.status_code == 200:
                                data = resp.json()
                                for item in data.get("results", []):
                                    tid = str(item.get("trackId") or "")
                                    if tid:
                                        results_map[tid] = item
                                break
                            elif resp.status_code in (429, 403):
                                await asyncio.sleep(4.0 * (attempt + 1))
                            else:
                                break
                        except Exception:
                            await asyncio.sleep(2.0)

                    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    updated_any = False
                    with db_session() as conn:
                        for tid, track_list in id_to_tracks.items():
                            item = results_map.get(tid)
                            if not item:
                                continue
                            updated_any = True
                            art_url = _upgrade_artwork(item.get("artworkUrl100") or item.get("artworkUrl60"))
                            preview_url = item.get("previewUrl")
                            rel_date = item.get("releaseDate")
                            rel_year = _extract_year(rel_date)
                            genre = item.get("primaryGenreName")
                            artist = primary_artist_name(item.get("artistName"))

                            conn.execute(
                                """
                                INSERT OR REPLACE INTO enrichment_cache (
                                    cache_key, artist_name, album_name, genre,
                                    release_year, release_date, artwork_url, preview_url,
                                    itunes_track_id, source, status, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    f"id:{tid}",
                                    artist,
                                    item.get("collectionName"),
                                    genre,
                                    rel_year,
                                    rel_date,
                                    art_url,
                                    preview_url,
                                    tid,
                                    "itunes_lookup",
                                    "enriched",
                                    now_iso,
                                ),
                            )
                            for tr in track_list:
                                self._apply_track_update(
                                    conn,
                                    tr["track_key"],
                                    artist=artist,
                                    genre=genre,
                                    release_year=rel_year,
                                    release_date=rel_date,
                                    artwork_url=art_url,
                                    preview_url=preview_url,
                                    itunes_track_id=tid,
                                    source="itunes_lookup",
                                    status="enriched",
                                    now_iso=now_iso,
                                )

                    if updated_any:
                        self.state["version"] += 1
                    self.get_snapshot()
                    self._broadcast()
                    await asyncio.sleep(1.2)

                # ----------------------------------------------------------
                # Stage 2a-bis: Resolve any remaining Spotify Technical Log IDs
                # ----------------------------------------------------------
                with db_session() as conn:
                    sp_rows = conn.execute(
                        """
                        SELECT tc.track_key, ptm.external_id AS spotify_id
                        FROM tracks_catalog tc
                        JOIN platform_track_mappings ptm
                          ON ptm.track_key = tc.track_key AND ptm.provider = 'spotify'
                        WHERE tc.song_name LIKE 'Spotify Track %'
                        ORDER BY tc.total_plays DESC, tc.total_ms DESC
                        """
                    ).fetchall()

                if sp_rows:
                    from .importers.spotify import (
                        _save_cached_track_metadata,
                        fetch_single_spotify_embed,
                    )

                    self.state["phase"] = "spotify_uri_resolve"
                    self._broadcast()
                    for idx, sr in enumerate(sp_rows):
                        if self._stop_event.is_set():
                            return
                        tid = str(sr["spotify_id"])
                        tkey = str(sr["track_key"])
                        self.state["current_track"] = f"Spotify URI ({idx + 1}/{len(sp_rows)}) {tid[:10]}"
                        meta = None
                        for attempt in range(3):
                            meta, rate_limited = await fetch_single_spotify_embed(client, tid)
                            if meta:
                                break
                            if rate_limited:
                                await asyncio.sleep(5.0 * (attempt + 1))
                            else:
                                break
                        if meta and meta.get("song_name"):
                            _save_cached_track_metadata({tid: meta})
                            song = meta["song_name"]
                            p_artist = primary_artist_name(meta.get("artist_name")) or "Artiste inconnu"
                            dur = int(meta.get("duration_ms") or 0) or None
                            with db_session() as conn:
                                conn.execute(
                                    """
                                    UPDATE tracks_catalog SET
                                        song_name = ?,
                                        song_norm = ?,
                                        song_group_key = ?,
                                        artist_name = ?,
                                        artist_norm = ?,
                                        artist_group_key = ?,
                                        artwork_url = COALESCE(artwork_url, ?),
                                        preview_url = COALESCE(preview_url, ?),
                                        release_year = COALESCE(release_year, ?),
                                        release_date = COALESCE(release_date, ?),
                                        duration_ms = CASE WHEN COALESCE(duration_ms, 0) <= 0 AND ? IS NOT NULL THEN ? ELSE duration_ms END
                                    WHERE track_key = ?
                                    """,
                                    (
                                        song,
                                        normalize_basic(song),
                                        clean_group_key(song, strip_feat=True) or normalize_basic(song),
                                        p_artist,
                                        normalize_basic(p_artist),
                                        clean_group_key(p_artist, strip_feat=True) or normalize_basic(p_artist),
                                        meta.get("artwork_url"),
                                        meta.get("preview_url"),
                                        meta.get("release_year"),
                                        meta.get("release_date"),
                                        dur,
                                        dur,
                                        tkey,
                                    ),
                                )
                            self.state["version"] += 1
                            self.get_snapshot()
                            self._broadcast()
                        await asyncio.sleep(0.35)

                # ----------------------------------------------------------
                # Stage 2b: Individual Search (iTunes Search Song+Album -> Deezer fallback)
                # Prioritized by total_plays DESC (Top tracks & missing artists first)
                # ----------------------------------------------------------
                self.state["phase"] = "itunes_search"
                self._broadcast()

                with db_session() as conn:
                    rem_rows = conn.execute(
                        """
                        SELECT track_key, song_name, album_name, artist_name, total_plays
                        FROM tracks_catalog
                        WHERE enrichment_status = 'local_only'
                        ORDER BY
                            CASE WHEN artist_name IS NULL THEN 0 ELSE 1 END ASC,
                            total_plays DESC,
                            total_ms DESC
                        """
                    ).fetchall()

                for idx, r in enumerate(rem_rows):
                    if self._stop_event.is_set():
                        return
                    tr = dict(r)
                    self.state["current_track"] = f"{tr['song_name']} — {tr['album_name'] or ''}"[:70]

                    match = await self._search_itunes(client, tr["song_name"], tr["album_name"], tr["artist_name"])
                    source = "itunes_search"
                    if not match:
                        match = await self._search_deezer(client, tr["song_name"], tr["album_name"], tr["artist_name"])
                        source = "deezer_search"
                    if not match or not match.get("artwork_url"):
                        caa = await self._search_cover_art_archive(
                            client, tr["song_name"], tr["album_name"], (match or {}).get("artist") or tr["artist_name"]
                        )
                        if caa:
                            if match:
                                match["artwork_url"] = caa["artwork_url"]
                            else:
                                match = caa
                                source = "cover_art_archive"

                    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                    with db_session() as conn:
                        if match:
                            conn.execute(
                                """
                                INSERT OR REPLACE INTO enrichment_cache (
                                    cache_key, artist_name, album_name, genre,
                                    release_year, release_date, artwork_url, preview_url,
                                    itunes_track_id, source, status, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    f"key:{tr['track_key']}",
                                    match.get("artist"),
                                    match.get("album"),
                                    match.get("genre"),
                                    match.get("release_year"),
                                    match.get("release_date"),
                                    match.get("artwork_url"),
                                    match.get("preview_url"),
                                    match.get("itunes_track_id"),
                                    source,
                                    "enriched",
                                    now_iso,
                                ),
                            )
                            self._apply_track_update(
                                conn,
                                tr["track_key"],
                                artist=match.get("artist"),
                                genre=match.get("genre"),
                                release_year=match.get("release_year"),
                                release_date=match.get("release_date"),
                                artwork_url=match.get("artwork_url"),
                                preview_url=match.get("preview_url"),
                                itunes_track_id=match.get("itunes_track_id"),
                                source=source,
                                status="enriched",
                                now_iso=now_iso,
                            )
                        else:
                            conn.execute(
                                """
                                INSERT OR REPLACE INTO enrichment_cache (
                                    cache_key, status, source, updated_at
                                ) VALUES (?, 'not_found', 'none', ?)
                                """,
                                (f"key:{tr['track_key']}", now_iso),
                            )
                            conn.execute(
                                """
                                UPDATE tracks_catalog
                                SET enrichment_status = 'not_found', enriched_at = ?
                                WHERE track_key = ?
                                """,
                                (now_iso, tr["track_key"]),
                            )

                    if idx % 5 == 0 or idx == len(rem_rows) - 1:
                        self.state["version"] += 1
                        self.get_snapshot()
                        self._broadcast()

                    # Respect iTunes ~20 req/min rate limit gracefully
                    await asyncio.sleep(2.6)

            self.state["phase"] = "done"
            self.state["current_track"] = None
            self.state["running"] = False
            self.state["version"] += 1
            self.get_snapshot()
            self._broadcast()
        except asyncio.CancelledError:
            self.state["running"] = False
            self.state["phase"] = "stopped"
            self._broadcast()
            raise
        except Exception as exc:
            self.state["running"] = False
            self.state["phase"] = f"error: {exc}"
            self._broadcast()

    def _apply_track_update(
        self,
        conn,
        track_key: str,
        *,
        artist: str | None,
        genre: str | None,
        release_year: int | None,
        release_date: str | None,
        artwork_url: str | None,
        preview_url: str | None,
        itunes_track_id: str | None,
        source: str,
        status: str,
        now_iso: str,
    ):
        existing = conn.execute(
            "SELECT artist_name, genre, release_year, release_date, artwork_url, preview_url, itunes_track_id FROM tracks_catalog WHERE track_key = ?",
            (track_key,),
        ).fetchone()
        if not existing:
            return

        final_artist = existing["artist_name"] or artist
        final_artist_norm = normalize_basic(final_artist) if final_artist else None
        final_artist_group = clean_group_key(final_artist) if final_artist else None

        conn.execute(
            """
            UPDATE tracks_catalog
            SET
                artist_name = ?,
                artist_norm = ?,
                artist_group_key = ?,
                genre = COALESCE(genre, ?),
                release_year = COALESCE(release_year, ?),
                release_date = COALESCE(release_date, ?),
                artwork_url = COALESCE(?, artwork_url),
                preview_url = COALESCE(?, preview_url),
                itunes_track_id = COALESCE(itunes_track_id, ?),
                enrichment_status = ?,
                enrichment_source = ?,
                enriched_at = ?
            WHERE track_key = ?
            """,
            (
                final_artist,
                final_artist_norm,
                final_artist_group,
                genre,
                release_year,
                release_date,
                artwork_url,
                preview_url,
                itunes_track_id,
                status,
                source,
                now_iso,
                track_key,
            ),
        )

    async def _search_itunes(
        self,
        client: httpx.AsyncClient,
        song_name: str,
        album_name: str,
        known_artist: str | None,
    ) -> dict[str, Any] | None:
        # Always combine Song Name + Album Name (or Artist if album missing) to avoid false matches
        if album_name:
            term = f"{song_name} {album_name}"
        elif known_artist:
            term = f"{song_name} {known_artist}"
        else:
            term = song_name

        for attempt in range(2):
            try:
                resp = await client.get(
                    "https://itunes.apple.com/search",
                    params={"term": term[:140], "entity": "song", "country": "fr", "limit": 6},
                )
                if resp.status_code in (429, 403):
                    await asyncio.sleep(6.0 * (attempt + 1))
                    continue
                if resp.status_code != 200:
                    return None
                results = resp.json().get("results", [])
                best_item = None
                best_score = 0.0
                for item in results:
                    s_song = similarity_score(song_name, item.get("trackName", ""))
                    s_album = similarity_score(album_name, item.get("collectionName", "")) if album_name else 0.5
                    s_art = similarity_score(known_artist, item.get("artistName", "")) if known_artist else 0.5
                    score = s_song * 0.55 + s_album * 0.30 + s_art * 0.15
                    if s_song >= 0.45 and score > best_score:
                        best_score = score
                        best_item = item
                if best_item and best_score >= 0.52:
                    rel_date = best_item.get("releaseDate")
                    return {
                        "artist": primary_artist_name(best_item.get("artistName")),
                        "album": best_item.get("collectionName"),
                        "genre": best_item.get("primaryGenreName"),
                        "release_year": _extract_year(rel_date),
                        "release_date": rel_date,
                        "artwork_url": _upgrade_artwork(best_item.get("artworkUrl100")),
                        "preview_url": best_item.get("previewUrl"),
                        "itunes_track_id": str(best_item.get("trackId") or "") or None,
                    }
                return None
            except Exception:
                await asyncio.sleep(1.5)
        return None

    async def _search_deezer(
        self,
        client: httpx.AsyncClient,
        song_name: str,
        album_name: str,
        known_artist: str | None,
    ) -> dict[str, Any] | None:
        q = f"{song_name} {known_artist or album_name}".strip()
        try:
            resp = await client.get("https://api.deezer.com/search", params={"q": q[:120], "limit": 5})
            if resp.status_code != 200:
                return None
            items = resp.json().get("data", [])
            best = None
            best_score = 0.0
            for item in items:
                s_song = similarity_score(song_name, item.get("title", ""))
                alb = (item.get("album") or {}).get("title", "")
                art = (item.get("artist") or {}).get("name", "")
                s_album = similarity_score(album_name, alb) if album_name else 0.5
                s_art = similarity_score(known_artist, art) if known_artist else 0.5
                score = s_song * 0.55 + s_album * 0.30 + s_art * 0.15
                if s_song >= 0.45 and score > best_score:
                    best_score = score
                    best = item
            if best and best_score >= 0.55:
                alb_obj = best.get("album") or {}
                art_obj = best.get("artist") or {}
                return {
                    "artist": primary_artist_name(art_obj.get("name")),
                    "album": alb_obj.get("title"),
                    "genre": None,
                    "release_year": None,
                    "release_date": None,
                    "artwork_url": alb_obj.get("cover_xl") or alb_obj.get("cover_big") or alb_obj.get("cover_medium"),
                    "preview_url": best.get("preview") or None,
                    "itunes_track_id": None,
                }
        except Exception:
            return None
        return None

    async def _search_cover_art_archive(
        self,
        client: httpx.AsyncClient,
        song_name: str,
        album_name: str | None,
        known_artist: str | None,
    ) -> dict[str, Any] | None:
        """Fallback #3: MusicBrainz release-group -> Cover Art Archive front-500."""
        query_album = album_name if album_name and album_name.lower() != "single / inconnu" else song_name
        if not query_album:
            return None
        q = f'releasegroup:"{query_album}"'
        if known_artist and known_artist.lower() != "artiste inconnu":
            q += f' AND artist:"{known_artist}"'
        try:
            resp = await client.get(
                "https://musicbrainz.org/ws/2/release-group/",
                params={"query": q, "fmt": "json", "limit": 2},
                headers={"User-Agent": "AMDataWrap/4.5.0 (https://github.com/Pibaps/AMDataWrap)"},
            )
            if resp.status_code != 200:
                return None
            groups = resp.json().get("release-groups") or []
            if not groups:
                return None
            rg_id = groups[0].get("id")
            if not rg_id:
                return None
            caa_url = f"https://coverartarchive.org/release-group/{rg_id}/front-500"
            head = await client.head(caa_url, follow_redirects=True)
            if head.status_code in (200, 302, 307):
                return {
                    "artist": primary_artist_name(known_artist) if known_artist else None,
                    "album": query_album,
                    "genre": None,
                    "release_year": None,
                    "release_date": None,
                    "artwork_url": str(head.url) if head.status_code == 200 else caa_url,
                    "preview_url": None,
                    "itunes_track_id": None,
                }
        except Exception:
            return None
        return None

    def queue_repair_missing(self) -> int:
        """Re-queue tracks missing artwork, missing/expired Deezer previews, or previously not_found."""
        with db_session() as conn:
            cur = conn.execute(
                """
                UPDATE tracks_catalog
                SET enrichment_status = 'local_only'
                WHERE artwork_url IS NULL
                   OR artwork_url = ''
                   OR preview_url IS NULL
                   OR preview_url = ''
                   OR preview_url LIKE '%dzcdn.net%'
                   OR enrichment_status = 'not_found'
                """
            )
            queued = int(cur.rowcount or 0)
            conn.execute("DELETE FROM enrichment_cache WHERE status = 'not_found'")
        self.get_snapshot()
        return queued


enrichment_manager = EnrichmentManager()
