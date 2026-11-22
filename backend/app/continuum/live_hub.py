"""V4 Live Tracking Hub: WebSocket `/ws/now-playing`, Web Scrobbler Webhook, & LAN QR Setup."""

from __future__ import annotations

import io
import socket
import time
from typing import Any

import segno
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from ..db import db_session
from .os_media import os_media_tracker
from .reconciler import IncomingScrobble, clear_now_playing, reconcile_batch, update_now_playing

live_hub_router = APIRouter(tags=["v4-live-tracking"])


class NowPlayingHub:
    """In-memory WebSocket fan-out hub pushing live playback state to the 3D Turntable."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._last_state: dict[str, Any] = {"is_playing": False}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        # Immediately push current now-playing state so 3D Turntable syncs on load
        await ws.send_json({"type": "now_playing", "data": self.get_current_state()})

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    def get_current_state(self) -> dict[str, Any]:
        with db_session() as conn:
            row = conn.execute("SELECT * FROM now_playing_state WHERE id = 1").fetchone()
            if row and row["song_name"]:
                return {
                    "provider": row["provider"],
                    "song_name": row["song_name"],
                    "artist_name": row["artist_name"],
                    "album_name": row["album_name"],
                    "artwork_url": row["artwork_url"],
                    "duration_ms": int(row["duration_ms"] or 0),
                    "position_ms": int(row["position_ms"] or 0),
                    "is_playing": bool(row["is_playing"]),
                    "updated_at": row["updated_at"],
                }
        return self._last_state

    async def broadcast(self, state: dict[str, Any]) -> None:
        self._last_state = state
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_json({"type": "now_playing", "data": state})
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


now_playing_hub = NowPlayingHub()
os_media_tracker.set_broadcaster(now_playing_hub.broadcast)


def detect_lan_ip() -> str:
    """Best-effort detection of the host's LAN IPv4 address for smartphone QR code access."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except Exception:
        pass
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return "127.0.0.1"


def make_qr_svg(data: str) -> str:
    qr = segno.make(data, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=5, border=2, dark="#f4f1ea", light=None)
    return buf.getvalue().decode("utf-8")


