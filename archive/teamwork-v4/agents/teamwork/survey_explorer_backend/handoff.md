# Handoff Report — AMDataWrap V4 Backend & Python Environment Survey

**Handoff Type:** Hard (Survey Complete)  
**Scope:** Full read-only audit of `backend/`, SQLite schema, filters, routers/endpoints, importers, enrichment, continuum/scrobbling, tests, and VM Python environment for Phase 1 & Phase 3 V4 backend implementation.

**Executive Summary:** The existing V3 backend is a well-structured, 31-file FastAPI + SQLite WAL/FTS5 + DuckDB/Parquet codebase whose `play_events` table and `reconciler.py` are ~70% ready for V4 multi-platform data, while **all 53 routes currently live in `backend/app/main.py`** with zero WebSocket endpoints and no `profiles`/ISRC/vinyl tables yet. No virtualenv exists yet in the repo, and system Python (`3.11.2`) carries outdated Debian packages (`fastapi 0.92`, `pydantic 1.10`) incompatible with the codebase's Pydantic v2 (`model_dump()`), but **`uv 0.13.8` is pre-installed and PyPI is reachable (HTTP 200)** for bootstrapping `backend/.venv` cleanly in user space.

---

## 1. Observation

### 1.1 Repository & `backend/` Directory Map (36 entries total)

Verified via `list_dir` and `find_by_name` on `/home/antigravity/Pibaps/AMDataWrap`:

