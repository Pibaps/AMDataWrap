# Milestone M1 Briefing

## Mandatory Reference Files (Pass Verbatim to All Subagents)
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/ORIGINAL_REQUEST.md`
- `/home/antigravity/Pibaps/AMDataWrap/PROJECT.md`
- `/home/antigravity/Pibaps/AMDataWrap/docs/plans/PLAN_V4_FINAL.md`
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/survey_explorer_backend/handoff.md`
- `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/survey_spec_miner_docs/handoff.md`

## Core Technical Requirements (M1)
1. **Python Env (`backend/requirements.txt` + `backend/.venv/`):**
   - Add `openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0`, `dbus-next>=0.2.3`.
   - Bootstrap via `uv venv backend/.venv --python python3` and `uv pip install --python backend/.venv/bin/python -r backend/requirements.txt` (NO `sudo`/`apt`).
2. **V4 SQLite Schema & Migrations (`backend/app/db.py`):**
   - Define 7 new tables BOTH in `SCHEMA_SQL` AND idempotently in `_run_v4_migrations(conn)` (called from `init_db()`):
     - `profiles` (seed default `id=1`, `name="Profil Principal"`, `kind="standard"`, `is_active=1`)
     - `profile_sources`
     - `profile_merged_exclusions`
     - `recording_isrcs` + `idx_rec_isrc`
     - `platform_track_mappings` + `idx_ptm_provider_ext`
     - `vinyl_editions`
     - `api_metadata_cache`
   - Additive columns BOTH in `SCHEMA_SQL` AND via `_ensure_column()` in `_run_v4_migrations(conn)`:
     - `play_events`: `profile_id INTEGER DEFAULT 1`, `incognito_mode INTEGER DEFAULT 0`, `reason_start TEXT`, `skipped INTEGER`, `isrc TEXT` + `idx_pe_profile_id`
     - `lyric_events`, `search_events`, `favorites`: `profile_id INTEGER DEFAULT 1`
   - Seed `'web_scrobbler'`, `'os_media'`, `'extension_bridge'` into `sync_providers_config`.
   - Preserve 100% compatibility with `backend/tests/test_properties.py` (which executes `SCHEMA_SQL` + `_run_v3_migrations(conn)` directly) and `backend/tests/test_openapi_fuzz.py`.
3. **Global Filters (`backend/app/filters.py`):**
   - Add optional `source_provider: str | None = None`, `profile_id: int | None = None`, and `exclude_incognito: bool = False` to `FilterParams` and `get_filter_params()`.
   - When `profile_id is None`, preserve 100% backward-compatible V1/V2/V3 query behavior.
   - When `profile_id` is set:
     - `kind == 'standard'`: `pe.profile_id = ?`
     - `kind == 'merged'`: `pe.profile_id IN (...)` AND `pe.id NOT IN (SELECT play_event_id FROM profile_merged_exclusions WHERE merged_profile_id = ?)`
     - Non-existent `profile_id` should cleanly yield zero rows (e.g. `pe.profile_id = ?` or `1=0`), never crash.
   - When `source_provider` is set: filter `pe.source_provider` cleanly supporting comma-separated providers and canonical platform aliases (`apple_music`, `spotify`, `youtube_music`, `deezer`, `tidal`, plus exact provider names like `apple_rgpd_zip`, `spotify_extended`, `spotify_account`, `deezer_rgpd`, `tidal_csv`, `youtube_takeout`, etc.).
4. **Multi-Profiles, Fusion & Capabilities (`backend/app/profiles.py`):**
   - Expose FastAPI `profiles_router = APIRouter(prefix="/api/v4", tags=["v4-profiles"])`:
     - `GET /api/v4/profiles`
     - `POST /api/v4/profiles` (`201`, standard or merged; validate non-empty valid target IDs, prevent self-merge/cycles/nested-merged cycles; compute merged exclusions immediately)
     - `POST /api/v4/profiles/{profile_id}/activate`
     - `POST /api/v4/profiles/{profile_id}/recompute-merge`
     - `DELETE /api/v4/profiles/{profile_id}` (forbid deleting `profile_id == 1` with HTTP 400)
     - `GET /api/v4/profile/capabilities` (exact 11+ fields: `profile_id`, `platforms`, `has_exact_duration`, `estimated_duration_pct`, `has_skips`, `has_end_reasons`, `has_lyrics_events`, `has_search_events`, `has_devices`, `has_audio_quality`, `has_incognito_flag`, `has_shuffle_flag`; zero division-by-zero on empty profiles).
   - Cross-platform dedup engine `recompute_merged_exclusions(conn, merged_profile_id)`:
     - Chronological scan across member profiles within `±180s` matching by shared ISRC (`play_events.isrc` or `recording_isrcs`) OR `canonical_key_for(song_name, artist_name)` OR `similarity_score >= 0.85` (same normalized artist + similar title).
     - Keep highest `source_priority` (tie-break: exact duration (`duration_is_estimated == 0`) > longer `play_duration_ms` > lowest `id`), insert redundant play IDs into `profile_merged_exclusions`.
   - Reusable helpers for M2A: `record_profile_source(conn, profile_id, ...)` and `refresh_all_merged_profiles_containing(conn, profile_id)`.
5. **Analytics & DuckDB Updates:**
   - `backend/app/analytics/overview.py`: add `providers` list & optional `profile_id` awareness to `get_filter_options()`.
   - `backend/app/analytics/behavior.py`: update `_build_date_where()` to respect `f.profile_id` (including merged profile member IDs) on `lyric_events` and `search_events`.
   - `backend/app/analytics/duckdb_engine.py`: add `profile_id` column to `PARQUET_SCHEMA` and `export_parquet_snapshot()`.
6. **Tests (`backend/tests/test_profiles_v4.py`):**
   - Comprehensive unit + Hypothesis property tests covering all M1 features.
