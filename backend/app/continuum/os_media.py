"""Cross-OS Real-Time Media Tracking State Machine (0 EUR).

Supports:
- Windows: WinRT SMTC (`smtc_worker.py`, 1s polling)
- macOS (15.4+ / 26): `mediaremote-adapter` (`media-control stream` via `/usr/bin/perl`) with startup self-test
- Linux: MPRIS2 D-Bus (`org.mpris.MediaPlayer2.Player`) with internal elapsed stopwatch
  working around Spotify Linux's `Position = 0` bug.

Commits qualified listens (>= 30s AND (>= 50% OR >= 4 min)) via `reconciler.py`
and notifies the live WebSocket hub (`/ws/now-playing`).
"""

from __future__ import annotations

import asyncio
import json
import platform
import shutil
import time
from typing import Any, Callable

from .reconciler import IncomingScrobble, clear_now_playing, reconcile_batch, update_now_playing
from .smtc_worker import is_smtc_supported, smtc_worker


def detect_os_sensor_capabilities() -> dict[str, Any]:
    sys_name = platform.system()
    if sys_name == "Windows":
        return {
            "os": "Windows",
            "sensor": "windows_smtc",
            "supported": is_smtc_supported(),
            "detail": "Windows SMTC (winrt-Windows.Media.Control)"
            if is_smtc_supported()
            else "Installer `winrt-Windows.Media.Control` sur Windows pour le tracking automatique.",
        }
    if sys_name == "Darwin":
        perl_ok = bool(shutil.which("/usr/bin/perl") or shutil.which("perl"))
        adapter_ok = bool(shutil.which("media-control"))
        return {
            "os": "macOS",
            "sensor": "macos_mediaremote",
            "supported": perl_ok and adapter_ok,
            "detail": "mediaremote-adapter prêt (`media-control stream`)."
            if (perl_ok and adapter_ok)
            else "Installer `ungive/mediaremote-adapter` (`brew install media-control`) sur macOS 15.4+.",
        }
    if sys_name == "Linux":
        try:
            import dbus_next  # type: ignore  # noqa: F401
            has_dbus = True
        except Exception:
            has_dbus = False
        return {
            "os": "Linux",
            "sensor": "linux_mpris2",
            "supported": has_dbus,
            "detail": "MPRIS2 D-Bus (`org.mpris.MediaPlayer2.Player`) prêt avec chronomètre interne anti-bug Spotify."
            if has_dbus
            else "Installer `dbus-next` pour activer le capteur MPRIS2 Linux.",
        }
    return {"os": sys_name, "sensor": "none", "supported": False, "detail": f"OS non supporté : {sys_name}"}


