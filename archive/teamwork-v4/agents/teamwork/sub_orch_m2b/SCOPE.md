# Milestone M2B Exclusive File Ownership Scope

## Owned Files (WRITE ALLOWED ONLY HERE)
1. `/home/antigravity/Pibaps/AMDataWrap/backend/app/vinyl_enrichment.py`
2. `/home/antigravity/Pibaps/AMDataWrap/backend/tests/test_vinyl_enrichment_v4.py`

## State Folder (Sub-Orchestrator Markdown Only)
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m2b/*.md`

## Strictly Forbidden (READ-ONLY — DO NOT MODIFY)
- `backend/app/main.py` (owned by M2E)
- `backend/app/db.py` (owned by M1)
- `backend/app/filters.py` (owned by M1)
- `backend/app/profiles.py` (owned by M1)
- `backend/app/enrichment.py` (existing V1–V3 module — read-only reference)
- `backend/app/jobs/worker.py` (existing V3 worker — read-only reference)
- `backend/app/importers/*` (owned by M2A)
- `backend/app/continuum/*` (owned by M2C/M2E)
- `backend/app/playback/*` (owned by M2D)
- `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py`, `backend/tests/test_profiles_v4.py`
- `frontend/`, `frontend-v2/`, `frontend-v3/`, `frontend-v4/`
