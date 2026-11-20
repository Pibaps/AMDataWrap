# Primary Code Review Report (Reviewer 1) — Milestone M1 (Iteration 1)

**Milestone:** M1 — Backend V4 Foundation, Python Env, V4 SQLite Schema, Global Filters, Multi-Profiles, Fusion & Capabilities Matrix  
**Reviewer Role:** Primary Reviewer (Reviewer 1)  
**Repository:** `/home/antigravity/Pibaps/AMDataWrap`  
**Exclusive Report Path:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1/iter1_reviewer_primary/handoff.md`

---

## Verdict: `APPROVE`

All M1 requirements, `PROJECT.md` Interface Contract §1 specifications, `PLAN_V4_FINAL.md` §2.1 & §2.3 schema/logic rules, strict exclusive file ownership boundaries, and full V1/V2/V3 backward-compatibility guardrails are satisfied with zero blocking defects and 25/25 passing tests (0 failures, 0 skips).

---

## 1. Ownership & Working Tree Verification

### Command
```bash
git status --short && echo "---" && git diff --stat
```

### Verbatim Output
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
---
 backend/app/analytics/behavior.py      |  36 +++++-
 backend/app/analytics/duckdb_engine.py |  34 ++++--
 backend/app/analytics/overview.py      |  96 +++++++++++----
 backend/app/db.py                      | 216 ++++++++++++++++++++++++++++++++-
 backend/app/filters.py                 | 138 +++++++++++++++++++++
 backend/requirements.txt               |   6 +
 6 files changed, 492 insertions(+), 34 deletions(-)
```

### Assessment
- **PASS:** Every modified/created repository file is strictly within M1's exclusive ownership list (`backend/requirements.txt`, `backend/.venv/`, `backend/app/db.py`, `backend/app/filters.py`, `backend/app/profiles.py`, `backend/app/analytics/overview.py`, `backend/app/analytics/behavior.py`, `backend/app/analytics/duckdb_engine.py`, `backend/tests/test_profiles_v4.py`).
- **PASS:** Untouched non-owned files confirmed: `backend/app/main.py`, `backend/app/continuum/reconciler.py`, `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py`, `frontend/`, `frontend-v2/`, `frontend-v3/`.

---

## 2. Verification Commands & Verbatim Output

### 2.1 Full Pytest Suite (`backend/.venv/bin/pytest -v`)
```text
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

======================== 25 passed, 1 warning in 4.75s =========================
```
Result: Exit code `0` — `test_properties.py` (9/9), `test_openapi_fuzz.py` (4/4), and `test_profiles_v4.py` (12/12) ALL pass with 0 failures and 0 skips.

### 2.2 Python Environment & Pillow WebP Verification
```bash
backend/.venv/bin/python -c "import fastapi, pydantic, websockets, openpyxl, ytmusicapi, PIL, segno, dbus_next, duckdb, pyarrow, ruptures, pytest, hypothesis, schemathesis; from PIL import features; assert features.check('webp'); print('ALL IMPORTS & WEBP OK')"
```
Verbatim output (Exit code `0`): `ALL IMPORTS & WEBP OK`.

### 2.3 SQLite `json_each` Non-Array Resilience Check
```bash
backend/.venv/bin/python -c "import sqlite3; c=sqlite3.connect(':memory:'); print([(v, c.execute('SELECT CAST(je.value AS INTEGER) FROM json_each(?) je', (v,)).fetchall()) for v in ['[]', '[1,2]', '{}', 'null', '123', '\"abc\"']])"
```
Verbatim output (Exit code `0`): `[('[]', []), ('[1,2]', [(1,), (2,)]), ('{}', []), ('null', [(None,)]), ('123', [(123,)]), ('"abc"', [(0,)])]` — confirms `json_each` never raises SQLite errors on valid non-array JSON, while `json_valid(...)` safely handles malformed JSON.

---

## 3. Line-by-Line Review Findings by File

### 3.1 `backend/requirements.txt` — PASS
- Preserves all 12 V3 dependencies intact (lines 1–12).
- Appends required V4 dependencies (`openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0`, `dbus-next>=0.2.3; sys_platform == "linux"`).

