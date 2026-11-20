# Challenger 1 Report — Schema, Migrations, Filters & Analytics Stress-Test (M1 Iteration 1)

- **Role:** Challenger 1 (Schema, Migrations, Filters & Analytics Stress-Tester)
- **Milestone:** M1 — Phase 1 Foundation (`db.py`, `filters.py`, `profiles.py`, `overview.py`, `behavior.py`, `duckdb_engine.py`)
- **Repository:** `/home/antigravity/Pibaps/AMDataWrap`
- **Verdict:** **`PASS`** (0 Critical, 0 High, 0 Medium; 2 Low-severity hardening observations documented below)

---

## 1. Executive Summary

All M1 schema migrations, global filter/SQL-injection defenses, multi-profile isolation contracts, cross-platform deduplication boundaries, and DuckDB/Parquet round-trip recovery paths were empirically attacked using isolated probe suites executed via `backend/.venv/bin/python` inside temporary `mktemp -d` directories (completely removed via `rm -rf` prior to reporting).

- **Zero Critical / High / Medium defects found.**
- **Zero repository files modified** (confirmed via `git status --short`).
- **All temporary probe directories deleted** (`/tmp/m1_probe_*` verified absent).

---

## 2. Empirical Probes Executed & Observed Results

### Probe 1 — Legacy V1/V2 & V3 DB → V4 Upgrade Torture Test (`PASS`)

| Sub-probe | Input / Attack Setup | Observed Output | Contract Status |
| :--- | :--- | :--- | :---: |
| **1A: Genuine V1/V2 DB → V4 (×3 `init_db()`)** | Pre-V3 SQLite DB missing ALL V3 Continuum and V4 columns/tables; legacy rows with NULL `artist_name`, `genre`, `release_year`, `end_reason_type`, `device_label`, `audio_quality`; existing `import_meta` (`total_play_events=2`), `lyric_events`, `search_events`, `favorites`. Called `init_db()` 3 times sequentially. | Zero errors. All 7 V4 tables created; all additive columns added; `play_events.profile_id=1`, `incognito_mode=0`, `lyric_events/search_events/favorites.profile_id=1`; `tracks_fts` rebuilt (`count=1`); `profile_sources` backfilled **exact count = 1** (not duplicated across 3 runs). | **PASS** |
| **1B: Genuine V3 DB → V4 (×3 `init_db()` + Unique Indexes + Concurrency)** | Pre-V4 SQLite DB with old global unique partial indexes `idx_pe_provider_event_uniq(source_provider, source_event_id)` and `idx_pe_dedup_fp_uniq(dedup_fingerprint)`, NULL `source_provider`/`source_priority`/`duration_is_estimated`/`imported_at`, and non-null `('apple_rgpd_zip', 'evt-shared-1', 'fp-shared-1')`. Called `init_db()` ×3, tested cross/same-profile inserts, activated Profile 2, ran `init_db()` ×2 more, then ran 4 concurrent `init_db()` threads. | `PRAGMA index_info` verified `['profile_id', 'source_provider', 'source_event_id']` and `['profile_id', 'dedup_fingerprint']`. Cross-profile duplicate in Profile 2 **succeeded**; same-profile duplicate `(source_provider, source_event_id)` and same-profile duplicate `dedup_fingerprint` both raised `sqlite3.IntegrityError`; multiple NULLs in same profile succeeded. Profile 2 remained sole active profile across subsequent `init_db()` calls (`actives=[2]`). `profile_sources` stayed `1`. All 4 concurrent `init_db()` threads succeeded with 0 errors. | **PASS** |
| **1C: Migration Edge Cases** | `import_meta` with `total_play_events=0`; `profiles` manually updated so all rows have `is_active=0`; then `init_db()`. | `profile_sources` remained `0` (no bogus source row inserted); active profile automatically recovered to `[1]`. | **PASS** |

---

### Probe 2 — Filter SQL Injection, Edge Cases, Profile Isolation & All Analytics (`PASS`)

