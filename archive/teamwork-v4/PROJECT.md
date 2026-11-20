# Project: AMDataWrap V4 (« SONIC ODYSSEY × VINYL STUDIO 3D »)

**Authoritative Specification:** `docs/plans/PLAN_V4_FINAL.md` & `.agents/teamwork/ORIGINAL_REQUEST.md`  
**Execution Order (STRICT):** **Phase 1** (Backend Multi-Platform + Profiles + 5 Importers + Enrichment + Continuum Live + 0€ Playback & MV3 Extension) → **Phase 2** (`frontend-v4/` port `5176`, Persistent 3D Canvas, Record Crate & Turntable 3D, Readable Galaxy 3D V4, V2+V3 Glassmorphism Analytics) → **Phase 3** (4 Graphic Tiers Mobile/WebGL2/WebGPU Opt-in, LAN/QR Code, Full E2E + Playwright Desktop 1440p & Mobile 390×844 + Tier-5 Adversarial Hardening).

---

## Architecture

- **Shared FastAPI Backend (`backend/`, port `8000`):**
  - Preserves ALL 53 existing V1/V2/V3 routes, SQLite WAL + FTS5 tables, DuckDB/Parquet snapshot, and **`FastAPI(..., version="3.0.0")`** (required by `backend/tests/test_openapi_fuzz.py:12` non-regression constraint; V4 capabilities advertised via `/api/v4/*` and additive `/api/health` fields).
  - Extends SQLite additively (`SCHEMA_SQL` + `_run_v4_migrations()`) with `profiles`, `profile_sources`, `profile_merged_exclusions`, `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`, and additive columns (`profile_id`, `incognito_mode`, `reason_start`, `skipped`, `isrc`).
  - Organizes V4 endpoints into modular FastAPI `APIRouter`s (`profiles.py`, `importers/`, `vinyl_enrichment.py`, `continuum/v4_router.py`, `playback/router.py`) mounted cleanly in `main.py`, plus two WebSocket hubs (`WS /ws/now-playing` and `WS /ws/bridge`), `Referrer-Policy: strict-origin-when-cross-origin` middleware, and `/api/artwork-proxy?w=&fmt=webp` Pillow resizing.
- **Browser Extension MV3 (`extensions/amdatawrap-bridge/`):**
  - Open-source Manifest V3 extension (`minimum_chrome_version: "116"`) connecting via `ws://127.0.0.1:8000/ws/bridge` with 20s keepalive + `chrome.alarms` wake-up, piloting user's authenticated web tabs at 0 € across V4.0 connectors: **Apple Music Web (`window.MusicKit.getInstance()`)**, **Spotify Web**, and **YouTube Music** (extensible connector registry for V4.1 Deezer/TIDAL).
- **Frontends Coexistence:**
  - `frontend/` (`:5173`), `frontend-v2/` (`:5174`), `frontend-v3/` (`:5175`) remain **100% untouched**.
  - **`frontend-v4/` (`:5176`):** React 19 + Vite 6 + Tailwind v4 + Zustand + TanStack Query + ECharts 5 + raw Three.js + GSAP. Single persistent root `<PersistentStageCanvas />` (zero animation resets across routes/filters/tracks) hosting 3 persistent `THREE.Group` sub-stages (`NebulaStage`, `VinylStudioStage`, `GalaxyV4Stage`), zero Hi-Fi rack, unified 0€ `PlaybackManager` (`YouTubeIFrameProvider`, `ExtensionBridgeProvider`, `PreviewAudioProvider`), single persistent `<YouTubeDeckOverlay />` (≥ 200×200 px projected into 3D turntable bezel OR auto-docked as 240×200 px draggable glassmorphism card), and capability-driven V2+V3 glassmorphism analytics.
