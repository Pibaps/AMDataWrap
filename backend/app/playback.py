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

playback_router = APIRouter(tags=["v4-playback"])


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _search_ytmusic_sync(query: str, song_name: str, artist_name: str) -> dict[str, Any] | None:
    """Resolve a YouTube Music song `videoId` without authentication using `ytmusicapi`."""
    try:
        from ytmusicapi import YTMusic  # type: ignore

        ytm = YTMusic()
        results = ytm.search(query, filter="songs", limit=5) or []
        best = None
        best_score = 0.0
        for item in results:
            vid = item.get("videoId")
            if not vid:
                continue
            title = item.get("title") or ""
            artists = ", ".join(a.get("name", "") for a in (item.get("artists") or []) if isinstance(a, dict))
            score = similarity_score(song_name, title) * 0.65 + similarity_score(artist_name, artists) * 0.35
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
) -> dict[str, Any]:
    """Resolve a track to a playable YouTube `videoId` (cached in `platform_track_mappings`) + preview fallback."""
    tkey = track_key or make_track_key(song, album or "Single / Inconnu")
    preview_url: str | None = None
    artwork_url: str | None = None

    with db_session() as conn:
        # 1. Check permanent cache in platform_track_mappings
        cached = conn.execute(
            """
            SELECT external_id, url FROM platform_track_mappings
            WHERE track_key = ? AND provider = 'youtube'
            LIMIT 1
            """,
            (tkey,),
        ).fetchone()
        t_row = conn.execute(
            "SELECT preview_url, artwork_url, duration_ms FROM tracks_catalog WHERE track_key = ?",
            (tkey,),
        ).fetchone()
        if t_row:
            preview_url = t_row["preview_url"]
            artwork_url = t_row["artwork_url"]

        if cached and cached["external_id"]:
            return {
                "ok": True,
                "cached": True,
                "provider": "youtube_iframe",
                "track_key": tkey,
                "video_id": cached["external_id"],
                "url": cached["url"] or f"https://music.youtube.com/watch?v={cached['external_id']}",
                "preview_url": preview_url,
                "artwork_url": artwork_url,
            }

    # 2. Live resolve via ytmusicapi (no auth)
    query = f"{artist} {song}".strip()
    found = await asyncio.to_thread(_search_ytmusic_sync, query, song, artist)
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
        "video_id": None,
        "url": None,
        "preview_url": preview_url,
        "artwork_url": artwork_url,
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
                elif msg_type == "autoplay_blocked":
                    await extension_bridge_hub.broadcast_to_frontends(raw)
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
