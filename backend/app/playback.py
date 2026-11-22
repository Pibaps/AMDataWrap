"""V4 Hybrid 0 EUR Full-Track Playback Engine & Browser Extension MV3 Bridge.

Providers:
1. `YouTubeIFrameProvider` (default, PC & Mobile, 0 install):
   - Resolves `videoId` via `ytmusicapi` without auth (`YTMusic().search(..., filter="songs")`),
     cached permanently in `platform_track_mappings` (`provider='youtube'`).
   - Fallback to MusicBrainz `url-rels` when needed.
   - Records real playback completion into `reconciler.py` (`source_provider='youtube_iframe'`).
2. `ExtensionBridgeProvider` (PC opt-in, real subscriber accounts at 0 EUR):
   - Local WebSocket hub at `WS /ws/bridge` connecting `extensions/amdatawrap-bridge/` (MV3)
     and frontend-v4 playback controls.
   - Supports Apple Music Web (`window.MusicKit.getInstance()`), Spotify Web, YouTube Music.
3. `PreviewAudioProvider`: 30s non-DRM preview fallback for Web Audio FFT / Audio DNA.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from .continuum.live_hub import now_playing_hub
from .continuum.reconciler import IncomingScrobble, reconcile_batch, update_now_playing
from .db import db_session
from .normalize import make_track_key, similarity_score
from .vinyl_enrichment import fetch_deezer_track_metadata

playback_router = APIRouter(tags=["v4-playback"])


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_HARD_PENALTY_KEYWORDS = ("karaoke", "karaoké", "tribute", "cover", "parody", "reaction", "tutorial")
_SOFT_PENALTY_KEYWORDS = ("live", "concert", "remix", "slowed", "sped up", "nightcore", "8d", "acoustic", "instrumental")


def _search_ytmusic_sync(
    query: str, song_name: str, artist_name: str, album_name: str = ""
) -> dict[str, Any] | None:
    """Resolve a YouTube Music song `videoId` without authentication using `ytmusicapi`."""
    try:
        from ytmusicapi import YTMusic  # type: ignore

        ytm = YTMusic()
        results = ytm.search(query, filter="songs", limit=8) or []
        best = None
        best_score = -999.0
        clean_album = album_name if album_name and album_name.lower() != "single / inconnu" else ""
        req_context = f"{song_name} {clean_album}".lower()
        for item in results:
            vid = item.get("videoId")
            if not vid:
                continue
            title = item.get("title") or ""
            artists = ", ".join(a.get("name", "") for a in (item.get("artists") or []) if isinstance(a, dict))
            alb = (item.get("album") or {}).get("name") or "" if isinstance(item.get("album"), dict) else ""
            if clean_album:
                score = (
                    similarity_score(song_name, title) * 0.55
                    + similarity_score(artist_name, artists) * 0.25
                    + similarity_score(clean_album, alb) * 0.20
                )
            else:
                score = similarity_score(song_name, title) * 0.65 + similarity_score(artist_name, artists) * 0.35

            cand_text = f"{title} {alb} {artists}".lower()
            for kw in _HARD_PENALTY_KEYWORDS:
                if kw in cand_text and kw not in req_context:
                    score -= 0.45
            for kw in _SOFT_PENALTY_KEYWORDS:
                if kw in cand_text and kw not in req_context:
                    score -= 0.30

            if score > best_score:
                best_score = score
                best = {
                    "video_id": vid,
                    "title": title,
                    "artist": artists,
                    "duration_seconds": item.get("duration_seconds") or 0,
                    "url": f"https://music.youtube.com/watch?v={vid}",
                    "score": round(score, 3),
                }
        if best:
            return best
        # Fallback to first result with videoId if similarity heuristic was strict
        for item in results:
            if item.get("videoId"):
                vid = item["videoId"]
                return {
                    "video_id": vid,
                    "title": item.get("title") or song_name,
                    "artist": artist_name,
                    "duration_seconds": item.get("duration_seconds") or 0,
                    "url": f"https://music.youtube.com/watch?v={vid}",
                    "score": 0.5,
                }
    except Exception:
        return None
    return None


async def _fallback_musicbrainz_youtube_url(artist_name: str, song_name: str) -> str | None:
    """Fallback: check MusicBrainz recording `url-rels` for an official YouTube link."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://musicbrainz.org/ws/2/recording/",
                params={"query": f'recording:"{song_name}" AND artist:"{artist_name}"', "fmt": "json", "limit": 2},
                headers={"User-Agent": "AMDataWrap/4.0.0 (local-analytics)"},
            )
            if resp.status_code != 200:
                return None
            recs = resp.json().get("recordings") or []
            if not recs:
                return None
            mbid = recs[0].get("id")
            if not mbid:
                return None
            rel_resp = await client.get(
                f"https://musicbrainz.org/ws/2/recording/{mbid}",
                params={"inc": "url-rels", "fmt": "json"},
                headers={"User-Agent": "AMDataWrap/4.0.0 (local-analytics)"},
            )
            if rel_resp.status_code != 200:
                return None
            for rel in rel_resp.json().get("relations") or []:
                res_url = (rel.get("url") or {}).get("resource") or ""
                if "youtube.com/watch?v=" in res_url:
                    return res_url.split("v=")[-1].split("&")[0]
                if "youtu.be/" in res_url:
                    return res_url.split("youtu.be/")[-1].split("?")[0]
    except Exception:
        return None
    return None