@live_hub_router.websocket("/ws/now-playing")
async def ws_now_playing(websocket: WebSocket) -> None:
    await now_playing_hub.connect(websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        now_playing_hub.disconnect(websocket)
    except Exception:
        now_playing_hub.disconnect(websocket)


@live_hub_router.post("/api/v4/webhooks/web-scrobbler")
async def api_web_scrobbler_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    """Receive Web Scrobbler webhook events (`nowplaying`, `scrobble`, `loved`, `paused`, `resumedplaying`).

    Always returns HTTP 200 per Web Scrobbler webhook spec.
    """
    event_name = str(payload.get("eventName") or payload.get("event") or "").strip().lower()
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    song_obj = data.get("song") if isinstance(data.get("song"), dict) else data
    parsed = song_obj.get("parsed") if isinstance(song_obj.get("parsed"), dict) else song_obj

    song_name = str(parsed.get("track") or parsed.get("song") or parsed.get("title") or "").strip()
    artist_name = str(parsed.get("artist") or "Artiste inconnu").strip()
    album_name = str(parsed.get("album") or "").strip()
    duration_sec = float(parsed.get("duration") or song_obj.get("duration") or 0)
    duration_ms = int(duration_sec * 1000) if duration_sec > 0 else 0
    artwork_url = parsed.get("trackArt") or song_obj.get("trackArt") or None
    ts = int(data.get("time") or payload.get("time") or time.time())

    if event_name in ("nowplaying", "resumedplaying"):
        if song_name:
            update_now_playing(
                provider="web_scrobbler",
                song_name=song_name,
                artist_name=artist_name,
                album_name=album_name,
                artwork_url=artwork_url,
                duration_ms=duration_ms,
                position_ms=0,
                is_playing=True,
            )
            await now_playing_hub.broadcast(
                {
                    "provider": "web_scrobbler",
                    "song_name": song_name,
                    "artist_name": artist_name,
                    "album_name": album_name,
                    "artwork_url": artwork_url,
                    "duration_ms": duration_ms,
                    "position_ms": 0,
                    "is_playing": True,
                }
            )
    elif event_name == "paused":
        if song_name:
            update_now_playing(
                provider="web_scrobbler",
                song_name=song_name,
                artist_name=artist_name,
                album_name=album_name,
                artwork_url=artwork_url,
                duration_ms=duration_ms,
                position_ms=0,
                is_playing=False,
            )
            await now_playing_hub.broadcast(
                {
                    "provider": "web_scrobbler",
                    "song_name": song_name,
                    "artist_name": artist_name,
                    "album_name": album_name,
                    "artwork_url": artwork_url,
                    "duration_ms": duration_ms,
                    "position_ms": 0,
                    "is_playing": False,
                }
            )
        else:
            clear_now_playing()
            await now_playing_hub.broadcast({"is_playing": False, "provider": "web_scrobbler"})
    elif event_name == "scrobble" and song_name:
        sc = IncomingScrobble(
            source_provider="web_scrobbler",
            song_name=song_name,
            artist_name=artist_name,
            album_name=album_name,
            started_epoch=ts,
            play_duration_ms=duration_ms or 180_000,
            media_duration_ms=duration_ms or 180_000,
            source_event_id=f"ws:{ts}:{song_name[:32]}",
            device_label="Web Scrobbler (Navigateur)",
            device_os="Web",
            is_valid_lastfm=1,
            is_skip_30s=0,
        )
        stats = reconcile_batch([sc])
        return {"ok": True, "event": event_name, "reconciled": stats}
    elif event_name == "loved" and song_name:
        with db_session() as conn:
            conn.execute(
                """
                INSERT INTO favorites (favorite_type, item_reference, item_description, last_modified, preference)
                VALUES ('TRACK', ?, ?, datetime('now'), 'LOVE')
                """,
                (song_name, f"{artist_name} - {song_name}"),
            )

    return {"ok": True, "event": event_name or "noop"}


@live_hub_router.get("/api/v4/tracking/os-status")
def api_os_tracker_status() -> dict[str, Any]:
    return os_media_tracker.status()


@live_hub_router.post("/api/v4/tracking/os-start")
def api_os_tracker_start() -> dict[str, Any]:
    return os_media_tracker.start()


@live_hub_router.post("/api/v4/tracking/os-stop")
async def api_os_tracker_stop() -> dict[str, Any]:
    await os_media_tracker.stop()
    return {"ok": True, "running": False}


@live_hub_router.get("/api/v4/network/lan-info")
def api_lan_info(request: Request, frontend_port: int = 5177, backend_port: int = 8000) -> dict[str, Any]:
    """Return local LAN URLs + QR codes (SVG) for instant smartphone access & mobile scrobbling."""
    lan_ip = detect_lan_ip()
    frontend_url = f"http://{lan_ip}:{frontend_port}"
    backend_url = f"http://{lan_ip}:{backend_port}"
    lb_endpoint = f"{backend_url}/apis/listenbrainz/1/submit-listens"
    webhook_url = f"{backend_url}/api/v4/webhooks/web-scrobbler"
    return {
        "lan_ip": lan_ip,
        "frontend_v4_url": frontend_url,
        "backend_url": backend_url,
        "listenbrainz_submit_url": lb_endpoint,
        "web_scrobbler_webhook_url": webhook_url,
        "frontend_qr_svg": make_qr_svg(frontend_url),
        "listenbrainz_qr_svg": make_qr_svg(lb_endpoint),
    }


@live_hub_router.get("/api/v4/tracking/setup")
def api_tracking_setup(request: Request) -> dict[str, Any]:
    """1-click & QR code setup guide for all 0 EUR PC + Mobile real-time trackers."""
    lan = api_lan_info(request)
    return {
        "os_sensor": os_media_tracker.status(),
        "lan": lan,
        "guides": [
            {
                "id": "os_media",
                "name": "Capteur OS Local (Windows SMTC / macOS / Linux MPRIS2)",
                "platform": "PC / Mac / Linux",
                "cost": "0 €",
                "one_click_supported": True,
                "steps": [
                    "Clique sur « Démarrer le capteur OS » pour capter automatiquement Apple Music, Spotify, YouTube Music ou TIDAL Desktop.",
                    "Règle Last.fm appliquée localement (>= 30s ET >= 50% ou >= 4 min) + synchronisation temps réel du Tourne-Disque 3D.",
                ],
            },
            {
                "id": "pano_scrobbler",
                "name": "Pano Scrobbler (Android)",
                "platform": "Android",
                "cost": "0 € (Open-Source)",
                "copy_value": lan["listenbrainz_submit_url"],
                "qr_svg": lan["listenbrainz_qr_svg"],
                "steps": [
                    "Ouvre Pano Scrobbler → Paramètres → Comptes → Custom ListenBrainz.",
                    f"Colle l'URL serveur : {lan['backend_url']}/apis/listenbrainz/1 (ou scanne le QR code).",
                    "Token : n'importe quelle chaîne (ex: `amdatawrap-local`).",
                ],
            },
            {
                "id": "fastscrobbler",
                "name": "FastScrobbler / Finale (iOS)",
                "platform": "iOS",
                "cost": "0 €",
                "copy_value": lan["listenbrainz_submit_url"],
                "qr_svg": lan["listenbrainz_qr_svg"],
                "steps": [
                    "Connecte FastScrobbler ou multi-scrobbler à l'endpoint ListenBrainz local sur le même Wi-Fi.",
                    f"Endpoint : {lan['listenbrainz_submit_url']}",
                ],
            },
            {
                "id": "web_scrobbler",
                "name": "Web Scrobbler (Chrome / Firefox / Edge)",
                "platform": "Navigateur PC",
                "cost": "0 € (Open-Source)",
                "copy_value": lan["web_scrobbler_webhook_url"],
                "steps": [
                    "Dans l'extension Web Scrobbler → Options → Comptes → Webhook personnalisé.",
                    f"Colle l'URL : {lan['web_scrobbler_webhook_url']}",
                ],
            },
        ],
    }