| Path | Lines | Purpose & Key Symbols |
| :--- | :---: | :--- |
| `pytest.ini` | 4 | `pythonpath = .`, `testpaths = backend/tests` |
| `backend/requirements.txt` | 13 | 12 packages (`fastapi>=0.115.0`, `uvicorn[standard]>=0.32.0`, `httpx>=0.27.0`, `python-multipart>=0.0.12`, `aiosqlite>=0.20.0`, `duckdb>=1.1.0`, `pyarrow>=18.0.0`, `numpy>=2.0.0`, `ruptures>=1.1.9`, `pytest>=8.3.0`, `hypothesis>=6.115.0`, `schemathesis>=3.38.0`) |
| `start.ps1` / `start.bat` | 43 / 3 | Windows launcher expecting `.\backend\.venv\Scripts\uvicorn.exe backend.app.main:app --host 127.0.0.1 --port 8000` + frontends `:5173`, `:5174`, `:5175` |
| `.gitignore` | 38 | Already ignores `backend/.venv/`, `.venv/`, `data/`, `*.sqlite*`, `*.parquet`, `*.zip` |
| `backend/app/main.py` | 765 | FastAPI app (`version="3.0.0"`), `lifespan()`, `CORSMiddleware`, 2 exception handlers, **53 HTTP endpoints** (no `APIRouter`s, no WebSocket endpoints) |
| `backend/app/db.py` | 519 | `DB_PATH = data/amdatawrap.sqlite`, `PARQUET_SNAPSHOT_PATH = data/analytics_snapshot.parquet`, `get_connection()`, `db_session()`, `async_db_session()`, `SCHEMA_SQL`, `_ensure_column()`, `_run_v3_migrations()`, `rebuild_fts_indexes()`, `upsert_track_fts()`, `upsert_lyrics_fts()`, `init_db()` |
| `backend/app/filters.py` | 147 | `FilterParams` dataclass (L6–30), `get_filter_params()` FastAPI dependency (L33–70), `build_where_clause()` (L73–142), `metric_order_sql()` (L145–146) |
| `backend/app/schemas.py` | 129 | Pydantic v2 models: `ErrorResponse`, `ProviderConfigIn`, `ProviderStatusOut`, `NowPlayingOut`, `ContinuumStatusOut`, `SyncResultOut`, `AudioDnaIn`, `PlaylistBuildIn`, `SearchResultItem`, `FtsSearchOut` |
| `backend/app/normalize.py` | 88 | `normalize_basic()`, `strip_accents()`, `clean_group_key()`, `clean_display_title()`, `primary_artist_name()`, `make_track_key()`, `similarity_score()` |
| `backend/app/ingestion.py` | 840 | `ingest_zip(zip_path, filename)` — Pass 1 Apple Music RGPD ZIP importer (CSV/nested `.json.zip`, sessions `<30min`, search prefix dedup, **destructive table wipe** at L654–658, preserves live scrobbles via `reconcile_scrobble`) |
| `backend/app/enrichment.py` | 525 | `EnrichmentManager` singleton `enrichment_manager` — Pass 2 background iTunes Lookup batch (80/req) -> iTunes Search -> Deezer Search fallback, SSE pub/sub queue, persists to `enrichment_cache` & `tracks_catalog` |
| `backend/app/external.py` | 190 | `fetch_lyrics_lrclib()`, `fetch_artist_bio_wikipedia()`, `fetch_track_bpm_deezer()`, SQLite `external_cache` |
| `backend/app/continuum/reconciler.py` | 521 | `PROVIDER_PRIORITY`, `IncomingScrobble` dataclass, `canonical_key_for()`, `make_dedup_fingerprint()`, `reconcile_scrobble()`, `reconcile_batch()`, `update_now_playing()`, `clear_now_playing()` |
| `backend/app/continuum/providers.py` | 500 | `save_provider_config()`, `sync_listenbrainz()`, `sync_lastfm()`, `ingest_listenbrainz_submit_payload()`, `push_playlist_to_listenbrainz()` |
| `backend/app/continuum/smtc_worker.py` | 172 | `is_smtc_supported()`, `WindowsSMTCWorker` singleton `smtc_worker` (1s WinRT polling, graceful no-op on Linux/macOS) |
| `backend/app/jobs/worker.py` | 674 | `PersistentJobWorker` singleton `job_worker` (MusicBrainz WS/2 `1.15s` rate limit + HTTP 503 exponential backoff + Wikidata `wbgetentities` + ListenBrainz popularity), `fetch_cover_art_archive()`, `fetch_artist_setlists()`, `COUNTRY_CENTROIDS`, `CURATED_ARTIST_GEO` |
| `backend/app/nlp/sentiment.py` | 192 | `detect_language()`, `analyze_lyrics_sentiment()`, `save_track_lyrics_sentiment()` (FR/EN lexicon + optional ONNX) |
| `backend/app/analytics/duckdb_engine.py` | 185 | `PARQUET_SCHEMA`, `export_parquet_snapshot()`, `ensure_parquet_snapshot()`, `get_snapshot_status()`, `query_parquet()` (strict no-`ATTACH sqlite` rule) |
| `backend/app/analytics/overview.py` | 588 | `get_filter_options()`, `get_overview()`, `get_top_artists()`, `get_top_albums()`, `get_top_tracks()`, `get_top_genres()` |
| `backend/app/analytics/chrono.py` | — | `get_chronobiology(f)` |
| `backend/app/analytics/persona.py` | — | `get_persona_and_eras(f)`, `_weighted_median()`, `_pick_archetype()` |
| `backend/app/analytics/behavior.py` | 419 | `get_behavior_and_obsessions(f)`, `_build_date_where(f, alias)` (L321–337, used on `lyric_events` & `search_events`), `_detect_obsession_phases()` |
| `backend/app/analytics/detail.py` | 414 | `get_artist_detail()`, `get_album_detail()`, `get_day_detail()`, `get_sessions()`, `get_history()`, `export_history_csv()` |
| `backend/app/analytics/galaxy.py` | 121 | `get_sonic_galaxy(f, limit=75)` |
| `backend/app/analytics/wrapped.py` | — | `get_wrapped_story(f)` |
| `backend/app/analytics/v3_science.py` | 1862 | `upsert_track_audio_dna()`, `compute_eddington_number()`, `compute_gini_and_effective_core()`, `compute_shannon_entropy()`, `camelot_compatible_codes()`, `get_musical_eras_pelt()`, `get_emotional_compass()`, `get_camelot_wheel()`, `build_smart_playlist()`, `format_playlist_export()`, `get_science_metrics()`, `get_world_atlas()`, `get_cooccurrence_graph_2d()`, `get_music_iceberg()`, `get_blind_test_quiz()`, `get_collector_atelier()`, `fts5_search()` |
| `backend/tests/test_properties.py` | 189 | Hypothesis property tests: normalization idempotence, Eddington/Gini/Shannon/Camelot math, Continuum reconciliation priority & FTS5 (`unicode61` + `trigram`), live DB session gap `<= 1805s` |
| `backend/tests/test_openapi_fuzz.py` | 118 | OpenAPI schema check (`assert schema["info"]["version"] == "3.0.0"` at **L12**), 20 V1/V2/V3 GET endpoints no-5xx smoke test, ErrorResponse 400 contract, Schemathesis ASGI smoke test, V3 frontend JSON key contract test |

