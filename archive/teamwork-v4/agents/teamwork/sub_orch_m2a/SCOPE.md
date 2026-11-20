# Scope & Acceptance Criteria — Milestone M2A

## Owned Deliverables
1. **`backend/app/importers/__init__.py`**:
   - Format auto-detection across `.zip`, `.json`, `.xlsx`, `.csv` (plus `platform_hint` override / disambiguation).
   - `import_router = APIRouter(prefix="/api/v4", tags=["v4-import"])` implementing `PROJECT.md` §2:
     - `POST /api/v4/import` (multipart `file`, optional `profile_id`, `profile_name`, `platform_hint`, `exclude_incognito: bool = False`, `column_mapping: str | None = None`).
     - `POST /api/v4/import/preview-columns` (multipart `file` -> `{ detected_platform, detected_headers, sample_rows, suggested_mapping }`).
   - Non-destructive per-profile import reusing `get_or_create_standard_profile`, `record_profile_source`, `refresh_all_merged_profiles_containing`, `V4_PROVIDER_PRIORITY` from `backend.app.profiles`.
   - Exact response contract:
     - Standard success: `{ ok: true, detected_platform: "apple_music"|"spotify_extended"|"spotify_account"|"youtube_music"|"deezer"|"tidal", profile_id: int, raw_rows: int, inserted: int, upgraded: int, deduplicated: int, skipped_non_music: int, estimated_duration_count: int, min_date: str|null, max_date: str|null, warnings: str[] }`.
     - TIDAL missing required columns without `column_mapping`: HTTP 200 `{ ok: false, needs_mapping: true, detected_platform: "tidal", detected_headers: [...], sample_rows: [...], suggested_mapping: {...} }`.
2. **`backend/app/importers/base.py`**:
   - Shared normalized `ImportedPlay` & `ImportResult` dataclasses.
   - Profile-scoped batch DB inserter:
     - `play_events` with `profile_id`, `dedup_fingerprint`, `source_event_id`, `source_provider`, `source_priority`, `canonical_track_key`, `duration_is_estimated`, `incognito_mode`, `reason_start`, `skipped`, `isrc` (idempotent re-imports without wiping other profiles; upgrade/dedup counters).
     - `tracks_catalog` non-destructive upsert (never wipes other profiles' tracks; recalculates aggregate counts/stats cleanly).
     - `recording_isrcs` N-to-M insert (ISO 3901 / cleaned ISRC).
     - `platform_track_mappings` insert (`spotify`, `youtube`, etc.).
     - Session ID computation with 30-min (1800s) gap (scoped per profile).
     - FTS5 index update (`tracks_fts`, `tracks_fts_trigram`, `lyrics_fts`).
     - DuckDB Parquet refresh hook (`export_parquet_snapshot()`).
3. **`backend/app/importers/apple.py`**:
   - Non-destructive profile-scoped Apple Music RGPD ZIP importer reusing parsing helpers from `backend/app/ingestion.py` WITHOUT modifying `ingestion.py` and WITHOUT wiping other profiles' rows.
   - Preserves `PLAY_END` + `AUDIO` filter, `LYRIC_DISPLAY` -> `lyric_events` (tagged with `profile_id`), `Click Activity.csv` -> `search_events` (tagged with `profile_id`), `Favorites.csv` -> `favorites` (tagged with `profile_id`), nested `.json.zip`, `Daily Tracks` / `Library Tracks` heuristics, `source_provider='apple_rgpd_zip'`.
4. **`backend/app/importers/spotify.py`**:
   - Auto-detect inside `my_spotify_data.zip` or raw `.json` between:
     - Extended Streaming History (`Streaming_History_Audio_*.json`): strict filter `spotify_track_uri IS NOT NULL` (excludes podcasts/audiobooks), `exclude_incognito` honored, `incognito_mode` persisted, historical anomalies (`skipped` unreliable/null between `2015-04-13` and `2022-10-16` -> infer skip from `ms_played < 30_000` / `reason_end` in `fwdbtn`/`endplay`, legacy pre-2017 reasons `clickside`/`popup`/`uriopen`, `offline_timestamp` sec vs ms normalization), `platform_track_mappings` (`provider='spotify'`), `reason_end` mapping, warning for 2015–2022 `skipped` gap.
     - Account Data (`StreamingHistory_music_*.json`): `endTime`, `artistName`, `trackName`, `msPlayed`.
5. **`backend/app/importers/youtube.py`**:
   - Google Takeout `watch-history.json` (standalone or inside `.zip`).
   - Strict filter `entry.get("header") == "YouTube Music"`.
   - Reject HTML Takeout with clear French HTTP 400 instructing user to switch Google Takeout "Formats multiples" to JSON.
   - Dynamic multilingual title prefix stripping (`"Watched "`, `"Vous avez regardé "`, `"Angesehen: "`, `"Viste "`, `"Hai guardato "`, `"Assistiu a "`, etc.) + `" - Topic"` strip on `subtitles[0]["name"]`.
   - Tolerate deleted/private videos (missing `subtitles`) without crashing.
   - Extract `videoId` from `titleUrl` into `platform_track_mappings` (`provider='youtube'`).
   - Always set `duration_is_estimated = 1` (impute from canonical catalog duration or 210_000 ms) + warning about estimated durations & 36-month Google purge.
6. **`backend/app/importers/deezer.py`**:
   - Stream-read `.xlsx` (standalone or inside `.zip`) strictly with `openpyxl.load_workbook(..., read_only=True, data_only=True)`.
   - Detect EN and FR headers dynamically (`Song Title`/`Titre`, `Artist`/`Artiste`, `Album`, `Date`/`Date d'écoute`, `Listening Time`/`Durée d'écoute`, `Platform`/`Appareil`, `ISRC`).
   - Interpret timestamps strictly as UTC (datetime objects, Excel serial numbers, ISO/string dates).
   - **STRICT PRIVACY RULE**: detect and discard ANY IP address column (`IP`, `IP Address`, `Adresse IP`, etc.) — never persist or log IP anywhere!
   - Impute missing durations coded as `-1` via bounded chronological gap to next play (capped e.g. 600s) or canonical duration/210s default, marking `duration_is_estimated = 1`; NEVER store negative `play_duration_ms`.
7. **`backend/app/importers/tidal.py`**:
   - UTF-8 / UTF-8-BOM (`utf-8-sig`) `.csv` (standalone or inside `.zip`).
   - Auto-detect header aliases (`Title`/`Track Name`/`Song`, `Artist`/`Artist Name`/`Artist Name(s)`, `Album`/`Album Name`, `Duration`/`Duration (ms)`/`Duration (s)`, `ISRC`, `Date`/`Timestamp`/`Played At`).
   - Parse `MM:SS`, seconds, and milliseconds durations; insert valid ISRCs into `recording_isrcs`.
   - If required columns (`title`, `artist`) cannot be auto-detected and no `column_mapping` provided, return HTTP 200 `{ ok: false, needs_mapping: true, detected_platform: "tidal", detected_headers: [...], sample_rows: [...], suggested_mapping: {...} }`.
8. **`backend/tests/test_importers_v4.py`**:
   - Comprehensive unit + Hypothesis property-based tests covering all 5 importers, auto-detection, `POST /api/v4/import` & `POST /api/v4/import/preview-columns` (on test FastAPI app), profile separation, re-import idempotency, strict IP rejection, Spotify historical anomalies, YTM multilingual/HTML/deleted, Deezer `-1` duration, TIDAL assisted mapping, and merged profile refresh.
