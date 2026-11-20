# Milestone M1 Scope & Acceptance Criteria

## In-Scope Deliverables
- `backend/requirements.txt` & `backend/.venv/`
- `backend/app/db.py`
- `backend/app/filters.py`
- `backend/app/profiles.py`
- `backend/app/analytics/overview.py`
- `backend/app/analytics/behavior.py`
- `backend/app/analytics/duckdb_engine.py`
- `backend/tests/test_profiles_v4.py`

## Out-of-Scope (Strict Exclusion)
- `backend/app/main.py` (do not mount router yet — M2E owns `main.py`; tests can test `profiles_router` via a standalone FastAPI test app or TestClient mounting `profiles_router`)
- `backend/app/continuum/reconciler.py` (M2E)
- `backend/app/importers/*` (M2A)
- `frontend/`, `frontend-v2/`, `frontend-v3/`, `frontend-v4/`

## Gate Pass Criteria (Strict AND)
1. Independent post-edit verifier runs `backend/.venv/bin/pytest -v` with 100% pass across `test_properties.py`, `test_openapi_fuzz.py`, and `test_profiles_v4.py`.
2. Both Reviewers return `APPROVE`.
3. Both Challengers confirm edge-case & contract correctness (zero remaining critical/high issues).
4. Forensic Auditor (intermediate milestone audit on M1 owned paths) returns `CLEAN`.