### 1.2 Existing SQLite Schema (`backend/app/db.py:59-440`)

17 tables + 3 FTS5 virtual tables currently exist:
- **Core V1/V2:** `import_meta` (singleton `id=1`), `tracks_catalog` (`track_key PK`, includes V3 columns `duration_ms`, `mbid_recording`, `mbid_artist`, `mbid_release_group`, `back_cover_url`), `play_events` (includes V3 Continuum columns `source_provider DEFAULT 'apple_rgpd_zip'`, `source_priority DEFAULT 100`, `source_event_id`, `canonical_track_key`, `duration_is_estimated DEFAULT 0`, `dedup_fingerprint`), `lyric_events`, `search_events`, `favorites`, `enrichment_cache`, `external_cache`.
- **V3 Continuum & Science:** `sync_providers_config` (seeded with `listenbrainz`, `lastfm`, `local_smtc`, `local_receiver`, `discogs`, `setlistfm`), `now_playing_state` (singleton `id=1`), `background_jobs` (`UNIQUE(job_type, target_key)`), `track_audio_dna`, `track_lyrics_sentiment`, `artist_musicbrainz`, `artist_setlists`, `playlists_saved`.
- **FTS5 Virtual Tables:** `tracks_fts` (`unicode61 remove_diacritics 2`), `tracks_fts_trigram` (`trigram`), `lyrics_fts` (`unicode61 remove_diacritics 2`).
- **Unique Indexes on `play_events` (`db.py:416-429`):**
  - `idx_pe_provider_event_uniq ON play_events(source_provider, source_event_id) WHERE source_event_id IS NOT NULL`
  - `idx_pe_dedup_fp_uniq ON play_events(dedup_fingerprint) WHERE dedup_fingerprint IS NOT NULL`

### 1.3 Existing Endpoints, Proxies, CORS & Lifespan (`backend/app/main.py`)

- **CORS (`main.py:119-125`):** `CORSMiddleware(allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])`. No `Referrer-Policy` middleware yet.
- **Lifespan (`main.py:86-110`):** Calls `init_db()`, checks `import_meta`, auto-ingests `ROOT_DIR / "Apple Media Services information.zip"` if present and DB empty, starts `enrichment_manager` + `job_worker` if `has_data`; on shutdown stops `enrichment_manager`, `job_worker`, `smtc_worker`.
- **Artwork Proxy (`main.py:244-269`):** `GET /api/artwork-proxy?url=...` — currently allows only `https://is`, `cdn-images.dzcdn.net`, `e-cdns-images.dzcdn.net`, `upload.wikimedia.org`, `coverartarchive.org`, `archive.org`, `https://ia`. Does **NOT** yet accept `w` or `fmt` query params (needed for Phase 3 `?w=512&fmt=webp`) and does **NOT** yet allow YouTube (`i.ytimg.com`, `lh3.googleusercontent.com`), Spotify (`i.scdn.co`), or TIDAL (`resources.tidal.com`) cover domains.
- **Audio Proxy (`main.py:272-298`):** `GET /api/audio-proxy?url=...` — allows `audio-ssl.itunes.apple.com`, `cdns-preview-`, `cdnt-preview.` (30s non-DRM previews for Web Audio FFT / Essentia.js WASM).
- **Real-time / Scrobble Endpoints (`main.py:459-598`):**
  - `GET /api/v3/continuum/status`, `POST /api/v3/continuum/providers/{provider}`, `POST /api/v3/continuum/sync/{provider}`, `POST /api/v3/continuum/smtc/{action}`
  - `GET /apis/listenbrainz/1/validate-token`, `POST /apis/listenbrainz/1/submit-listens`
  - `GET /api/enrichment/stream` (SSE)
  - **No WebSocket endpoints exist yet** (`WS /ws/now-playing` and `WS /ws/bridge` are new in V4).
- **V1/V2/V3 Analytics & External Routes (lines 154–765):** 53 routes total, all directly decorated on `@app.*`.

