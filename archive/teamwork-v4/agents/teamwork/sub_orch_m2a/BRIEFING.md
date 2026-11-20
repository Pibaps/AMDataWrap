# Milestone M2A Briefing — 5 RGPD/Takeout Importers & Unified `POST /api/v4/import`

## Objective
Implement the complete V4 multi-platform GDPR/Takeout ingestion package (`backend/app/importers/`) and its comprehensive unit + Hypothesis property-based test suite (`backend/tests/test_importers_v4.py`), strictly following `PROJECT.md` Interface Contract §2, `PLAN_V4_FINAL.md` §2.2, and `ORIGINAL_REQUEST.md`.

## Exclusive File Ownership (ONLY these 8 files)
1. `backend/app/importers/__init__.py`
2. `backend/app/importers/base.py`
3. `backend/app/importers/apple.py`
4. `backend/app/importers/spotify.py`
5. `backend/app/importers/youtube.py`
6. `backend/app/importers/deezer.py`
7. `backend/app/importers/tidal.py`
8. `backend/tests/test_importers_v4.py`

## Hard Boundaries (DO NOT TOUCH)
- NEVER modify `main.py`, `db.py`, `filters.py`, `profiles.py`, `ingestion.py`, `reconciler.py`, `schemas.py`, `frontend/`, `frontend-v2/`, `frontend-v3/`, or files belonging to M2B/M2C/M2D/M2E.
- Reuse M1 helpers directly from `backend.app.profiles` (`get_or_create_standard_profile`, `record_profile_source`, `refresh_all_merged_profiles_containing`, `V4_PROVIDER_PRIORITY`) and parsing/normalization helpers from `backend.app.ingestion` / `backend.app.continuum.reconciler` / `backend.app.db` / `backend.app.analytics.duckdb_engine` without modifying those modules.

## Verification Strategy
- Target-scoped command: `backend/.venv/bin/pytest -v backend/tests/test_importers_v4.py`
- Full-suite check (Primary Reviewer): `backend/.venv/bin/pytest -v` (confirming M2A + existing V3 & M1 tests pass cleanly)
- Strict AND gate: 2 Reviewers (`APPROVE`) + 2 Challengers (`PASS`) + 1 Forensic Auditor (`CLEAN`, intermediate audit on M2A owned paths).
