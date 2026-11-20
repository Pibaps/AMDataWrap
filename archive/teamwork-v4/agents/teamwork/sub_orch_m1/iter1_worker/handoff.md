# Handoff Report — M1 Implementation Worker (Phase 1 Foundation)

**Milestone:** M1 — Phase 1 Foundation: Python Env, V4 SQLite Schema, Global Filters, Multi-Profiles, Fusion & Capabilities Matrix  
**Status:** Complete & Verified (25/25 tests PASS, 0 failures, 0 skipped)  
**Repository:** `/home/antigravity/Pibaps/AMDataWrap`  
**Exclusive Handoff Path:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1/iter1_worker/handoff.md`

---

## 1. Files Created / Modified (Strict Ownership Compliance)

Verified via `git status --short` — ONLY M1-owned files were created/modified:

| Path | Action | Summary of Implementation |
| :--- | :---: | :--- |
| `backend/requirements.txt` | Modified | Appended V4 dependencies (`openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0`, `dbus-next>=0.2.3; sys_platform == "linux"`) preserving all 12 existing V3 deps. |
| `backend/.venv/` | Created (gitignored) | Bootstrapped in user space with `uv venv backend/.venv --python python3` + `uv pip install` (57 packages, `pydantic==2.14.4`, `fastapi==0.165.0`, Pillow WebP verified). |
| `backend/app/db.py` | Modified | Added V4 additive columns (`play_events`: `profile_id`, `incognito_mode`, `reason_start`, `skipped`, `isrc`; `lyric_events`/`search_events`/`favorites`: `profile_id`) and all 7 V4 tables (`profiles`, `profile_sources`, `profile_merged_exclusions`, `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`) + new-table-only indexes in `SCHEMA_SQL`. Added idempotent `_run_v4_migrations(conn)` invoked by `init_db()` handling V3->V4 column additions, NULL backfills, additive-column indexes, profile-scoped unique partial index upgrades (`idx_pe_provider_event_uniq`, `idx_pe_dedup_fp_uniq`), default Profile `id=1` seed preserving active profile across restarts, `profile_sources` backfill from `import_meta`, and `sync_providers_config` V4 seeds (`web_scrobbler`, `os_media`, `extension_bridge`). |
| `backend/app/filters.py` | Modified | Implemented Single Source of Truth: `SOURCE_PROVIDER_ALIASES`, `PROVIDER_TO_PLATFORM`, `canonical_platform_for()`, `expand_source_providers()`, and pure-SQL `build_profile_id_clause()` (using SQLite `json_each()` + `json_valid()` + `profile_merged_exclusions`). Extended `FilterParams`, `get_filter_params()`, and `build_where_clause()` with `source_provider`, `profile_id`, and `exclude_incognito` (defaults preserve 100% V1/V2/V3 parity). |
| `backend/app/profiles.py` | Created | Implemented `profiles_router` (`prefix="/api/v4"`) with all 6 endpoints (`GET /api/v4/profiles`, `POST /api/v4/profiles` returning `201`, `POST /api/v4/profiles/{profile_id}/activate`, `POST /api/v4/profiles/{profile_id}/recompute-merge`, `DELETE /api/v4/profiles/{profile_id}` forbidding `id==1` with HTTP 400 and cleanly updating/recomputing affected merged profiles, `GET /api/v4/profile/capabilities`). Implemented chronological active-survivors sliding-window cross-platform deduplication engine `recompute_merged_exclusions()` (ISRC N-to-M + `play_events.isrc`, `canonical_key_for`, `similarity_score >= 0.85`, ±180s window, strict 4-level tie-breaker, same-profile repeat preservation, transitive chain safety). Exported M2A helpers (`record_profile_source`, `refresh_all_merged_profiles_containing`, `get_or_create_standard_profile`, `ensure_default_profile`, `resolve_profile_scope`). Reuses `expand_source_providers()`, `canonical_platform_for()`, and `build_profile_id_clause()` from `filters.py` with zero circular imports. |
| `backend/app/analytics/overview.py` | Modified | Updated `get_filter_options(profile_id: int | None = None)` to scope all filter option queries via `build_where_clause(FilterParams(profile_id=profile_id), include_skip_filter=False)` and added `"providers"` alongside all 10 existing keys. |
| `backend/app/analytics/behavior.py` | Modified | Added Spotify Extended end-reason French labels to `END_REASON_LABELS` and updated `_build_date_where(f, alias)` to reuse `expand_source_providers()` and `build_profile_id_clause(..., include_exclusions=False)` so `lyric_events` and `search_events` are isolated cleanly by profile (standard & merged) and `source_provider`. |
| `backend/app/analytics/duckdb_engine.py` | Modified | Appended `profile_id`, `incognito_mode`, and `isrc` to `PARQUET_SCHEMA` and `export_parquet_snapshot()`, dynamically referenced `db_mod.PARQUET_SNAPSHOT_PATH`, and upgraded `ensure_parquet_snapshot()` to detect and automatically re-export stale V3 Parquet snapshots missing V4 columns. |
| `backend/tests/test_profiles_v4.py` | Created | Added 12 comprehensive unit & Hypothesis property-based tests covering fresh/V3-upgrade migrations, cross-profile unique indexes, active profile preservation, filter matrix, profile CRUD/validation/deletion, ISRC/canonical/similarity/±180s/4-level tie-breaker/transitive dedup, M2A helpers, Capabilities Matrix across all 5 platforms + merged + empty, `overview.py` + `behavior.py` + `duckdb_engine.py` integration, and Hypothesis invariants. |

Untouched non-owned files confirmed: `backend/app/main.py` (`version="3.0.0"` intact), `backend/app/continuum/reconciler.py`, `backend/app/schemas.py`, `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py`, `frontend/`, `frontend-v2/`, `frontend-v3/`.

---

## 2. Canonical Verification Commands & Verbatim Output

### 2.1 Virtualenv Bootstrap (`uv`)
```bash
uv venv backend/.venv --python python3 && uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
```
Result: Exit code `0` — created `backend/.venv` (Python `3.11.2`) and installed 57 packages (`fastapi==0.165.0`, `pydantic==2.14.4`, `uvicorn==0.54.0`, `websockets==17.4`, `openpyxl==3.1.5`, `ytmusicapi==1.12.4`, `pillow==13.0.0`, `segno==1.6.6`, `dbus-next==0.2.3`, `duckdb==2.0.1`, `pyarrow==26.0.1`, `pytest==9.2.0`, `hypothesis==6.170.17`, `schemathesis==4.33.4`).

### 2.2 Import, WebP & Full Pytest Regression Suite
```bash
backend/.venv/bin/python -c "import fastapi, pydantic, websockets, openpyxl, ytmusicapi, PIL, segno, dbus_next, duckdb, pyarrow, ruptures, pytest, hypothesis, schemathesis; from PIL import features; assert features.check('webp'); import backend.app.profiles, backend.app.filters, backend.app.analytics.overview, backend.app.analytics.behavior, backend.app.analytics.duckdb_engine; print('ENV & IMPORTS OK | pydantic:', pydantic.__version__)" && backend/.venv/bin/pytest -v
```
Verbatim output (Exit code `0`):
```text
ENV & IMPORTS OK | pydantic: 2.14.4
============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.2.0, pluggy-1.7.0 -- /home/antigravity/Pibaps/AMDataWrap/backend/.venv/bin/python
cachedir: .pytest_cache
hypothesis profile 'default'
rootdir: /home/antigravity/Pibaps/AMDataWrap
configfile: pytest.ini
testpaths: backend/tests
plugins: anyio-4.16.0, hypothesis-6.170.17, schemathesis-4.33.4
collecting ... collected 25 items

