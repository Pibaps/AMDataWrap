"""Native Windows SMTC Sensor (Phase 1).

Uses WinRT `GlobalSystemMediaTransportControlsSessionManager` via 1-second polling
(avoiding Python WinRT's documented broken `SessionsChanged` async event), tracks real elapsed
playback duration, and applies the Last.fm rule (>= 50% or >= 4 min) before committing to SQLite
with `source_provider='local_smtc'` (priority 70).

Gracefully degrades on Linux/macOS where WinRT is unavailable.
"""

from __future__ import annotations

import asyncio
import platform
import time
from typing import Any

from ..analytics.duckdb_engine import export_parquet_snapshot
from .reconciler import IncomingScrobble, clear_now_playing, reconcile_batch, update_now_playing


def is_smtc_supported() -> bool:
    if platform.system() != "Windows":
        return False
    try:
        import winrt.windows.media.control  # type: ignore  # noqa: F401
        return True
    except Exception:
        return False


class WindowsSMTCWorker:
    """1-second polling Windows SMTC tracker."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.running = False
        self.last_error: str | None = None
        self._current_sig: str | None = None
        self._started_epoch: int = 0
        self._elapsed_sec: float = 0.0
        self._duration_sec: float = 0.0
        self._meta: dict[str, Any] = {}
        self._committed = False

    def start(self) -> dict[str, Any]:
        if not is_smtc_supported():
            self.last_error = (
                "Capteur Windows SMTC disponible uniquement sous Windows avec `winrt-Windows.Media.Control`."
            )
            return {"ok": False, "supported": False, "running": False, "detail": self.last_error}
        if self._task and not self._task.done():
            return {"ok": True, "supported": True, "running": True}
        self._stop = asyncio.Event()
        self.running = True
        self.last_error = None
        self._task = asyncio.create_task(self._loop())
        return {"ok": True, "supported": True, "running": True}

    async def stop(self):
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.running = False

    async def _poll_once(self) -> dict[str, Any] | None:
        from winrt.windows.media.control import (  # type: ignore
            GlobalSystemMediaTransportControlsSessionManager as SessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        )

        manager = await SessionManager.request_async()
        session = manager.get_current_session()
        if not session:
            return None
        info = session.get_playback_info()
        is_playing = info.playback_status == PlaybackStatus.PLAYING
        props = await session.try_get_media_properties_async()
        timeline = session.get_timeline_properties()
        duration_sec = 0.0
        position_sec = 0.0
        if timeline:
            try:
                duration_sec = max(0.0, timeline.end_time.total_seconds())
                position_sec = max(0.0, timeline.position.total_seconds())
            except Exception:
                pass
        return {
            "song_name": (props.title or "").strip(),
            "artist_name": (props.artist or "").strip(),
            "album_name": (props.album_title or "").strip(),
            "app_id": session.source_app_user_model_id or "Windows SMTC",
            "is_playing": is_playing,
            "duration_sec": duration_sec,
            "position_sec": position_sec,
        }

    def _commit_if_qualified(self):
        if self._committed or not self._meta.get("song_name"):
            return
        play_ms = int(self._elapsed_sec * 1000)
        media_ms = int(self._duration_sec * 1000) if self._duration_sec > 0 else max(play_ms, 180_000)
        ratio = play_ms / max(media_ms, 1)
        # Apply Last.fm qualification rule: >= 30s AND (>= 50% OR >= 4 min)
        if play_ms >= 30_000 and (ratio >= 0.5 or play_ms >= 240_000):
            sc = IncomingScrobble(
                source_provider="local_smtc",
                song_name=self._meta["song_name"],
                artist_name=self._meta.get("artist_name") or "Artiste inconnu",
                album_name=self._meta.get("album_name") or "",
                started_epoch=self._started_epoch,
                play_duration_ms=play_ms,
                media_duration_ms=media_ms,
                source_event_id=f"smtc:{self._started_epoch}:{self._meta['song_name'][:32]}",
                device_label="Windows PC (Apple Music SMTC)",
                device_os="Windows",
                is_valid_lastfm=1,
                is_skip_30s=0,
            )
            stats = reconcile_batch([sc])
            if stats["inserted"] > 0 or stats["upgraded"] > 0:
                export_parquet_snapshot()
            self._committed = True

    async def _loop(self):
        try:
            while not self._stop.is_set():
                try:
                    snap = await self._poll_once()
                    if not snap or not snap["song_name"]:
                        self._commit_if_qualified()
                        if self._current_sig:
                            clear_now_playing()
                        self._current_sig = None
                    else:
                        sig = f"{snap['song_name']}||{snap['artist_name']}"
                        if sig != self._current_sig:
                            self._commit_if_qualified()
                            self._current_sig = sig
                            self._started_epoch = int(time.time())
                            self._elapsed_sec = 0.0
                            self._duration_sec = snap["duration_sec"]
                            self._meta = snap
                            self._committed = False
                        if snap["is_playing"]:
                            self._elapsed_sec += 1.0
                            self._commit_if_qualified()
                        update_now_playing(
                            provider="local_smtc",
                            song_name=snap["song_name"],
                            artist_name=snap["artist_name"],
                            album_name=snap["album_name"],
                            duration_ms=int(snap["duration_sec"] * 1000),
                            position_ms=int(snap["position_sec"] * 1000),
                            is_playing=snap["is_playing"],
                        )
                except Exception as exc:
                    self.last_error = str(exc)
                await asyncio.sleep(1.0)
        finally:
            self.running = False


smtc_worker = WindowsSMTCWorker()