| Sub-probe | Input / Attack Setup | Observed Output | Contract Status |
| :--- | :--- | :--- | :---: |
| **2A: SQL Injection Attack** | Tested 6 payloads (`"apple_music' OR '1'='1"`, `"spotify); DROP TABLE play_events; --"`, `"' UNION SELECT 1 --"`, `"apple_music\"; DELETE FROM profiles; --"`, `"all' OR 1=1--"`, `"1; ATTACH DATABASE '/tmp/pwn.db' AS pwn;--"`) in `source_provider` and across `artist`, `genre`, `device`, `container_type`, `feature_name`. | Strictly parameterized `?` bindings. Every analytics call returned `0` plays / empty results with zero SQL errors; `play_events` (5 rows) and `profiles` (11 rows) untouched afterward. | **PASS** |
| **2B: `source_provider` Normalization & Aliases** | Tested `None`, `""`, `"   , ,  "`, `"all"`, `"all,spotify"`, `"  ALL , apple_music "`, `" Apple_Music , , SPOTIFY "`. | `None`/`""`/whitespace/`"all"`/`"all,spotify"` all returned `[]` (unfiltered, 5/5 plays). `" Apple_Music , , SPOTIFY "` expanded cleanly to 8 deduplicated raw provider values including `apple_rgpd_zip` and `spotify_extended` and matched 5/5 plays. | **PASS** |
| **2C: Profile Isolation & Analytics Matrix** | Evaluated `overview.get_overview`, `overview.get_filter_options`, `behavior.get_behavior_and_obsessions`, `chrono.get_chronobiology`, `detail.get_history`, `galaxy.get_sonic_galaxy` across **15 `profile_id` values** (`None`, `0`, `-5`, `99999`, Profile 1 Apple, Profile 2 Spotify+Incognito, Profile 3 Empty, Profile 4 Merged `[1,2]`, empty merged `[]`, corrupt JSON `"{bad json"`, object JSON, scalar JSON, mixed array, self-cycle `[10]`, nested merged `[4]`) × `exclude_incognito` ∈ `{False, True}` × 6 `source_provider` values. Also ran `persona.get_persona_and_eras`, `wrapped.get_wrapped_story`, `detail.{get_artist_detail,get_album_detail,get_day_detail,get_sessions,export_history_csv}`, and `v3_science.{get_musical_eras_pelt,get_science_metrics,get_world_atlas,get_cooccurrence_graph_2d,get_music_iceberg,get_collector_atelier}`. | Zero SQL errors, zero division-by-zero on empty profiles. Strict isolation confirmed: Profile 1 saw only 2 Apple plays / year `[2024]` / provider `['apple_rgpd_zip']` / 1 lyric / 1 search (no `Windows Desktop`); Profile 2 saw 3 Spotify plays (2 with `exclude_incognito=True`), 0 lyrics, 0 searches (no `iPhone 15`); Profile 4 (Merged) saw 4 plays (`5 - 1` deduped; 3 with `exclude_incognito=True`), 1 lyric / 1 search unfiltered, and 0 lyrics / 0 searches when `source_provider='spotify'`. See **Low Observation #1** below for DB-tampered non-array JSON literals. | **PASS** |
| **2D: Cross-Platform Dedup Boundaries, Tie-Breakers & Profile API Guards** | Tested exact ±180s boundaries (`dt=179s`, `180s`, `181s`), all 4 winner tie-breaker levels (`source_priority` → `duration_is_estimated` → `play_duration_ms` → lowest `id`), N-to-M `recording_isrcs` with hyphenated/lowercase normalization (`us-rc1-76-07839` vs `USRC17607839`), fuzzy similarity (`>= 0.85` vs `< 0.85`), same-profile repeat within 30s, 3-profile transitive chain (`P1(t=0,p=60) → P2(t=100,p=95) → P3(t=250,p=100)`), 9 invalid `POST /profiles` payloads, `DELETE /profiles/1` (400), `capabilities(99999)` (404), and deleting an active merged member. | `179s` & `180s` deduped, `181s` kept (`checked=6, excluded=2, kept=4`). All 4 tie-breaker levels exact. N-to-M ISRC matched with reason `'isrc'`. Fuzzy `>= 0.85` matched (`'similarity'`) while `< 0.85` kept. Same-profile repeat preserved. 3-profile chain kept highest-ranked survivor cleanly. All 9 bad `POST /profiles` payloads raised HTTP `400`. Deleting active member re-activated Profile 1, stripped member from `merged_profile_ids_json`, and recomputed exclusions cleanly. | **PASS** |

---

### Probe 3 — DuckDB / Parquet Round-Trip Torture Test (`PASS`)