### 1.4 VM Python & System Environment

Verified via shell inspection (read-only):
- **Python:** `/usr/bin/python3` -> **Python 3.11.2**, SQLite **3.40.1** with **FTS5 enabled**.
- **Package manager:** **`uv 0.13.8`** at `/usr/local/bin/uv` (user-space ready, no `sudo`/`apt` needed).
- **Virtualenvs:** None exist yet in repo (`backend/.venv` does not exist; `data/` does not exist; no `Apple Media Services information.zip` in repo root).
- **Node/npm:** Node `v24.22.3`, npm `11.21.2`.
- **System tools:** `/usr/bin/perl` present, `dbus-send` present, `PIL` WebP encoder confirmed (`features.check('webp') == True`).
- **System Python packages vs required packages:**
  - Installed in `/usr/lib/python3/dist-packages` (OUTDATED / INCOMPLETE): `fastapi 0.92.0`, `pydantic 1.10.4` (**breaks Pydantic v2 `model_dump()`!**), `uvicorn 0.17.6`, `numpy 1.24.2`, `openpyxl 3.0.9`, `Pillow 9.4.0`.
  - **Missing from system Python (must be installed in `backend/.venv`):** `fastapi>=0.115.0`, `uvicorn[standard]>=0.32.0` (includes `websockets`), `httpx>=0.27.0`, `python-multipart>=0.0.12`, `aiosqlite>=0.20.0`, `duckdb>=1.1.0`, `pyarrow>=18.0.0`, `numpy>=2.0.0`, `ruptures>=1.1.9`, `pytest>=8.3.0`, `hypothesis>=6.115.0`, `schemathesis>=3.38.0`, plus **V4 additions**: `openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0` (pure-Python QR code generator with SVG/PNG data-URI, zero native deps), `dbus-next>=0.2.3` (pure-Python asyncio MPRIS2 D-Bus client for Linux, zero C/libdbus build deps!).
- **PyPI Connectivity:** Verified `HTTP 200` on `pypi.org` for all 17 tested packages (`fastapi`, `uvicorn`, `pytest`, `hypothesis`, `openpyxl`, `ytmusicapi`, `dbus-next`, `jeepney`, `segno`, `qrcode`, `pillow`, `httpx`, `aiosqlite`, `duckdb`, `pyarrow`, `ruptures`, `schemathesis`).

---

## 2. Logic Chain

1. **Why `backend/.venv` must be bootstrapped first with `uv`:**  
   Because system Python has `pydantic 1.10.4` and lacks `aiosqlite`, `httpx`, `duckdb`, `pytest`, `hypothesis`, `ytmusicapi`, etc. (Observation 1.4), existing tests cannot even be imported with `/usr/bin/python3`. Since `uv 0.13.8` is available and PyPI returns HTTP 200, running `uv venv backend/.venv --python python3` and `uv pip install --python backend/.venv/bin/python -r backend/requirements.txt` (after updating `backend/requirements.txt` with V4 deps) satisfies the no-`sudo`/no-`apt` constraint and matches `.gitignore:15` and `start.ps1:14`.

2. **Why `app.version` MUST remain `"3.0.0"`:**  
   `backend/tests/test_openapi_fuzz.py:12` hardcodes `assert schema["info"]["version"] == "3.0.0"` (Observation 1.1). Preserving all existing tests 100% intact requires keeping `FastAPI(version="3.0.0")` (V4 capability/version info can be advertised via `/api/v4/...` and an additive `"v4_enabled": True` / `"api_versions": ["v1", "v2", "v3", "v4"]` field in `/api/health`).