### 3.2 `backend/app/db.py` — PASS
- **Schema Completeness:** All 7 V4 tables (`profiles`, `profile_sources`, `profile_merged_exclusions`, `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`) and additive columns (`play_events`: `profile_id`, `incognito_mode`, `reason_start`, `skipped`, `isrc`; `lyric_events`/`search_events`/`favorites`: `profile_id`) match `PROJECT.md` and `PLAN_V4_FINAL.md` §2.1 & §2.3.
- **V3→V4 Upgrade Safety:** `SCHEMA_SQL` only creates indexes on newly introduced V4 tables (lines 472–480). Additive columns on existing tables are added via `_ensure_column()` inside `_run_v4_migrations()` (lines 615–623), NULLs are backfilled (lines 626–630), and additive-column indexes are created strictly afterward (lines 633–643), preventing `OperationalError: no such column` on pre-existing V1/V2/V3 SQLite databases.
- **Profile-Scoped Unique Partial Indexes:** `_run_v4_migrations()` inspects `_index_columns()` and safely upgrades `idx_pe_provider_event_uniq` to `(profile_id, source_provider, source_event_id)` and `idx_pe_dedup_fp_uniq` to `(profile_id, dedup_fingerprint)` (lines 646–664). Idempotent across repeated `init_db()` calls (since `_run_v3_migrations()` uses `CREATE UNIQUE INDEX IF NOT EXISTS`, it leaves the upgraded V4 index intact).
- **Default Profile & Backfill:** Seeds Profile `id=1` (`'Profil Principal'`) with UTC timestamps, preserves active profile across restarts, backfills `profile_sources` from `import_meta` when `profile_sources` is empty, and seeds `web_scrobbler`, `os_media`, `extension_bridge` in `sync_providers_config`.

### 3.3 `backend/app/filters.py` — PASS
- **V1/V2/V3 Backward Compatibility:** `FilterParams` defaults (`source_provider=None`, `profile_id=None`, `exclude_incognito=False`) emit identical WHERE clauses to V3 when omitted.
- **Provider Aliases & Parameterization:** `SOURCE_PROVIDER_ALIASES`, `PROVIDER_TO_PLATFORM`, `canonical_platform_for()`, and `expand_source_providers()` cleanly handle `None`, `""`, `"all"`, canonical aliases (`apple_music`, `spotify`, `youtube_music`, `deezer`, `tidal`, `live`), raw provider tokens, and comma-separated lists. All SQL values use `?` placeholders (zero SQL injection surface).
- **Merged Profile Pure-SQL Clause:** `build_profile_id_clause()` uses `COALESCE({alias}.profile_id, 1) IN (SELECT ... UNION SELECT CAST(je.value AS INTEGER) FROM json_each(CASE WHEN json_valid(...) ...))` plus `NOT EXISTS (... profile_merged_exclusions ...)` when `include_exclusions=True`. Verified safe against all existing analytics callers (`overview`, `behavior`, `chrono`, `detail`, `galaxy`, `persona`, `v3_science`, `wrapped`), all of which query `play_events pe` against SQLite.

### 3.4 `backend/app/profiles.py` — PASS
- **API Contract Compliance (`PROJECT.md` §1):**
  - `GET /api/v4/profiles` matches exact schema (`active_profile_id`, `profiles[]` with `id`, `name`, `kind`, `merged_profile_ids`, `is_active`, `sources[]`, `total_plays`, `created_at`, `updated_at`). `total_plays` on merged profiles accurately uses deduplicated count via `build_profile_id_clause(..., include_exclusions=True)`.
  - `POST /api/v4/profiles` returns `201`, validates name (1–120 chars), kind (`standard`|`merged`), non-empty positive unique existing standard-only `merged_profile_ids` (blocks nested merges/cycles with HTTP 400), and immediately computes `profile_merged_exclusions`.
  - `POST /api/v4/profiles/{profile_id}/activate` enforces single-active invariant (404 on missing).
  - `POST /api/v4/profiles/{profile_id}/recompute-merge` validates existence (404) and merged kind (400 on standard) and refreshes exclusions.
  - `DELETE /api/v4/profiles/{profile_id}` forbids deleting `id == 1` (400), returns 404 on missing, explicitly cleans all profile-scoped tables (`profile_merged_exclusions`, `profile_sources`, `play_events`, `lyric_events`, `search_events`, `favorites`, `profiles` — essential since SQLite `PRAGMA foreign_keys` is OFF by default), strips the deleted ID from remaining merged profiles and recomputes their exclusions, and re-activates Profile `1` if the deleted profile was active.
  - `GET /api/v4/profile/capabilities` returns all 12 contract keys (`profile_id`, `platforms`, `has_exact_duration`, `estimated_duration_pct`, `has_skips`, `has_end_reasons`, `has_lyrics_events`, `has_search_events`, `has_devices`, `has_audio_quality`, `has_incognito_flag`, `has_shuffle_flag`) plus additive `source_providers` and `total_plays`. Division-by-zero guarded (`if total_plays > 0 else 0.0`), empty/merged/provider-filtered cases handled accurately.
