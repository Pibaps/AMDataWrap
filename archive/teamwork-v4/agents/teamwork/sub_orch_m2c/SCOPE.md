# Milestone M2C — Scope & Exclusive File Ownership

## Owned Files (EXCLUSIVE WRITE BOUNDARY)
1. `backend/app/continuum/ws_hub.py`
2. `backend/app/continuum/os_sensors.py`
3. `backend/app/continuum/v4_router.py`
4. `backend/tests/test_tracking_v4.py`

## Strictly Forbidden Files (NEVER MODIFY)
- `backend/app/main.py` (owned by M2E)
- `backend/app/continuum/reconciler.py` (owned by M2E)
- `backend/app/continuum/providers.py` (existing V3)
- `backend/app/continuum/smtc_worker.py` (existing V3 — may be imported/wrapped read-only)
- `backend/app/db.py`, `backend/app/filters.py`, `backend/app/profiles.py` (owned by M1)
- `backend/app/importers/*` (M2A), `backend/app/vinyl_enrichment.py` (M2B), `backend/app/playback/*` & `extensions/*` (M2D)
- `frontend/`, `frontend-v2/`, `frontend-v3/`, `frontend-v4/`
- Existing test files: `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py`, `backend/tests/test_profiles_v4.py`

## Deliverable Contracts
### 1. `backend/app/continuum/ws_hub.py`
- `NowPlayingHub` singleton `now_playing_hub`:
  - Manages active `WS /ws/now-playing` subscribers cleanly with dead-socket auto-cleanup (dead sockets never crash/block broadcasts).
  - Stores latest snapshot and sends immediate `{"type": "now_playing", "payload": ...}` snapshot upon connect.
  - Exposes `async broadcast(payload: dict | None) -> None`, `publish_threadsafe(payload: dict | None) -> None` (safe from background threads or sync handlers across event loops), `client_count() -> int`, `latest_payload() -> dict | None`.
- `BridgeHub` singleton `bridge_hub`:
  - Tracks connected MV3 extension clients (`HELLO { platforms, version }`), handles 20s `PING` -> `PONG` keepalive, receives `STATE_UPDATE` telemetry (updates `now_playing_state` + broadcasts on `now_playing_hub` + commits qualified scrobbles via `reconciler.py`).
  - Shared contract with M2D `playback/router.py`:
    - `get_status() -> dict` returning `{"connected": bool, "clients": int, "platforms": list[str], "version": str | None, "last_seen": str | None}`
    - `async send_command(action: str, payload: dict | None = None, target_platform: str | None = None) -> dict` returning `{"ok": bool, "sent_to": int, "error": str | None}`
    - `set_last_state(state: dict | None)` / `get_last_state() -> dict | None`

### 2. `backend/app/continuum/os_sensors.py`
- Shared OS Playback State Machine (`MediaSessionStateMachine`):
  - Increments internal wall-clock playback chronometer ONLY while `is_playing == True` (bypassing Spotify Linux MPRIS `Position = 0` bug).
  - Detects track switches & seek jumps; commits qualified listens to `reconciler.py` (`reconcile_scrobble`) when Last.fm threshold is met (`elapsed_ms >= 30_000` AND (`elapsed_ms >= 0.5 * duration_ms` OR `elapsed_ms >= 240_000`)), and infers `TRACK_SKIPPED_FORWARDS` when switching prematurely.
  - Calls `update_now_playing` + `now_playing_hub.publish_threadsafe(...)`.
- 3 OS Platform Adapters under unified `OSMediaManager` singleton `os_media_manager` (strictly multi-event-loop safe `start()`/`stop()`):
  - Windows: wraps existing `smtc_worker` / `pywinrt` (`winrt.windows.media.control`) with strong asyncio task references + 1s polling fallback.
  - macOS (15.4+ / 26): subprocess adapter for `ungive/mediaremote-adapter` (`media-control stream` via `/usr/bin/perl`) with startup self-test (`exit code 0` check) degrading cleanly (`supported: False`) if absent or entitlement-blocked.
  - Linux: `MPRIS2` D-Bus adapter (`org.mpris.MediaPlayer2.Player`) using `dbus-next` (guarded `try/except ImportError` + graceful degradation on headless VM without `DBUS_SESSION_BUS_ADDRESS`) feeding into `MediaSessionStateMachine`'s internal stopwatch.
- Exposes `get_status() -> dict` (`{ platform, backend, supported, running, detail }`).

### 3. `backend/app/continuum/v4_router.py`
- Exports `tracking_v4_router = APIRouter(tags=["v4-tracking"])`:
  - `POST /api/v4/webhooks/web-scrobbler` — parses all 5 events (`nowplaying`, `scrobble`, `loved`, `paused`, `resumedplaying`), updates `now_playing_state` + `now_playing_hub`, commits scrobbles via `reconciler.py`, inserts `favorites` on `loved`, ALWAYS returns `HTTP 200` (even on unknown/malformed payloads -> `{"ok": False, "ignored": True}`, never 4xx/5xx!).
  - `GET /api/v4/tracking/status` — `{ os, ws_clients, bridge_connected, bridge_platforms, last_webhook_at, now_playing }`.
  - `POST /api/v4/tracking/os/{action}` (`start` | `stop`).
  - `GET /api/v4/tracking/setup` — detects LAN IPv4 (safe fallback `127.0.0.1`), generates scannable `segno` SVG data-URIs (`listenbrainz_qr_svg`, `frontend_v4_qr_svg`), returns 1-click URLs (`lan_ip`, `backend_url`, `frontend_v4_url`, `listenbrainz_url`, `web_scrobbler_webhook_url`) and French guided instructions (`pano_scrobbler`, `fast_scrobbler`, `web_scrobbler`, `multi_scrobbler`).
  - `WS /ws/now-playing` — live now-playing stream via `now_playing_hub`.
  - `WS /ws/bridge` — MV3 extension bridge via `bridge_hub`.
- Exports `detect_lan_ipv4() -> tuple[str, bool]` returning `(ip, is_loopback_fallback)` for reuse by M2E `/api/v4/network/lan-info`.

### 4. `backend/tests/test_tracking_v4.py`
- Comprehensive tests covering all M2C requirements & edge cases.