3. **How Multi-Profile & `source_provider` Filtering integrate with zero regression across all V1/V2/V3 endpoints:**  
   - Every analytics module (`overview.py`, `chrono.py`, `persona.py`, `behavior.py`, `detail.py`, `galaxy.py`, `wrapped.py`, `v3_science.py`) funnels queries through `FilterParams` + `build_where_clause()` in `backend/app/filters.py` (Observation 1.1).
   - Adding optional `source_provider: str | None = None` and `profile_id: int | None = None` (defaulting to `None`, preserving legacy unfiltered queries when omitted) to `FilterParams` and `get_filter_params()` automatically enables multi-profile and platform filtering across all 25+ analytics endpoints!
   - Two edge cases discovered by code inspection must also be handled:
     1. `behavior.py:201,259` calls `_build_date_where(f, "le")` / `_build_date_where(f, "se")` directly on `lyric_events` and `search_events` -> adding `profile_id INTEGER DEFAULT 1` to those tables and filtering by `profile_id` inside `_build_date_where()` prevents Apple Music lyrics/searches from leaking into a Spotify-only profile!
     2. `ingestion.py:654-658` runs `DELETE FROM play_events / tracks_catalog / ...` -> legacy `POST /api/import` can remain intact for V1/V2/V3 backward compatibility, while the new V4 `backend/app/importers/` pipeline writes **non-destructively** into a target `profile_id` and preserves `tracks_catalog` rows belonging to other profiles.

4. **How `play_events` unique indexes interact with Multi-Profile & Merged Views:**  
   - Existing unique partial indexes `idx_pe_provider_event_uniq (source_provider, source_event_id)` and `idx_pe_dedup_fp_uniq (dedup_fingerprint)` (`db.py:416-429`) enforce global uniqueness.
   - If two distinct profiles (e.g., Profile 1 and Profile 2) import the same track/event, `dedup_fingerprint` and `source_event_id` would collide unless scoped!
   - **Clean solution preserving `test_properties.py:100-161`:** Include `profile_id` in `make_dedup_fingerprint()` when `profile_id != 1` (or scope unique indexes / prefix `source_event_id` with `p{profile_id}:` for non-default profiles while keeping `profile_id=1` default behavior identical to V3). For **virtual merged profiles** (`profiles.kind = 'merged'`, `merged_profile_ids_json = '[1, 2]'`), compute the deduplicated event ID set (or SQL CTE/exclusion set) across member profiles using **ISRC (`recording_isrcs`) + `canonical_key_for` + `±180s` window** keeping the highest `source_priority` event, and inject `pe.profile_id IN (...)` + deduplicated exclusions cleanly in `build_where_clause()` (or materialize a merged-view dedup lookup table `profile_merged_exclusions` refreshed on merge/import for O(1) indexed SQL filtering!).
   - Note: A materialized `profile_merged_exclusions (merged_profile_id, excluded_play_event_id)` table is vastly faster for SQLite/FTS/analytics queries than a correlated `NOT EXISTS` subquery on 50k+ rows!

5. **How `SCHEMA_SQL` vs `_run_v4_migrations` stays compatible with `test_properties.py`:**  
   `test_properties.py:105-106` executes `db_mod.SCHEMA_SQL` followed by `db_mod._run_v3_migrations(conn)` (without calling `init_db()`). Therefore, all new V4 tables (`profiles`, `profile_sources`, `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`, `profile_merged_exclusions`) and new columns (`profile_id DEFAULT 1`, `incognito_mode DEFAULT 0`, `reason_start`, `skipped`, `isrc`) should be defined both in `SCHEMA_SQL` (for fresh DBs / test DBs) AND in `_run_v4_migrations(conn)` invoked by `init_db()` (for upgrading pre-existing V1/V2/V3 SQLite databases).

6. **How to avoid merge conflicts across parallel Phase 1 Workers:**  
   Because `main.py` currently holds all 53 routes inline, having multiple workers edit `main.py` concurrently would create constant conflicts. Using FastAPI `APIRouter` in dedicated vertical modules (profiles, importers, vinyl enrichment, tracking/WS, playback) lets 4–5 workers operate with **100% exclusive file ownership**, followed by a single small integration pass wiring routers and middleware into `main.py`.

---

## 3. Caveats

