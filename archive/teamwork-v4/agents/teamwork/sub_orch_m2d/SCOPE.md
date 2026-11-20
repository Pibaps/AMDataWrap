# Scope & Exclusive File Ownership — Milestone M2D

## Owned Paths (CREATE / MODIFY ALLOWED ONLY HERE)
1. `backend/app/playback/__init__.py`
2. `backend/app/playback/youtube_resolver.py`
3. `backend/app/playback/router.py`
4. `extensions/amdatawrap-bridge/**`
   - `extensions/amdatawrap-bridge/manifest.json`
   - `extensions/amdatawrap-bridge/background.js`
   - `extensions/amdatawrap-bridge/connectors/apple_music_main.js`
   - `extensions/amdatawrap-bridge/connectors/apple_music_bridge.js`
   - `extensions/amdatawrap-bridge/connectors/spotify_web.js`
   - `extensions/amdatawrap-bridge/connectors/youtube_music.js`
   - `extensions/amdatawrap-bridge/popup.html`
   - `extensions/amdatawrap-bridge/popup.js`
   - `extensions/amdatawrap-bridge/README.md`
   - (optional icons if helpful, e.g. SVG/PNG generated cleanly inside `extensions/amdatawrap-bridge/`)
5. `backend/tests/test_playback_v4.py`

## Forbidden Paths (NEVER MODIFY)
- `backend/app/main.py` (owned by M2E)
- `backend/app/db.py` (owned by M1)
- `backend/app/continuum/reconciler.py` (owned by M2E)
- `backend/app/continuum/{ws_hub,os_sensors,v4_router}.py` (owned by M2C — may inspect read-only to ensure exact lazy-import compatibility!)
- `backend/app/importers/*`, `backend/app/vinyl_enrichment.py`, `backend/app/profiles.py`, `backend/app/filters.py`
- `frontend/`, `frontend-v2/`, `frontend-v3/`, `frontend-v4/`
- `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py`, `backend/tests/test_profiles_v4.py`