backend/tests/test_openapi_fuzz.py::test_openapi_schema_valid_and_v3_endpoints_present PASSED [  4%]
backend/tests/test_openapi_fuzz.py::test_v3_core_endpoints_no_5xx PASSED [  8%]
backend/tests/test_openapi_fuzz.py::test_schemathesis_get_endpoints_smoke PASSED [ 12%]
backend/tests/test_openapi_fuzz.py::test_v3_frontend_contract_keys PASSED [ 16%]
backend/tests/test_profiles_v4.py::test_v4_fresh_init_idempotent PASSED  [ 20%]
backend/tests/test_profiles_v4.py::test_v4_migration_preserves_active_profile_across_restart PASSED [ 24%]
backend/tests/test_profiles_v4.py::test_v3_to_v4_upgrade_and_cross_profile_unique_indexes PASSED [ 28%]
backend/tests/test_profiles_v4.py::test_filters_provider_aliases_and_incognito PASSED [ 32%]
backend/tests/test_profiles_v4.py::test_filters_profile_id_standard_merged_and_edge_cases PASSED [ 36%]
backend/tests/test_profiles_v4.py::test_profiles_crud_validation_activation_and_deletion PASSED [ 40%]
backend/tests/test_profiles_v4.py::test_merge_dedup_isrc_canonical_similarity_and_boundaries PASSED [ 44%]
backend/tests/test_profiles_v4.py::test_merge_dedup_four_level_tie_breaker_transitive_and_m2a_helpers PASSED [ 48%]
backend/tests/test_profiles_v4.py::test_capabilities_matrix_all_platforms_and_merged PASSED [ 52%]
backend/tests/test_profiles_v4.py::test_overview_behavior_and_duckdb_v4_integration PASSED [ 56%]
backend/tests/test_profiles_v4.py::test_prop_merge_dedup_invariants PASSED [ 60%]
backend/tests/test_profiles_v4.py::test_prop_capabilities_bounds_and_safety PASSED [ 64%]
backend/tests/test_properties.py::test_normalize_basic_idempotent PASSED [ 68%]
backend/tests/test_properties.py::test_clean_group_key_idempotent PASSED [ 72%]
backend/tests/test_properties.py::test_clean_group_key_accents_and_editions PASSED [ 76%]
backend/tests/test_properties.py::test_eddington_invariant PASSED        [ 80%]
backend/tests/test_properties.py::test_gini_and_effective_core_bounds PASSED [ 84%]
backend/tests/test_properties.py::test_shannon_entropy_bounds PASSED     [ 88%]
backend/tests/test_properties.py::test_camelot_symmetry_and_coverage PASSED [ 92%]
backend/tests/test_properties.py::test_continuum_reconciliation_and_fts5 PASSED [ 96%]
backend/tests/test_properties.py::test_session_gap_invariant_in_db PASSED [100%]