- **No real Apple Music / Spotify / YTM / Deezer / TIDAL export files are mounted locally in `/home/antigravity/Pibaps/AMDataWrap`:** Two `.zip` files exist on Google Drive in project resources (`Apple Media Services information.zip` and `90292a73-6942-4cf7-9d63-52e82685064c.zip`), which were not downloaded during this read-only survey. Unit & Hypothesis tests in Phase 1 should use synthetic fixtures (and optionally test against downloaded sample ZIPs in scratch space if desired later).
- **Headless Linux VM environment for OS media sensors:** Windows SMTC (`pywinrt`/`winrt`), macOS `mediaremote-adapter` (`/usr/bin/perl`), and desktop Linux D-Bus session MPRIS2 cannot detect a real active GUI music player inside this headless Linux VM. All 3 OS sensor adapters must degrade gracefully without crashing `lifespan` or tests, and be unit-tested with mocked D-Bus/subprocess/WinRT backends.
- **`dbus-next` vs `jeepney`:** `dbus-next` is pure Python asyncio (no C extensions or `libdbus-1-dev` needed, critical since `apt` is forbidden). Its optional import should still be guarded with `try/except ImportError` for cross-platform safety.
- **`ytmusicapi` runtime network dependency:** Live `YTMusic().search()` calls require internet access and can be rate-limited; unit tests must mock `YTMusic` and verify `platform_track_mappings` caching + MusicBrainz `url-rels` fallback deterministically.
- **Existing V3 `frontend/`, `frontend-v2/`, `frontend-v3/`** were not inspected (out of scope for backend survey); however, preserving all 53 existing routes, response shapes, and `FilterParams` defaults guarantees 100% compatibility.

---

## 4. Conclusion

### 4.1 Concrete Integration Points & Schema Extensions

1. **New SQLite Tables (`backend/app/db.py`):**
   - `profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT DEFAULT 'standard', merged_profile_ids_json TEXT DEFAULT '[]', is_active INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` — seeded with default Profile `id=1` (*"Profil Principal"*).
   - `profile_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL, source_provider TEXT NOT NULL, filename TEXT, file_sha256 TEXT, imported_at TEXT NOT NULL, events_count INTEGER DEFAULT 0, unique_tracks INTEGER DEFAULT 0, min_date TEXT, max_date TEXT, metadata_json TEXT DEFAULT '{}', FOREIGN KEY (profile_id) REFERENCES profiles(id))`
   - `profile_merged_exclusions (merged_profile_id INTEGER NOT NULL, play_event_id INTEGER NOT NULL, reason TEXT, PRIMARY KEY (merged_profile_id, play_event_id))`
   - `recording_isrcs (track_key TEXT NOT NULL, isrc TEXT NOT NULL, source TEXT, PRIMARY KEY (track_key, isrc), FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key))` + `idx_rec_isrc ON recording_isrcs(isrc)`
   - `platform_track_mappings (track_key TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL, url TEXT, resolved_at TEXT NOT NULL, PRIMARY KEY (track_key, provider, external_id), FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key))` + `idx_ptm_provider_ext ON platform_track_mappings(provider, external_id)`
   - `vinyl_editions (album_key TEXT PRIMARY KEY, mbid_release_group TEXT, mbid_vinyl_release TEXT, label_name TEXT, catalog_number TEXT, country TEXT, press_year INTEGER, disc_count INTEGER DEFAULT 1, vinyl_color_hex TEXT, front_cover_url TEXT, back_cover_url TEXT, medium_label_url TEXT, sides_json TEXT DEFAULT '[]', enriched_at TEXT)`
   - `api_metadata_cache (cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL)`

2. **Additive Columns on Existing Tables (`_run_v4_migrations` + `SCHEMA_SQL`):**
   - `play_events`: `profile_id INTEGER DEFAULT 1`, `incognito_mode INTEGER DEFAULT 0`, `reason_start TEXT`, `skipped INTEGER`, `isrc TEXT` + index `idx_pe_profile_id ON play_events(profile_id)`.
   - `lyric_events`, `search_events`, `favorites`: `profile_id INTEGER DEFAULT 1`.
   - `sync_providers_config`: seed `'web_scrobbler'`, `'os_media'`, `'extension_bridge'` alongside existing 6 providers.
   - `reconciler.py` `PROVIDER_PRIORITY`: extend with `"spotify_rgpd": 95`, `"deezer_rgpd": 85`, `"tidal_rgpd": 85`, `"youtube_takeout": 60`, `"youtube_iframe": 75`, `"extension_bridge": 80`, `"web_scrobbler": 65`, `"os_media": 70` (preserving existing keys: `apple_rgpd_zip: 100`, `local_smtc: 70`, `local_receiver: 55`, `listenbrainz: 50`, `lastfm: 50`).

