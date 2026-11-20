# Milestone M2C — Technical Briefing

## Baseline Available from M1
- `backend/.venv` (Python 3.11.2) has `fastapi`, `uvicorn`, `websockets`, `segno`, `dbus-next`, `aiosqlite`, `pytest`, `hypothesis`, etc.
- `backend/app/db.py` already includes V4 schema (`profiles`, `favorites.profile_id`, `play_events.profile_id`, `now_playing_state`, `sync_providers_config` seeded with `web_scrobbler`, `os_media`, `extension_bridge`).
- `backend/app/continuum/reconciler.py` and `backend/app/continuum/smtc_worker.py` exist (READ-ONLY for M2C — inspect exact function signatures and table schemas before implementing!).

## Critical Pitfalls to Address in Design
1. **Multi-Event-Loop Safety (`AUDIT_V3.md`):** Every async worker (`OSMediaManager`, WebSocket loops, background tasks) MUST guard `self._task.get_loop() is asyncio.get_running_loop()` in `start()`/`stop()` and reset task/loop refs cleanly so repeated FastAPI `TestClient` / `lifespan` cycles never raise `RuntimeError: Task got Future attached to a different loop`.
2. **Thread-safe & Multi-loop WebSocket Publishing:** `now_playing_hub.publish_threadsafe(payload)` may be called from sync handlers, worker threads, or when no loop is running or after a loop closes; it must always update the latest snapshot safely and schedule broadcast on the active loop if open/running without leaking unawaited coroutines or raising `RuntimeError`.
3. **Spotify Linux MPRIS `Position = 0` Bug:** Never trust MPRIS `Position` alone for scrobble eligibility; `MediaSessionStateMachine` must increment its own wall-clock chronometer ONLY while `is_playing == True`, pausing cleanly when `is_playing == False`, and tolerating explicit seek jumps cleanly.
4. **Web Scrobbler Always `HTTP 200`:** Web Scrobbler enters an error state on non-200 HTTP responses. `POST /api/v4/webhooks/web-scrobbler` must accept raw `Request` (never FastAPI Pydantic 422 auto-rejection!) so invalid JSON, empty body, missing fields, or unknown events return `HTTP 200` with `{"ok": False, "ignored": True, ...}`.
5. **macOS `mediaremote-adapter` Self-Test:** On macOS 15.4+/26, MediaRemote is entitlement-blocked for non-Apple binaries; adapter invokes `media-control` / `/usr/bin/perl` script and MUST run a startup self-test verifying `exit code == 0`, degrading cleanly to `supported: False` on failure.
6. **Windows `pywinrt` GC Bug:** Keep strong references to all asyncio tasks / event tokens so Python GC never cancels callbacks mid-flight, with 1s polling fallback.
7. **Favorites Schema Compatibility:** Check `favorites` table columns and constraints in `backend/app/db.py` before inserting on Web Scrobbler `loved` events (including `profile_id` and uniqueness/dedup behavior).
8. **Reconciler Contract Compatibility:** Check exact signature of `reconcile_scrobble`, `update_now_playing`, `get_now_playing`, and `PROVIDER_PRIORITY` in `backend/app/continuum/reconciler.py` (which M2E will later extend, so M2C must work seamlessly against the current `reconciler.py`!).
