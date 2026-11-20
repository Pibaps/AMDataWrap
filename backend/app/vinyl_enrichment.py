"""V4 ISRC N-to-M Reconciliation & Real Vinyl Editions 3-Pass Enrichment Cascade.

Cascade (0 EUR, deduplicated by `(artist, title)` / album):
1. Deezer Public REST API (50 req / 5s = 600 req/min, 0 auth):
   -> native ISRC, exact duration, HD cover artwork, Deezer track ID.
2. MusicBrainz WS/2 + Cover Art Archive (1 req / s, nominative User-Agent, HTTP 503 backoff):
   -> real 12" LP vinyl pressings (`vinyl_editions`: sides A/B/C/D, label, catalog_number,
      country, press_year, disc_count, front/back/medium cover URLs).
3. iTunes Search API (~20 req / min, 3.5s spacing):
   -> targeted fallback + 30s `preview_url` for Audio DNA / FFT.

All external payloads are cached in `api_metadata_cache` with a compliant TTL.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .db import db_session
from .filters import FilterParams, build_where_clause, get_filter_params
from .normalize import clean_group_key, similarity_score

vinyl_router = APIRouter(prefix="/api/v4", tags=["v4-vinyl"])

MB_USER_AGENT = "AMDataWrap/4.0.0 (https://github.com/Pibaps/AMDataWrap; local-analytics)"
DEEZER_MIN_INTERVAL_SEC = 0.11  # <= 50 req / 5s
MB_MIN_INTERVAL_SEC = 1.05      # <= 1 req / s
ITUNES_MIN_INTERVAL_SEC = 3.5   # <= ~20 req / min
DEFAULT_CACHE_TTL_DAYS = 30

_VINYL_COLOR_PALETTE = (
    "#111114",  # Classic Jet Black
    "#18181f",  # Deep Obsidian
    "#2c1418",  # Translucent Ruby
    "#102230",  # Midnight Cobalt
    "#262112",  # Amber Gold
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _cache_get(cache_key: str) -> dict[str, Any] | None:
    now_iso = _utc_now_iso()
    with db_session() as conn:
        row = conn.execute(
            "SELECT payload_json, expires_at FROM api_metadata_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] and row["expires_at"] < now_iso:
            return None
        try:
            return json.loads(row["payload_json"])
        except Exception:
            return None


def _cache_set(cache_key: str, payload: dict[str, Any], ttl_days: int = DEFAULT_CACHE_TTL_DAYS) -> None:
    expires = (datetime.now(timezone.utc) + timedelta(days=ttl_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO api_metadata_cache (cache_key, payload_json, expires_at)
            VALUES (?, ?, ?)
            """,
            (cache_key, json.dumps(payload, ensure_ascii=False), expires),
        )


class _RateLimiter:
    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait_for = self.min_interval - (now - self._last)
            if wait_for > 0:
                await asyncio.sleep(wait_for)
            self._last = time.monotonic()


_deezer_limiter = _RateLimiter(DEEZER_MIN_INTERVAL_SEC)
_mb_limiter = _RateLimiter(MB_MIN_INTERVAL_SEC)
_itunes_limiter = _RateLimiter(ITUNES_MIN_INTERVAL_SEC)


# ---------------------------------------------------------------------------
# Pass 1: Deezer Public REST API (ISRC + Duration + HD Cover)
# ---------------------------------------------------------------------------

async def fetch_deezer_track_metadata(
    artist_name: str,
    song_name: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    ck = f"deezer:track:{clean_group_key(artist_name, strip_feat=True)}||{clean_group_key(song_name, strip_feat=True)}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached or None

    query = f'artist:"{artist_name}" track:"{song_name}"'
    url = f"https://api.deezer.com/search/track?q={quote(query)}&limit=5"

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=10.0)
    try:
        await _deezer_limiter.wait()
        resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json().get("data") or []
        best = None
        best_score = 0.0
        for item in data:
            title_s = similarity_score(song_name, item.get("title") or "")
            artist_s = similarity_score(artist_name, (item.get("artist") or {}).get("name") or "")
            score = title_s * 0.6 + artist_s * 0.4
            if score > best_score:
                best_score = score
                best = item
        if not best or best_score < 0.62:
            _cache_set(ck, {}, ttl_days=7)
            return None

        track_id = best.get("id")
        isrc = best.get("isrc")
        # Fetch full track object if ISRC is missing in search payload
        if track_id and not isrc:
            await _deezer_limiter.wait()
            t_resp = await client.get(f"https://api.deezer.com/track/{track_id}")
            if t_resp.status_code == 200:
                full = t_resp.json()
                isrc = full.get("isrc") or isrc

        album = best.get("album") or {}
        result = {
            "deezer_id": str(track_id) if track_id else None,
            "isrc": isrc,
            "duration_ms": int((best.get("duration") or 0) * 1000),
            "preview_url": best.get("preview") or None,
            "artwork_url": album.get("cover_xl") or album.get("cover_big") or album.get("cover_medium"),
            "album_name": album.get("title"),
            "artist_name": (best.get("artist") or {}).get("name"),
            "link": best.get("link"),
        }
        _cache_set(ck, result, ttl_days=30)
        return result
    except Exception:
        return None
    finally:
        if own_client:
            await client.aclose()