3. **Phase 3 Backend Touchpoints (`main.py` & `start.ps1`):**
   - `GET /api/artwork-proxy`: add optional `w: int | None = Query(None, ge=64, le=2048)` and `fmt: str | None = Query(None)` (`webp`/`jpeg`/`png`) via Pillow + cache; expand domain allowlist for `https://i.ytimg.com`, `https://lh3.googleusercontent.com`, `https://i.scdn.co`, `https://resources.tidal.com`.
   - Add HTTP middleware injecting `Referrer-Policy: strict-origin-when-cross-origin` (YouTube IFrame anti-Error 153).
   - LAN access: confirm `--host 0.0.0.0`, clean LAN CORS, and LAN IP + QR Code endpoint (`GET /api/v4/lan/info` / `GET /api/v4/tracking/setup`).
   - Update `start.ps1` (and optionally add a Linux/macOS `start.sh`) to support `--host 0.0.0.0` and V4 frontend `:5176` without breaking V1/V2/V3.

### 4.2 Recommended Exclusive File Ownership Plan (Phase 1 Parallel Workers)

**Stage 0 — Environment & Foundation Worker (runs first, ~1 sequential prerequisite):**
- **Owns exclusively:**
  - `backend/requirements.txt` (add `openpyxl>=3.1.0`, `ytmusicapi>=1.9.0`, `Pillow>=10.0.0`, `segno>=1.6.0`, `dbus-next>=0.2.3`) + create `backend/.venv` via `uv` and verify existing tests pass
  - `backend/app/db.py` (V4 schema tables, `_run_v4_migrations()`, default profile seed)
  - `backend/app/filters.py` (`source_provider`, `profile_id` in `FilterParams`, `get_filter_params`, `build_where_clause` including virtual merged profile support)
  - `backend/app/profiles.py` (Profile CRUD, merged profile creation + ISRC/`canonical_key_for`/±180s dedup engine, `GET /api/v4/profile/capabilities`, `profiles_router`)
  - `backend/app/analytics/overview.py` (add `providers` list & optional `profile_id` to `get_filter_options()`)
  - `backend/app/analytics/behavior.py` (respect `profile_id` in `_build_date_where()`)
  - `backend/app/analytics/duckdb_engine.py` (add `profile_id` to `PARQUET_SCHEMA` & export query)
  - `backend/tests/test_profiles_v4.py`

**Stage 1 — 4 Fully Parallel Workers (100% disjoint files):**

| Worker | Exclusive File Ownership | Key Deliverables |
| :--- | :--- | :--- |
| **Worker 1A: 5 RGPD/Takeout Importers** | `backend/app/importers/__init__.py`<br>`backend/app/importers/base.py`<br>`backend/app/importers/apple.py`<br>`backend/app/importers/spotify.py`<br>`backend/app/importers/youtube.py`<br>`backend/app/importers/deezer.py`<br>`backend/app/importers/tidal.py`<br>`backend/tests/test_importers_v4.py` | Format auto-detection, `POST /api/v4/import` + `POST /api/v4/import/preview-columns` (for TIDAL manual mapping), all 5 parsers with exact PLAN_V4_FINAL edge cases (Spotify `spotify_track_uri IS NOT NULL`, `incognito_mode`, 2015–2022 `skipped`; YTM `header=="YouTube Music"`, multilingual prefix + `" - Topic"` strip, `duration_is_estimated=1`; Deezer `openpyxl` `read_only=True`, EN/FR headers, strict IP rejection, `-1` duration imputation; TIDAL aliases + manual map + ISRC; Apple non-destructive profile wrapper) + Hypothesis property tests |
| **Worker 1B: ISRC N-to-M & Vinyl Enrichment** | `backend/app/vinyl_enrichment.py`<br>`backend/tests/test_vinyl_enrichment_v4.py` | 3-pass free cascade (`Deezer Public REST 50/5s` -> `MusicBrainz WS/2 1/s + HTTP 503 backoff + Cover Art Archive front/back/medium` -> `iTunes Search 3.5s`), TTL `api_metadata_cache`, `recording_isrcs` & `vinyl_editions` persistence, `vinyl_router` (`GET /api/v4/vinyl/crate`, `GET /api/v4/vinyl/{album_key}`, `POST /api/v4/vinyl/enrich/{album_key}`, `POST /api/v4/enrichment/v4/start`) |
| **Worker 1C: Real-Time 0€ Tracking & WS Live** | `backend/app/continuum/ws_hub.py`<br>`backend/app/continuum/os_sensors.py`<br>`backend/app/continuum/v4_router.py`<br>`backend/tests/test_tracking_v4.py` | Thread-safe `NowPlayingHub` (`WS /ws/now-playing`) + `BridgeHub` (`WS /ws/bridge`), OS state machine (`WindowsSMTCWorker` wrapper + `MacOSMediaRemoteWorker` via `mediaremote-adapter` + `LinuxMPRIS2Worker` via `dbus-next` with Spotify `Position=0` internal stopwatch), `POST /api/v4/webhooks/web-scrobbler` (HTTP 200), `GET /api/v4/tracking/setup` (1-click configs + `segno` QR code SVG/data-URI for Pano/FastScrobbler/LAN) |
| **Worker 1D: Playback Resolver & Extension MV3** | `backend/app/playback/__init__.py`<br>`backend/app/playback/youtube_resolver.py`<br>`backend/app/playback/router.py`<br>`extensions/amdatawrap-bridge/**`<br>`backend/tests/test_playback_v4.py` | Unauthenticated `ytmusicapi` (`YTMusic().search(..., filter="songs")`) -> `platform_track_mappings` permanent cache -> MusicBrainz `url-rels` fallback, `GET /api/v4/playback/resolve`, `POST /api/v4/playback/track-event`, bridge command router, and complete Manifest V3 extension (`manifest.json`, `background.js` with `ws://127.0.0.1:8000/ws/bridge` + 20s keepalive + `chrome.alarms`, content scripts for Apple Music Web `window.MusicKit.getInstance()`, Spotify Web, YouTube Music, popup) |