@playback_router.get("/api/v4/playback/resolve")
async def api_resolve_playback(
    song: str = Query(..., min_length=1),
    artist: str = Query(""),
    album: str = Query(""),
    track_key: str | None = Query(None),
    force_refresh: bool = Query(False),
) -> dict[str, Any]:
    """Resolve a track to a playable YouTube `videoId` (cached in `platform_track_mappings`) + preview fallback."""
    tkey = track_key or make_track_key(song, album or "Single / Inconnu")
    preview_url: str | None = None
    artwork_url: str | None = None
    album_key: str | None = None
    duration_ms: int = 0
    effective_artist = artist
    effective_album = album

    with db_session() as conn:
        t_row = conn.execute(
            "SELECT track_key, album_group_key, artist_name, album_name, preview_url, artwork_url, duration_ms FROM tracks_catalog WHERE track_key = ?",
            (tkey,),
        ).fetchone()
        if not t_row:
            if effective_artist:
                t_row = conn.execute(
                    """
                    SELECT track_key, album_group_key, artist_name, album_name, preview_url, artwork_url, duration_ms
                    FROM tracks_catalog
                    WHERE LOWER(song_name) = LOWER(?) AND LOWER(COALESCE(artist_name, '')) = LOWER(?)
                    ORDER BY total_plays DESC
                    LIMIT 1
                    """,
                    (song, effective_artist),
                ).fetchone()
            if not t_row:
                t_row = conn.execute(
                    """
                    SELECT track_key, album_group_key, artist_name, album_name, preview_url, artwork_url, duration_ms
                    FROM tracks_catalog
                    WHERE LOWER(song_name) = LOWER(?)
                    ORDER BY total_plays DESC
                    LIMIT 1
                    """,
                    (song,),
                ).fetchone()
            if t_row:
                tkey = t_row["track_key"]

        if t_row:
            preview_url = t_row["preview_url"]
            artwork_url = t_row["artwork_url"]
            album_key = t_row["album_group_key"]
            duration_ms = int(t_row["duration_ms"] or 0)
            if t_row["artist_name"]:
                effective_artist = t_row["artist_name"]
            if t_row["album_name"] and not effective_album:
                effective_album = t_row["album_name"]

        # 1. Check permanent cache in platform_track_mappings
        cached = None
        if not force_refresh:
            cached = conn.execute(
                """
                SELECT external_id, url FROM platform_track_mappings
                WHERE track_key = ? AND provider = 'youtube'
                LIMIT 1
                """,
                (tkey,),
            ).fetchone()

        if cached and cached["external_id"]:
            return {
                "ok": True,
                "cached": True,
                "provider": "youtube_iframe",
                "track_key": tkey,
                "album_key": album_key,
                "duration_ms": duration_ms,
                "video_id": cached["external_id"],
                "url": cached["url"] or f"https://music.youtube.com/watch?v={cached['external_id']}",
                "preview_url": preview_url,
                "artwork_url": artwork_url,
            }

    # 2. Live resolve via ytmusicapi (no auth) — include album context to avoid OST/short-title mismatches
    clean_album = effective_album if effective_album and effective_album.lower() != "single / inconnu" else ""
    query = f"{effective_artist} {song} {clean_album}".strip() if clean_album else f"{effective_artist} {song}".strip()
    found = await asyncio.to_thread(_search_ytmusic_sync, query, song, effective_artist, clean_album)
    video_id = found["video_id"] if found else None
    url = found["url"] if found else None

    # 3. Fallback to MusicBrainz url-rels
    if not video_id and artist:
        mb_vid = await _fallback_musicbrainz_youtube_url(artist, song)
        if mb_vid:
            video_id = mb_vid
            url = f"https://www.youtube.com/watch?v={mb_vid}"

    if video_id:
        with db_session() as conn:
            # Ensure track exists in catalog before FK insert
            exists = conn.execute("SELECT 1 FROM tracks_catalog WHERE track_key = ?", (tkey,)).fetchone()
            if exists:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO platform_track_mappings (
                        track_key, provider, external_id, url, resolved_at
                    ) VALUES (?, 'youtube', ?, ?, ?)
                    """,
                    (tkey, video_id, url, _utc_now_iso()),
                )
        return {
            "ok": True,
            "cached": False,
            "provider": "youtube_iframe",
            "track_key": tkey,
            "album_key": album_key,
            "duration_ms": duration_ms,
            "video_id": video_id,
            "url": url,
            "preview_url": preview_url,
            "artwork_url": artwork_url,
        }

    return {
        "ok": bool(preview_url),
        "cached": False,
        "provider": "preview_audio" if preview_url else "none",
        "track_key": tkey,
        "album_key": album_key,
        "duration_ms": duration_ms,
        "video_id": None,
        "url": None,
        "preview_url": preview_url,
        "artwork_url": artwork_url,
    }


@playback_router.get("/api/v4/playback/refresh-preview")
async def api_refresh_preview(
    song: str = Query(..., min_length=1),
    artist: str = Query(""),
    album: str = Query(""),
    track_key: str | None = Query(None),
) -> dict[str, Any]:
    """Transparently refresh an expired 30s preview URL (preferring non-expiring iTunes over Deezer)."""
    tkey = track_key or make_track_key(song, album or "Single / Inconnu")
    clean_artist = artist if artist and artist.lower() != "artiste inconnu" else ""
    term = f"{clean_artist} {song}".strip()
    preview_url: str | None = None
    artwork_url: str | None = None
    source: str | None = None

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://itunes.apple.com/search",
                params={"term": term[:140], "entity": "song", "country": "fr", "limit": 5},
            )
            if resp.status_code == 200:
                items = resp.json().get("results") or []
                best_item = None
                best_score = 0.0
                for it in items:
                    sc = similarity_score(song, it.get("trackName") or "") * 0.65
                    if clean_artist:
                        sc += similarity_score(clean_artist, it.get("artistName") or "") * 0.35
                    else:
                        sc += 0.25
                    if it.get("previewUrl") and sc > best_score:
                        best_score = sc
                        best_item = it
                if best_item and best_score >= 0.45:
                    preview_url = best_item.get("previewUrl")
                    art = best_item.get("artworkUrl100")
                    if art:
                        artwork_url = art.replace("100x100bb", "600x600bb")
                    source = "itunes"
    except Exception:
        pass

    if not preview_url:
        try:
            dz = await fetch_deezer_track_metadata(clean_artist or "", song)
            if dz and dz.get("preview_url"):
                preview_url = dz["preview_url"]
                artwork_url = artwork_url or dz.get("artwork_url")
                source = "deezer"
        except Exception:
            pass

    if preview_url:
        with db_session() as conn:
            conn.execute(
                """
                UPDATE tracks_catalog
                SET preview_url = ?,
                    artwork_url = COALESCE(artwork_url, ?)
                WHERE track_key = ?
                """,
                (preview_url, artwork_url, tkey),
            )

    return {
        "ok": bool(preview_url),
        "track_key": tkey,
        "preview_url": preview_url,
        "artwork_url": artwork_url,
        "source": source,
    }


class PlaybackScrobbleIn(BaseModel):
    song_name: str = Field(..., min_length=1)
    artist_name: str = Field("Artiste inconnu")
    album_name: str = Field("")
    play_duration_ms: int = Field(0, ge=0)
    media_duration_ms: int = Field(0, ge=0)
    provider: str = Field("youtube_iframe")
    started_epoch: int | None = None
    video_id: str | None = None
    artwork_url: str | None = None
    event_type: str = Field("scrobble", description="now_playing | scrobble")


@playback_router.post("/api/v4/playback/scrobble")
async def api_playback_scrobble(payload: PlaybackScrobbleIn) -> dict[str, Any]:
    """Record live playback or completed track from YouTube IFrame / Extension MV3."""
    if payload.event_type == "now_playing":
        update_now_playing(
            provider=payload.provider,
            song_name=payload.song_name,
            artist_name=payload.artist_name,
            album_name=payload.album_name,
            artwork_url=payload.artwork_url,
            duration_ms=payload.media_duration_ms,
            position_ms=payload.play_duration_ms,
            is_playing=True,
        )
        await now_playing_hub.broadcast(
            {
                "provider": payload.provider,
                "song_name": payload.song_name,
                "artist_name": payload.artist_name,
                "album_name": payload.album_name,
                "artwork_url": payload.artwork_url,
                "duration_ms": payload.media_duration_ms,
                "position_ms": payload.play_duration_ms,
                "is_playing": True,
            }
        )
        return {"ok": True, "event_type": "now_playing"}

    epoch = payload.started_epoch or int(time.time())
    media_ms = payload.media_duration_ms or max(payload.play_duration_ms, 180_000)
    sc = IncomingScrobble(
        source_provider=payload.provider,
        song_name=payload.song_name,
        artist_name=payload.artist_name,
        album_name=payload.album_name,
        started_epoch=epoch,
        play_duration_ms=payload.play_duration_ms,
        media_duration_ms=media_ms,
        source_event_id=f"{payload.provider}:{epoch}:{payload.video_id or payload.song_name[:24]}",
        device_label=f"AMDataWrap V4 ({payload.provider})",
        device_os="Web",
        is_valid_lastfm=1 if payload.play_duration_ms >= 30_000 else 0,
        is_skip_30s=1 if 0 < payload.play_duration_ms < 30_000 else 0,
    )
    stats = reconcile_batch([sc])
    return {"ok": True, "event_type": "scrobble", "reconciled": stats}


# ---------------------------------------------------------------------------
# Extension MV3 Bridge WebSocket Hub (`WS /ws/bridge`)
# ---------------------------------------------------------------------------

@playback_router.get("/api/v4/playback/apple-hints")
async def api_playback_apple_hints(
    song: str = Query(..., min_length=1),
    artist: str = Query(""),
    album: str = Query(""),
    track_key: str | None = Query(None),
) -> dict[str, Any]:
    """Return cached Apple Music catalog ID and known ISRCs (from `recording_isrcs` or live Deezer)."""
    clean_album = album if album and album.lower() != "single / inconnu" else ""
    tkey = track_key or make_track_key(song, clean_album or "Single / Inconnu")
    cached_song_id: str | None = None
    isrcs: list[str] = []
    effective_artist = artist
    effective_album = clean_album

    with db_session() as conn:
        cached = conn.execute(
            """
            SELECT external_id FROM platform_track_mappings
            WHERE track_key = ? AND provider = 'apple_music'
            LIMIT 1
            """,
            (tkey,),
        ).fetchone()
        if cached and cached["external_id"]:
            cached_song_id = str(cached["external_id"])

        isrc_rows = conn.execute(
            "SELECT DISTINCT isrc FROM recording_isrcs WHERE track_key = ? AND isrc IS NOT NULL AND isrc != ''",
            (tkey,),
        ).fetchall()
        isrcs = [str(r["isrc"]).strip().upper() for r in isrc_rows if r["isrc"]]

        t_row = conn.execute(
            "SELECT artist_name, album_name FROM tracks_catalog WHERE track_key = ?",
            (tkey,),
        ).fetchone()
        if t_row:
            if not effective_artist and t_row["artist_name"]:
                effective_artist = t_row["artist_name"]
            if not effective_album and t_row["album_name"]:
                effective_album = t_row["album_name"]

    if not isrcs and not cached_song_id and effective_artist and effective_artist.lower() != "artiste inconnu":
        try:
            dz = await fetch_deezer_track_metadata(effective_artist, song)
        except Exception:
            dz = None
        if dz and dz.get("isrc"):
            found_isrc = str(dz["isrc"]).strip().upper()
            isrcs.append(found_isrc)
            now_iso = _utc_now_iso()
            with db_session() as conn:
                exists = conn.execute("SELECT 1 FROM tracks_catalog WHERE track_key = ?", (tkey,)).fetchone()
                if exists:
                    conn.execute(
                        "INSERT OR IGNORE INTO recording_isrcs (track_key, isrc, source, created_at) VALUES (?, ?, 'deezer', ?)",
                        (tkey, found_isrc, now_iso),
                    )

    return {
        "ok": True,
        "track_key": tkey,
        "apple_song_id": cached_song_id,
        "isrcs": isrcs[:10],
        "artist_name": effective_artist,
        "album_name": effective_album,
    }

class ExtensionBridgeHub:
    """Routes playback commands from Frontend V4 to Browser Extension MV3 and state back."""

    def __init__(self) -> None:
        self._extensions: set[WebSocket] = set()
        self._frontends: set[WebSocket] = set()
        self.connected_platforms: dict[str, dict[str, Any]] = {}

    def status(self) -> dict[str, Any]:
        return {
            "extension_connected": len(self._extensions) > 0,
            "extension_count": len(self._extensions),
            "frontend_count": len(self._frontends),
            "platforms": list(self.connected_platforms.values()),
        }

    async def broadcast_to_frontends(self, msg: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._frontends):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._frontends.discard(ws)

    async def send_to_extensions(self, msg: dict[str, Any]) -> int:
        sent = 0
        dead: list[WebSocket] = []
        for ws in list(self._extensions):
            try:
                await ws.send_json(msg)
                sent += 1
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._extensions.discard(ws)
        return sent


extension_bridge_hub = ExtensionBridgeHub()


@playback_router.get("/api/v4/bridge/status")
def api_bridge_status() -> dict[str, Any]:
    return extension_bridge_hub.status()


@playback_router.websocket("/ws/bridge")
async def ws_extension_bridge(websocket: WebSocket, role: str = "extension") -> None:
    """Bidirectional bridge between AMDataWrap MV3 extension (`role=extension`) and V4 UI (`role=frontend`)."""
    await websocket.accept()
    is_ext = role != "frontend"
    if is_ext:
        extension_bridge_hub._extensions.add(websocket)
        await extension_bridge_hub.broadcast_to_frontends(
            {"type": "bridge_status", "data": extension_bridge_hub.status()}
        )
    else:
        extension_bridge_hub._frontends.add(websocket)
        await websocket.send_json({"type": "bridge_status", "data": extension_bridge_hub.status()})

    try:
        while True:
            raw = await websocket.receive_json()
            msg_type = raw.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "ts": int(time.time())})
                continue

            if is_ext:
                if msg_type == "hello":
                    for p in raw.get("platforms") or []:
                        if isinstance(p, dict) and p.get("platform"):
                            extension_bridge_hub.connected_platforms[p["platform"]] = p
                    await extension_bridge_hub.broadcast_to_frontends(
                        {"type": "bridge_status", "data": extension_bridge_hub.status()}
                    )
                elif msg_type == "state":
                    data = raw.get("data") or {}
                    await extension_bridge_hub.broadcast_to_frontends({"type": "playback_state", "data": data})
                    if data.get("song_name"):
                        update_now_playing(
                            provider="extension_bridge",
                            song_name=data["song_name"],
                            artist_name=data.get("artist_name") or "",
                            album_name=data.get("album_name") or "",
                            artwork_url=data.get("artwork_url"),
                            duration_ms=int(data.get("duration_ms") or 0),
                            position_ms=int(data.get("position_ms") or 0),
                            is_playing=bool(data.get("is_playing")),
                        )
                        await now_playing_hub.broadcast({"provider": "extension_bridge", **data})
                elif msg_type in ("track_ended", "autoplay_blocked", "error", "bridge_log"):
                    await extension_bridge_hub.broadcast_to_frontends(raw)
                elif msg_type == "resolved_mapping":
                    tkey = raw.get("track_key")
                    song_id = raw.get("apple_song_id")
                    if tkey and song_id:
                        with db_session() as conn:
                            exists = conn.execute(
                                "SELECT 1 FROM tracks_catalog WHERE track_key = ?", (tkey,)
                            ).fetchone()
                            if exists:
                                conn.execute(
                                    """
                                    INSERT OR REPLACE INTO platform_track_mappings (
                                        track_key, provider, external_id, url, resolved_at
                                    ) VALUES (?, 'apple_music', ?, ?, ?)
                                    """,
                                    (
                                        tkey,
                                        str(song_id),
                                        f"https://music.apple.com/song/{song_id}",
                                        _utc_now_iso(),
                                    ),
                                )
            else:
                # Frontend command -> forward to Extension MV3
                delivered = await extension_bridge_hub.send_to_extensions(raw)
                if delivered == 0:
                    await websocket.send_json(
                        {"type": "error", "detail": "Aucune extension AMDataWrap Bridge connectée."}
                    )
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if is_ext:
            extension_bridge_hub._extensions.discard(websocket)
            if not extension_bridge_hub._extensions:
                extension_bridge_hub.connected_platforms.clear()
            await extension_bridge_hub.broadcast_to_frontends(
                {"type": "bridge_status", "data": extension_bridge_hub.status()}
            )
        else:
            extension_bridge_hub._frontends.discard(websocket)
