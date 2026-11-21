# AMDataWrap V4.1 — Plan Technique & Feuille de Route Parallèle

> **Statut :** Prêt pour validation · **Date :** 2026-11-21  
> **Version actuelle intacte :** V4.0 (`main`, `frontend-v4/`, port `5176`)  
> **Cible :** V4.1 développée en parallèle sans écraser V4.0  
> **Référence Perf :** [Optimisation Extrême Three.js et FastAPI.pdf](file:///e:/Documents/Programming/Drafting/AMDataWrap/docs/references/Optimisation%20Extr%C3%AAme%20Three.js%20et%20FastAPI.pdf) *(les listings complets p. 16–46 ne sont pas recopiés ici pour économiser les tokens ; chaque section renvoie aux pages exactes et mappe directement sur nos vrais fichiers et symboles).*

---

## 0. Isolation Parallèle (Zéro Écrasement de V4.0)

- **`main` (`frontend-v4/`, port `5176`)** reste strictement intouchée (V4.0 de référence).
- **Branche dédiée `feat/v4.1`** montée dans un **`git worktree` parallèle** (ex. `../AMDataWrap-v4.1/`, Vite sur le port **`5177`**), partageant la base SQLite/Parquet locale en lecture.
- **Intérêt** : possibilité d'ouvrir `:5176` (V4.0) et `:5177` (V4.1) côte à côte dans Chrome pour comparer visuellement le Salon 3D et mesurer `Shift + Esc` (RAM) + DevTools (FPS/GPU).
- **Dépendance npm à ajouter dans `frontend-v4/package.json`** : `three-mesh-bvh` (pour le raycasting accéléré sur les géométries denses uniquement).

---

## 1. Optimisation Extrême RAM / GPU (Mapping Exact PDF → Codebase)

### Tableau des budgets cibles (PDF p. 1–2, 13–15)
| Métrique | V4.0 Actuel | Cible V4.1 | Levier principal |
| :--- | :---: | :---: | :--- |
| **RAM Onglet (repos / hors YT)** | ~250–650+ Mo | **95–120 Mo** | Façade YouTube + `ImageBitmap.close()` + shaders GLSL |
| **RAM Onglet (YT actif → pause > 45 s)** | Pic permanent | **165–210 Mo → < 120 Mo** | Hibernation auto + cleanup React 19 `about:blank` |
| **Draw calls bac à vinyles** | **120** (`20 × 6`) | **1 (-99,2 %)** | `InstancedMesh` + `DataArrayTexture` GPU-only |
| **GPU Idle (platine arrêtée)** | Continu (~60 Hz) | **< 2 % (0 Hz)** | Planificateur demand-driven 4 voies auto-endormant |
| **RSS Backend FastAPI** | ~280 Mo | **90–130 Mo** | DuckDB éphémère 64 Mo + Pillow `draft()` + `ETag`/`immutable` |

---

### 1.1 Backend FastAPI — `backend/app/analytics/duckdb_engine.py` & `backend/app/main.py` (PDF p. 11–12, 43–47)

1. **Confinement DuckDB (`backend/app/analytics/duckdb_engine.py:188-202`, `query_parquet`)** :
   - **Problème actuel** : `duckdb.connect(database=":memory:")` sans limite → DuckDB s'alloue 80 % de la RAM physique et 1 thread par cœur CPU.
   - **Fix V4.1** : ouvrir la connexion éphémère avec :
     - `config={"memory_limit": "64MB", "threads": 2, "preserve_insertion_order": False, "temp_directory": str(DUCKDB_SPILL_DIR)}`
   - **Lifespan (`backend/app/main.py`)** : sur Linux 64-bit uniquement (`platform.system() == "Linux"`), exécuter une seule fois au démarrage `SET GLOBAL allocator_background_threads = true;` + `SET GLOBAL allocator_flush_threshold = '16MB';`.
   - **Piège PDF p. 11** : ne **jamais** utiliser `RESET SESSION allocator_background_threads` (bug DuckDB qui coupe le thread de purge pour tout le processus).

2. **Proxy Artwork (`backend/app/main.py:267-325`, `artwork_proxy`)** :
   - **Problèmes actuels** : crée un `httpx.AsyncClient` par requête ; pas d'`ETag`/304 ; pas de `img.draft()` ; `Cache-Control` limité à `86400` sans `immutable`.
   - **Fix V4.1** (tout en **conservant** la whitelist actuelle d'origines autorisées : `https://is`, `dzcdn.net`, `coverartarchive.org`, `i.scdn.co`, `i.ytimg.com`, etc.) :
     - Mutualiser un `httpx.AsyncClient(timeout=8.0, limits=httpx.Limits(max_connections=12, max_keepalive_connections=4))` fermé proprement dans le `lifespan`.
     - Calculer un **`ETag` déterministe** `blake2b(f"{url}|{w}|{fmt}")` → retourner `Response(status_code=304)` immédiat si `If-None-Match == etag` sans toucher au réseau ni à Pillow.
     - Dans `_transform` (exécuté via `run_in_threadpool` / `asyncio.to_thread`) : si `im.format in ("JPEG", "MPO")` et `w`, appeler **`im.draft("RGB", (w, w))`** avant le décodage pour exploiter la réduction DCT native et couper le pic RAM `Storage.c`, puis `im.thumbnail((w, w), Image.Resampling.LANCZOS)`.
     - Émettre `Cache-Control: public, max-age=604800, immutable` + `ETag`.
     - **Piège PDF p. 12** : ne jamais décorer un endpoint `async def` avec `@lru_cache`.

---

### 1.2 Pipeline Textures GPU-Only & Shaders GLSL — `frontend-v4/src/scene/textures.ts` (PDF p. 5–8, 15–23)

1. **Bac à vinyles (`DataArrayTexture` GPU-only + `InstancedMesh`)** :
   - Remplacer les 20 `BoxGeometry × 6 MeshStandardMaterial + 20 CanvasTexture` (120 draw calls, ~15–45 MiB RAM CPU + Skia) par **1 seul `InstancedMesh`** + **`THREE.DataArrayTexture(null, 384, 384, 20)`** (`source.dataReady = false`, `anisotropy = Math.min(4, maxAniso)`).
   - **Résolution validée** : `384×384×20` dans le bac (~15 MiB VRAM, **0 MiB RAM CPU** grâce à `bitmap.close()`, bien plus net que `256px` sans aucune rétention CPU).
   - Upload progressif par paliers de 4 pochettes (`uploadCoverToArraySlot` + `regenerateArrayMipmaps` en fin de palier) pour zéro micro-stutter (> 16,6 ms).
   - **Pièges Three.js r174 (PDF p. 7 & 17)** :
     - `Texture.flipY` et `premultiplyAlpha` sont **ignorés** par WebGL pour un `ImageBitmap` → passer impérativement `{ imageOrientation: 'flipY', premultiplyAlpha: 'none', resizeWidth, resizeHeight, resizeQuality: 'medium' }` à `createImageBitmap()`.
     - Signature r174 exacte : `renderer.copyTextureToTexture(tempTex, arrayTex, null, _dstPos, 0)` puis `tempTex.dispose()` et `bitmap.close()` dans `finally`.
     - Ne **jamais** remettre `tex.needsUpdate = true` après `bitmap.close()` (`INVALID_VALUE: source detached`) ; gérer `webglcontextrestored` en rechargeant depuis le cache HTTP `immutable` (`cache: 'force-cache'`).

2. **Netteté HD Inspection & Chevalet (*Now Playing*)** :
   - Fonction `loadZeroRamTexture(renderer, url, size = 1024)` (ou `768`) utilisant `createImageBitmap` → `renderer.initTexture(tex)` → `bitmap.close()` (**0 MiB RAM CPU**).
   - Utilisée **uniquement** pour la pochette posée sur le chevalet et la pochette en inspection (`INSPECT`), avec `.dispose()` systématique dès changement d'album ou fermeture de l'inspecteur.
   - Verso d'inspection (`createEphemeralVersoTexture`, `512×512` ou `768×768`) : généré à la demande sur `OffscreenCanvas` (flip vertical manuel `ctx.translate(0, size); ctx.scale(1, -1)` avant `transferToImageBitmap()`) → `renderer.initTexture(tex)` → `bitmap.close()`, détruit par `.dispose()` à la fermeture de l'inspecteur.

3. **Shaders GLSL Analytiques (`0 Mo VRAM`, netteté infinie — PDF p. 8, 21–23)** :
   - Remplacer les `CanvasTexture` permanents (`makeGrooveMaps`, `makeStrobeTexture`, textures bois noyer et plâtre) par des injections `onBeforeCompile` sur `MeshStandardMaterial` avec **`material.customProgramCacheKey()` unique par variante** :
     - **Vinyle 12"** (`createProceduralVinylMaterial`) : `uniform float uTrackStops[16]` + `uniform int uStopCount` alimentés par les rayons normalisés des vraies pauses inter-pistes de la face active ; micro-sillons `sin(r * 1450.0)` + **reflet anisotrope en sablier** (`pow(abs(sin(angle * 2.0 + 0.45)), 3.5)`) sous la lampe en laiton → **rendu nettement supérieur au Canvas2D actuel**.
     - **Crédence en noyer** (`createProceduralWalnutMaterial`), **mur en plâtre** (micro-bruit rugosité) et **points stroboscopiques du plateau** (step sur angle polaire).

---

### 1.3 Moteur Demand-Driven 4 Voies, Ombres Gelées, PMREM & Raycaster — `PersistentStageCanvas.tsx` (PDF p. 3–4, 8–11, 24–33)

1. **Planificateur 4 voies (`DIRTY_WEBGL`, `DIRTY_CAMERA`, `DIRTY_SHADOW`, `DIRTY_RAYCAST`)** :
   - Boucle RAF auto-endormante : si `!isSpinning && !dampingActive && !hasActiveTween && dirtyFlags === 0`, ne replanifie **aucun** `requestAnimationFrame` (**0 Hz / < 2 % GPU**).
   - **Piège OrbitControls zoom molette (PDF p. 4)** : `controls.update()` ne retourne `true` que pour l'amortissement d'orbite/pan, pas pour un zoom isolé → brancher `controls.addEventListener('change', () => invalidate(DIRTY_WEBGL | DIRTY_CAMERA))` en plus de `start`/`end`.
   - **Scratchpads zéro-GC** pré-alloués hors boucle : `_pointerNdc`, `_raycaster`, `_hits[]`, `_camForward`, `_oledNormal`, `_oledQuat`, `_lastCamMatrix` (`Float32Array(16)`), `_dummy`, `_localPt`.
   - **CSS3DRenderer événementiel** : n'appeler `css3dRenderer.render()` et le dot-product de back-face culling **que** sur `DIRTY_CAMERA` ET si au moins un des 16 coefficients de `camera.matrixWorldInverse.elements` a varié de `> 1e-5` → **0 écriture DOM `matrix3d` pendant la rotation du vinyle**.

2. **WebGLRenderer, Ombres & PMREM** :
   - `pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)` (économie jusqu'à **110,7 MiB** de framebuffer MSAA vs DPR 2.0), `stencil: false`, `preserveDrawingBuffer: false`, `powerPreference: 'default'`.
   - `renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;` — réveiller `DIRTY_SHADOW` uniquement sur animation du capot, mouvement du bras, feuilletage du bac, sortie/retournement disque ou inspection.
   - Désactiver `receiveShadow` sur boutons, stroboscope, `InstancedMesh` du bac et lattes acoustiques ; désactiver `castShadow` sur plateau et vinyle ; ombres de contact analytiques douces (`exp(-k * r²)`) sous les pieds/bac/lampe ; consolider les lumières (`RoomEnvironment` + 1 `SpotLight` + 1 `HemisphereLight`).
   - **PMREM** : appeler `roomEnv.dispose()` et `pmrem.dispose()` immédiatement après `pmrem.fromScene(roomEnv, 0.04)` (-3 MiB VRAM temporaires). Au unmount, appeler **`envRT.dispose()`** (jamais `envRT.texture.dispose()`).
   - **Précompilation asynchrone** : `renderer.compileAsync(scene, camera)`.

3. **Raycasting zéro-GC + `three-mesh-bvh` ciblé** :
   - Cadence ≤ 30 Hz (`now - lastRaycastTs >= 33`), déclenché uniquement si pointeur déplacé ≥ 2 px hors drag caméra (`!isOrbiting`).
   - Pré-test rapide `_raycaster.ray.intersectsSphere(interactiveClusterSphere)` avant `intersectObjects(interactiveTargets, false, _hits)`.
   - Appeler `geometry.computeBoundsTree()` **uniquement** sur les géométries denses (> 500 tris : bras en S `TubeGeometry`, châssis `RoundedBoxGeometry`).

---

### 1.4 Façade YouTube Lazy Mount & Cleanup React 19 — `HybridPlaybackDeck.tsx` (PDF p. 10, 33–38)

- **Façade légère (< 1 Mo)** sur l'écran OLED tant que YouTube n'est pas lancé (`preconnect` vers `youtube-nocookie.com` et `i.ytimg.com` au premier `onPointerEnter`).
- **Montage paresseux + réutilisation** : charger `iframe_api` et instancier une unique instance `YT.Player` (`host: 'https://www.youtube-nocookie.com'`) au premier Play YouTube ; sur changement de piste, réutiliser `player.loadVideoById(vid)`.
- **Hibernation & destruction anti-fuite React 19** : après **45 s de pause**, `POWER OFF`, ou passage sur source Externe/Extrait 30 s, démonter l'hôte ; la fonction de cleanup de `ref` callback React 19 exécute impérativement :
  `player.stopVideo()` → `iframe.src = 'about:blank'` → `player.destroy()` → `node.replaceChildren()`.
- **Correctif critique lecture hors onglet `Salon 3D` (fix des boutons Play des 11 onglets)** :
  - Actuellement `#turntable-css3d-screen` est dans le canvas 3D qui est masqué quand `activeTab !== 'studio'`. Dans Chromium, une iframe YouTube dans un conteneur `display: none` refuse l'autoplay ou ne déclenche pas `onReady`.
  - **Fix V4.1** : lorsque `activeTab !== 'studio'`, maintenir le conteneur de l'hôte YouTube hors-écran visible au compositeur (`position: fixed; left: -9999px; width: 240px; height: 126px; opacity: 0.01; pointer-events: none`) ou portaliser dynamiquement entre un hôte offscreen permanent et `#turntable-css3d-screen` sans jamais détruire l'instance pendant la lecture !

---

### 1.5 Synthèse Vinyle AudioWorklet — `frontend-v4/src/audio/vinylFoley.ts` (PDF p. 11, 39–43)

- Remplacer les `AudioBuffer` 4 s stéréo (`1 500 KiB` réalloués) par un **`AudioWorklet`** inline chargé via `Blob` (`type: 'application/javascript'`, révoqué par `URL.revokeObjectURL()` sitôt chargé — contourne le bug MIME `video/mp2t` de Vite sur `.ts?url`).
- Filtre bruit rose raffiné de **Paul Kellet** (7 flottants `b0..b6`, `512 octets` par quantum de 128 samples) + générateur de micro-craquements déterministe.
- Fallback mono 2 s unique (`375 KiB`) + pool unique pour les transitoires mécaniques courts (`40 ms ≈ 7,5 KiB`) + `ctx.suspend()` automatique 400 ms après arrêt du grain.

---

## 2. Tourne-Disque & Interactions 3D (`Salon 3D`)

### 2.1 Agrandissement & Recalibrage Spatial (Zéro Chevauchement)
- **Constat actuel (`PersistentStageCanvas.tsx:530-960`)** : châssis trop compact → chevauchements entre le plateau (`R=1.56`), le contrepoids/bras en S (`sCurve` longueur `2.02`), les boutons (`START/STOP`, `33/45`, `POWER`), le fader `VOLUME` et le capot (`lidH = 0.54`).
- **Refonte V4.1** :
  - Agrandir le châssis (`PLINTH_W`, `PLINTH_D`) de ~18–22 % et relever `lidH` (`0.54 → 0.68`) pour donner une vraie respiration mécanique entre :
    - Zone gauche : plateau + vinyle 12" + boutons `POWER` / `START·STOP` / `33` / `45` (clairement dégagés du rebord stroboscopique).
    - Zone droite : embase cardan + contrepoids (dégagé de la paroi arrière du capot même bras posé) + bras en S + porte-cellule + fader linéaire `VOLUME` (dégagé du bras au repos).
  - Réajuster proportionnellement : les 4 pieds amortisseurs, la crédence en noyer, le chevalet *Now Playing*, le bac à vinyles, la lampe et les 5 presets caméra (`Salon`, `Platine`, `Bac`, `Pochette`, `Free Cam`).

### 2.2 Changement de Piste Intuitif (Double Approche)
- **Needle Drop 3D** : clic direct sur la couronne de sillons (`GROOVE_INNER_R`..`GROOVE_OUTER_R`) → `findTrackAtRadius()` calcule la piste exacte d'après les durées réelles de la face active, déplace le bras en S sur ce rayon et lance la lecture.
- **Navigation Suivante / Précédente** :
  - Ajout d'actions `nextVinylTrack()` / `prevVinylTrack()` partagées (dans `useV4Store` / `playTrack.ts`).
  - Raccourcis clavier (`J`/`K` ou `←`/`→` lorsque focus platine / hors saisie texte) + petits contrôles discrets « Piste précédente / suivante » dans le HUD du Salon 3D et le dock audio.

### 2.3 Retournement 3D Physique + Vraies Données + Double LP Gatefold (2 Disques)
- **Vérification Backend (`backend/app/vinyl_enrichment.py:525-613`)** :
  - `/api/v4/vinyl/{album_key}` renvoie déjà `sides` (Face A/B/C/D) et `disc_count = max(1, (len(sides) + 1) // 2)`.
  - Vérifier `_synthesize_sides_from_catalog(tracks)` pour garantir que les albums longs (> ~44 min ou > 12 titres sans pressage MusicBrainz) découpent proprement en **2 disques (Faces A/B + C/D)** avec vraies durées et `track_key` préservés.
- **Animation 3D de retournement sur le plateau** (clic sur le macaron central ou double-clic vinyle) :
  1. Si lecture active, mise en pause + levée fluide du bras en S vers son repos (`DIRTY_SHADOW`).
  2. Le groupe vinyle (`recordMesh` + macaron) se soulève en `Y`, pivote à 180° autour de `Z`/`X` (animation GSAP `~0.65 s` fluide + foley), puis se repose sur la feutrine.
  3. Mise à jour instantanée des uniforms GLSL `setTrackStops(newSideStops)` et de la texture du macaron (Face B / Face D), puis reprise de lecture sur la piste 1 de la nouvelle face.
- **Double LP (`disc_count >= 2`, 3 ou 4 faces) — Pochette Gatefold qui se déplie + 2 Disques Physiques** :
  - Nouveau champ store `activeDiscIndex: 0 | 1` (`0` = LP 1 Faces A/B, `1` = LP 2 Faces C/D).
  - En mode `INSPECT`, si `inspected.disc_count >= 2` :
    - La pochette 3D est constituée de **deux volets articulés** (`leftWingPivot` + `rightWingPivot`) qui se déplient fluidement en **Gatefold** (avec intérieur imprimé / tracklist A/B à gauche et C/D à droite).
    - **Deux disques distincts** sont logés dans les deux poches (`LP 1 · Faces A/B` et `LP 2 · Faces C/D`). Cliquer sur l'un ou l'autre le fait glisser proprement hors de sa pochette et permet de le poser directement sur la platine.

### 2.4 Verrouillage Physique Strict sous Capot Fermé (`lidOpen === false`)
- **Constat actuel (`PersistentStageCanvas.tsx:1250-1259`)** : `filterValidHit()` ne bloque rien quand `lidOpen === false`.
- **Fix V4.1** :
  - Définir l'ensemble `UNDER_LID_ACTIONS = new Set(["groove-seek", "flip-disc-side", "toggle-start", "rpm-33", "rpm-45", "power-toggle", "volume-fader", "stylus-light"])`.
  - Si `!st.lidOpen` :
    - Au survol : curseur bloqué / hint explicite *« Capot fermé · Cliquer sur la poignée pour ouvrir »*.
    - Au clic sur le capot ou un élément dessous : bloquer l'action, jouer un léger bruit sourd acrylique (`playLidBlocked`) et afficher un court toast discret.
  - Les contrôles hors capot (poignée du capot, lampe, bac à vinyles, chevalet, **et toute la barre audio UI inférieure : Play/Pause, timeline/slider, pistes**) restent toujours utilisables.

---

## 3. Pilotage Gratuit Multi-Plateformes (YouTube + Apple Music / Spotify / Deezer)

- **Zéro clé payante** : on garde **YouTube Music gratuit** comme lecteur intégré par défaut pour tout le monde.
- **Pilotage gratuit d'onglet ouvert via `extensions/amdatawrap-bridge/` (WebSocket `/ws/bridge`)** :
  - Déjà présents : `content-apple.js` (`music.apple.com`), `content-spotify.js` (`open.spotify.com`), `content-ytm.js` (`music.youtube.com`).
  - **Ajout V4.1** : `content-deezer.js` (`https://www.deezer.com/*`) + ajout dans `manifest.json` (`host_permissions` et `content_scripts`) + support bidirectionnel (`play`, `pause`, `seek`, `next`, `prev`, `play_track` recherche/lecture).
- **Intégration UI claire dans `HybridPlaybackDeck.tsx`** :
  - Sélecteur simple et lisible dans le dock audio :
    - **YouTube (Intégré · Gratuit)**
    - **Mon onglet ouvert** *(Apple Music / Spotify / Deezer — badge vert si l'extension détecte un onglet actif, sinon popover guidé en 3 étapes pour charger `extensions/amdatawrap-bridge/`)*.
  - Lorsque le mode « Mon onglet ouvert » est actif, les boutons Play/Pause/Seek/Suivant/Précédent et les clics sur la platine 3D envoient les commandes au bridge `/ws/bridge` (et l'iframe YouTube reste démontée = **0 Mo RAM**).

---

## 4. Simplification de l'Onglet « Archives » (`frontend-v4/src/views/pages/HubPage.tsx`)

- **Vue « Essentiel » par défaut (grand public)** :
  1. **Importer mes écoutes** : carte claire avec glisser-déposer (Apple Music RGPD `.zip`/`.csv`, Spotify JSON, CSV personnalisé) et étapes illustrées sans jargon.
  2. **Mes profils & sauvegardes** : sélection/création de profil simplifiée.
  3. **Écoute en direct (en réserve pour l'hébergement futur)** : encart discret expliquant que le suivi en direct est mis de côté pour la future version hébergée (piste **scrobbles gratuits type ListenBrainz / Last.fm**), sans supprimer le code backend ni les endpoints existants.
- **Tiroir repliable `Options avancées / Technique`** tout en bas (fermé par défaut) contenant : matrice de capacités, paramètres ISRC ±180s, détails Extension MV3, Webhooks, LAN QR, diagnostics.

---

## 5. Vulgarisation par Infobulles `?` & Audit/Fix des Boutons dans les 11 Onglets

### 5.1 Composant `<InfoTooltip />` (`frontend-v4/src/components/ui.tsx`)
- Icône `?` discrète (14 px, teinte `ink-3`, hover `amber`) placée à côté des intitulés techniques sans modifier les titres existants ni l'esthétique *Liner Notes*.
- Infobulle CSS pure (zéro `backdrop-filter`), accessible au survol et au focus clavier (`aria-label` + `role="tooltip"`).
- **Termes couverts** :
  - **Science (`SciencePage.tsx`)** : Nombre d'Eddington, Indice de Gini, Courbe de Lorenz, Entropie de Shannon (bits & perplexité), Demi-vie d'écoute, Transitions de Markov, Détection de rupture PELT, Roue de Camelot.
  - **Habitudes (`BehaviorPage.tsx`)** : Lift × (affinité), Télémétrie du lecteur / Causes de fin de piste (`NATURAL_END`, `SKIP`, etc.).
  - **Portrait (`PersonaPage.tsx`)** : Âge de cristallisation, indices de découverte/fidélité.

### 5.2 Audit & Réparation de Tous les Boutons (`Play`, Filtres, Navigation)
- **Diagnostic** :
  1. Correctif YouTube offscreen hors onglet `Salon 3D` (cf. §1.4) pour que `playTrack()` déclenche systématiquement le son réel depuis n'importe lequel des 11 onglets.
  2. Vérifier chaque appel `playTrack(...)` dans `OverviewPage`, `TopsPage`, `BehaviorPage`, `GalaxyPage`, `SearchPage`, `WrappedPage` (champs `song_name`, `artist_name`, `album_name`, `track_key`, `duration_ms`, `artwork_url`) + ajouter `PlayButton` là où il manque sur les titres/albums cliquables.
  3. Synchroniser optionnellement l'album sur la platine en arrière-plan (`setOnPlatter`) sans changer `activeTab`.
  4. Ajouter un petit bouton discret **`Voir sur la platine`** dans la barre audio inférieure (visible quand `activeTab !== 'studio'` et qu'un titre joue) pour basculer dans le Salon 3D en un clic.

---

## 6. Ordre d'Exécution & Protocole de Validation (V4.0 vs V4.1)

| Phase | Contenu | Critère de sortie |
| :---: | :--- | :--- |
| **P0** | Création branche `feat/v4.1` + `git worktree` (port `5177`) + `npm i three-mesh-bvh` | V4.0 (`:5176`) intacte, V4.1 (`:5177`) démarre |
| **P1** | Backend : DuckDB éphémère 64 Mo, Pillow `draft()` + `ETag`/`immutable`, vérification `/api/v4/vinyl/{album_key}` Double LP | RSS backend 90–130 Mo, 304 sur artwork-proxy |
| **P2** | Perf Front : `HybridPlaybackDeck` (Façade + offscreen fix + cleanup React 19), `vinylFoley` (AudioWorklet), `textures.ts` (`DataArrayTexture` 384px + `1024px` inspect/chevalet + GLSL vinyle/noyer/plâtre/strobe) | `textures <= 6`, 0 `CanvasTexture` permanent |
| **P3** | Scène 3D : Demand-driven 4 voies + agrandissement platine sans chevauchement + verrouillage capot fermé + needle drop & J/K + retournement 3D + Double LP Gatefold 2 disques | `calls < 35`, GPU idle < 2 %, 0 chevauchement |
| **P4** | Bridge MV3 : `content-deezer.js` + sélecteur clair « YouTube intégré / Mon onglet ouvert » | Pilotage Apple Music / Spotify / Deezer 0 € |
| **P5** | UX & Tabs : `HubPage` simplifié (direct mis de côté), `<InfoTooltip />` `?`, audit & fix de tous les boutons `Play` des 11 onglets + bouton « Voir sur la platine » | 100 % des boutons Play déclenchent l'audio |
| **P6** | Validation instrumentée : `window.__AMDW_STATS()`, Chromium `Shift + Esc` (≤ 120 Mo au repos), `npm run build` + Playwright E2E étendu | 0 erreur console, 0 HTTP ≥ 400, RAM ≤ 120 Mo |