- **Universal Compatibility (Phase 3):**
  - Automatic 4-tier graphics engine: Tier 0 (CSS 3D + Canvas 2D), Tier 1 (Mobile WebGL2 `DPR <= 1.5`, `w=512&fmt=webp`, `< 60 draw calls`, `< 150 Mo VRAM`, thumb-accessible bottom controls, `webglcontextlost/restored`), Tier 2 (Desktop WebGL2 `DPR <= 2.0`, `1024px`, selective bloom, `visibilityState === 'hidden'` pause), Tier 3 (PC Ultra WebGPU opt-in via `THREE.WebGPURenderer` with instant fallback to Tier 2 WebGL2).
  - LAN Wi-Fi smartphone access (`--host 0.0.0.0`, clean LAN CORS, PC QR Code modal, `start.ps1` + `start.sh`).

---

## Feature Inventory

Every feature from Step 0 Survey (`survey_spec_miner_docs/handoff.md`, 38 features) is assigned to a milestone (zero unassigned):

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Coexistence V1/V2/V3/V4 on shared backend | Preserve `frontend/`, `frontend-v2/`, `frontend-v3/`, `version="3.0.0"` OpenAPI contract & all existing backend tests while adding V4 | M1, M2E, M3, M4D, M6 | survey |
| 2 | Strictly 0€ Zero-Cost & Local Offline-First | Zero paid APIs/keys; graceful fallback if optional services absent | M2B, M2C, M2D, M4B | survey |
| 3 | Multi-Event-Loop Async Lifecycle Safety | Guard `get_loop() is asyncio.get_running_loop()` in all background workers | M2B, M2C, M2E | survey |
| 4 | Multi-Profile Schema (`profiles`, `profile_sources`) | Separate profiles + virtual merged profiles (`merged_profile_ids`), CRUD API, default Profile `id=1` migration | M1 | survey |
| 5 | Cross-Platform Profile Fusion & Deduplication | Dedup across profiles via ISRC + `canonical_key_for` + similarity ≥ 0.85 + ±180s keeping highest `source_priority` | M1 | survey |
| 6 | Global `source_provider` & `profile_id` Filter | Extend `FilterParams`, `build_where_clause`, `overview.py`, `behavior.py`, `duckdb_engine.py` | M1 | survey |
| 7 | Dynamic Capabilities Matrix (`GET /api/v4/profile/capabilities`) | Returns exact 11-field capabilities JSON for active/requested profile | M1 | survey |
| 8 | Unified Auto-Detect Import (`POST /api/v4/import`) | Auto-detect `.zip`/`.json`/`.xlsx`/`.csv`, profile binding, non-destructive import, TIDAL column preview | M2A | survey |
| 9 | Importer 1: Apple Music (`importers/apple.py`) | Preserve/wrap existing Apple RGPD ZIP parser non-destructively per profile | M2A | survey |
| 10 | Importer 2: Spotify (`importers/spotify.py`) | Auto-detect Extended vs Account Data, `spotify_track_uri IS NOT NULL`, `incognito_mode`, 2015–2022 `skipped` bug, `offline_timestamp` | M2A | survey |
| 11 | Importer 3: YouTube Music (`importers/youtube.py`) | `watch-history.json`, `header == "YouTube Music"`, multilingual prefix strip, `" - Topic"` strip, deleted video tolerance, `duration_is_estimated = 1`, HTML rejection | M2A | survey |
| 12 | Importer 4: Deezer (`importers/deezer.py`) | `openpyxl` `read_only=True`, EN/FR header detection, UTC dates, strict IP column rejection, `-1` duration imputation | M2A | survey |
| 13 | Importer 5: TIDAL (`importers/tidal.py`) | UTF-8/BOM `.csv`, alias auto-detection, ISRC ingestion, `needs_mapping` assisted manual column mapping | M2A | survey |
| 14 | ISRC N-to-M, Platform Mappings, Vinyl Editions & TTL Cache Schema | `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache` tables | M1 | survey |
| 15 | 3-Pass Free Enrichment Cascade | Deduplicated `(artist, title)` -> Deezer REST (`50/5s`) -> MusicBrainz WS/2 (`1/s` + 503 backoff) + CAA (`front`/`back`/`medium`) -> iTunes Search (`3.5s`) + TTL cache | M2B | survey |
| 16 | Multi-OS Desktop State Machine (`continuum/os_sensors.py`) | Windows SMTC (`pywinrt` strong refs + polling), macOS `mediaremote-adapter` (`media-control stream` + self-test), Linux `MPRIS2` (`dbus-next` + internal stopwatch for Spotify `Position=0`) | M2C | survey |
| 17 | Web Scrobbler Webhook (`POST /api/v4/webhooks/web-scrobbler`) | Handle `nowplaying`, `scrobble`, `loved`, `paused`, `resumedplaying`, always return `HTTP 200` | M2C | survey |
| 18 | Local ListenBrainz Endpoint + 1-Click / QR Mobile Setup | Integrate `/apis/listenbrainz/1/submit-listens` -> `WS /ws/now-playing` + `GET /api/v4/tracking/setup` with `segno` QR & 1-click configs for Pano/FastScrobbler/Web Scrobbler/multi-scrobbler | M2C, M2E | survey |
| 19 | Live Now-Playing WebSocket (`WS /ws/now-playing`) | Broadcast real-time playback state to 3D Turntable from all tracking & playback sources | M2C, M2E | survey |
| 20 | Pluggable `PlaybackProvider` Abstraction | Unified millisecond playback manager (`YouTubeIFrame`, `ExtensionBridge`, `PreviewAudio`) + fallback + `reconciler.py` event reporting | M2D, M4B | survey |
| 21 | `YouTubeIFrameProvider` + `ytmusicapi` + Anti-Error-153 | Backend `ytmusicapi` search -> permanent `platform_track_mappings` cache -> MusicBrainz `url-rels` fallback; `Referrer-Policy: strict-origin-when-cross-origin`, `playsinline=1`, ≥200×200px, exact timeline | M2D, M2E, M4B | survey |
| 22 | `ExtensionBridgeProvider` & MV3 Extension (`extensions/amdatawrap-bridge/`) | MV3 (`minimum_chrome_version: 116`), `ws://127.0.0.1:8000/ws/bridge`, 20s keepalive + `chrome.alarms`, Apple Music `window.MusicKit.getInstance()`, Spotify Web, YouTube Music, Autoplay `NotAllowedError` handling | M2D, M4B | survey |
| 23 | `PreviewAudioProvider` (Fallback & Audio DNA) | 30s non-DRM preview via `/api/audio-proxy`, Web Audio `AnalyserNode` FFT + Audio DNA Web Worker | M4B | survey |
| 24 | `frontend-v4/` App Shell & Sonic Odyssey V2 DNA (No Hi-Fi) | Port `5176`, nebula, `--aura-1/2/3`, `.spatial-glass`, `Syne`/`Instrument Serif`/`JetBrains Mono`, ZERO Hi-Fi rack | M3 | survey |
| 25 | Correction #1: Single Persistent 3D Canvas & Zero Animation Resets | Root-mounted `<PersistentStageCanvas />`, mutable non-React `sceneRefs`, GSAP smooth transitions | M3, M4A, M4D | survey |
| 26 | Correction #2: Readable 3D Galaxy V4 | Clear HUD legend (sectors=genres, size=time, height=era), screen-space AABB anti-collision labels, hover dimming, genre/era quick-filters, click inspector | M4B | survey |
| 27 | 4-State Vinyl Studio FSM | `CRATE_BROWSE` -> `SLEEVE_INSPECT` -> `DISC_SLIDE_OUT` -> `TURNTABLE_PLAY` with GSAP tween cancellation safety | M4A | survey |
| 28 | State 1 (`CRATE_BROWSE`): 3D Record Crate | Physical flip-through drag/wheel/touch + 5 filters (Top Albums, Par Ère, Par Genre, Récents, Pioche aléatoire) | M4A | survey |
| 29 | State 2 (`SLEEVE_INSPECT`): Authentic Front/Back & Procedural Vinyl Back | 360° flip, HD front + spine, CAA `back_cover_url` OR hi-res procedural vinyl pressing back (Sides A/B/C/D, Label, Cat#, year/country, barcode, personal stats, clickable tracklist) | M4A | survey |
| 30 | State 3 (`DISC_SLIDE_OUT`): 12" Vinyl Extraction & Proportional Grooves | Drag/button extraction, duration-proportional microgrooves, center label, Side A/B flip, sleeve placed on "Now Playing" easel | M4A | survey |
| 31 | State 4 (`TURNTABLE_PLAY`): 3 Finishes & Integrated 3D Digital Display | 3 one-click finishes (*Obsidian Glass & Alu brossé*, *Noyer Vintage*, *Alu Studio*); integrated 3D screen hosting ≥200×200px YouTube IFrame with auto-switch to draggable 240×200px glassmorphism card, or live BPM/Camelot/FFT telemetry | M4A, M4B | survey |
| 32 | State 4 (`TURNTABLE_PLAY`): Physical Controls, Draggable Tonearm & Foley | 33⅓/45 RPM inertia platter, draggable tonearm seeking across grooves, `START/STOP`, `CUE`, `FLIP A/B`, `EJECT`, transparent dust cover, optional 1-click Web Audio mechanical foley | M4A | survey |
| 33 | Onboarding & Connections/Profiles Hub | 5-platform guided drag&drop import + TIDAL column mapper, profile CRUD & merge UI, 0€ Live Tracking QR/1-click wizard, OS/Webhook/Extension status | M4C | survey |
| 34 | Unified V2 + V3 Glassmorphism Analytics & Wrapped V4 | Overview, Tops, Chrono, Persona, Obsessions/Skips/Paroles, Sessions/History, Science Lab V3 (PELT/Russell/Camelot), Atlas Mondial V3, FTS5 `Ctrl+K`, DetailDrawer, Wrapped V4 — all capability-gated | M4C | survey |
| 35 | 4 Automatic Graphic Tiers (Tier 0–3) & `/api/artwork-proxy` WebP | Tier 0 CSS/2D, Tier 1 Mobile WebGL2 (`DPR<=1.5`, `w=512&fmt=webp`, `<60 draw calls`, `<150 Mo VRAM`, bottom touch controls, `webglcontextlost/restored`), Tier 2 Desktop WebGL2 (`DPR<=2.0`, `1024px`, bloom, `visibilityState` pause), Tier 3 PC WebGPU opt-in + instant WebGL2 fallback | M2E, M5 | survey |
| 36 | LAN Smartphone Access (`--host 0.0.0.0`), CORS & PC QR Code | Backend/Vite `--host 0.0.0.0`, clean LAN CORS, `/api/v4/network/lan-info`, PC QR Code modal, `start.ps1`/`start.sh` | M2E, M5 | survey |
| 37 | V4.1 Extensible Boundary | Keep MV3 extension connector registry clean/extensible for post-V4.0 Deezer/TIDAL | M2D | survey |
| 38 | Section 5 Pre-Delivery Validation Checklist | Unit + Hypothesis tests on 5 importers, multi-profile/merge/capabilities, YouTube + MV3 playback, Playwright Desktop 1440p + Mobile 390×844 on Crate/Turntable & Galaxy V4, Tier-5 Adversarial Hardening | E2E_TRACK, M6 | survey |

---

## Milestones

| # | Name | Phase | Scope | Dependencies | Status |
|---|------|-------|-------|--------------|--------|
| M1 | Backend V4 Foundation, Env & Profiles/Capabilities | Phase 1 | `backend/.venv`, `requirements.txt`, `db.py` V4 schema/migrations, `filters.py`, `profiles.py` (CRUD + ISRC/±180s merge + capabilities), `overview.py`/`behavior.py`/`duckdb_engine.py`, `test_profiles_v4.py` | none | DONE (25/25 pytest, 5/5 Gate PASS, Auditor CLEAN) |
| M2A | 5 RGPD/Takeout Importers | Phase 1 | `backend/app/importers/*` (Apple, Spotify, YTM, Deezer, TIDAL + `POST /api/v4/import` + preview-columns), `test_importers_v4.py` (unit + Hypothesis) | M1 | IN_PROGRESS (`4b93a178422b1d239447e899f52930b6`) |
| M2B | ISRC N-to-M & 3-Pass Vinyl Enrichment | Phase 1 | `backend/app/vinyl_enrichment.py` (Deezer REST -> MB WS/2 + CAA -> iTunes + TTL cache + vinyl router), `test_vinyl_enrichment_v4.py` | M1 | IN_PROGRESS (`28611e3bb1499e42691043e218ba30b1`) |
| M2C | 0€ Real-Time Tracking & Live WebSockets | Phase 1 | `backend/app/continuum/{ws_hub,os_sensors,v4_router}.py` (Win/Mac/Linux state machine, Web Scrobbler webhook, ListenBrainz QR setup, `WS /ws/now-playing`, `WS /ws/bridge`), `test_tracking_v4.py` | M1 | IN_PROGRESS (`f8057147849fb7eb3dfaca771ab87bc9`) |
| M2D | 0€ Playback Resolver & MV3 Extension | Phase 1 | `backend/app/playback/*` (`ytmusicapi` + MB `url-rels` + cache + track-event router), `extensions/amdatawrap-bridge/**` (MV3 20s keepalive + Apple MusicKit/Spotify/YTM), `test_playback_v4.py` | M1 | IN_PROGRESS (`ac7138bb721aa1e5e70d202d15656ff5`) |
| M2E | Phase 1 Integration, Proxy/LAN & Backend Gate | Phase 1 | Wire all 5 routers + `Referrer-Policy` middleware + `/api/artwork-proxy?w=&fmt=webp` + `/api/v4/network/lan-info` in `main.py` (`version="3.0.0"` preserved); extend `reconciler.py`; full backend regression gate | M2A, M2B, M2C, M2D | PLANNED |
| E2E_TRACK | E2E Testing Track (Dual Track) | Parallel | Author `TEST_INFRA.md`, build opaque-box Tier 1–4 E2E suite (`tests_e2e/` + Playwright Desktop 1440p & Mobile 390×844 specs in `frontend-v4/e2e/` once M3/M5 ready), publish `TEST_READY.md` | M1 (starts backend E2E), M5 (adds Playwright E2E) | PLANNED |
| M3 | `frontend-v4/` Scaffold & V2 Sonic Odyssey Shell | Phase 2 | `frontend-v4/` (`:5176`), `package.json`, `vite.config.ts`, `index.css`, `api/`, `store/`, `TopDockNav`, `FilterBar`, `Artwork`, `CapabilityBadge`, `App.tsx` shell, `npm install` + build | M2E | PLANNED |
| M4A | Persistent 3D Engine & Record Crate / Turntable 3D | Phase 2 | `PersistentStageCanvas`, `NebulaStage`, `scenes/vinyl/*` (4-state FSM, Crate, Front/Back + procedural vinyl back, 12" grooves, 3-finish Turntable + integrated display + tonearm + foley) | M3 | PLANNED |
| M4B | Readable 3D Galaxy V4 & Pluggable 0€ Playback | Phase 2 | `scenes/galaxy/*` (legend, AABB label collision, hover dim, filters, inspector), `playback/*` (YT IFrame, Extension Bridge, Preview Audio, `YouTubeDeckOverlay`, `nowPlayingWs`, `FloatingPlayerDock`), `workers/*` | M3 | PLANNED |
| M4C | Onboarding/Hub & V2+V3 Glassmorphism Analytics | Phase 2 | `pages/*` (OnboardingHub, Overview, Tops, Chrono, Persona, Behavior, SessionsHistory, ScienceLab, Atlas), `charts/EChartBox`, `DetailDrawer`, `FtsSearchModal`, `SonicOdysseyWrappedV4` | M3 | PLANNED |
| M4D | Phase 2 Integration & Frontend Build Gate | Phase 2 | Wire M4A + M4B + M4C in `frontend-v4/src/App.tsx`, verify `tsc -b && vite build`, verify V1/V2/V3 untouched | M4A, M4B, M4C | PLANNED |
| M5 | Phase 3 Graphics Tiers (0–3), Mobile/WebGPU & LAN/QR | Phase 3 | `tierManager.ts`, `FallbackStage2D.tsx`, `LanQrModal.tsx`, Tier 0–3 integration (`<60 draw calls`, `<150 Mo VRAM`, `w=512&fmt=webp`, mobile thumb controls, `webglcontextlost/restored`, `visibilityState`, WebGPU opt-in), `start.ps1` + `start.sh` | M4D | PLANNED |
| M6 | Final Milestone: 100% E2E Pass (Tiers 1–4) + Tier-5 Adversarial Hardening | Phase 3 | Phase 1: pass 100% of `TEST_READY.md` (backend unit/Hypothesis/existing + opaque-box E2E + Playwright Desktop 1440p & Mobile 390×844); Phase 2: Tier-5 white-box Challenger-initiated hardening loop | M5, E2E_TRACK | PLANNED |

---

## Code Layout & Exclusive File Ownership

- **Existing Frontends (READ-ONLY — NEVER MODIFY):** `frontend/`, `frontend-v2/`, `frontend-v3/`
- **Existing Backend Tests (PRESERVE GREEN):** `backend/tests/test_properties.py`, `backend/tests/test_openapi_fuzz.py`
- **M1 owns:** `backend/requirements.txt`, `backend/.venv/` (env), `backend/app/db.py`, `backend/app/filters.py`, `backend/app/profiles.py`, `backend/app/analytics/overview.py`, `backend/app/analytics/behavior.py`, `backend/app/analytics/duckdb_engine.py`, `backend/tests/test_profiles_v4.py`
- **M2A owns:** `backend/app/importers/{__init__,base,apple,spotify,youtube,deezer,tidal}.py`, `backend/tests/test_importers_v4.py`
- **M2B owns:** `backend/app/vinyl_enrichment.py`, `backend/tests/test_vinyl_enrichment_v4.py`
- **M2C owns:** `backend/app/continuum/{ws_hub,os_sensors,v4_router}.py`, `backend/tests/test_tracking_v4.py`
- **M2D owns:** `backend/app/playback/{__init__,youtube_resolver,router}.py`, `extensions/amdatawrap-bridge/**`, `backend/tests/test_playback_v4.py`
- **M2E owns:** `backend/app/main.py`, `backend/app/continuum/reconciler.py`, `backend/tests/test_v4_integration.py`
- **M3 owns:** `frontend-v4/{index.html,package.json,tsconfig.json,vite.config.ts}`, `frontend-v4/src/{main.tsx,index.css,App.tsx}`, `frontend-v4/src/api/{types,client}.ts`, `frontend-v4/src/store/{appStore,sceneRefs}.ts`, `frontend-v4/src/utils/format.ts`, `frontend-v4/src/components/layout/{TopDockNav,FilterBar}.tsx`, `frontend-v4/src/components/ui/{Artwork,CapabilityBadge}.tsx`
- **M4A owns:** `frontend-v4/src/engine/{PersistentStageCanvas.tsx,NebulaStage.ts}`, `frontend-v4/src/scenes/vinyl/**`, `frontend-v4/src/utils/mechanicalSfx.ts`
- **M4B owns:** `frontend-v4/src/scenes/galaxy/**`, `frontend-v4/src/playback/**`, `frontend-v4/src/workers/**`
- **M4C owns:** `frontend-v4/src/pages/**`, `frontend-v4/src/components/charts/**`, `frontend-v4/src/components/layout/{DetailDrawer,FtsSearchModal}.tsx`, `frontend-v4/src/components/wrapped/**`
- **M4D owns:** `frontend-v4/src/App.tsx` (wiring pass) + minor export glue in `frontend-v4/src/store/appStore.ts` if needed
- **M5 owns:** `frontend-v4/src/engine/{tierManager.ts,FallbackStage2D.tsx}`, `frontend-v4/src/components/ui/LanQrModal.tsx`, tier hooks in `PersistentStageCanvas.tsx` / `VinylStudioOverlay.tsx` / `TopDockNav.tsx`, `start.ps1`, `start.sh`
- **E2E_TRACK owns:** `TEST_INFRA.md`, `TEST_READY.md`, `tests_e2e/**`, `frontend-v4/playwright.config.ts`, `frontend-v4/e2e/**`

---

## Interface Contracts

### 1. Multi-Profile & Capabilities (`backend/app/profiles.py` ↔ `frontend-v4/`)
- `GET /api/v4/profiles` → `{ active_profile_id: int, profiles: [{ id, name, kind: "standard"|"merged", merged_profile_ids: int[], is_active: bool, sources: [{ id, source_provider, filename, imported_at, events_count, unique_tracks, min_date, max_date }], total_plays: int, created_at, updated_at }] }`
- `POST /api/v4/profiles` body `{ name: str, kind?: "standard"|"merged", merged_profile_ids?: int[] }` → `201` created profile (for `merged`, computes `profile_merged_exclusions` via ISRC + `canonical_key_for` + `similarity >= 0.85` + `±180s` keeping highest `source_priority`).
- `POST /api/v4/profiles/{profile_id}/activate` → activates profile.
- `POST /api/v4/profiles/{profile_id}/recompute-merge` → refreshes merged deduplication exclusions.
- `DELETE /api/v4/profiles/{profile_id}` → deletes non-default profile (returns 400 if `profile_id == 1`).
- `GET /api/v4/profile/capabilities?profile_id=...&source_provider=...` →
  ```json
  {
    "profile_id": 1,
    "platforms": ["apple_music", "spotify"],
    "has_exact_duration": true,
    "estimated_duration_pct": 0.0,
    "has_skips": true,
    "has_end_reasons": true,
    "has_lyrics_events": true,
    "has_search_events": true,
    "has_devices": true,
    "has_audio_quality": true,
    "has_incognito_flag": true,
    "has_shuffle_flag": true
  }
  ```
- `FilterParams` (`backend/app/filters.py`): adds optional `source_provider: str | None = None` and `profile_id: int | None = None`. Default `None` preserves full V1/V2/V3 backward compatibility.

### 2. Unified Multi-Platform Import (`backend/app/importers/` ↔ `frontend-v4/`)
- `POST /api/v4/import` (multipart form): `file: UploadFile`, `profile_id?: int`, `profile_name?: str`, `platform_hint?: str`, `exclude_incognito?: bool = False`, `column_mapping?: str (JSON)`
  - Response: `{ ok: true, detected_platform: "apple_music"|"spotify_extended"|"spotify_account"|"youtube_music"|"deezer"|"tidal", profile_id: int, raw_rows: int, inserted: int, upgraded: int, deduplicated: int, skipped_non_music: int, estimated_duration_count: int, min_date: str|null, max_date: str|null, warnings: str[] }`
  - If TIDAL CSV headers cannot be auto-mapped and `column_mapping` omitted: returns `{ ok: false, needs_mapping: true, detected_platform: "tidal", detected_headers: str[], sample_rows: dict[], suggested_mapping: dict }` (HTTP 200 or 422? Return HTTP 200 with `needs_mapping: true` so UI renders mapper cleanly without triggering HTTP ≥ 400 E2E guardrail!).
- `POST /api/v4/import/preview-columns` (multipart `file`) → returns `{ detected_platform, detected_headers, sample_rows, suggested_mapping }`.

### 3. ISRC N-to-M & Vinyl Editions (`backend/app/vinyl_enrichment.py` ↔ `frontend-v4/`)
- `GET /api/v4/vinyl/crate?filter=top|era|genre|recent|random&limit=40&profile_id=...&source_provider=...` → `{ items: [{ album_key, album_name, artist_name, artwork_url, back_cover_url, medium_label_url, total_plays, total_ms, first_played_at, release_year, genre, has_vinyl_edition: bool, label_name, catalog_number, press_year, country, disc_count, vinyl_color_hex, sides: [{ side: "A"|"B"|"C"|"D", tracks: [{ track_key, song_name, artist_name, duration_ms, position, play_count, preview_url, youtube_video_id }] }] }] }`
- `GET /api/v4/vinyl/{album_key}` → full album + `vinyl_editions` detail + tracks grouped by sides (auto-split into Side A / Side B ~22 min if not yet enriched by MusicBrainz) + personal stats.
- `POST /api/v4/vinyl/enrich/{album_key}` → runs on-demand 3-pass cascade (Deezer -> MB WS/2 + CAA -> iTunes) for that album and returns updated `vinyl_editions`.
- `POST /api/v4/enrichment/v4/start` / `GET /api/v4/enrichment/v4/status` → background deduplicated 3-pass enrichment status.

### 4. Real-Time 0€ Tracking & Live WebSockets (`backend/app/continuum/` ↔ `frontend-v4/`)
- `POST /api/v4/webhooks/web-scrobbler` → accepts `nowplaying`, `scrobble`, `loved`, `paused`, `resumedplaying`; **ALWAYS returns `HTTP 200`** `{ ok: true, event: ... }`.
- `GET /api/v4/tracking/status` → `{ os: { platform, backend, supported, running, detail }, ws_clients: int, bridge_connected: bool, bridge_platforms: str[], last_webhook_at: str|null, now_playing: {...}|null }`.
- `POST /api/v4/tracking/os/{action}` (`start` | `stop`) → controls OS state machine.
- `GET /api/v4/tracking/setup` → `{ lan_ip, backend_url, frontend_v4_url, listenbrainz_url, web_scrobbler_webhook_url, listenbrainz_qr_svg, frontend_v4_qr_svg, instructions: { pano_scrobbler, fast_scrobbler, web_scrobbler, multi_scrobbler } }`.
- `WS /ws/now-playing` → sends immediate snapshot `{ type: "now_playing", payload: { is_playing, song_name, artist_name, album_name, artwork_url, duration_ms, position_ms, provider, bpm, camelot, updated_at } | null }` and broadcasts live updates.
- `WS /ws/bridge` → bidirectional MV3 extension & frontend control channel (`PING`/`PONG` 20s keepalive, `HELLO { platforms, version }`, `COMMAND { action: PLAY_TRACK|PLAY_ALBUM|PAUSE|RESUME|SEEK|NEXT|PREV|ACTIVATE_TAB, payload }`, `STATE_UPDATE { platform, is_playing, song_name, artist_name, album_name, position_ms, duration_ms, error? }`).

### 5. 0€ Playback Engine (`backend/app/playback/` ↔ `frontend-v4/` & `extensions/amdatawrap-bridge/`)
- `GET /api/v4/playback/resolve?song_name=...&artist_name=...&track_key=...` → `{ track_key, video_id: str|null, source: "cache"|"ytmusicapi"|"musicbrainz_url_rel"|"none", url: str|null, preview_url: str|null }`.
- `POST /api/v4/playback/track-event` body `{ track_key?, song_name, artist_name, album_name?, provider: "youtube_iframe"|"extension_bridge"|"preview_audio", event_type: "now_playing"|"scrobble"|"skip", position_ms, duration_ms, profile_id? }` → updates `now_playing_state` + `WS /ws/now-playing` and commits to `reconciler.py` on scrobble/skip.
- `GET /api/v4/playback/bridge/status` & `POST /api/v4/playback/bridge/command` → inspect connected MV3 bridge and relay commands.

### 6. Artwork Proxy & LAN Info (`backend/app/main.py` ↔ `frontend-v4/`)
- `GET /api/artwork-proxy?url=...&w=512&fmt=webp` → `w` optional (64–2048), `fmt` optional (`webp`|`jpeg`|`png`); caches resized bytes; allows Apple, Deezer, Wikimedia, CAA, Archive, YouTube (`i.ytimg.com`, `lh3.googleusercontent.com`), Spotify (`i.scdn.co`), TIDAL (`resources.tidal.com`).
- `GET /api/v4/network/lan-info` → `{ lan_ip, hostname, backend_port: 8000, frontend_v4_port: 5176, backend_url, frontend_v4_url, qr_svg, is_loopback_fallback: bool }`.
- HTTP Middleware on all responses: `Referrer-Policy: strict-origin-when-cross-origin`.
