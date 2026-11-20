## 2026-11-20T14:59:36Z

You are a Specification Miner for AMDataWrap V4.

MANDATORY FIRST STEP:
Read `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/ORIGINAL_REQUEST.md` and `/home/antigravity/Pibaps/AMDataWrap/docs/plans/PLAN_V4_FINAL.md` in full before investigating.

Working directory: `/home/antigravity/Pibaps/AMDataWrap`
Your exclusive state folder: `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/survey_spec_miner_docs`

Objective (READ-ONLY — do NOT modify any source files):
1. Read `docs/README.md`, `docs/plans/PLAN_V4_FINAL.md`, and the technical feasibility documents in `docs/feasibility/` (`FEASIBILITY_APPLE_MUSIC_PLAYER.md`, `FEASIBILITY_MULTI_PLATFORM.md`, `FAQ_IFRAME_AND_ZERO_COST.md`) and any other relevant markdown specs in `docs/` or repo root (`README.md`, etc.).
2. Extract an exhaustive, numbered **Feature Inventory** covering EVERY requirement across Phase 1, Phase 2, Phase 3, and Section 5 (Validation Checklist) of `PLAN_V4_FINAL.md` and `ORIGINAL_REQUEST.md`, with exact technical details, edge cases, error conditions, and compliance constraints:
   - Exact schema & deduplication rules (ISRC + `canonical_key_for` + ±180s), capabilities flags, `source_provider` filter.
   - Exact details for all 5 importers (Apple Music, Spotify Extended & Account Data + historical `skipped` 2015–2022 & `offline_timestamp` & `spotify_track_uri IS NOT NULL`, YouTube Music Takeout multilingual prefixes + `" - Topic"` + deleted videos + `duration_is_estimated = 1`, Deezer `.xlsx` EN/FR headers + strict IP column rejection + `-1` duration imputation, TIDAL `.csv` UTF-8 alias auto-detection + manual mapping).
   - Exact enrichment cascade (Deezer REST rate limits, MusicBrainz WS/2 + CAA front/back/medium + 1 req/s + 503 backoff, iTunes Search fallback + preview_url) and TTL cache.
   - Exact Continuum tracking (Windows SMTC, macOS `mediaremote-adapter`, Linux `MPRIS2` with internal timer for Spotify `Position=0` bug, Web Scrobbler webhook events, ListenBrainz local endpoint + QR/1-click setup, `WS /ws/now-playing`).
   - Exact 0€ Playback Engine (`YouTubeIFrameProvider` + `ytmusicapi` + MusicBrainz `url-rels` + anti-Error 153 headers `Referrer-Policy: strict-origin-when-cross-origin`, `playsinline=1`, >=200x200px ToS + floating 240x200px glassmorphism switch; `ExtensionBridgeProvider` + MV3 extension `extensions/amdatawrap-bridge/` with `ws://127.0.0.1:8000/ws/bridge`, 20s keepalive + `chrome.alarms`, Apple Music `window.MusicKit.getInstance()`, Spotify Web, YouTube Music; `PreviewAudioProvider`).
   - Exact Frontend V4 requirements (port 5176, single persistent Canvas + GSAP + no React animation resets, Crate/Turntable 4-state machine, 3 finishes, integrated digital display, authentic front/back sleeve + vinyl back generator, proportional grooves, tonearm drag seek, Web Audio foley, Galaxy 3D V4 HUD/anti-collision/hover-dim/filters/inspector, V2+V3 analytics modules driven by capabilities).
   - Exact Phase 3 requirements (4 graphic tiers 0-3, `< 60 draw calls`, `< 150 Mo VRAM`, `/api/artwork-proxy?w=512&fmt=webp`, `webglcontextlost/restored`, `visibilityState === 'hidden'`, WebGPU opt-in + fallback, LAN `--host 0.0.0.0` + CORS + QR code, and Section 5 validation checklist including Playwright Desktop 1440p & Mobile 390x844).
3. Also note any sample data files or fixtures present in the repo (or mounted Drive resources if relevant) that could help testing, without downloading huge files unnecessarily.

Deliverable:
Write a comprehensive, structured specification report to `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/survey_spec_miner_docs/handoff.md` and send a concise completion message back to your caller with the report path and summary.
