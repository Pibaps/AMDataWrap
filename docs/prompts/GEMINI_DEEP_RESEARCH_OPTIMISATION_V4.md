# Prompt Gemini Deep Research — Optimisation Extrême WebGL / Three.js / React 19 (< 150–200 Mo RAM, < 2% GPU idle, 60 FPS) & Patterns Claude Fable 5.2 / Opus 5.5

## 1. Contexte Fonctionnel et Architecture Technique du Projet (`AMDataWrap V4`)

Je développe **AMDataWrap V4 ("Salon d'écoute")**, une application web locale d'analyse musicologique et d'écoute interactive construite autour d'un **salon d'écoute vinyle 3D temps réel** et de **11 vues analytiques éditoriales** (Synthèse, Classements, Chronobiologie/Rythmes, Portrait/Persona, Habitudes/Skips, Science Musicale Eddington/Gini/Lorenz/Shannon/PELT, Atlas géographique, Constellation de co-occurrence, Recherche plein-texte FTS5, Wrapped, Import multi-plateformes).

### Stack Technique Exacte
- **Frontend (`frontend-v4/`, port `5176`)** :
  - **React 19.0** + **TypeScript 5.7** + **Vite 6.2** + **Tailwind CSS v4** (`@tailwindcss/vite`, zéro `backdrop-filter` pour éviter la surcharge du compositeur GPU).
  - **Three.js `0.174.0`** (`WebGLRenderer` + `CSS3DRenderer` / `CSS3DObject` + `OrbitControls` + `RoomEnvironment` PMREM + `RoundedBoxGeometry`) + **GSAP `3.12.7`** pour les interpolations.
  - **Zustand `5.0.3`** pour l'état global UI + une horloge de lecture mutable hors React (`playbackClock.ts`) pour éviter les re-renders à 60 Hz.
  - **Audio & Lecture Hybride** : API officielle **YouTube IFrame JS (`window.YT.Player`)** montée dans un `CSS3DObject` via `React.createPortal` directement sur le châssis 3D du tourne-disque + fallback HTML5 `<audio>` 30s + moteur de bruitages mécaniques procéduraux **Web Audio API** (`AudioContext`, oscillateurs, buffers de bruit rose/craquements vinyle).
- **Backend (`backend/`, port `8000`)** :
  - **FastAPI** (Python 3.12, Uvicorn) + **SQLite en mode WAL** (`data/amdatawrap.sqlite`, index **FTS5 `unicode61`**) + **DuckDB / Parquet** (`data/analytics_snapshot.parquet`) pour les agrégations analytiques lourdes.
  - Volume de données réel en base : **37 339 lignes brutes** issues de l'export RGPD Apple Music (`17 439` écoutes audio, `3 974` titres uniques, `1 725` albums uniques, `1 187` artistes uniques, `1 120` sessions).
  - Proxies locaux FastAPI : `/api/artwork-proxy` (redimensionnement Pillow à la volée en WebP/JPEG avec CORS) et `/api/audio-proxy`.

