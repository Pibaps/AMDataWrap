# Secondary Reviewer (Reviewer 2) Report — Milestone M1 (Iteration 1)

**Milestone:** M1 — Backend V4 Foundation, Env, Profiles, Fusion & Capabilities Matrix  
**Reviewer Role:** Secondary Reviewer (Cross-Module Interface Readiness for M2A–M2E, Subtle Logic/SQL Defects & Contract Fidelity)  
**Verdict:** **`APPROVE`**

---

## 1. Target-Scoped Verification Commands & Exact Outputs

### 1.1 Target Test Suite (`test_profiles_v4.py`)
```bash
backend/.venv/bin/pytest backend/tests/test_profiles_v4.py -v
```
Output (Exit code `0`):
```text
============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.2.0, pluggy-1.7.0 -- /home/antigravity/Pibaps/AMDataWrap/backend/.venv/bin/python
rootdir: /home/antigravity/Pibaps/AMDataWrap
configfile: pytest.ini
collected 12 items

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

======================== 12 passed, 1 warning in 2.52s =========================
```

### 1.2 Git Ownership & Scope Check
```bash
git status --short && git diff --stat
```
Output (Exit code `0`):
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
 backend/app/analytics/behavior.py      |  36 +++++-
 backend/app/analytics/duckdb_engine.py |  34 ++++--
 backend/app/analytics/overview.py      |  96 +++++++++++----
 backend/app/db.py                      | 216 ++++++++++++++++++++++++++++++++-
 backend/app/filters.py                 | 138 +++++++++++++++++++++
 backend/requirements.txt               |   6 +
 6 files changed, 492 insertions(+), 34 deletions(-)
