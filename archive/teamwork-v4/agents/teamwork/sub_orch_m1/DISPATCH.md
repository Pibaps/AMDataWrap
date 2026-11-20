# Milestone M1 Dispatch — Phase 1 Foundation

- **Milestone:** M1 — Python Env, V4 SQLite Schema, Global Filters, Multi-Profiles, Fusion & Capabilities Matrix
- **Parent Orchestrator:** `799cd2e0a4e262e978fe0fc571a501c9`
- **Sub-Orchestrator:** `673003c5001aacc64536c7d9308d1872`
- **State Folder:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1`
- **Repository:** `/home/antigravity/Pibaps/AMDataWrap`
- **Workspace Mode:** `inherit` (MANDATORY for all subagents)
- **Canonical Test Command:** `backend/.venv/bin/pytest -v`

## Exclusive File Ownership (M1)
1. `backend/requirements.txt` + `backend/.venv/` (bootstrap user-space via `uv`, NO `sudo`/`apt`)
2. `backend/app/db.py`
3. `backend/app/filters.py`
4. `backend/app/profiles.py`
5. `backend/app/analytics/overview.py`
6. `backend/app/analytics/behavior.py`
7. `backend/app/analytics/duckdb_engine.py`
8. `backend/tests/test_profiles_v4.py`

## Forbidden Files (DO NOT MODIFY)
- `backend/app/main.py` (owned by M2E)
- `backend/app/continuum/reconciler.py` (owned by M2E)
- `frontend/`, `frontend-v2/`, `frontend-v3/`, `frontend-v4/`
- `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py` (must remain 100% green and untouched)
- Any files owned by M2A–M2E
