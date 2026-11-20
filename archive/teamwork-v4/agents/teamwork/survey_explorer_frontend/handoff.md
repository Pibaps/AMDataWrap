# Survey Explorer Handoff — Frontends V1/V2/V3, Extensions, Environment & `frontend-v4/` Architecture

**Core Summary:** All three existing frontends (`frontend/` :5173, `frontend-v2/` :5174, `frontend-v3/` :5175) share a React 19 + Vite 6 + Tailwind v4 + ECharts 5 + raw Three.js stack (zero R3F/GSAP currently), with no `extensions/` directory yet and Node `v24.22.3` + system Chromium `156.0.8078.79` ready on this VM. We isolated the exact root causes of V2's animation resets and Galaxy 3D readability flaws (plus subtle rebuild traps in V3's `UnifiedObservatoryCanvas`), cataloged reusable V2/V3 modules, and designed a zero-overlap modular architecture for `frontend-v4/` (`:5176`) partitioned into independent Phase 2 and Phase 3 worker lanes.

---

## 1. Observation

### 1.1 Repository Root, Scripts, Extensions & Ports Map

Inspected `/home/antigravity/Pibaps/AMDataWrap` root directory:
- **Existing frontend directories:** `frontend/`, `frontend-v2/`, `frontend-v3/`.
- **`extensions/` directory:** **Does not exist yet** (will be created fresh at `extensions/amdatawrap-bridge/` in Phase 1).
- **Root startup scripts & build files:**
  - `start.bat` (4 lines): Windows wrapper invoking `powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"`.
  - `start.ps1` (43 lines): Windows PowerShell launcher starting FastAPI backend (`:8000` on `127.0.0.1`), `frontend/` (`:5173`), `frontend-v2/` (`:5174`), and `frontend-v3/` (`:5175`), opening `http://localhost:5175`.
  - **No** `start.sh`, `Makefile`, or root `package.json` exist yet.

| App | Path | Port | Vite Proxy Targets (`vite.config.ts`) | Host / WS / Headers | Status for V4 |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **V1 Classique** | `frontend/` | `5173` | `/api` → `http://127.0.0.1:8000` | localhost default, no WS proxy | Keep intact |
| **V2 Sonic Odyssey** | `frontend-v2/` | `5174` | `/api` → `http://127.0.0.1:8000` | localhost default, no WS proxy | Keep intact |
| **V3 Continuum** | `frontend-v3/` | `5175` | `/api`, `/apis` → `http://127.0.0.1:8000` | localhost default, `worker.format: 'es'`, `build.target: 'es2022'`, no WS proxy | Keep intact |
| **V4 (Target)** | `frontend-v4/` | `5176` | `/api`, `/apis`, **`/ws` (`ws: true`)** → `http://127.0.0.1:8000` | `host: '0.0.0.0'` (LAN), `Referrer-Policy: strict-origin-when-cross-origin` (anti-YT Error 153) | New in Phase 2 |

### 1.2 VM Node / npm / Playwright / Browser Environment

Direct shell inspection in `/home/antigravity/Pibaps/AMDataWrap`:
- `node -v` → **`v24.22.3`**
- `npm -v` → **`11.21.2`**
- Package managers present: `/usr/local/bin/npx`, `/usr/local/bin/pnpm`, `/usr/local/bin/yarn`.
- Global npm packages (`npm list -g --depth=0`): `chrome-devtools-mcp@1.10.1`, `corepack@0.36.0`, `npm@11.21.2`.
- **Installed browsers:** `/usr/bin/chromium` and `/usr/bin/google-chrome` both exist and report **`Chromium 156.0.8078.79 built on Debian GNU/Linux 12 (bookworm)`**.
- **Playwright status:**
  - `~/.cache/ms-playwright` does **not** exist (`No such file or directory`).
  - `npx --no-install playwright --version` fails (not globally installed); Python `playwright` is not installed (`ModuleNotFoundError`).
  - `frontend-v3/package.json` declares `"@playwright/test": "^1.50.1"` in `devDependencies` and has `playwright.config.ts` + `e2e/v3.spec.ts` (zero-error console/pageerror/HTTP>=400 guardrail pattern).
- **`node_modules/` status:** None of `frontend/`, `frontend-v2/`, or `frontend-v3/` currently have `node_modules/` installed on disk.

### 1.3 Dependency Matrix Across V1 / V2 / V3