class UnifiedOSMediaTracker:
    """Manages the active OS-specific media sensor and broadcasts live updates."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._broadcast_cb: Callable[[dict[str, Any]], Any] | None = None
        self.running = False
        self.last_error: str | None = None
        self._current_sig: str | None = None
        self._started_epoch: int = 0
        self._elapsed_sec: float = 0.0
        self._duration_sec: float = 0.0
        self._meta: dict[str, Any] = {}
        self._committed = False

    def set_broadcaster(self, cb: Callable[[dict[str, Any]], Any]) -> None:
        self._broadcast_cb = cb

    def _emit_now_playing(self, payload: dict[str, Any]) -> None:
        if self._broadcast_cb:
            try:
                res = self._broadcast_cb(payload)
                if asyncio.iscoroutine(res):
                    asyncio.create_task(res)
            except Exception:
                pass

    def status(self) -> dict[str, Any]:
        cap = detect_os_sensor_capabilities()
        is_running = smtc_worker.running if cap["sensor"] == "windows_smtc" else self.running
        return {
            **cap,
            "running": is_running,
            "last_error": smtc_worker.last_error if cap["sensor"] == "windows_smtc" else self.last_error,
        }

    def start(self) -> dict[str, Any]:
        cap = detect_os_sensor_capabilities()
        if cap["sensor"] == "windows_smtc":
            return smtc_worker.start()
        if not cap["supported"]:
            self.last_error = cap["detail"]
            return {"ok": False, **cap, "running": False}
        if self._task and not self._task.done():
            return {"ok": True, **cap, "running": True}
        self._stop = asyncio.Event()
        self.running = True
        self.last_error = None
        if cap["sensor"] == "macos_mediaremote":
            self._task = asyncio.create_task(self._run_macos_mediaremote())
        elif cap["sensor"] == "linux_mpris2":
            self._task = asyncio.create_task(self._run_linux_mpris2())
        return {"ok": True, **cap, "running": True}

    async def stop(self) -> None:
        await smtc_worker.stop()
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, RuntimeError):
                pass
        self._task = None
        self.running = False

    def _commit_if_qualified(self, os_label: str) -> None:
        if self._committed or not self._meta.get("song_name"):
            return
        play_ms = int(self._elapsed_sec * 1000)
        media_ms = int(self._duration_sec * 1000) if self._duration_sec > 0 else max(play_ms, 180_000)
        ratio = play_ms / max(media_ms, 1)
        if play_ms >= 30_000 and (ratio >= 0.5 or play_ms >= 240_000):
            sc = IncomingScrobble(
                source_provider="os_media",
                song_name=self._meta["song_name"],
                artist_name=self._meta.get("artist_name") or "Artiste inconnu",
                album_name=self._meta.get("album_name") or "",
                started_epoch=self._started_epoch,
                play_duration_ms=play_ms,
                media_duration_ms=media_ms,
                source_event_id=f"os:{os_label}:{self._started_epoch}:{self._meta['song_name'][:24]}",
                device_label=f"{os_label} ({self._meta.get('app_id', 'Media')})",
                device_os=os_label,
                is_valid_lastfm=1,
                is_skip_30s=0,
            )
            reconcile_batch([sc])
            self._committed = True

    def _process_snapshot(self, snap: dict[str, Any] | None, os_label: str, tick_sec: float = 1.0) -> None:
        if not snap or not snap.get("song_name"):
            self._commit_if_qualified(os_label)
            if self._current_sig:
                clear_now_playing()
                self._emit_now_playing({"is_playing": False, "provider": "os_media"})
            self._current_sig = None
            return

        sig = f"{snap['song_name']}||{snap.get('artist_name', '')}"
        if sig != self._current_sig:
            self._commit_if_qualified(os_label)
            self._current_sig = sig
            self._started_epoch = int(time.time())
            self._elapsed_sec = 0.0
            self._duration_sec = float(snap.get("duration_sec") or 0.0)
            self._meta = snap
            self._committed = False

        if snap.get("is_playing"):
            # Internal stopwatch protects against Spotify Linux MPRIS2 `Position = 0` bug
            self._elapsed_sec += tick_sec
            self._commit_if_qualified(os_label)

        pos_ms = int(snap.get("position_sec") or 0) * 1000
        if pos_ms <= 0 and snap.get("is_playing"):
            pos_ms = int(self._elapsed_sec * 1000)
        dur_ms = int((snap.get("duration_sec") or 0) * 1000)

        update_now_playing(
            provider="os_media",
            song_name=snap["song_name"],
            artist_name=snap.get("artist_name") or "",
            album_name=snap.get("album_name") or "",
            duration_ms=dur_ms,
            position_ms=pos_ms,
            is_playing=bool(snap.get("is_playing")),
        )
        self._emit_now_playing(
            {
                "provider": "os_media",
                "song_name": snap["song_name"],
                "artist_name": snap.get("artist_name") or "",
                "album_name": snap.get("album_name") or "",
                "duration_ms": dur_ms,
                "position_ms": pos_ms,
                "is_playing": bool(snap.get("is_playing")),
            }
        )

    async def _run_macos_mediaremote(self) -> None:
        """Stream JSON events from `media-control stream` (`ungive/mediaremote-adapter`)."""
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "media-control",
                "stream",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            assert proc.stdout is not None
            while not self._stop.is_set():
                line = await proc.stdout.readline()
                if not line:
                    break
                try:
                    payload = json.loads(line.decode("utf-8", errors="replace"))
                    data = payload.get("payload") if isinstance(payload, dict) else None
                    if not isinstance(data, dict):
                        continue
                    snap = {
                        "song_name": (data.get("title") or "").strip(),
                        "artist_name": (data.get("artist") or "").strip(),
                        "album_name": (data.get("album") or "").strip(),
                        "app_id": data.get("bundleIdentifier") or "macOS",
                        "is_playing": bool(data.get("playing")),
                        "duration_sec": float(data.get("duration") or 0.0),
                        "position_sec": float(data.get("elapsedTime") or 0.0),
                    }
                    self._process_snapshot(snap, "macOS", tick_sec=1.0)
                except Exception:
                    continue
        except Exception as exc:
            self.last_error = str(exc)
        finally:
            if proc and proc.returncode is None:
                proc.terminate()
            self.running = False

    async def _run_linux_mpris2(self) -> None:
        """Poll Linux D-Bus `org.mpris.MediaPlayer2.*` with internal elapsed stopwatch."""
        try:
            from dbus_next.aio import MessageBus  # type: ignore

            bus = await MessageBus().connect()
            while not self._stop.is_set():
                try:
                    intro = await bus.introspect("org.freedesktop.DBus", "/org/freedesktop/DBus")
                    obj = bus.get_proxy_object("org.freedesktop.DBus", "/org/freedesktop/DBus", intro)
                    dbus_iface = obj.get_interface("org.freedesktop.DBus")
                    names = await dbus_iface.call_list_names()
                    players = [n for n in names if n.startswith("org.mpris.MediaPlayer2.")]
                    snap = None
                    for pname in players:
                        try:
                            p_intro = await bus.introspect(pname, "/org/mpris/MediaPlayer2")
                            p_obj = bus.get_proxy_object(pname, "/org/mpris/MediaPlayer2", p_intro)
                            props = p_obj.get_interface("org.freedesktop.DBus.Properties")
                            status = (await props.call_get("org.mpris.MediaPlayer2.Player", "PlaybackStatus")).value
                            meta = (await props.call_get("org.mpris.MediaPlayer2.Player", "Metadata")).value
                            title = meta.get("xesam:title").value if "xesam:title" in meta else ""
                            artists = meta.get("xesam:artist").value if "xesam:artist" in meta else []
                            album = meta.get("xesam:album").value if "xesam:album" in meta else ""
                            length_us = meta.get("mpris:length").value if "mpris:length" in meta else 0
                            try:
                                pos_us = (await props.call_get("org.mpris.MediaPlayer2.Player", "Position")).value
                            except Exception:
                                pos_us = 0
                            snap = {
                                "song_name": str(title or "").strip(),
                                "artist_name": ", ".join(artists) if isinstance(artists, list) else str(artists or ""),
                                "album_name": str(album or "").strip(),
                                "app_id": pname.replace("org.mpris.MediaPlayer2.", ""),
                                "is_playing": status == "Playing",
                                "duration_sec": float(length_us or 0) / 1_000_000.0,
                                "position_sec": float(pos_us or 0) / 1_000_000.0,
                            }
                            if snap["is_playing"]:
                                break
                        except Exception:
                            continue
                    self._process_snapshot(snap, "Linux", tick_sec=1.0)
                except Exception as exc:
                    self.last_error = str(exc)
                await asyncio.sleep(1.0)
        except Exception as exc:
            self.last_error = str(exc)
        finally:
            self.running = False


os_media_tracker = UnifiedOSMediaTracker()
