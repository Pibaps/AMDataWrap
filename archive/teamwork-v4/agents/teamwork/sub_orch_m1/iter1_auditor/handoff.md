# Forensic Integrity Audit Report — Milestone M1 (Intermediate Gate)

**Verdict:** **`CLEAN`**  
**Milestone Audited:** M1 — Phase 1 Foundation (Env, V4 SQLite Schema & Migrations, Global Filters, Multi-Profiles, Cross-Platform Fusion & Capabilities Matrix)  
**Repository:** `/home/antigravity/Pibaps/AMDataWrap`  
**Audit Report Path:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1/iter1_auditor/handoff.md`

---

## 1. Executive Summary

An independent, line-by-line forensic audit of all M1-owned artifacts, git working-tree boundaries, virtual environment packages, SQLite migrations, pure-SQL filters, cross-platform deduplication engine, SQL-computed Capabilities Matrix, analytics/DuckDB integration, and test suite found **zero integrity violations**, **zero unauthorized modifications**, and **zero stub/mock/cheating patterns**. All 12 new M1 unit + Hypothesis tests and all 13 pre-existing V3 regression tests pass independently (**25/25 PASS**, 0 skipped, 0 xfailed).

---

## 2. Exclusive Scope & Working-Tree Forensics

Verified directly via `git status --short`, `git diff --name-only`, and `git diff --cached --name-only`:

- **Tracked files modified (6 — 100% M1-owned):**
  - `backend/requirements.txt`
  - `backend/app/db.py`
  - `backend/app/filters.py`
  - `backend/app/analytics/overview.py`
  - `backend/app/analytics/behavior.py`
  - `backend/app/analytics/duckdb_engine.py`
- **Untracked repository files created (2 — 100% M1-owned, plus gitignored `backend/.venv/`):**
  - `backend/app/profiles.py`
  - `backend/tests/test_profiles_v4.py`
  - *(Orchestrator files `PROJECT.md` and `.agents/` untouched by worker outside its handoff.)*
- **Staged files:** None.
- **Unowned files confirmed 100% untouched:**
  - `backend/app/main.py` (`version="3.0.0"` preserved)
  - `backend/app/continuum/reconciler.py`
  - `backend/app/schemas.py`
  - `backend/tests/test_properties.py`
  - `backend/tests/test_openapi_fuzz.py`
  - `frontend/`, `frontend-v2/`, `frontend-v3/`
  - No stray/temporary files in `backend/`, `backend/app/`, or `backend/tests/`.

---

## 3. Anti-Cheating & Genuine Implementation Forensics

### 3.1 Environment & Dependencies (`backend/requirements.txt`, `backend/.venv/`)
- `backend/requirements.txt` (lines 1–17) preserves all 12 V3 dependencies verbatim and appends all 5 V4 dependencies (`openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0`, `dbus-next>=0.2.3; sys_platform == "linux"`).
- Independently verified via `importlib.metadata.version()` inside `backend/.venv/bin/python`:
  - `fastapi==0.165.0`, `uvicorn==0.54.0`, `httpx==0.28.1`, `python-multipart==0.0.34`, `aiosqlite==0.22.1`, `duckdb==2.0.1`, `pyarrow==26.0.1`, `numpy==2.4.6`, `ruptures==1.1.10`, `pytest==9.2.0`, `hypothesis==6.170.17`, `schemathesis==4.33.4`, `openpyxl==3.1.5`, `ytmusicapi==1.12.4`, `pillow==13.0.0`, `segno==1.6.6`, `dbus-next==0.2.3`.
  - Pillow WebP support verified live: `PIL.features.check('webp') == True`.

### 3.2 SQLite Schema & Idempotent V4 Migrations (`backend/app/db.py`)
- **All 7 required V4 tables genuinely defined** in `SCHEMA_SQL` (lines 342–415):
  - `profiles`, `profile_sources`, `profile_merged_exclusions`, `recording_isrcs` (composite PK `(track_key, isrc)` N-to-M), `platform_track_mappings`, `vinyl_editions` (exact 14-column schema from `PLAN_V4_FINAL.md:73`), and `api_metadata_cache` (exact TTL schema from `PLAN_V4_FINAL.md:74`).
- **All additive columns defined in both `SCHEMA_SQL` and `_run_v4_migrations()`** (lines 148–194, 615–623): `play_events.{profile_id, incognito_mode, reason_start, skipped, isrc}`, plus `profile_id` on `lyric_events`, `search_events`, and `favorites`.
- **V3→V4 upgrade safety confirmed:** `SCHEMA_SQL` (lines 473–480) only creates indexes on newly introduced V4 tables; additive-column indexes are deferred to `_run_v4_migrations()` (lines 633–643) *after* `_ensure_column()` and NULL backfills (lines 626–630), avoiding `OperationalError: no such column` on legacy DB upgrades.
- **Profile-scoped unique partial indexes** (`idx_pe_provider_event_uniq`, `idx_pe_dedup_fp_uniq`, lines 646–664) inspect `_index_columns()` before dropping/recreating, preventing cross-profile `IntegrityError` while enforcing same-profile uniqueness.
- **Default profile seed & active-profile preservation** (lines 667–680): `INSERT OR IGNORE` seeds `id=1` (`Profil Principal`) and only sets `is_active=1` when `active_cnt == 0`, preserving active profile selection across restarts.
- **V3 `import_meta` → `profile_sources` backfill** (lines 683–707) and V4 `sync_providers_config` seeds (`web_scrobbler`, `os_media`, `extension_bridge`, lines 710–718) are genuinely implemented and wired into `init_db()` (line 725).

### 3.3 Global Multi-Platform & Multi-Profile Filters (`backend/app/filters.py`)
- Single Source of Truth mappings (`SOURCE_PROVIDER_ALIASES`, `PROVIDER_TO_PLATFORM`, `canonical_platform_for()`, `expand_source_providers()`, lines 6–82) cover all 5 platforms (`apple_music`, `spotify`, `youtube_music`, `deezer`, `tidal`) plus `live`, comma-separated tokens, raw tokens, and `'all'`.
- `build_profile_id_clause()` (lines 85–111) is **pure parameterized SQL** using SQLite `json_each()` guarded by `json_valid()` and `NOT EXISTS (SELECT 1 FROM profile_merged_exclusions ...)`. Zero SQL injection vectors; resilient to corrupt JSON or missing/empty profiles.
- `FilterParams`, `get_filter_params()`, and `build_where_clause()` (lines 114–280) add `source_provider`, `profile_id`, and `exclude_incognito` while keeping default `FilterParams()` 100% backward-compatible with V1/V2/V3.

### 3.4 Multi-Profile CRUD, Fusion Deduplication & Capabilities Matrix (`backend/app/profiles.py`)
- **All 6 FastAPI endpoints** implemented on `profiles_router` (`prefix="/api/v4"`, lines 764–978) matching `PROJECT.md` Interface Contracts verbatim:
  - `GET /api/v4/profiles`, `POST /api/v4/profiles` (`201`, strict validation preventing empty/overlong names, duplicate/missing/non-positive/nested-merged IDs), `POST /api/v4/profiles/{profile_id}/activate`, `POST /api/v4/profiles/{profile_id}/recompute-merge`, `DELETE /api/v4/profiles/{profile_id}` (forbids `id == 1` with HTTP 400, cascades deletion across profile-scoped tables, updates/recomputes affected merged profiles, re-activates `id == 1` if active), and `GET /api/v4/profile/capabilities`.
- **Cross-Platform Deduplication Engine (`recompute_merged_exclusions`, lines 194–392):** Genuine chronological active-survivors sliding-window algorithm (`MERGE_DEDUP_WINDOW_SEC = 180`):
  - Loads N-to-M `recording_isrcs` + normalized `play_events.isrc`, exact `canonical_key_for(song, artist)`, and fuzzy `similarity_score >= 0.85` (artist + title).
  - Preserves legitimate same-profile repeats (`a.profile_id == b.profile_id -> None`).
  - Strict 4-level total-order tie-breaker `_winner_rank`: `(source_priority, exact_duration, play_duration_ms, -id)`.
  - Correctly handles transitive chains and writes real rows into `profile_merged_exclusions`.
  - Exports genuine M2A helpers (`record_profile_source`, `refresh_all_merged_profiles_containing`, `get_or_create_standard_profile`, `ensure_default_profile`, `resolve_profile_scope`).
- **Dynamic Capabilities Matrix (`get_profile_capabilities`, lines 600–756):** Genuine SQL aggregation over actual rows in `play_events`, `lyric_events`, and `search_events` (scoped via `build_profile_id_clause(..., include_exclusions=True)` and `expand_source_providers()`). Not hardcoded per provider name; computes real `estimated_duration_pct`, `has_exact_duration`, `has_skips`, `has_end_reasons`, `has_lyrics_events`, `has_search_events`, `has_devices`, `has_audio_quality`, `has_incognito_flag`, `has_shuffle_flag` on deduplicated plays.

### 3.5 Downstream Analytics & DuckDB Parquet (`overview.py`, `behavior.py`, `duckdb_engine.py`)
- `overview.py`: `get_filter_options(profile_id=None)` scopes all option queries via `build_where_clause()` and adds `"providers"` while preserving all 10 V3 keys.
- `behavior.py`: Adds Spotify Extended French `END_REASON_LABELS` (lines 28–36) and scopes `lyric_events` / `search_events` in `_build_date_where()` via `expand_source_providers()` + `build_profile_id_clause(..., include_exclusions=False)`.
- `duckdb_engine.py`: Extends `PARQUET_SCHEMA` and `export_parquet_snapshot()` with `profile_id`, `incognito_mode`, `isrc`; dynamically references `db_mod.PARQUET_SNAPSHOT_PATH`; upgrades `ensure_parquet_snapshot()` to detect and atomically re-export stale V3 Parquet files.

### 3.6 Test Suite Integrity (`backend/tests/test_profiles_v4.py`)
- 12 substantial tests (10 deterministic unit/integration + 2 Hypothesis property-based tests: `test_prop_merge_dedup_invariants` with 60 examples and `test_prop_capabilities_bounds_and_safety` with 40 examples).
- Zero `@pytest.mark.skip`, zero `xfail`, zero tautological assertions, zero monkeypatching of logic under test (only `DB_PATH`/`PARQUET_SNAPSHOT_PATH` redirected to `tmp_path`).

---

## 4. Independent Test Execution (Verbatim Results)

### 4.1 Target-Scoped M1 Tests
Command: `backend/.venv/bin/pytest backend/tests/test_profiles_v4.py -v`  
Exit code: `0`
```text
============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.2.0, pluggy-1.7.0 -- /home/antigravity/Pibaps/AMDataWrap/backend/.venv/bin/python
cachedir: .pytest_cache
hypothesis profile 'default'
rootdir: /home/antigravity/Pibaps/AMDataWrap
configfile: pytest.ini
plugins: anyio-4.16.0, hypothesis-6.170.17, schemathesis-4.33.4
collecting ... collected 12 items

