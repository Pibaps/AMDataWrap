# Milestone M2B Briefing — ISRC N-to-M Reconciliation & 3-Pass Free Vinyl Enrichment

## Goal
Implement AMDataWrap V4 Milestone M2B strictly within exclusive file ownership (`backend/app/vinyl_enrichment.py` and `backend/tests/test_vinyl_enrichment_v4.py`), delivering:
1. **TTL Metadata Cache** over `api_metadata_cache (cache_key, payload_json, expires_at)`:
   - `cache_get(conn, key)`, `cache_set(conn, key, payload, ttl_seconds)`, `cache_purge_expired(conn)`
   - Honors TIDAL Terms 3.0 & external API TTL compliance (default 7d for stable MB/Deezer metadata, shorter for transient lookups).
2. **3-Pass Free Enrichment Cascade** (strictly after deduplicating by `(normalized_artist, normalized_title)` so each unique track is queried once):
   - **Pass 1 — Deezer Public REST API** (`https://api.deezer.com/search`, `/track/{id}`, `/track/isrc:{ISRC}`): 0 auth, rate-limited at `<= 50 req / 5 s` (`600 req/min`), extracts native ISRC (persisted into N-to-M `recording_isrcs`), duration, HD artwork (`cover_xl`/`cover_big`), album title, `preview` URL; stores Deezer ID in `platform_track_mappings`.
   - **Pass 2 — MusicBrainz WS/2 + Cover Art Archive**: strict rate limit `1 req / s` (`>= 1.1s` spacing), mandatory contactable `User-Agent` (`AMDataWrap/4.0 (https://github.com/Pibaps/AMDataWrap)`), explicit HTTP 503 exponential backoff + jitter; queries `/ws/2/isrc/{ISRC}` / `/ws/2/release-group` / `/ws/2/release/{MBID}?inc=recordings+labels+media+url-rels`:
     - Prefers real 12" LP / Vinyl media formats to extract authentic Sides A/B/C/D track splits & durations, `label_name`, `catalog_number`, `country`, `press_year`, `disc_count`, and YouTube/streaming `url-rels` (stored in `platform_track_mappings`).
     - Queries Cover Art Archive (`https://coverartarchive.org/release/{mbid}`) for `front`, `back`, and `medium` (vinyl center label) artwork URLs.
     - Persists into `vinyl_editions` and updates `tracks_catalog` (`mbid_recording`, `mbid_release_group`, `back_cover_url`, `artwork_url`).
   - **Pass 3 — iTunes Search API**: spaced at `~3.5 s` (`~20 req/min`) with 429/403 exponential backoff; targeted fallback ONLY for tracks still missing `artwork_url` or 30s `preview_url`.
3. **Background Manager `vinyl_enrichment_manager`**:
   - Strict multi-event-loop async safety (`self._task.get_loop() is asyncio.get_running_loop()` in `start()`/`stop()`, resets `self._task = None`).
   - Injectable `httpx.AsyncClient` / transport and injectable rate-limit sleeper / clock for 100% deterministic offline tests.
4. **Synthetic Side A/B Fallback Builder (`build_album_sides`)**:
   - When an album has no MusicBrainz `vinyl_editions` yet, cleanly groups album tracks into realistic Side A / Side B (~22 min per side) with real durations, play counts, `preview_url`, and cached `youtube_video_id` from `platform_track_mappings`.
5. **FastAPI Router `vinyl_router = APIRouter(prefix="/api/v4", tags=["v4-vinyl"])`** (`PROJECT.md` §3):
   - `GET /api/v4/vinyl/crate?filter=top|era|genre|recent|random&limit=40&profile_id=...&source_provider=...` (respects `FilterParams` / `build_where_clause`).
   - `GET /api/v4/vinyl/{album_key}` (accepts URL-encoded album key or normalized lookup, returns full vinyl edition + sides + personal stats).
   - `POST /api/v4/vinyl/enrich/{album_key}` (runs on-demand 3-pass enrichment for that album).
   - `POST /api/v4/enrichment/v4/start`, `POST /api/v4/enrichment/v4/stop`, `GET /api/v4/enrichment/v4/status`.
6. **Comprehensive Offline Deterministic Tests** (`backend/tests/test_vinyl_enrichment_v4.py`) using `httpx.MockTransport`.

## Non-Negotiable Constraints
- Do NOT modify `main.py`, `db.py`, `enrichment.py`, `jobs/worker.py`, `frontend*/`, or files belonging to M1/M2A/M2C/M2D/M2E.
- Zero paid APIs/keys; strictly 0€; offline-safe deterministic tests.
- Linux user-space only (`backend/.venv/bin/pytest`).