======================== 25 passed, 1 warning in 4.66s =========================
```

### 2.3 Git Status Ownership Verification
```bash
git status --short
```
Verbatim output:
```text
 M backend/app/analytics/behavior.py
 M backend/app/analytics/duckdb_engine.py
 M backend/app/analytics/overview.py
 M backend/app/db.py
 M backend/app/filters.py
 M backend/requirements.txt
?? .agents/
?? PROJECT.md
?? backend/app/profiles.py
?? backend/tests/test_profiles_v4.py
```

---

## 3. Notes for Downstream Milestones (M2A–M2E)

1. **M2A (Importers):** Import `get_or_create_standard_profile`, `record_profile_source`, and `refresh_all_merged_profiles_containing` from `backend.app.profiles`. All `play_events` unique indexes (`idx_pe_provider_event_uniq`, `idx_pe_dedup_fp_uniq`) are now `profile_id`-scoped.
2. **M2B (Vinyl Enrichment):** `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, and `api_metadata_cache` tables and indexes are live in `db.py`.
3. **M2C (Tracking):** `sync_providers_config` is already seeded with `web_scrobbler`, `os_media`, and `extension_bridge`.
4. **M2E (Main Integration):** Mount `profiles_router` from `backend.app.profiles` into `backend/app/main.py` (keeping `FastAPI(version="3.0.0")`).