```
Strictly within M1 file ownership; `main.py`, `reconciler.py`, `schemas.py`, `frontend/`, `frontend-v2/`, `frontend-v3/`, and existing test files are untouched.

### 1.3 Live Cross-Analytics & DuckDB Parquet Smoke Audit (All 23+ Analytics Callers)
Executed an isolated read-only Python check against a temporary SQLite DB + Parquet snapshot exercising all analytics modules (`overview`, `behavior`, `chrono`, `detail`, `galaxy`, `persona`, `wrapped`, all 10 `FilterParams`-accepting functions in `v3_science`, and `duckdb_engine.query_parquet`) under 5 filter combinations (`default`, `profile_id=merged`, `profile_id=merged + source_provider="spotify"`, `profile_id=merged + exclude_incognito=True`, `profile_id=999`).
Result (Exit code `0`):
```text
Discovered v3_science FilterParams funcs: ['build_smart_playlist', 'build_where_clause', 'get_blind_test_quiz', 'get_camelot_wheel', 'get_collector_atelier', 'get_cooccurrence_graph_2d', 'get_emotional_compass', 'get_music_iceberg', 'get_musical_eras_pelt', 'get_science_metrics', 'get_world_atlas', 'metric_order_sql']
OK: default -> overview plays = 3
OK: merged -> overview plays = 2
OK: merged+spotify -> overview plays = 1
OK: merged+no_incog -> overview plays = 1
OK: empty_prof -> overview plays = 0
ALL ANALYTICS FUNCTIONS + DUCKDB PARQUET PASSED!
```

---

## 2. Detailed Audit Results

### 2.1 Contract Fidelity (`backend/app/profiles.py` vs `PROJECT.md` §1)
Every endpoint, HTTP status code, and JSON key matches `PROJECT.md` §1 verbatim:
- **`GET /api/v4/profiles`**: `{ active_profile_id, profiles: [{ id, name, kind, merged_profile_ids, is_active, sources: [{ id, source_provider, filename, imported_at, events_count, unique_tracks, min_date, max_date }], total_plays, created_at, updated_at }] }` — **EXACT MATCH**.
- **`POST /api/v4/profiles`**: `status_code=201`, validates `name` (1–120 trimmed), `kind` (`standard`|`merged`), non-empty/positive/unique/existing non-merged `merged_profile_ids`, immediately computes `profile_merged_exclusions` for merged profiles, returns serialized profile (+ additive `dedup_stats`). — **EXACT MATCH**.
- **`POST /api/v4/profiles/{profile_id}/activate`**: `404` on missing, clears previous `is_active`, activates target, returns `{ ok, active_profile_id, profile }`. — **EXACT MATCH**.
- **`POST /api/v4/profiles/{profile_id}/recompute-merge`**: `404` on missing, `400` on standard profile, recomputes exclusions & bumps `updated_at`, returns `{ ok, profile_id, checked, excluded, kept }`. — **EXACT MATCH**.
- **`DELETE /api/v4/profiles/{profile_id}`**: `400` if `profile_id == 1`, `404` if missing; deletes `profile_merged_exclusions` (before deleting `play_events` so the subquery resolves properly), `profile_sources`, `play_events`, `lyric_events`, `search_events`, `favorites`, `profiles`; strips deleted ID from surviving merged profiles and recomputes their exclusions; re-activates profile `1` if the deleted profile was active. — **EXACT MATCH**.
- **`GET /api/v4/profile/capabilities?profile_id=...&source_provider=...`**: Returns all 12 contract keys (`profile_id`, `platforms`, `has_exact_duration`, `estimated_duration_pct`, `has_skips`, `has_end_reasons`, `has_lyrics_events`, `has_search_events`, `has_devices`, `has_audio_quality`, `has_incognito_flag`, `has_shuffle_flag`) plus additive `source_providers` and `total_plays` consistently across empty, standard, and merged profiles. Zero division-by-zero when `total_plays == 0`. — **EXACT MATCH**.

### 2.2 `recompute_merged_exclusions()` Algorithmic Audit (`backend/app/profiles.py:194-392`)
- **Ordering & Window Eviction:** Streams member `play_events` ordered by `started_epoch ASC, id ASC`; evicts `window[0].started_epoch < cur.started_epoch - 180` (`<= 180s` inclusive, `181s` kept). Duplicate timestamps handled deterministically via `id ASC` and `-ev.id` tie-breaker.
- **Matching Criteria:** (1) Normalized ISRC intersection across `play_events.isrc` + N-to-M `recording_isrcs`, (2) `canonical_key_for`, (3) `artist_gk` equality or `similarity_score(artist) >= 0.85` AND `similarity_score(song) >= 0.85`. Same-profile events (`a.profile_id == b.profile_id`) are never deduplicated.
- **Active-Survivors Invariant:** Because `window` holds only currently-kept events and any incoming `cur` either gets excluded (if any matching survivor outranks it) or evicts ALL matching survivors (if `cur` strictly outranks all of them), the active-survivors invariant holds inductively: zero surviving pairs across distinct profiles match within ±180s, including transitive chains and multi-profile overlap.
- **Tie-Breaker Stability:** Strict total order `(source_priority, duration_is_estimated == 0, play_duration_ms, -id)` guarantees uniqueness and idempotence.

### 2.3 Cross-Module Readiness for M2A–M2E
- **M2A (`importers/`):** `get_or_create_standard_profile`, `record_profile_source`, `refresh_all_merged_profiles_containing`, `V4_PROVIDER_PRIORITY` all accept the caller's `sqlite3.Connection` directly (zero nested connection / write-lock risk). Both unique partial indexes (`idx_pe_provider_event_uniq`, `idx_pe_dedup_fp_uniq`) are `profile_id`-scoped so identical archives/events can coexist in separate profiles while staying idempotent within a profile.
- **M2B (`vinyl_enrichment.py`):** All 4 tables (`recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`) and indexes match `PLAN_V4_FINAL.md` §2.3 columns/PKs verbatim.
- **M2C (`continuum/`):** `sync_providers_config` seeded with `web_scrobbler` (enabled=1), `os_media` (enabled=0), `extension_bridge` (enabled=0).
- **M2D (`playback/`):** `platform_track_mappings` indexed on `(track_key, provider)` and `(provider, external_id)`.
- **M2E (`main.py`):** `profiles_router` cleanly exposes `/api/v4` prefix; `get_filter_options(profile_id=None)` preserves zero-arg V1/V2/V3 compatibility while allowing M2E to wire `profile_id` query param into `GET /api/filters`.

### 2.4 `filters.py`, `overview.py`, `behavior.py` & `duckdb_engine.py` Audit
- **Parameter Binding & Alias Safety:** Verified all 25 `build_where_clause` call sites across `chrono.py`, `detail.py`, `galaxy.py`, `overview.py`, `persona.py`, `v3_science.py`, `wrapped.py`, and `behavior.py`. Every caller uses `FROM play_events pe` (zero collisions with internal subquery aliases `p`, `je`, `pme`). All `?` placeholders match parameter list lengths and ordering across `build_where_clause`, `build_profile_id_clause`, `get_filter_options`, and `_build_date_where`.
- **`source_provider` Alias Coverage:** Covers Apple (`apple_rgpd_zip`, `apple_music`, `apple`, `musickit_web`), Spotify (`spotify_extended`, `spotify_account`, `spotify_rgpd`, `spotify_web`, `spotify`), YouTube Music (`youtube_takeout`, `youtube_music`, `youtube_iframe`, `youtube_web`, `youtube`), Deezer (`deezer_rgpd`, `deezer`), TIDAL (`tidal_csv`, `tidal_rgpd`, `tidal`), and Live (`local_smtc`, `os_media`, `web_scrobbler`, `extension_bridge`, `local_receiver`, `listenbrainz`, `lastfm`, `youtube_iframe`, `preview_audio`).
- **DuckDB Parquet Compatibility:** `PARQUET_SCHEMA` and `export_parquet_snapshot()` append `profile_id`, `incognito_mode`, `isrc` without altering existing columns; `ensure_parquet_snapshot()` automatically detects and re-exports stale V3 Parquet files; `v3_science.py`'s `query_parquet("SELECT COUNT(*) AS c FROM {parquet}")` remains 100% compatible.

---

## 3. Non-Blocking Observations (Low / Informational)

No Critical, High, or Medium defects were found. Four minor/informational notes for future polish or M2E awareness:

1. **`backend/app/profiles.py:235` (Low — edge case):** `_events_match` checks `a.canon_key and a.canon_key != "||" and a.canon_key == b.canon_key`. If two different punctuation/emoji-only titles by the same artist normalize to `""` (producing `"||artist"`), they would match via `canonical_key`. Checking `not a.canon_key.startswith("||")` would prevent empty-song false matches.
2. **`backend/app/profiles.py:482-497` (Low — edge case):** `get_or_create_standard_profile` truncates `clean_name[:120]` during `INSERT` (line 496) rather than before the `LOWER(name) = LOWER(?)` lookup (line 485). Truncating at line 482 (`clean_name = (profile_name or "").strip()[:120]`) guarantees idempotence for >120-char names.
3. **`backend/app/profiles.py:47-64, 86-97` (Low — completeness):**
   - `V4_PROVIDER_PRIORITY` includes `"apple_rgpd_zip"` (100) from `PROVIDER_PRIORITY`, but omits `"apple_music"` (would fall back to 50 if a row has `source_priority IS NULL`).
   - `_NO_NATIVE_END_REASON_PROVIDERS` includes `"listenbrainz"` and `"lastfm"`, whereas `"local_receiver"` and `"web_scrobbler"` are omitted (could report `has_end_reasons=True` on default `"NATURAL_END_OF_TRACK"` rows if a profile only contains those live scrobbles).
4. **`backend/app/main.py:333-335` (Info for M2E):** `GET /api/filters` currently calls `get_filter_options()` with no arguments (preserving M1 file ownership boundaries). M2E should add `profile_id: int | None = Query(None)` to `filters_endpoint` and pass `profile_id=profile_id` when mounting V4 routers.

---

## 4. Verdict

**`APPROVE`** — M1 meets all `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `PLAN_V4_FINAL.md` acceptance criteria, maintains strict V1/V2/V3 backward compatibility and file ownership, and provides a solid, cleanly tested foundation for M2A–M2E.