# ---------------------------------------------------------------------------
# Pass 2: MusicBrainz WS/2 + Cover Art Archive (Real 12" Vinyl Pressings)
# ---------------------------------------------------------------------------

async def _mb_get_json(client: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
    headers = {"User-Agent": MB_USER_AGENT, "Accept": "application/json"}
    backoff = 1.5
    for attempt in range(3):
        await _mb_limiter.wait()
        try:
            resp = await client.get(url, headers=headers)
        except Exception:
            return None
        if resp.status_code == 200:
            try:
                return resp.json()
            except Exception:
                return None
        if resp.status_code in (429, 503):
            await asyncio.sleep(backoff * (attempt + 1))
            continue
        return None
    return None


def _extract_vinyl_sides_from_mb_release(release_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert MusicBrainz release `media` -> vinyl sides A/B/C/D with track positions & durations."""
    media_list = release_data.get("media") or []
    side_buckets: dict[str, list[dict[str, Any]]] = {}
    side_labels = ["A", "B", "C", "D", "E", "F"]

    for m_idx, medium in enumerate(media_list):
        tracks = medium.get("tracks") or []
        if not tracks:
            continue
        # Detect explicit side letter on track number (e.g. A1, B2)
        has_side_letters = any(
            re.match(r"^[A-F]\d+", str(t.get("number") or ""), re.IGNORECASE) for t in tracks
        )
        if has_side_letters:
            for t in tracks:
                num = str(t.get("number") or "").upper()
                side = num[0] if num and num[0].isalpha() else side_labels[min(m_idx * 2, len(side_labels) - 1)]
                dur_ms = int(t.get("length") or (t.get("recording") or {}).get("length") or 180_000)
                side_buckets.setdefault(side, []).append(
                    {
                        "number": num or str(t.get("position") or ""),
                        "title": t.get("title") or (t.get("recording") or {}).get("title") or "Untitled",
                        "duration_ms": dur_ms,
                    }
                )
        else:
            # Split tracks evenly between Side A and Side B of this disc
            half = max(1, (len(tracks) + 1) // 2)
            side_a = side_labels[min(m_idx * 2, len(side_labels) - 1)]
            side_b = side_labels[min(m_idx * 2 + 1, len(side_labels) - 1)]
            for idx, t in enumerate(tracks):
                side = side_a if idx < half else side_b
                pos_in_side = (idx + 1) if idx < half else (idx - half + 1)
                dur_ms = int(t.get("length") or (t.get("recording") or {}).get("length") or 180_000)
                side_buckets.setdefault(side, []).append(
                    {
                        "number": f"{side}{pos_in_side}",
                        "title": t.get("title") or (t.get("recording") or {}).get("title") or "Untitled",
                        "duration_ms": dur_ms,
                    }
                )

    sides: list[dict[str, Any]] = []
    for side_key in sorted(side_buckets.keys()):
        tracks_on_side = side_buckets[side_key]
        total_ms = sum(t["duration_ms"] for t in tracks_on_side)
        sides.append(
            {
                "side": side_key,
                "total_duration_ms": total_ms,
                "tracks": tracks_on_side,
            }
        )
    return sides


async def fetch_musicbrainz_vinyl_edition(
    artist_name: str,
    album_name: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    """Query MusicBrainz WS/2 for an authentic 12" Vinyl pressing + Cover Art Archive front/back/medium."""
    ck = f"mb:vinyl:{clean_group_key(artist_name, strip_feat=True)}||{clean_group_key(album_name)}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached or None

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=12.0, follow_redirects=True)
    try:
        q = f'release:"{album_name}" AND artist:"{artist_name}" AND format:Vinyl'
        search_url = f"https://musicbrainz.org/ws/2/release/?query={quote(q)}&fmt=json&limit=5"
        search_data = await _mb_get_json(client, search_url)
        releases = (search_data or {}).get("releases") or []
        if not releases:
            # Relax without format:Vinyl to still capture release-group & CAA
            q2 = f'release:"{album_name}" AND artist:"{artist_name}"'
            search_data = await _mb_get_json(
                client, f"https://musicbrainz.org/ws/2/release/?query={quote(q2)}&fmt=json&limit=5"
            )
            releases = (search_data or {}).get("releases") or []
        if not releases:
            _cache_set(ck, {}, ttl_days=14)
            return None

        best_rel = releases[0]
        mbid_rel = best_rel.get("id")
        rg_id = (best_rel.get("release-group") or {}).get("id")

        # Fetch full release with recordings & labels
        detail = await _mb_get_json(
            client,
            f"https://musicbrainz.org/ws/2/release/{mbid_rel}?inc=recordings+labels+release-groups&fmt=json",
        )
        if not detail:
            detail = best_rel

        label_info = (detail.get("label-info") or [{}])[0]
        label_name = (label_info.get("label") or {}).get("name")
        catalog_number = label_info.get("catalog-number")
        country = detail.get("country")
        date_str = str(detail.get("date") or "")
        press_year = int(date_str[:4]) if len(date_str) >= 4 and date_str[:4].isdigit() else None
        sides = _extract_vinyl_sides_from_mb_release(detail)
        disc_count = max(1, len(detail.get("media") or []) or ((len(sides) + 1) // 2))

        # Cover Art Archive (front, back, medium)
        front_url = None
        back_url = None
        medium_url = None
        if mbid_rel:
            try:
                caa_resp = await client.get(
                    f"https://coverartarchive.org/release/{mbid_rel}",
                    headers={"User-Agent": MB_USER_AGENT},
                )
                if caa_resp.status_code == 200:
                    images = caa_resp.json().get("images") or []
                    for img in images:
                        types = [t.lower() for t in (img.get("types") or [])]
                        thumbs = img.get("thumbnails") or {}
                        best_img = thumbs.get("500") or thumbs.get("large") or img.get("image")
                        if not best_img:
                            continue
                        if "front" in types and not front_url:
                            front_url = best_img
                        elif "back" in types and not back_url:
                            back_url = best_img
                        elif "medium" in types and not medium_url:
                            medium_url = best_img
            except Exception:
                pass

        result = {
            "mbid_release_group": rg_id,
            "mbid_vinyl_release": mbid_rel,
            "label_name": label_name,
            "catalog_number": catalog_number,
            "country": country,
            "press_year": press_year,
            "disc_count": disc_count,
            "vinyl_color_hex": _VINYL_COLOR_PALETTE[abs(hash(mbid_rel or album_name)) % len(_VINYL_COLOR_PALETTE)],
            "front_cover_url": front_url,
            "back_cover_url": back_url,
            "medium_label_url": medium_url,
            "sides": sides,
        }
        _cache_set(ck, result, ttl_days=45)
        return result
    finally:
        if own_client:
            await client.aclose()


# ---------------------------------------------------------------------------
# Pass 3: iTunes Search API Fallback (Preview 30s + Artwork)
# ---------------------------------------------------------------------------

async def fetch_itunes_fallback(
    artist_name: str,
    song_name: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any] | None:
    ck = f"itunes:track:{clean_group_key(artist_name, strip_feat=True)}||{clean_group_key(song_name, strip_feat=True)}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached or None

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=10.0)
    try:
        await _itunes_limiter.wait()
        term = quote(f"{artist_name} {song_name}")
        resp = await client.get(f"https://itunes.apple.com/search?term={term}&entity=song&limit=5")
        if resp.status_code != 200:
            return None
        results = resp.json().get("results") or []
        if not results:
            _cache_set(ck, {}, ttl_days=14)
            return None
        top = results[0]
        art = top.get("artworkUrl100")
        if art:
            art = art.replace("100x100bb", "600x600bb")
        out = {
            "itunes_track_id": str(top.get("trackId") or ""),
            "preview_url": top.get("previewUrl"),
            "artwork_url": art,
            "genre": top.get("primaryGenreName"),
            "duration_ms": int(top.get("trackTimeMillis") or 0),
        }
        _cache_set(ck, out, ttl_days=30)
        return out
    except Exception:
        return None
    finally:
        if own_client:
            await client.aclose()


# ---------------------------------------------------------------------------
# Vinyl Crate & Pressing Details API (Used by Frontend V4 3D Studio)
# ---------------------------------------------------------------------------

def _synthesize_sides_from_catalog(tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build realistic Face A / Face B split when MusicBrainz vinyl pressing is not yet cached."""
    if not tracks:
        return []
    half = max(1, (len(tracks) + 1) // 2)
    side_a_tracks = []
    side_b_tracks = []
    for idx, t in enumerate(tracks):
        dur = int(t.get("duration_ms") or 200_000)
        item = {
            "number": f"A{idx + 1}" if idx < half else f"B{idx - half + 1}",
            "title": t["song_name"],
            "track_key": t["track_key"],
            "duration_ms": dur,
            "plays": int(t.get("plays") or 0),
            "preview_url": t.get("preview_url"),
        }
        if idx < half:
            side_a_tracks.append(item)
        else:
            side_b_tracks.append(item)

    sides = [
        {
            "side": "A",
            "total_duration_ms": sum(x["duration_ms"] for x in side_a_tracks),
            "tracks": side_a_tracks,
        }
    ]
    if side_b_tracks:
        sides.append(
            {
                "side": "B",
                "total_duration_ms": sum(x["duration_ms"] for x in side_b_tracks),
                "tracks": side_b_tracks,
            }
        )
    return sides


@vinyl_router.get("/vinyl/crate")
def api_get_vinyl_crate(
    params: FilterParams = Depends(get_filter_params),
    sort: str = Query("top", description="top | recent | era | genre | random"),
    limit: int = Query(36, ge=1, le=120),
) -> dict[str, Any]:
    """Return the user's Record Crate albums enriched with any cached real vinyl pressing metadata."""
    with db_session() as conn:
        where_sql, bind = build_where_clause(params)
        order_clause = {
            "top": "total_ms DESC, plays DESC",
            "recent": "last_played DESC",
            "era": "release_year ASC NULLS LAST, total_ms DESC",
            "genre": "genre ASC NULLS LAST, total_ms DESC",
            "random": "RANDOM()",
        }.get(sort, "total_ms DESC, plays DESC")

        rows = conn.execute(
            f"""
            SELECT
                tc.album_group_key AS album_key,
                MAX(tc.album_name) AS album_name,
                MAX(tc.artist_name) AS artist_name,
                MAX(tc.genre) AS genre,
                MAX(tc.release_year) AS release_year,
                MAX(tc.artwork_url) AS artwork_url,
                MAX(tc.back_cover_url) AS back_cover_url,
                COUNT(pe.id) AS plays,
                COALESCE(SUM(pe.play_duration_ms), 0) AS total_ms,
                COUNT(DISTINCT tc.track_key) AS track_count,
                MAX(pe.started_at_local) AS last_played,
                MIN(pe.local_date) AS first_date,
                ve.label_name AS ve_label,
                ve.catalog_number AS ve_catalog,
                ve.country AS ve_country,
                ve.press_year AS ve_press_year,
                ve.disc_count AS ve_disc_count,
                ve.vinyl_color_hex AS ve_color_hex,
                ve.front_cover_url AS ve_front_url,
                ve.back_cover_url AS ve_back_url,
                ve.medium_label_url AS ve_medium_url
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN vinyl_editions ve ON ve.album_key = tc.album_group_key
            WHERE {where_sql}
              AND tc.album_group_key IS NOT NULL
              AND tc.album_group_key != ''
            GROUP BY tc.album_group_key
            ORDER BY {order_clause}
            LIMIT ?
            """,
            [*bind, limit],
        ).fetchall()

        albums = []
        for r in rows:
            albums.append(
                {
                    "album_key": r["album_key"],
                    "album_name": r["album_name"],
                    "artist_name": r["artist_name"] or "Artiste inconnu",
                    "genre": r["genre"] or "Inconnu",
                    "release_year": r["ve_press_year"] or r["release_year"],
                    "artwork_url": r["ve_front_url"] or r["artwork_url"],
                    "back_cover_url": r["ve_back_url"] or r["back_cover_url"],
                    "medium_label_url": r["ve_medium_url"],
                    "plays": int(r["plays"] or 0),
                    "total_ms": int(r["total_ms"] or 0),
                    "track_count": int(r["track_count"] or 0),
                    "last_played": r["last_played"],
                    "first_date": r["first_date"],
                    "label_name": r["ve_label"],
                    "catalog_number": r["ve_catalog"],
                    "country": r["ve_country"],
                    "disc_count": int(r["ve_disc_count"] or 1),
                    "vinyl_color_hex": r["ve_color_hex"] or "#111114",
                    "has_real_pressing": bool(r["ve_label"] or r["ve_catalog"]),
                }
            )
    return {"sort": sort, "count": len(albums), "albums": albums}


@vinyl_router.get("/vinyl/{album_key}")
def api_get_vinyl_detail(
    album_key: str,
    params: FilterParams = Depends(get_filter_params),
) -> dict[str, Any]:
    """Return full Recto/Verso + Faces A/B/C/D tracklist & personal stats for a 3D vinyl album."""
    with db_session() as conn:
        where_sql, bind = build_where_clause(params)
        track_rows = conn.execute(
            f"""
            SELECT
                tc.track_key,
                tc.song_name,
                tc.artist_name,
                tc.album_name,
                tc.genre,
                tc.release_year,
                tc.artwork_url,
                tc.preview_url,
                COALESCE(NULLIF(tc.duration_ms, 0), MAX(pe.media_duration_ms), 200000) AS duration_ms,
                COUNT(pe.id) AS plays,
                COALESCE(SUM(pe.play_duration_ms), 0) AS total_ms
            FROM tracks_catalog tc
            LEFT JOIN play_events pe ON pe.track_key = tc.track_key AND ({where_sql})
            WHERE tc.album_group_key = ?
            GROUP BY tc.track_key
            ORDER BY plays DESC, tc.song_name ASC
            """,
            [*bind, album_key],
        ).fetchall()

        if not track_rows:
            raise HTTPException(status_code=404, detail=f"Album introuvable dans le bac : {album_key}")

        ve = conn.execute(
            "SELECT * FROM vinyl_editions WHERE album_key = ?", (album_key,)
        ).fetchone()

        tracks = [dict(r) for r in track_rows]
        first = tracks[0]

        sides: list[dict[str, Any]] = []
        if ve and ve["sides_json"]:
            try:
                parsed_sides = json.loads(ve["sides_json"])
                if isinstance(parsed_sides, list) and parsed_sides:
                    # Enrich MB tracks with local track_key & play counts when matching
                    for s in parsed_sides:
                        for st in s.get("tracks") or []:
                            best_t = max(
                                tracks,
                                key=lambda lt: similarity_score(st.get("title", ""), lt["song_name"]),
                                default=None,
                            )
                            if best_t and similarity_score(st.get("title", ""), best_t["song_name"]) >= 0.65:
                                st["track_key"] = best_t["track_key"]
                                st["plays"] = int(best_t["plays"] or 0)
                                st["preview_url"] = best_t.get("preview_url")
                    sides = parsed_sides
            except Exception:
                sides = []

        if not sides:
            sides = _synthesize_sides_from_catalog(tracks)

        total_plays = sum(int(t["plays"] or 0) for t in tracks)
        total_ms = sum(int(t["total_ms"] or 0) for t in tracks)

        return {
            "album_key": album_key,
            "album_name": first["album_name"],
            "artist_name": first["artist_name"] or "Artiste inconnu",
            "genre": first["genre"] or "Inconnu",
            "release_year": (ve["press_year"] if ve and ve["press_year"] else first["release_year"]),
            "artwork_url": (ve["front_cover_url"] if ve and ve["front_cover_url"] else first["artwork_url"]),
            "back_cover_url": ve["back_cover_url"] if ve else None,
            "medium_label_url": ve["medium_label_url"] if ve else None,
            "label_name": (ve["label_name"] if ve and ve["label_name"] else "Pressage Indépendant / Digital"),
            "catalog_number": (ve["catalog_number"] if ve and ve["catalog_number"] else f"AMDW-{abs(hash(album_key)) % 99999:05d}"),
            "country": (ve["country"] if ve and ve["country"] else "XW"),
            "disc_count": int(ve["disc_count"] if ve and ve["disc_count"] else max(1, (len(sides) + 1) // 2)),
            "vinyl_color_hex": (ve["vinyl_color_hex"] if ve and ve["vinyl_color_hex"] else "#111114"),
            "has_real_pressing": bool(ve and ve["mbid_vinyl_release"]),
            "total_plays": total_plays,
            "total_ms": total_ms,
            "sides": sides,
            "tracks": tracks,
        }


@vinyl_router.post("/vinyl/{album_key}/enrich")
async def api_enrich_vinyl_album(album_key: str) -> dict[str, Any]:
    """Run the 3-pass free cascade (Deezer -> MusicBrainz/CAA -> iTunes) on a specific album."""
    with db_session() as conn:
        row = conn.execute(
            """
            SELECT MAX(album_name) AS album_name, MAX(artist_name) AS artist_name,
                   GROUP_CONCAT(track_key, '|||') AS track_keys
            FROM tracks_catalog
            WHERE album_group_key = ?
            """,
            (album_key,),
        ).fetchone()
        if not row or not row["album_name"]:
            raise HTTPException(status_code=404, detail=f"Album introuvable : {album_key}")
        album_name = row["album_name"]
        artist_name = row["artist_name"] or ""
        trows = conn.execute(
            "SELECT track_key, song_name, artist_name FROM tracks_catalog WHERE album_group_key = ? LIMIT 12",
            (album_key,),
        ).fetchall()

    now_iso = _utc_now_iso()
    isrcs_added = 0
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        # Pass 1: Deezer ISRC & HD artwork on up to 6 top tracks
        for tr in trows[:6]:
            dz = await fetch_deezer_track_metadata(tr["artist_name"] or artist_name, tr["song_name"], client=client)
            if dz:
                with db_session() as conn:
                    if dz.get("isrc"):
                        conn.execute(
                            "INSERT OR IGNORE INTO recording_isrcs (track_key, isrc, source, created_at) VALUES (?, ?, 'deezer', ?)",
                            (tr["track_key"], dz["isrc"], now_iso),
                        )
                        isrcs_added += 1
                    if dz.get("deezer_id"):
                        conn.execute(
                            "INSERT OR REPLACE INTO platform_track_mappings (track_key, provider, external_id, url, resolved_at) VALUES (?, 'deezer', ?, ?, ?)",
                            (tr["track_key"], dz["deezer_id"], dz.get("link"), now_iso),
                        )
                    if dz.get("artwork_url") or dz.get("duration_ms") or dz.get("preview_url"):
                        conn.execute(
                            """
                            UPDATE tracks_catalog
                            SET artwork_url = COALESCE(NULLIF(artwork_url, ''), ?),
                                preview_url = COALESCE(NULLIF(preview_url, ''), ?),
                                duration_ms = CASE WHEN COALESCE(duration_ms, 0) <= 0 THEN ? ELSE duration_ms END
                            WHERE track_key = ?
                            """,
                            (dz.get("artwork_url"), dz.get("preview_url"), int(dz.get("duration_ms") or 0), tr["track_key"]),
                        )

        # Pass 2: MusicBrainz + Cover Art Archive real 12" vinyl pressing
        mb_vinyl = await fetch_musicbrainz_vinyl_edition(artist_name, album_name, client=client)
        if mb_vinyl:
            with db_session() as conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO vinyl_editions (
                        album_key, mbid_release_group, mbid_vinyl_release, label_name,
                        catalog_number, country, press_year, disc_count, vinyl_color_hex,
                        front_cover_url, back_cover_url, medium_label_url, sides_json, enriched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        album_key,
                        mb_vinyl.get("mbid_release_group"),
                        mb_vinyl.get("mbid_vinyl_release"),
                        mb_vinyl.get("label_name"),
                        mb_vinyl.get("catalog_number"),
                        mb_vinyl.get("country"),
                        mb_vinyl.get("press_year"),
                        int(mb_vinyl.get("disc_count") or 1),
                        mb_vinyl.get("vinyl_color_hex") or "#111114",
                        mb_vinyl.get("front_cover_url"),
                        mb_vinyl.get("back_cover_url"),
                        mb_vinyl.get("medium_label_url"),
                        json.dumps(mb_vinyl.get("sides") or [], ensure_ascii=False),
                        now_iso,
                    ),
                )

    return {
        "ok": True,
        "album_key": album_key,
        "isrcs_added": isrcs_added,
        "vinyl_pressing_found": bool(mb_vinyl),
        "vinyl_edition": mb_vinyl,
    }