**Stage 2 — Integration Wiring (single worker, small surgical diff):**
- **Owns exclusively:**
  - `backend/app/main.py` (mount `profiles_router`, `import_router`, `vinyl_router`, `tracking_v4_router`, `playback_router`; add `Referrer-Policy` middleware; enhance `/api/artwork-proxy` with `w`/`fmt` Pillow WebP & expanded CDN allowlist; clean shutdown of `os_sensors` in `lifespan`; **keep `version="3.0.0"`!**)
  - `backend/app/continuum/reconciler.py` (extend `PROVIDER_PRIORITY`, add `profile_id` & `isrc` optional fields on `IncomingScrobble`, emit `now_playing_hub.publish_threadsafe(...)` in `update_now_playing`/`clear_now_playing`)
  - Run full test suite & OpenAPI verification.

---

## 5. Verification Method

To independently verify every claim in this survey:

1. **Inspect existing routes & OpenAPI version constraint:**
   - `grep -n '@app\.' backend/app/main.py` (confirms 53 routes, 0 WebSockets, 0 `APIRouter`s)
   - `sed -n '10,15p' backend/tests/test_openapi_fuzz.py` (confirms `assert schema["info"]["version"] == "3.0.0"`)
2. **Inspect schema & destructive legacy import:**
   - `sed -n '106,148p;392,441p' backend/app/db.py` (confirms existing V3 `play_events` columns and unique indexes)
   - `sed -n '653,660p' backend/app/ingestion.py` (confirms `DELETE FROM ...` on legacy Apple ZIP import)
3. **Verify Python / `uv` / SQLite / Pillow environment:**
   - `python3 --version && uv --version` (`Python 3.11.2`, `uv 0.13.8`)
   - `python3 -c "import sqlite3; c=sqlite3.connect(':memory:'); c.execute('CREATE VIRTUAL TABLE t USING fts5(a)'); print(sqlite3.sqlite_version)"` (`3.40.1`)
   - `python3 -c "from PIL import features; print(features.check('webp'))"` (`True`)
4. **Baseline test command (once Stage 0 creates `backend/.venv`):**
   - `uv venv backend/.venv --python python3`
   - `uv pip install --python backend/.venv/bin/python -r backend/requirements.txt`
   - `backend/.venv/bin/pytest -v` (uses `pytest.ini` at repo root: `pythonpath = .`, `testpaths = backend/tests`).
5. **Invalidation conditions:** Any change to `backend/app/main.py`, `backend/app/db.py`, `backend/requirements.txt`, or creation of `backend/.venv` will advance the repository past this pre-Phase-1 baseline snapshot.