| Sub-probe | Input / Attack Setup | Observed Output | Contract Status |
| :--- | :--- | :--- | :---: |
| **3A: Empty DB Parquet Export** | Fresh DB with 0 rows in `play_events` / `tracks_catalog`. Called `export_parquet_snapshot()` and `query_parquet()`. | Exported valid 0-row Parquet with all 37 columns (`profile_id: int64`, `incognito_mode: int8`, `isrc: string`). `query_parquet` returned `[{'c': 0, 's': 0}]`. | **PASS** |
| **3B: Multi-Profile Export with NULLs & Apostrophe Path** | Exported to `o'brien_snapshot.parquet` with Profile 1 (`isrc='USRC17607839'`), Profile 2 (`isrc=NULL, incognito_mode=1`), and a raw row with explicit `profile_id=NULL, isrc=NULL, incognito_mode=NULL, release_year=NULL, artist_name=NULL, genre=NULL`. | Exported 3 rows without error. DuckDB returned `profile_id=1` (coalesced), `isrc=''` (coalesced) / `'USRC17607839'`, `incognito_mode=0/1/0`; `GROUP BY profile_id` returned `[{1: 2}, {2: 1}]`. Apostrophe in file path handled cleanly. | **PASS** |
| **3C: Corrupt Parquet Recovery (`ensure_parquet_snapshot`)** | Overwrote Parquet file with (1) `0` bytes, (2) random garbage bytes, and (3) first 50% truncated bytes of a valid Parquet file; called `ensure_parquet_snapshot()` + `query_parquet()`. | All 3 corruption modes caught cleanly and atomically re-exported from SQLite; DuckDB returned exact count `3` after each recovery. | **PASS** |
| **3D: Stale V3 Parquet Auto-Upgrade** | Wrote a valid 34-column V3 Parquet file (omitting `profile_id`, `incognito_mode`, `isrc`) containing 1 stale dummy row; called `ensure_parquet_snapshot()`. | Detected missing V4 columns, auto-re-exported from SQLite to 37-column V4 schema with all 3 live SQLite rows. | **PASS** |

---

## 3. Non-Blocking Low-Severity Hardening Observations

These do **not** violate any API contract under normal usage and do **not** warrant blocking M1, but are worth tightening opportunistically:

1. **LOW — `build_profile_id_clause()` SQL/Python parity on DB-tampered non-array JSON (`backend/app/filters.py:98-100`)**
   - **Repro:** Manually insert a merged profile with valid non-array JSON in `merged_profile_ids_json`, e.g., `'{"a": 1, "b": 2}'` or `'1'`.
   - **Observed:** `json_valid(...)` evaluates to `1` in SQLite, so `json_each()` iterates object values / scalar value and `overview.get_overview(FilterParams(profile_id=...))` returns `5` / `2` plays, while `profiles._parse_merged_ids()` enforces `isinstance(parsed, list)` and returns `[]` (`capabilities` reports `0` plays). (Syntactically invalid JSON like `'{bad json'` already falls back safely to `'[]'` in both SQL and Python.)
   - **Suggested fix:** Guard with `CASE WHEN json_valid(p.merged_profile_ids_json) AND json_type(p.merged_profile_ids_json) = 'array' THEN p.merged_profile_ids_json ELSE '[]' END`.

2. **LOW — `get_snapshot_status()` stale cache when target file does not exist (`backend/app/analytics/duckdb_engine.py:174-185`)**
   - **Repro:** Export a Parquet snapshot, then delete the file on disk (or switch `db_mod.PARQUET_SNAPSHOT_PATH` to a non-existent path) and call `get_snapshot_status()`.
   - **Observed:** Returns stale `{'exists': True, 'rows': 3, ...}` from module-global `_LAST_EXPORT_META` because `if target.exists():` has no `else:` branch. (`ensure_parquet_snapshot()` and `query_parquet()` are unaffected and always inspect `target.exists()` directly.)
   - **Suggested fix:** Add an `else:` branch returning `exists=False, path=str(target), size_bytes=0, rows=0`.

---

## 4. Final Verdict

**VERDICT: `PASS`** — All M1 schema migration, SQL-injection/filter, multi-profile isolation, cross-platform deduplication, analytics integration, and DuckDB/Parquet contracts hold empirically with zero critical, high, or medium issues.