| Package | `frontend` (V1) | `frontend-v2` (V2) | `frontend-v3` (V3) | Notes for `frontend-v4` |
| :--- | :--- | :--- | :--- | :--- |
| `react` / `react-dom` | `^19.0.0` | `^19.0.0` | `^19.0.0` | Keep `^19.0.0` |
| `vite` / `@vitejs/plugin-react` | `^6.2.0` / `^4.3.4` | `^6.2.0` / `^4.3.4` | `^6.2.0` / `^4.3.4` | Keep `^6.2.0` |
| `tailwindcss` / `@tailwindcss/vite` | `^4.0.9` | `^4.0.9` | `^4.0.9` | Keep Tailwind v4 |
| `typescript` | `^5.7.3` | `^5.7.3` | `^5.7.3` | Keep `^5.7.3` |
| `three` / `@types/three` | `^0.187.0` | `^0.174.0` | `^0.174.0` | Use `^0.174.0` (or `^0.187.0`, supports `three/webgpu`) |
| `@react-three/fiber` / `drei` | — | — | — | **Not used** anywhere (raw Three.js preferred for React 19 & WebGPU) |
| `gsap` | — | — | — | **Add `gsap`** in `frontend-v4` (required by `PLAN_V4_FINAL.md` §3.1) |
| `zustand` | — | — | `^5.0.3` | **Reuse in V4** (selective subscriptions, zero Context re-render storms) |
| `@tanstack/react-query` | — | — | `^5.66.0` | **Reuse in V4** (`keepPreviousData`, caching, invalidation) |
| `echarts` | `^5.6.0` | `^5.6.0` | `^5.6.0` | **Reuse in V4** (Canvas renderer) |
| `framer-motion` | `^12.4.7` | `^12.4.7` | `^12.4.7` | Optional for modals/HUD transitions (avoid unmounting 3D canvas) |
| `lucide-react` | `^0.475.0` | `^0.475.0` | `^0.475.0` | **Reuse in V4** |
| `@tanstack/react-virtual` | `^3.13.6` | `^3.13.6` | `^3.13.6` | **Reuse in V4** (history/sessions lists) |
| `maplibre-gl` + `@deck.gl/*` | — | — | `^5.1.0` / `^9.1.4` | **Reuse in V4** (Atlas Mondial V3) |
| `sigma` + `graphology*` | — | — | `^3.0.0` / `^0.26.0` | Optional in V4 (Atlas 2D Graph sub-tab) |
| `essentia.js` | — | — | `^0.1.3` | Note: V3's `audioDna.worker.ts` uses pure JS DSP (Goertzel + autocorr) without importing `essentia.js` runtime |
| `html-to-image` / `modern-screenshot` | `html-to-image` | `html-to-image` | `modern-screenshot` | Use `html-to-image` or `modern-screenshot` for Wrapped PNG export |
| `qrcode` (or inline SVG QR) | — | — | — | **Add `qrcode`** (tiny pure-JS) for LAN mobile access & ListenBrainz setup QR codes |
| `@playwright/test` | — | — | `^1.50.1` | **Add in `frontend-v4`** `devDependencies` |

### 1.4 Deep-Dive: `frontend-v2/` (Sonic Odyssey Visual DNA & Exact Flaws)