### Structure Actuelle de la Scène 3D (`src/scene/PersistentStageCanvas.tsx` & `src/scene/textures.ts`)
- Un canvas Three.js unique monté à la racine de `App.tsx` (qui ne se démonte jamais lors des changements d'onglets et met en pause sa boucle `requestAnimationFrame` quand `activeTab !== "studio"`).
- La scène 3D contient :
  1. Une pièce d'écoute (crédence en noyer, mur en plâtre, panneau acoustique en lattes de bois `InstancedMesh`, lampe en laiton avec `SpotLight` + `PCFSoftShadowMap` 512×512, `HemisphereLight`, `DirectionalLight`, `PointLight`, `RoomEnvironment` PMREM).
  2. Un tourne-disque direct-drive détaillé (type Technics SL-1200 MK II) : châssis `RoundedBoxGeometry`, plateau rotatif avec stroboscope, vinyle 12" avec texture de sillons générée sur `<canvas>` 2D (`createConicGradient` + arcs proportionnels aux durées des pistes) et macaron central, bras de lecture en S (`TubeGeometry`), boutons physiques cliquables par raycasting (`START/STOP`, `33/45 RPM`, `POWER`, fader linéaire de volume glissable `0–100%`), capot en acrylique fumé articulé, et écran OLED `CSS3DObject` intégrant l'iframe YouTube en perspective 3D avec back-face culling.
  3. Un bac à vinyles en chêne contenant 20 pochettes 3D individuelles (`BoxGeometry` avec 6 matériaux par pochette, textures de pochettes chargées via `/api/artwork-proxy?w=256&fmt=webp` et dessinées sur des `<canvas>` 256×256 convertis en `THREE.CanvasTexture`), feuilletables physiquement avec inclinaison animée dans la boucle RAF, plus un groupe d'inspection 3D Recto/Verso (texture verso 512×512 générée sur `<canvas>` avec tracklist et code-barres).

---

## 2. Problème à Résoudre & Objectifs Chiffrés

Bien que le temps de chargement initial ait été réduit, **l'empreinte mémoire (RAM navigateur + VRAM GPU) et la consommation CPU/GPU en rotation continue dans la scène 3D restent trop élevées** (notamment à cause de la coexistence WebGL + CSS3DRenderer + YouTube IFrame + 20×6 matériaux/textures CanvasTexture + boucle RAF permanente + ombres dynamiques + raycasting sur `pointermove`).

**Cibles de performance strictes :**
1. **Empreinte RAM totale de l'onglet navigateur ≤ 150–200 Mo** (contre plusieurs centaines de Mo à >1 Go lorsque les textures Canvas 2D, les bitmaps décodés, l'iframe YouTube et les buffers WebGL s'accumulent).
2. **Consommation GPU/CPU proche de 0 % au repos** (quand le plateau ne tourne pas et que la caméra est immobile) et **< 15 % sur GPU intégré à 60 FPS** quand le plateau tourne.
3. **Zéro micro-stutter (0 frame drop > 16.6 ms)** lors du chargement des pochettes, du feuilletage du bac ou du retournement Recto/Verso.

---

## 3. Axes de Recherche Attendus dans le Rapport Deep Research

Fais une recherche approfondie et fournis des **solutions d'implémentation concrètes en code TypeScript / Three.js r174 / React 19** sur les 6 axes suivants :

### Axe 1 — Pratiques d'optimisation front/WebGL avancées (Patterns "Claude Fable 5.2" & "Claude Opus 5.5")
- Quelles sont les architectures et patterns de code privilégiés par les modèles de génération de code les plus récents (**Claude Fable 5.2**, **Claude Opus 5.5**) pour produire des scènes Three.js / WebGL2 / WebGPU ultra-légères à "zéro allocation par frame" (*zero-GC RAF loops*, *on-demand rendering*, *dirty-flag invalidation*, *single-atlas instancing*, *procedural fragment shaders vs CanvasTexture*) ?
- Comment structurer la boucle de rendu pour qu'elle fonctionne en **rendu à la demande (`demand-driven rendering`)** lorsque le vinyle est à l'arrêt, et qu'elle réduise automatiquement la fréquence ou la résolution de certaines passes (ombres, CSS3D, raycasting) lorsque seul le plateau tourne ?

### Axe 2 — Éradication de l'explosion RAM/VRAM des `CanvasTexture` dans Three.js
- Dans Three.js, créer 20 à 30 `new THREE.CanvasTexture(canvas)` conserve en mémoire vive le DOM `<canvas>` 2D complet **en plus** de la texture uploadée en VRAM GPU.
- Compare précisément :
  1. L'utilisation de `createImageBitmap(blob, { resizeWidth: 256, resizeHeight: 256 })` + `THREE.Texture(imageBitmap)` suivi de `imageBitmap.close()` après `renderer.initTexture(tex)` (pour libérer 100 % de la RAM CPU une fois la texture en VRAM !).
  2. Le remplacement des 20 meshes de pochettes (actuellement 20 × 6 matériaux = 120 slots matériaux) par un **`THREE.InstancedMesh` ou `THREE.BatchedMesh` (Three.js r174)** utilisant une **Texture Atlas unique (`DataArrayTexture` / `WebGLArrayTexture` ou grille UV 2048×2048)**.
  3. Le remplacement des textures procédurales Canvas 2D (bois, plâtre, micro-sillons vinyle anisotropes, stroboscope) par des **shaders GLSL analytiques légers (`onBeforeCompile` ou `ShaderMaterial`)** qui consomment **0 Mo de VRAM texture**.

### Axe 3 — Optimisation des Ombres, de l'Éclairage (PMREM) et du Raycasting
- `RoomEnvironment` + `PMREMGenerator` et `SpotLight` avec `PCFSoftShadowMap` recalculée à chaque frame à 60 FPS coûtent cher en VRAM et fill-rate.
- Comment figer la shadow map (`renderer.shadowMap.autoUpdate = false` + `renderer.shadowMap.needsUpdate = true` uniquement quand le couvercle, une pochette ou le bras bouge, puisque la rotation axiale d'un disque cylindrique ne change pas son ombre portée !) et remplacer l'ombre sous les objets par des *contact shadows* ou AO analytiques ?
- Comment throttler et optimiser le `Raycaster` sur `pointermove` (BVH `three-mesh-bvh`, bounding spheres pré-filtrées, exécution uniquement lors d'un vrai déplacement souris hors rotation plateau) ?

### Axe 4 — Coexistence Ultra-Légère `WebGLRenderer` + `CSS3DRenderer` + YouTube IFrame
- Un `<iframe>` YouTube complet charge à lui seul un sous-arbre DOM/JS Chromium lourd (~60 à 120 Mo de RAM).
- Comment implémenter un pattern **"Facade / Lazy IFrame Mount"** sur l'écran `CSS3DObject` de la platine pour que l'iframe YouTube ne soit instanciée qu'au premier clic sur `START`, ou détruite / mise en veille mémoire quand on repasse en mode `Extrait 30s` ?
- Comment éviter que `css3dRenderer.render(css3dScene, camera)` ne recalcule et ne réécrive les styles CSS `matrix3d(...)` du DOM à 60 FPS lorsque la caméra `OrbitControls` est immobile (`controls.addEventListener('change', ...)`) ?

### Axe 5 — Optimisation Mémoire Web Audio API & Backend FastAPI
- Dans `vinylFoley.ts`, comment pré-allouer un unique pool de petits `AudioBuffer` (ou un `AudioWorklet` / générateur de bruit déterministe) au lieu d'allouer un nouveau `ctx.createBuffer(...)` de 4 secondes à chaque activation du grain vinyle ?
- Côté FastAPI (`backend/`), comment réduire l'empreinte RAM du processus Python (~280 Mo actuellement à cause de DuckDB/Pillow/caches) via la configuration de `duckdb` (`memory_limit`, fermeture immédiate des connexions in-memory après requête Parquet) et un cache HTTP `Cache-Control: public, max-age=604800, immutable` sur `/api/artwork-proxy` pour que le navigateur ne redemande jamais les miniatures WebP ?

### Axe 6 — Plan de Refactoring Step-by-Step Prêt à Appliquer
- Fournis un plan d'action classé par **gain de RAM (Mo économisés)** et **gain GPU (% économisé)**, avec les extraits de code exacts prêts à être intégrés dans :
  - `frontend-v4/src/scene/PersistentStageCanvas.tsx`
  - `frontend-v4/src/scene/textures.ts`
  - `frontend-v4/src/components/HybridPlaybackDeck.tsx`
  - `frontend-v4/src/audio/vinylFoley.ts`
  - `backend/app/main.py`
