# Hard Handoff Report — Milestone M1 (Phase 1 Foundation)

**Handoff Type:** Hard (Milestone M1 Complete — Gate PASSED on Iteration 1)  
**Milestone:** M1 — Python Env, V4 SQLite Schema, Global Filters, Multi-Profiles, Fusion & Capabilities Matrix  
**Sub-Orchestrator:** `673003c5001aacc64536c7d9308d1872`  
**State Folder:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1`  
**Repository:** `/home/antigravity/Pibaps/AMDataWrap`

---

## 1. Executive Summary

Milestone M1 is **complete and independently verified** across a full 5-agent Parallel Verification Wave (**Primary Reviewer: `APPROVE`**, **Secondary Reviewer: `APPROVE`**, **Challenger 1: `PASS`**, **Challenger 2: `PASS`**, **Forensic Auditor: `CLEAN`**). All 25 backend tests (13 pre-existing V3 tests + 12 new M1 unit & Hypothesis property-based tests) pass with **0 failures and 0 skips**, and strict exclusive M1 file ownership was maintained (`main.py`, `reconciler.py`, `schemas.py`, `test_properties.py`, `test_openapi_fuzz.py`, and `frontend/`/`frontend-v2/`/`frontend-v3/` remain 100% untouched).

---

## 2. Files Created / Modified (Strictly Within M1 Exclusive Ownership)

1. **`backend/requirements.txt`** & **`backend/.venv/`** (user-space via `uv`, NO `sudo`/`apt`):
   - Preserved all 12 V3 dependencies and appended V4 dependencies: `openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0`, `dbus-next>=0.2.3; sys_platform == "linux"`.
   - Bootstrapped `backend/.venv` (Python `3.11.2`, 57 packages incl. `fastapi==0.165.0`, `pydantic==2.14.4`, `uvicorn==0.54.0`, `websockets==17.4`, `openpyxl==3.1.5`, `ytmusicapi==1.12.4`, `pillow==13.0.0` with WebP=True, `segno==1.6.6`, `dbus-next==0.2.3`, `duckdb==2.0.1`, `pyarrow==26.0.1`, `pytest==9.2.0`, `hypothesis==6.170.17`, `schemathesis==4.33.4`).
2. **`backend/app/db.py`**:
   - Added all 7 V4 tables (`profiles`, `profile_sources`, `profile_merged_exclusions`, `recording_isrcs` + `idx_rec_isrc`, `platform_track_mappings` + `idx_ptm_provider_ext` + `idx_ptm_track_provider`, `vinyl_editions` + `idx_ve_mbid_rg`, `api_metadata_cache` + `idx_amc_expires`) and additive columns (`play_events.{profile_id, incognito_mode, reason_start, skipped, isrc}`; `{lyric_events, search_events, favorites}.profile_id`) to `SCHEMA_SQL` (keeping `test_properties.py`'s direct `SCHEMA_SQL` + `_run_v3_migrations` execution 100% green).
   - Added idempotent `_run_v4_migrations(conn)` invoked by `init_db()` with V3→V4 safe index ordering (additive-column indexes created strictly after `_ensure_column()` + NULL backfills), profile-scoped unique partial index upgrades (`idx_pe_provider_event_uniq` and `idx_pe_dedup_fp_uniq` now include leading `profile_id`), default Profile `id=1` (`Profil Principal`) seed preserving user active profile across restarts, `import_meta` → `profile_sources` backfill, and V4 `sync_providers_config` seeds (`web_scrobbler`, `os_media`, `extension_bridge`).
3. **`backend/app/filters.py`**:
   - Single Source of Truth mappings & helpers: `SOURCE_PROVIDER_ALIASES`, `PROVIDER_TO_PLATFORM`, `canonical_platform_for()`, `expand_source_providers()`, and pure-SQL `build_profile_id_clause()` (using SQLite built-in `json_each()` + `json_valid()` + `NOT EXISTS` against `profile_merged_exclusions` covering PK index).
   - Extended `FilterParams`, `get_filter_params()`, and `build_where_clause()` with optional `source_provider: str | None = None`, `profile_id: int | None = None`, and `exclude_incognito: bool = False`. When omitted (`None`/`False`), SQL output preserves 100% V1/V2/V3 backward compatibility across all 25 callers.
4. **`backend/app/profiles.py`** (new):
   - FastAPI `profiles_router = APIRouter(prefix="/api/v4", tags=["v4-profiles"])` implementing `PROJECT.md` Interface Contract §1 verbatim:
     - `GET /api/v4/profiles`
     - `POST /api/v4/profiles` (`201`, standard & merged validation preventing empty/overlong names, invalid kind, empty/duplicate/non-positive/non-existent/nested-merged IDs; immediate exclusion computation)
     - `POST /api/v4/profiles/{profile_id}/activate`
     - `POST /api/v4/profiles/{profile_id}/recompute-merge`
     - `DELETE /api/v4/profiles/{profile_id}` (forbids `id==1` with HTTP 400; atomic cleanup of profile events/sources/exclusions; updates & recomputes referencing merged profiles cleanly even down to 0 members; re-activates `id=1` if active profile was deleted)
     - `GET /api/v4/profile/capabilities?profile_id=...&source_provider=...` (exact 12 contract keys + additive `source_providers`/`total_plays`, SQL-computed on deduplicated plays, zero division-by-zero on empty profiles)
   - Cross-platform deduplication engine `recompute_merged_exclusions(conn, merged_profile_id)`: chronological active-survivors sliding window (`±180s` inclusive) matching by normalized ISRC (`play_events.isrc` + N-to-M `recording_isrcs`), `canonical_key_for`, or `similarity_score >= 0.85` (same/similar artist + title), strict 4-level total-order tie-breaker (`source_priority` > exact duration > longer `play_duration_ms` > lowest `id`), same-profile repeat preservation, and transitive chain safety (2,000 events merged in 29.5 ms).
   - Exported M2A reusable helpers: `record_profile_source()`, `refresh_all_merged_profiles_containing()`, `get_or_create_standard_profile()`, `ensure_default_profile()`, `resolve_profile_scope()`, `V4_PROVIDER_PRIORITY`.
5. **`backend/app/analytics/overview.py`**:
   - Updated `get_filter_options(profile_id: int | None = None)` to scope all option queries via `build_where_clause(FilterParams(profile_id=profile_id), include_skip_filter=False)` and add `"providers"` while preserving all 10 V3 contract keys and zero-arg `main.py` compatibility.
6. **`backend/app/analytics/behavior.py`**:
   - Added Spotify Extended French `END_REASON_LABELS` and updated `_build_date_where(f, alias)` to scope `lyric_events` and `search_events` by `profile_id` (standard & merged via `build_profile_id_clause(..., include_exclusions=False)`) and `source_provider` (blocking Apple-only lyrics/searches on non-Apple filters).
7. **`backend/app/analytics/duckdb_engine.py`**:
   - Appended `profile_id`, `incognito_mode`, and `isrc` to `PARQUET_SCHEMA` and `export_parquet_snapshot()`, dynamically referenced `db_mod.PARQUET_SNAPSHOT_PATH`, and upgraded `ensure_parquet_snapshot()` to automatically detect & re-export stale V3 or corrupt Parquet snapshots.
8. **`backend/tests/test_profiles_v4.py`** (new):
   - 12 comprehensive unit, integration, legacy V3 upgrade, and Hypothesis property-based tests (0 skips, 0 xfails).

---

## 3. Verified Commands & Results

- **Full Backend Test Suite (independently verified by Primary Reviewer & Forensic Auditor):**
  - Command: `backend/.venv/bin/pytest -v`
  - Result: **25 passed, 0 failed, 0 skipped** (`test_openapi_fuzz.py`: 4/4, `test_profiles_v4.py`: 12/12, `test_properties.py`: 9/9) in `4.65s–4.75s`.
- **Environment & WebP Check:**
  - Command: `backend/.venv/bin/python -c "import fastapi, pydantic, websockets, openpyxl, ytmusicapi, PIL, segno, dbus_next, duckdb, pyarrow, ruptures, pytest, hypothesis, schemathesis; from PIL import features; assert features.check('webp'); print('ALL IMPORTS & WEBP OK')"`
  - Result: `ALL IMPORTS & WEBP OK`.
- **Ownership Check (`git status --short`):**
  - Confirmed ONLY the 8 M1-owned paths modified/created (plus `PROJECT.md` and `.agents/`). Zero unowned files touched.

---

## 4. Iteration 1 Gate Verdicts Summary (`GATE_STATUS.md`)

- **Primary Reviewer (`iter1_reviewer_primary/handoff.md`):** **`APPROVE`**
- **Secondary Reviewer (`iter1_reviewer_secondary/handoff.md`):** **`APPROVE`**
- **Challenger 1 — Schema/Filters/Analytics (`iter1_challenger_schema_filters/handoff.md`):** **`PASS`** (0 Critical, 0 High, 0 Medium)
- **Challenger 2 — Profiles/Dedup/Capabilities (`iter1_challenger_profiles/handoff.md`):** **`PASS`** (0 Critical, 0 High)
- **Forensic Auditor — Intermediate Audit (`iter1_auditor/handoff.md`):** **`CLEAN`**

---

## 5. Downstream Notes for M2A–M2E & Tier-5 Hardening

1. **M2A (`backend/app/importers/`):** Reuse `get_or_create_standard_profile`, `record_profile_source`, `refresh_all_merged_profiles_containing`, `V4_PROVIDER_PRIORITY` from `backend.app.profiles`. Both `play_events` partial unique indexes (`idx_pe_provider_event_uniq`, `idx_pe_dedup_fp_uniq`) are `profile_id`-scoped.
2. **M2B (`vinyl_enrichment.py`):** Tables `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache` and their indexes are live in `db.py`.
3. **M2C (`continuum/`):** `sync_providers_config` already seeds `web_scrobbler`, `os_media`, `extension_bridge`.
4. **M2D (`playback/`):** `platform_track_mappings` indexes on `(track_key, provider)` and `(provider, external_id)` are live in `db.py`.
5. **M2E (`main.py` & `reconciler.py`):** Mount `profiles_router` from `backend.app.profiles`, keep `FastAPI(version="3.0.0")`, and pass optional `profile_id: int | None = Query(None)` into `GET /api/filters` → `get_filter_options(profile_id=profile_id)`.
6. **Optional Tier-5 Hardening Notes (non-blocking polish flagged by Challengers/Reviewers):**
   - Tighten `_normalize_isrc()` in `profiles.py` to ISO 3901 12-char regex (`^[A-Z]{2}[A-Z0-9]{3}\d{7}$`) to reject placeholder strings like `"NOT_AVAILABLE"` / `"000000000000"`.
   - Guard short-artist substring matching (`min(len(a.artist_gk), len(b.artist_gk)) >= 4`) and empty-song canonical keys (`not a.canon_key.startswith("||")`) in `profiles.py:_events_match()`.
   - Add `AND json_type(p.merged_profile_ids_json) = 'array'` in `filters.py:build_profile_id_clause()` for DB-tampered non-array JSON parity.