1. **Visual DNA (keep & sublimate in V4):**
   - **Typography (`frontend-v2/index.html:10`, `src/index.css:4-34`):** Google Fonts `Syne` (`--font-display`, `-0.03em` tracking), `Instrument Serif` italic (`.font-editorial`), `Plus Jakarta Sans` (`--font-sans`), `JetBrains Mono` (`.font-mono-num` with `tabular-nums`). Base canvas `#050508`, text `#f6f6fa`.
   - **Dynamic Chromatic Auras (`src/index.css:9-11`, `src/store/AppContext.tsx:115-125`, `src/utils/format.ts:43-78`):** Extracts 3 vivid colors from `/api/artwork-proxy?url=...` on a 24×24 offscreen canvas, writes `--aura-1`, `--aura-2`, `--aura-3` CSS custom properties and feeds `auraColors` into the Three.js nebula.
   - **Glassmorphism Surfaces (`src/index.css:38-70`):** `.film-grain` SVG fractalNoise overlay (`opacity: 0.032`), `.spatial-glass` (`backdrop-filter: blur(26px) saturate(165%)`, specular top-edge `inset 0 1px 0 rgba(255,255,255,0.14)`), `.spatial-card`.
     - *Bug observed in V2:* `BehaviorPage.tsx:56` and `FilterBar.tsx:38` reference `.glass-panel` / `.glass-card` (leftover V1 classes not defined in V2's `index.css`). V4 must standardize cleanly on `.spatial-glass` / `.spatial-card`.
   - **Floating visionOS Top Dock (`src/App.tsx:62-129`):** Sticky rounded-2xl `.spatial-glass` pill nav (zero SaaS sidebar).
   - **WebGL Nebula Stage (`src/components/three/AmbientNebulaCanvas.tsx:16-210`):** 900 additive `THREE.Points` + 3 harmonic `THREE.TorusGeometry` rings + wireframe `IcosahedronGeometry` orb, smoothly lerping toward `auraColors` and reacting to `reactiveAudio.getBands()`.
   - **Audio Preview & Lyrics Dock (`src/components/layout/SpatialVinylDeck.tsx`):** Floating bottom-right dock with spinning CSS vinyl, live 28-bar FFT canvas, Deezer BPM badge, LRCLIB lyrics popover.
   - **11-Slide Wrapped (`src/components/wrapped/SonicOdysseyWrapped.tsx`):** Fullscreen 11-chapter Odyssey + Spatial Poster / Receiptify Ticket PNG export.
   - **V2 Pages & API Endpoints:**
     - `OverviewPage` → `/api/analytics/overview`
     - `SonicGalaxy3D` → `/api/analytics/galaxy?limit=75`
     - `TopsPage` → `/api/analytics/tops/{artists|tracks|albums|genres}`
     - `ChronoPage` → `/api/analytics/chronobiology`
     - `PersonaPage` → `/api/analytics/persona`
     - `BehaviorPage` → `/api/analytics/behavior`
     - `SessionsHistoryPage` → `/api/sessions`, `/api/history`, `/api/history/export.csv`
     - `DetailDrawer` → `/api/detail/{artist|album|day}/{id}`, `/api/external/artist-bio`
     - `EnrichmentBanner` → `EventSource('/api/enrichment/stream')`, `POST /api/enrichment/{start|stop}`

2. **Exact Root Causes of V2's Animation-Reset Flaws (Correction #1):**
   - **Bug A (Critical — Click-to-Play WebGL Teardown):** In `frontend-v2/src/store/AppContext.tsx:127-140`, `playPreview` lists `playingTrack` in its `useCallback` dependencies (`[playingTrack, setAmbientFromArtwork]`). In `frontend-v2/src/components/three/SonicGalaxy3D.tsx:288`, the entire Three.js setup `useEffect` (which creates `WebGLRenderer`, clears `el.innerHTML = ''`, reloads all 75 textures, and resets `radius=34, theta=0.4, phi=1.18`) has `[galaxyData, playPreview]` as dependencies! Clicking any planet calls `playPreview` → mutates `playingTrack` → recreates `playPreview` → **destroys and recreates the entire WebGL context and snaps the camera back to start**.
   - **Bug B (Multi-Canvas Thrashing & Unmount Resets):** `App.tsx:52` runs `AmbientNebulaCanvas` (Context #1), `App.tsx:149` mounts/unmounts `SonicGalaxy3D` on tab switch (Context #2 destroyed on every tab change via `AnimatePresence mode="wait"`), and `SonicOdysseyWrapped.tsx:190` mounts a *second* `AmbientNebulaCanvas` on top (Context #3).
   - **Bug C (React Context Re-render Cascade):** `AppContext.tsx:93` updates React state `audioProgress` on every `timeupdate`, re-rendering all consumers of `useApp()`.
   - **Bug D (Per-frame GC & No Visibility Pause):** `SonicGalaxy3D.tsx:272` allocates `new THREE.Vector3(...)` 75 times/frame (~4,500 allocs/sec), and neither `AmbientNebulaCanvas` nor `SonicGalaxy3D` pauses `requestAnimationFrame` when `document.visibilityState === 'hidden'`.

3. **Exact Readability Flaws of V2's `SonicGalaxy3D.tsx` (Correction #2):**
   - **Zero artist labels in 3D space:** All 75 planets are unlabeled artwork circles (`CircleGeometry`); users must hover blindly to discover who any node is.
   - **No encoding legend:** Nothing in the HUD explains that angle = genre sector, radial distance = rank, disc size = listening time, and Y-height = release era (`avg_year`, lines 75–87).
   - **No hover focus / dimming:** Hovering a node scales it to `1.32` (line 271), but the other 74 nodes and all unrelated co-occurrence edges remain at full opacity — impossible to trace an artist's session neighbors.
   - **Static non-interactive legend pills:** Lines 313–326 render genre pills inside a `pointer-events-none` container with no click filtering and no era filter.

### 1.5 Deep-Dive: `frontend-v3/` (Reusable Analytical Modules, Workers & 3D Prototype)

1. **Stack & Infrastructure Improvements over V2:**
   - **State & Fetching:** `zustand` (`src/store/playerStore.ts`) + off-React `audioTelemetryRef` (lines 24–35: 60 FPS FFT/waveform/RMS/progress never touch React state!) + `@tanstack/react-query` (`keepPreviousData`, 2-min `staleTime`) + `nuqs` URL-synced filters (`src/hooks/useUrlFilters.ts`).
   - **Audio DNA & Offscreen FFT Workers:**
     - `src/workers/audioDna.worker.ts` (225 lines): Pure TypeScript multi-window Goertzel Chroma + Krumhansl-Kessler Key/Camelot + onset autocorrelation BPM + Energy/Danceability/Loudness/Valence analyzer, posting to `POST /api/v3/audio-dna`. Runs in a Web Worker with zero main-thread jank.
     - `src/workers/fftCanvas.worker.ts` (128 lines): `OffscreenCanvas` 60 FPS visualizer worker with graceful main-thread fallback (`SpatialAudioDock.tsx:45-77`).
   - **ECharts Canvas Wrapper (`src/components/EChartCanvas.tsx`):** Canvas renderer + `ResizeObserver` + `universalTransition: true` + `onClickRef` (never re-inits chart on callback change).
   - **APCA / Palette Utilities (`src/utils/apca.ts`):** `desaturateForTheme()`, `artworkProxyUrl()`, `audioProxyUrl()`, formatters.

2. **Analytical Views to Port into V4 (restyled in V2 Sonic Odyssey glassmorphism, zero Hi-Fi/Braun chrome):**
   - **`ScienceLabPage.tsx` (741 lines):**
     - Tab 1 (`eras`): PELT RBF/BIC weekly hours + entropy chart & era signature cards (`/api/v3/analytics/eras`).
     - Tab 2 (`compass`): Russell Circumplex Valence×Arousal scatter + 24h diurnal trajectory + 4 quadrants + batch local WASM/Worker scanner (`/api/v3/analytics/compass`).
     - Tab 3 (`camelot`): Interactive 24-cell SVG Camelot Wheel (1A–12A / 1B–12B) + Harmonic Mix & Smart Playlist generator (`harmonic_mix`, `forgotten_gems`, `zero_skip`, `era_soundtrack`) + JSPF/XSPF/M3U8 export & ListenBrainz publish (`/api/v3/analytics/camelot`, `POST /api/v3/playlists/generate`, `GET /api/v3/playlists/export`).
     - Tab 4 (`metrics`): Eddington number, Gini/D_eff + Lorenz curve, Shannon entropy, Survival/Retention curve + archetypes, Bridge artists, Entropy by device (`/api/v3/analytics/science`).
   - **`AtlasAndGraphPage.tsx` (379 lines):**
     - MapLibre GL (`maplibre-gl`) + Deck.gl (`MapboxOverlay`, `ArcLayer`, `ScatterplotLayer`) with offline-safe graticule GeoJSON (zero external tile 404s!) (`/api/v3/analytics/atlas`).
     - Optional Sigma.js + Graphology ForceAtlas2 2D graph tab (`/api/v3/analytics/graph2d`).
   - **`FtsSearchModal.tsx` (133 lines):** `Ctrl/Cmd+K` instant modal querying `/api/v3/search` (SQLite FTS5 `unicode61` + `trigram` + indexed lyrics snippets).
   - **`ContinuumHubPage.tsx` (402 lines):** Foundation for V4's upgraded **Onboarding & Connections/Profiles Hub** (ListenBrainz, Local Receiver `/apis/listenbrainz/1/submit-listens`, OS SMTC/MPRIS/macOS status, Web Scrobbler webhook, Extension MV3 status, Parquet/Jobs status).
   - **`AnalyticsCorePage.tsx` & `GamesAndCollectorPage.tsx`:** Core analytics tabs (Tops, Chrono, Persona, Behavior, History) + Iceberg/Blind Test/Collector data (`/api/v3/collector/atelier`).

3. **V3's 3D Vinyl & Observatory Prototype (`UnifiedObservatoryCanvas.tsx`, 497 lines):**
   - **Good patterns to keep:** `webglcontextlost`/`webglcontextrestored` handling (lines 167–176), `InstancedMesh` + batched `LineSegments` draw-call discipline (`renderer.info.render.calls`), recursive `disposeSceneObjects()` (lines 51–60), `ResizeObserver`, GPU telemetry tracking.
   - **What V3 did NOT build yet:** No turntable, no tonearm, no grooves, no sleeve-slide/disc-extraction state machine, no real cover textures on vinyl sleeves (lines 376–380 used flat `MeshStandardMaterial({ color })` without loading `artwork_url` or `back_cover_url`!), no integrated 3D YouTube/digital display, no GSAP transitions.
   - **Flaws in V3's `UnifiedObservatoryCanvas` to AVOID in V4:**
     1. Mounted inside `Observatory3DPage.tsx:111`, NOT at app root → unmounts on tab change.
     2. Renderer `useEffect` depends on `[calm, setGpuMetrics]` (line 288) → toggling `calm` destroys and recreates `WebGLRenderer`.
     3. Scene rebuild `useEffect` depends on `[mode, theme, ridgeline, vinyls, constellation, flippedVinyl]` (line 469) → flipping a vinyl destroys the entire scene group and hard-resets `orbitRef.current`!

---

## 2. Logic Chain

1. **Why raw Three.js + GSAP (not `@react-three/fiber`) for `frontend-v4/`:**
   - Observed: V1, V2, and V3 all use raw `three` (`0.174`–`0.187`) with React `19.0.0`. `@react-three/fiber` v8 has peer-dependency conflicts with React 19, and v9 adds reconciler overhead plus friction when dynamically swapping `THREE.WebGLRenderer` ↔ `THREE.WebGPURenderer` (Tier 3 opt-in) or mutating platter/tonearm/aura state at 60 FPS outside React.
   - Conclusion: Using raw `three` + `gsap` inside a dedicated imperative `src/engine/` layer controlled via off-React `sceneRefs.ts` guarantees zero React re-renders during 60 FPS loops, clean `WebGLRenderer`/`WebGPURenderer` tier switching, and `< 60 draw calls` on Mobile Tier 1.

2. **Why a Single Persistent Root Canvas eliminates every V2 & V3 animation reset:**
   - Observed: Both V2 (`SonicGalaxy3D.tsx:288`, `App.tsx:149`, `SonicOdysseyWrapped.tsx:190`) and V3 (`UnifiedObservatoryCanvas.tsx:288,469`, `Observatory3DPage.tsx:111`) suffer resets because (a) canvases unmount across tabs/modals, and (b) React `useEffect` hooks recreate the renderer or reset camera spherical coordinates when callbacks or UI state (`playingTrack`, `flippedVinyl`, `calm`) change.
   - Conclusion: Mounting `<PersistentStageCanvas />` once at the root of `frontend-v4/src/App.tsx` — with three persistent `THREE.Group` sub-stages (`NebulaStage`, `VinylStudioStage`, `GalaxyV4Stage`) toggled via GSAP opacity/position/camera tweens and driven by mutable `sceneRefs` — makes abrupt resets structurally impossible.

3. **How the Integrated 3D Turntable Digital Display + Floating YouTube Cartouche satisfy YouTube ToS (≥ 200×200 px) across all views:**
   - Observed (`PLAN_V4_FINAL.md` §1 & §3.2, `FAQ_IFRAME_AND_ZERO_COST.md` §1.B): YouTube IFrame MUST stay mounted (never `display: none`) and visibly ≥ 200×200 px, with `Referrer-Policy: strict-origin-when-cross-origin` and `playsinline=1`.
   - Conclusion: Render **one single persistent `<YouTubeDeckOverlay />` DOM element** at app root (so changing views never reloads or interrupts playback!). When on the Vinyl Studio tab with the turntable camera framed close enough that the projected 3D screen-bezel rect is ≥ 200×200 CSS px, project the 3D screen corners via `camera` matrix into CSS `transform`/`left`/`top`/`width`/`height` (or `CSS3D`-aligned screen-space overlay) so the iframe sits seamlessly inside the 3D turntable's integrated digital display; when zoomed out or on any analytics tab, smoothly dock the **exact same DOM container** into the draggable glassmorphism floating cartouche (`240×200 px`)! When playing via `ExtensionBridgeProvider` or `PreviewAudioProvider` (non-YouTube), hide the YT overlay and paint the 3D turntable's integrated display with a crisp live `CanvasTexture` (BPM, Camelot key, FFT/BPM spectrum, timer, finish-matched styling).

4. **How `frontend-v4/` can be safely parallelized across Phase 2 & Phase 3 workers with zero file overlap:**
   - By strictly separating:
     - **Core shell / store / API / capabilities / types** (Foundation),
     - **3D Engine & Vinyl Crate/Turntable scene** (`src/engine/` + `src/scenes/vinyl/`),
     - **Galaxy 3D V4** (`src/scenes/galaxy/`),
     - **Playback Providers & Live WS** (`src/playback/`),
     - **Analytics & Onboarding/Hub Views** (`src/pages/`),
     - **Phase 3 Graphics Tiering, Mobile Touch Controls, WebGPU Opt-in, LAN QR & Playwright E2E** (`src/engine/tierManager.ts`, `src/components/LanQrModal.tsx`, `e2e/`).

---

## 3. Caveats

1. **Backend V4 API shapes are being designed/built in Phase 1:** Exact JSON schemas for `/api/v4/profile/capabilities`, `/api/v4/profiles`, `/api/v4/import`, `/api/v4/vinyl-editions`, `/api/v4/playback/resolve-youtube`, `/api/v4/lan-info`, and `WS /ws/now-playing` should be frozen in a shared contract before Phase 2 workers start (or typed in `frontend-v4/src/api/types.ts` by the Phase 2 scaffold step).
2. **`node_modules` and `npm` network availability:** None of the frontends have `node_modules/` installed yet; Phase 2 scaffold will run `npm install` in `frontend-v4/` (creating `frontend-v4/node_modules`). We did not run `npm install` because our role is strictly read-only.
3. **Playwright Chromium binary on VM:** `~/.cache/ms-playwright` is absent, while `/usr/bin/chromium` (`156.0.8078.79`) is already present. Phase 3's `frontend-v4/playwright.config.ts` should default to `launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] }` (falling back to Playwright's bundled browser if `/usr/bin/chromium` doesn't exist on another machine) so E2E WebGL2 tests work offline/instantly on this Linux VM without downloading 150 MB.
4. **WebGPU (`THREE.WebGPURenderer`) in headless VM:** Headless SwiftShader on Linux does not expose a hardware WebGPU adapter (`navigator.gpu` may be undefined or return `null` adapter). Tier 3 opt-in must gracefully probe `navigator.gpu?.requestAdapter()` and instantly fall back to Tier 2 WebGL2 with a clear UI status badge, and unit/E2E tests should verify the fallback path cleanly.
5. **macOS/Windows startup scripts:** `start.ps1` / `start.bat` are Windows-only; in Phase 3 we can optionally add a cross-platform `start.sh` (Linux/macOS) and add V4 (`:5176`) with `--host 0.0.0.0` to `start.ps1` without breaking V1/V2/V3.

---

## 4. Conclusion — Recommended Modular Architecture for `frontend-v4/` (`:5176`)

### 4.1 Recommended `frontend-v4/` Package & Vite Configuration

- **Port:** `5176` (`vite.config.ts`: `server: { host: '0.0.0.0', port: 5176, headers: { 'Referrer-Policy': 'strict-origin-when-cross-origin' }, proxy: { '/api': ..., '/apis': ..., '/ws': { target: 'ws://127.0.0.1:8000', ws: true, changeOrigin: true } } }`).
- **Core Dependencies:**
  - `react@^19.0.0`, `react-dom@^19.0.0`, `zustand@^5.0.3`, `@tanstack/react-query@^5.66.0`, `lucide-react@^0.475.0`, `framer-motion@^12.4.7`
  - `three@^0.174.0` (or `^0.187.0`), `gsap@^3.12.7`
  - `echarts@^5.6.0`, `@tanstack/react-virtual@^3.13.6`, `maplibre-gl@^5.1.0`, `@deck.gl/core@^9.1.4`, `@deck.gl/layers@^9.1.4`, `@deck.gl/mapbox@^9.1.4`, `sigma@^3.0.0`, `graphology@^0.26.0`, `graphology-layout-forceatlas2@^0.10.1`
  - `html-to-image@^1.11.13`, `qrcode@^1.5.4`
- **Dev Dependencies:** `vite@^6.2.0`, `@vitejs/plugin-react@^4.3.4`, `tailwindcss@^4.0.9`, `@tailwindcss/vite@^4.0.9`, `typescript@^5.7.3`, `@types/react@^19.0.10`, `@types/react-dom@^19.0.4`, `@types/three@^0.174.0`, `@types/qrcode@^1.5.5`, `@playwright/test@^1.50.1`.

### 4.2 Reusable Asset Map (V2 + V3 → V4)

| V4 Feature | Reuse / Port From | Key Modifications for V4 |
| :--- | :--- | :--- |
| Typography (`Syne`, `Instrument Serif`, `JetBrains Mono`), `#050508`, `.spatial-glass`, `.spatial-card`, `.film-grain` | `frontend-v2/index.html`, `frontend-v2/src/index.css` | Unify classes (remove leftover V1 `.glass-panel` refs); add mobile-safe touch targets & high-legibility HUD chips |
| Chromatic Aura Extraction (`--aura-1/2/3`) | `frontend-v2/src/utils/format.ts:43-78` + `frontend-v3/src/utils/apca.ts` | Combine V2's 3-color extraction with V3's gentle saturation clamp + route through `sceneRefs.auraTarget` (GSAP/lerp) |
| WebGL Nebula Background | `frontend-v2/src/components/three/AmbientNebulaCanvas.tsx` | Convert into a persistent `THREE.Group` inside `PersistentStageCanvas` (no standalone renderer); add Tier 0/1/2/3 particle budgets & `visibilityState` pause |
| Off-React 60 FPS Telemetry & Workers | `frontend-v3/src/store/playerStore.ts`, `audioDna.worker.ts`, `fftCanvas.worker.ts` | Extend `sceneRefs.ts` with turntable RPM/angle, tonearm angle/lift, camera rig, and playback timeline refs |
| ECharts Canvas Wrapper | `frontend-v3/src/components/EChartCanvas.tsx` | Restyle dark tooltip/axes in V2 obsidian glass palette |
| Science Lab (PELT / Russell / Camelot / Metrics) | `frontend-v3/src/pages/ScienceLabPage.tsx` | Restyle in `.spatial-glass` / `.spatial-card`; wire Play buttons to V4 unified `playbackManager` |
| Atlas Mondial + 2D Graph | `frontend-v3/src/pages/AtlasAndGraphPage.tsx` | Restyle in V2 obsidian glass; keep offline-safe MapLibre graticule |
| FTS5 Search (`Ctrl+K`) | `frontend-v3/src/components/FtsSearchModal.tsx` | Restyle in `.spatial-glass`; wire Play to V4 `playbackManager` & "Inspect Vinyl" action |
| Core Analytics (Overview, Tops, Chrono, Persona, Behavior, History, DetailDrawer) | `frontend-v2/src/pages/*` + `frontend-v2/src/components/drawers/DetailDrawer.tsx` | Migrate from `AppContext` to `useQuery` + `useAppStore` + **Capabilities-aware rendering** (`capabilities.has_lyrics_events`, `has_search_events`, `has_skips`, `has_incognito_flag`, `estimated_duration_pct` badges) |
| Wrapped Sonic Odyssey V4 | `frontend-v2/src/components/wrapped/SonicOdysseyWrapped.tsx` | Drive the **root persistent canvas** (`stageMode = 'wrapped'`) instead of mounting a 2nd `AmbientNebulaCanvas`; integrate multi-platform & capabilities flags |

### 4.3 Clean Modular File Architecture & Zero-Overlap Parallel Worker Lanes

```text
frontend-v4/
├── index.html                                  # [Lane 0: Scaffold] Fonts (Syne/Instrument Serif/JetBrains Mono) + meta referrer
├── package.json                                # [Lane 0: Scaffold] Dependencies & scripts (dev/build/test:e2e)
├── tsconfig.json                               # [Lane 0: Scaffold] Strict TS + WebWorker lib
├── vite.config.ts                              # [Lane 0: Scaffold] Port 5176, host 0.0.0.0, /api + /apis + /ws proxy, Referrer-Policy
├── playwright.config.ts                        # [Lane 5: Phase 3 QA] Desktop 1440p + Mobile 390x844 projects
├── e2e/
│   ├── v4-vinyl-studio.spec.ts                 # [Lane 5: Phase 3 QA] Crate -> Sleeve -> Disc -> Turntable + 3 finishes + <60 draw calls
│   ├── v4-galaxy-and-views.spec.ts             # [Lane 5: Phase 3 QA] Galaxy 3D legibility/labels + zero-error all-tabs walkthrough
│   └── v4-mobile-and-tiers.spec.ts             # [Lane 5: Phase 3 QA] 390x844 touch controls, Tier 0/1/2/3 fallback, LAN QR modal
└── src/
    ├── main.tsx                                # [Lane 0: Scaffold] QueryClientProvider + App root
    ├── index.css                               # [Lane 0: Scaffold] V2 Sonic Odyssey CSS tokens (--aura-1/2/3, .spatial-glass, .film-grain)
    ├── App.tsx                                 # [Lane 0: Scaffold] Single PersistentStageCanvas root + Top Dock + Tab Router + Overlays
    ├── api/
    │   ├── types.ts                            # [Lane 0: Scaffold] Shared TS interfaces (Filters, Profile, Capabilities, VinylEdition, Track)
    │   └── client.ts                           # [Lane 0: Scaffold] apiGet/apiPost/uploadImport/proxyArtworkUrl(url, w, fmt)
    ├── store/
    │   ├── appStore.ts                         # [Lane 0: Scaffold] Zustand UI state (activeTab, activeProfileId, capabilities, filters, finish, modals)
    │   └── sceneRefs.ts                        # [Lane 0: Scaffold] Off-React mutable refs (audio FFT, turntable RPM/arm, camera, hover, tier)
    ├── utils/
    │   ├── format.ts                           # [Lane 0: Scaffold] FR formatters + extractPaletteFromArtwork + APCA clamp
    │   └── mechanicalSfx.ts                    # [Lane 1: Vinyl 3D] Optional Web Audio procedural SFX (sleeve rustle, click, needle crackle)
    ├── engine/
    │   ├── PersistentStageCanvas.tsx           # [Lane 1: Core 3D] Single root WebGL2/WebGPU canvas, rAF loop, visibility pause, context lost/restored
    │   ├── NebulaStage.ts                      # [Lane 1: Core 3D] V2 audio-reactive nebula sub-group (tier-scaled particles/rings/orb)
    │   ├── tierManager.ts                      # [Lane 4: Phase 3 GPU/Mobile] Auto Tier 0/1/2/3 detection, WebGPU opt-in loader, DPR & VRAM guard
    │   └── FallbackStage2D.tsx                 # [Lane 4: Phase 3 GPU/Mobile] Tier 0 CSS 3D + Canvas 2D fallback when WebGL unavailable
    ├── scenes/
    │   ├── vinyl/
    │   │   ├── vinylStateMachine.ts            # [Lane 1: Vinyl 3D] FSM: CRATE_BROWSE -> SLEEVE_INSPECT -> DISC_SLIDE_OUT -> TURNTABLE_PLAY + GSAP
    │   │   ├── RecordCrate3D.ts                # [Lane 1: Vinyl 3D] Interactive 3D wooden/obsidian crate, flip-through physics, spine/cover pool
    │   │   ├── SleeveProceduralBack.ts         # [Lane 1: Vinyl 3D] Hi-res CanvasTexture generator for authentic vinyl back cover (Sides A/B/C/D, label, cat#, barcode, stats)
    │   │   ├── VinylDisc3D.ts                  # [Lane 1: Vinyl 3D] 12" LP mesh, proportional track-duration microgrooves shader/texture, center label, Flip A/B
    │   │   ├── Turntable3D.ts                  # [Lane 1: Vinyl 3D] 3 finishes (Obsidian Glass, Vintage Walnut, Studio Alu), inertia platter 33⅓/45, draggable tonearm, dust cover, integrated 3D digital screen
    │   │   ├── VinylStudioOverlay.tsx          # [Lane 1: Vinyl 3D] HUD controls (crate filters, finish switcher, tracklist click-to-seek, START/STOP/CUE/FLIP/EJECT, SFX toggle, mobile thumb bar)
    │   │   └── VinylStudioView.tsx             # [Lane 1: Vinyl 3D] Activates VinylStudioStage in persistent canvas + mounts HUD & fetches vinyl editions
    │   └── galaxy/
    │       ├── GalaxyV4Stage.ts                # [Lane 2: Galaxy 3D] Persistent Three.js group: Instanced/pooled planets, era Y-axis, hover focus dimming, batched co-occurrence edges
    │       ├── labelCollision.ts               # [Lane 2: Galaxy 3D] Screen-space 2D projection + greedy AABB anti-collision label placer
    │       └── GalaxyV4View.tsx                # [Lane 2: Galaxy 3D] Clear HUD legend, interactive genre/era quick-filters, crisp HTML label overlay, artist inspector card
    ├── playback/
    │   ├── types.ts                            # [Lane 2: Playback] Unified PlaybackProvider interface + TrackPlaybackRequest
    │   ├── playbackManager.ts                  # [Lane 2: Playback] Orchestrator: ExtensionBridge -> YouTubeIFrame -> PreviewAudio + reconciler reporting
    │   ├── YouTubeIFrameProvider.ts            # [Lane 2: Playback] YT IFrame API loader, /api/v4/playback/resolve-youtube, playsinline=1, exact timeline
    │   ├── ExtensionBridgeProvider.ts          # [Lane 2: Playback] WS /ws/bridge client (Apple Music Web / Spotify Web / YTM) + Autoplay unlock prompt
    │   ├── PreviewAudioProvider.ts             # [Lane 2: Playback] 30s preview Web Audio AnalyserNode -> sceneRefs.audio + Essentia/DSP worker trigger
    │   ├── nowPlayingWs.ts                     # [Lane 2: Playback] WS /ws/now-playing subscriber (drives 3D turntable live from OS SMTC/mobile scrobbles)
    │   ├── YouTubeDeckOverlay.tsx              # [Lane 2: Playback] Single persistent >=200x200 YT iframe: projects into 3D turntable bezel OR docks as draggable 240x200 glass cartouche
    │   └── FloatingPlayerDock.tsx              # [Lane 2: Playback] VisionOS glass mini-dock (when outside Vinyl Studio) + LRCLIB lyrics + provider badge
    ├── workers/
    │   ├── audioDna.worker.ts                  # [Lane 2: Playback] Ported from V3 (local MIR BPM/Camelot/Energy)
    │   └── fftCanvas.worker.ts                 # [Lane 2: Playback] Ported from V3 (OffscreenCanvas visualizer)
    ├── components/
    │   ├── layout/
    │   │   ├── TopDockNav.tsx                  # [Lane 0: Scaffold] Floating visionOS pill nav + Profile switcher + Search (Ctrl+K) + LAN QR button
    │   │   ├── FilterBar.tsx                   # [Lane 0: Scaffold] Global period/skip/metric/source_provider bar (capability-gated)
    │   │   ├── DetailDrawer.tsx                # [Lane 3: Analytics] Artist/Album/Day drawer + "Open in Vinyl Studio" button
    │   │   └── FtsSearchModal.tsx              # [Lane 3: Analytics] Ported V3 Ctrl+K FTS5 modal in V2 glass style
    │   ├── charts/
    │   │   └── EChartBox.tsx                   # [Lane 3: Analytics] Ported V3 Canvas ECharts wrapper styled for obsidian glass
    │   ├── ui/
    │   │   ├── Artwork.tsx                     # [Lane 0: Scaffold] Tier-aware /api/artwork-proxy?w=512|1024&fmt=webp loader
    │   │   ├── CapabilityBadge.tsx             # [Lane 0: Scaffold] Transparent "Durée estimée" / platform source badges
    │   │   └── LanQrModal.tsx                  # [Lane 4: Phase 3 GPU/Mobile] LAN URL QR modal + Tier/WebGPU selector toggle
    │   └── wrapped/
    │       └── SonicOdysseyWrappedV4.tsx       # [Lane 3: Analytics] Ported V2 11-slide Odyssey wired to single root canvas + capabilities
    └── pages/
        ├── OnboardingHubPage.tsx               # [Lane 3: Analytics] Multi-platform drag&drop import (5 formats), Profiles/Merge manager, 0€ Live Tracking setup + QR
        ├── OverviewPage.tsx                    # [Lane 3: Analytics] V2 Editorial Hero + capabilities-aware KPIs & quick-launch into Vinyl Studio
        ├── TopsPage.tsx                        # [Lane 3: Analytics] V2 Tops (Artists/Tracks/Albums/Genres) with full-track Play + Open Vinyl
        ├── ChronoPage.tsx                      # [Lane 3: Analytics] V2 Chronobiology (ECharts Canvas)
        ├── PersonaPage.tsx                     # [Lane 3: Analytics] V2 Persona & Listening Age
        ├── BehaviorPage.tsx                    # [Lane 3: Analytics] V2 Obsessions/Loops/Skips/Lyrics/Searches (capability-gated sections)
        ├── SessionsHistoryPage.tsx             # [Lane 3: Analytics] Virtualized sessions & history with source_provider badges
        ├── ScienceLabPage.tsx                  # [Lane 3: Analytics] Ported V3 PELT + Russell + Camelot + Eddington/Gini/Survival
        └── AtlasPage.tsx                       # [Lane 3: Analytics] Ported V3 MapLibre+Deck.gl Atlas Mondial + Sigma 2D Graph
```

#### Parallel Execution Plan (Zero File Overlap)
- **Step 2A (Sequential Prerequisite — small):** **Lane 0 (Scaffold)** creates `frontend-v4/` boilerplate, `vite.config.ts`, `index.css`, `api/types.ts`, `api/client.ts`, `store/appStore.ts`, `store/sceneRefs.ts`, `App.tsx` shell with lazy route stubs, and runs `npm install`.
- **Step 2B (3 Parallel Workers — ZERO file overlap):**
  - **Worker A (Lane 1 — Core 3D & Vinyl Studio):** owns `src/engine/PersistentStageCanvas.tsx`, `src/engine/NebulaStage.ts`, `src/scenes/vinyl/*`, `src/utils/mechanicalSfx.ts`.
  - **Worker B (Lane 2 — Galaxy 3D V4 & Playback Engine):** owns `src/scenes/galaxy/*`, `src/playback/*`, `src/workers/*`.
  - **Worker C (Lane 3 — Onboarding/Hub & Analytics/Wrapped Views):** owns `src/pages/*`, `src/components/charts/*`, `src/components/layout/{DetailDrawer,FtsSearchModal}.tsx`, `src/components/wrapped/*`.
- **Step 2C (Wiring & Build Check):** Hook Lane 1/2/3 exports cleanly into `App.tsx` and verify `npm run build` (`tsc -b && vite build`).
- **Step 3 (Phase 3 — 2 Parallel/Sequential Workers):**
  - **Worker D (Lane 4 — Tier 0–3 / Mobile / WebGPU / LAN QR):** owns `src/engine/tierManager.ts`, `src/engine/FallbackStage2D.tsx`, `src/components/ui/LanQrModal.tsx`, mobile touch polish, `start.ps1` / `start.sh` LAN updates.
  - **Worker E (Lane 5 — Playwright Validation):** owns `playwright.config.ts` and `e2e/*.spec.ts`, verifying Desktop `1440×900` + Mobile `390×844` on the Vinyl Studio 3D (`< 60 draw calls`, 3 finishes, integrated display, zero resets) and Galaxy 3D V4 (legend + anti-collision labels).

---

## 5. Verification Method

All observations in this report can be independently verified via:

1. **Ports, proxies & package versions:**
   - Inspect `frontend/package.json`, `frontend-v2/package.json`, `frontend-v3/package.json`, and `frontend*/vite.config.ts`.
   - Inspect `start.ps1` and `start.bat` at `/home/antigravity/Pibaps/AMDataWrap`.
2. **V2 animation-reset & Galaxy 3D root causes:**
   - Inspect `frontend-v2/src/store/AppContext.tsx:127-140` (`playPreview` depends on `playingTrack`).
   - Inspect `frontend-v2/src/components/three/SonicGalaxy3D.tsx:288` (`useEffect` depends on `[galaxyData, playPreview]`), lines `271-273` (per-frame `new THREE.Vector3`, no dimming), lines `311-327` (static `pointer-events-none` genre pills).
   - Inspect `frontend-v2/src/components/wrapped/SonicOdysseyWrapped.tsx:190` (duplicate `AmbientNebulaCanvas`).
3. **V3 Unified Canvas & reusable modules:**
   - Inspect `frontend-v3/src/components/UnifiedObservatoryCanvas.tsx:288,358-408,469` and `frontend-v3/src/pages/{Observatory3DPage,ScienceLabPage,AtlasAndGraphPage,ContinuumHubPage}.tsx`.
   - Inspect `frontend-v3/src/workers/{audioDna,fftCanvas}.worker.ts` and `frontend-v3/src/components/FtsSearchModal.tsx`.
4. **VM Node & Browser environment:**
   - Run:
     ```bash
     node -v && npm -v && /usr/bin/chromium --version && ls -d frontend*/node_modules ~/.cache/ms-playwright 2>&1 || true
     ```
5. **Invalidation conditions:**
   - If Phase 1 backend changes endpoint URLs or WebSocket paths from `PLAN_V4_FINAL.md`, update `frontend-v4/src/api/client.ts` and `src/playback/` accordingly before Phase 2 parallel fan-out.