backend/tests/test_profiles_v4.py::test_v4_fresh_init_idempotent PASSED  [  8%]
backend/tests/test_profiles_v4.py::test_v4_migration_preserves_active_profile_across_restart PASSED [ 16%]
backend/tests/test_profiles_v4.py::test_v3_to_v4_upgrade_and_cross_profile_unique_indexes PASSED [ 25%]
backend/tests/test_profiles_v4.py::test_filters_provider_aliases_and_incognito PASSED [ 33%]
backend/tests/test_profiles_v4.py::test_filters_profile_id_standard_merged_and_edge_cases PASSED [ 41%]
backend/tests/test_profiles_v4.py::test_profiles_crud_validation_activation_and_deletion PASSED [ 50%]
backend/tests/test_profiles_v4.py::test_merge_dedup_isrc_canonical_similarity_and_boundaries PASSED [ 58%]
backend/tests/test_profiles_v4.py::test_merge_dedup_four_level_tie_breaker_transitive_and_m2a_helpers PASSED [ 66%]
backend/tests/test_profiles_v4.py::test_capabilities_matrix_all_platforms_and_merged PASSED [ 75%]
backend/tests/test_profiles_v4.py::test_overview_behavior_and_duckdb_v4_integration PASSED [ 83%]
backend/tests/test_profiles_v4.py::test_prop_merge_dedup_invariants PASSED [ 91%]
backend/tests/test_profiles_v4.py::test_prop_capabilities_bounds_and_safety PASSED [100%]

======================== 12 passed, 1 warning in 2.65s =========================
```

### 4.2 Full Backend Non-Regression Suite
Command: `backend/.venv/bin/pytest -v`  
Exit code: `0` — **25 passed, 1 warning in 4.65s** (`test_openapi_fuzz.py`: 4/4 PASSED; `test_profiles_v4.py`: 12/12 PASSED; `test_properties.py`: 9/9 PASSED).

---

## 5. Final Verdict

**`CLEAN`** — Milestone M1 passes all forensic integrity, exclusive scope, genuine implementation, and independent verification checks and is cleared to proceed to downstream Phase 1 milestones (M2A–M2D).