- **Fusion Deduplication Engine (`recompute_merged_exclusions`):**
  - Chronological active-survivors sliding window (`±180s`, `ORDER BY started_epoch ASC, id ASC`) with strict 4-level total order `_winner_rank`: `(source_priority, exact_duration, play_duration_ms, -id)`.
  - Checks normalized ISRC (`recording_isrcs` N-to-M + `play_events.isrc`), `canonical_key_for`, and `similarity_score >= 0.85` (with artist match).
  - Preserves same-profile repeats (`a.profile_id == b.profile_id -> None`), guarantees monotonically ordered deque eviction, handles multi-survivor matches cleanly, and prevents false transitive suppression by evicted losers.
- **M2A Helpers:** `record_profile_source()`, `refresh_all_merged_profiles_containing()`, `get_or_create_standard_profile()`, `ensure_default_profile()`, and `resolve_profile_scope()` are clean, well-typed, and free of circular imports.

### 3.5 `backend/app/analytics/overview.py`, `behavior.py`, `duckdb_engine.py` — PASS
- `overview.py`: `get_filter_options(profile_id: int | None = None)` preserves backward compatibility with `main.py:335`, scopes all option queries cleanly via `build_where_clause`, and adds `"providers"` while preserving all 10 V3 contract keys.
- `behavior.py`: Adds French labels for Spotify Extended `end_reason_type` codes and scopes `lyric_events`/`search_events` in `_build_date_where()` by `source_provider` (returns 0 rows for non-Apple providers) and `profile_id` (standard & merged via `build_profile_id_clause(..., include_exclusions=False)`).
- `duckdb_engine.py`: Extends `PARQUET_SCHEMA` and `export_parquet_snapshot()` with `profile_id`, `incognito_mode`, and `isrc`; dynamically reads `db_mod.PARQUET_SNAPSHOT_PATH`; upgrades `ensure_parquet_snapshot()` to automatically re-export stale V3 Parquet files lacking V4 columns.

### 3.6 `backend/tests/test_profiles_v4.py` — PASS
- 12 thorough unit & Hypothesis property-based tests covering migrations, V3 upgrade, cross-profile unique indexes, filters, CRUD, deletion cascades, ISRC/canonical/similarity/boundary/4-level-tie-breaker/transitive dedup, capabilities across all 5 platforms + merged + empty, downstream analytics/DuckDB integration, and Hypothesis conservation/idempotence/bounds invariants.

---

## 4. Itemized Findings (Non-Blocking / Informational Only)

No `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW` defects found. Two minor informational notes recorded for awareness:

1. **Info — `backend/app/db.py:669-680`:** `_run_v4_migrations()` inserts default profile `id=1` with `is_active=1` via `INSERT OR IGNORE`. Under normal operation `id=1` cannot be deleted (HTTP 400 in `api_delete_profile`), so this is safe; if `id=1` were ever removed via manual SQL while another profile was active, inserting with `is_active=0` and letting the subsequent `if active_cnt == 0:` guard set `is_active=1` would preserve the single-active-profile invariant even under manual DB edits. (No action required for M1.)
2. **Info — `backend/app/analytics/duckdb_engine.py:174-185`:** `get_snapshot_status()` leaves `_LAST_EXPORT_META["exists"]` unchanged when `target.exists()` is `False` (pre-existing V3 behavior; harmless in production where `PARQUET_SNAPSHOT_PATH` is constant). (No action required for M1.)
