# Plan Draft V4 — « SONIC ODYSSEY × VINYL STUDIO 3D » : Esthétique V2, Disquaire & Tourne-Disque 3D + Multi-Plateformes à 0 €

**Base technique :** `AMDataWrap` V2 (*Sonic Odyssey* — direction artistique & spatiale) + socle analytique V3 (FastAPI + SQLite WAL + DuckDB/Parquet)  
**Frontend dédié :** `frontend-v4/` (port `5176`) — *V1, V2 et V3 conservées intactes en parallèle.*  
**Statut :** Draft d'orientation (prêt à être affiné en détail via `/grill-me` avant implémentation)  
**Contrainte cardinale :** **Gros effet WOW 3D inspiré de la V2**, **100 % gratuit (0 €)**, et **fluide sur tous PCs, navigateurs et smartphones** (WebGL2 par défaut, WebGPU en boost optionnel PC).  
**Références techniques :** [`docs/references/`](../references/) & [`docs/feasibility/`](../feasibility/).

---

## 1. Constat V2 vs V3 & Direction Artistique V4

### Pourquoi la V3 n'a pas convaincu
- La **V2 (*Sonic Odyssey*)** avait réussi l'effet « wahou » grâce à son atmosphère WebGL immersive (`AmbientNebulaCanvas`, particules, anneaux harmoniques, Galaxie 3D), ses auras lumineuses extraites des pochettes (`--aura-1/2/3`), son dock flottant visionOS et sa typographie éditoriale (`Syne` + `Instrument Serif` + `JetBrains Mono`).
- La **V3 (*Continuum*)** a trop aplati l'interface (« Zéro Néon ») et sa promesse « Studio Hi-Fi » s'est révélée décevante.

### La Direction V4 : L'ADN Spatial V2 + Le Disquaire & Tourne-Disque 3D (Sans Chaîne Hi-Fi)
- **Pas de chaîne Hi-Fi :** On abandonne le concept de rack ampli/enceintes. On reprend **l'univers spatial, lumineux et fluide de la V2** (nébuleuse/auras réactives aux couleurs de l'album, *glassmorphism*, dock flottant, Galaxie 3D, Wrapped cinématique) et on y place au centre **un vrai Bac à Vinyles & Tourne-Disque 3D tactile**.
- **Éclairage & Auras V2 :** L'ambiance de la scène, les reflets sur le plateau et le halo autour de la platine épousent en douceur la palette de l'album posé sur le tourne-disque.
- **Caméra cinématique fluide (GSAP) :** Transitions souples entre le **Bac à Vinyles 3D**, la **Platine Tourne-Disque 3D**, la **Galaxie 3D** et les vues analytiques en surimpression *glassmorphism*.
- **Sound Design optionnel (Web Audio local, 0 DRM) :** Frottement papier à la sortie de pochette, déclic Start/Stop, léger *crackle* au posé du diamant.

---

## 2. Cœur Interactif 3D : Le Disquaire & Tourne-Disque

### 1. Le Bac à Vinyles 3D (*Record Crate*)
- Bac à disques rempli de **tes vrais albums** (filtrables : *Top Albums*, *Par Ère*, *Par Genre*, *Récents*, bouton *« Digging Aléatoire »*).
- **Feuilletage physique (*flip-through*) :** Glisser à la souris ou au doigt incline les pochettes en cascade.
- **Inspection & Retournement 360° (Recto ↔ Verso) :**
  - Clic/Tap → la pochette sort du bac et vient face caméra.
  - **Recto :** Pochette HD officielle avec tranche (*spine*) imprimée et texture carton.
  - **Verso authentique :** Vraie pochette arrière (**Cover Art Archive**) si disponible, ou **verso haute fidélité généré sur `<canvas>`** avec les **vraies informations du pressage vinyle** (MusicBrainz : découpage réel **Face A / Face B / C / D**, durées exactes, **Label**, **N° de catalogue**, année & pays, code-barres) + tes stats perso (écoutes, heures, première découverte).
  - **Tracklist cliquable :** Cliquer sur un titre au dos lance la pose du disque directement sur ce sillon.
- **Extraction du disque :** Glisser sur le côté (ou clic *« Sortir le vinyle »*) ouvre la sous-pochette et fait glisser le **disque vinyle 12"** dehors, avec choix **Face A ↔ Face B**.

### 2. La Platine Tourne-Disque 3D (*Turntable*)
- **Pose cinématique :** Le disque vole en courbe fluide jusqu'au **plateau** pendant que la pochette se pose sur un chevalet *« Now Playing »* à côté.
- **Disque vinyle réaliste :** Sillons concentriques proportionnels aux vraies durées des pistes de la face, **macaron central (*Center Label*)** authentique (`medium` CAA ou généré), rotation **33⅓ / 45 RPM à inertie physique**.
- **Bras de lecture (*Tonearm*) 100 % interactif :**
  - Se lève, se cale automatiquement sur le sillon de la piste choisie, descend au démarrage et avance vers le centre au rythme de `currentTime / faceDuration`.
  - **Drag manuel du bras (ou clic sur un sillon)** : permet de changer de piste ou de naviguer (`seek`) en temps réel.
- **Commandes directement sur la platine :** `START / STOP` (inertie plateau), levier `CUE`, `FLIP A/B` (retourne physiquement le disque en 3D), `EJECT` (range le disque dans la pochette), capot transparent.

### 3. Intégration YouTube & Analytics V2 dans l'écrin Spatial
- **Mini-lecteur YouTube intégré proprement :** En mode lecture gratuite universelle (`YouTube IFrame Player API`), la fenêtre vidéo obligatoire (≥ 200 × 200 px ToS) s'intègre comme un petit **cartouche flottant *glassmorphism* style V2** à côté de la platine (escamotable/repositionnable, jamais caché en `display: none`).
- **Analytics & Galaxie 3D V2 sublimés :** Les vues **Tops, Chronobiologie, Persona, Obsessions, Science Lab, Paroles LRCLIB, Sessions & Historique** ainsi que la **Galaxie 3D** et le **Wrapped Sonic Odyssey** conservent l'esthétique V2 (*glassmorphism*, nébuleuse, auras pochette).

---

## 3. Stack 3D & Compatibilité Universelle (Tous PCs, Navigateurs & Téléphones)

### A. Stack Frontend V4 (`frontend-v4/`)
- **React 19 + TypeScript + Vite** (même écosystème que V2/V3).
- **Three.js + React Three Fiber (`@react-three/fiber`) + `@react-three/drei`** (scène déclarative propre, `Environment`, `ContactShadows`, `Html` 3D, `useTexture`, `Instances`).
- **`@react-three/postprocessing`** (Bloom sélectif léger sur les VU-mètres/tubes/LEDs, ToneMapping ACES Filmic — activé uniquement sur Desktop Tier 2+).
- **GSAP** (chorégraphies caméra, sortie de vinyle, vol du disque, retournement Face A/B) + **Zustand** (`useStudioStore`, télémétrie 60 FPS hors-React pour zéro lag).
- **Assets optimisés :** Géométries procédurales fines + modèles `.glb` compressés **Draco/Meshopt** (< 4 Mo total) + proxy backend `/api/artwork-proxy?w=512&fmt=webp` (mobile) / `w=1024` (PC).

### B. 4 Paliers Graphiques Automatiques (WebGL2-First, WebGPU en Boost PC)

| Palier | Moteur | Cible | Rendu & Garde-fous |
| :--- | :--- | :--- | :--- |
| **Tier 0 : Eco / Fallback** | CSS 3D + Canvas 2D | Très vieux PC, WebGL coupé, mode Économie | Bac à pochettes CSS 3D + platine 2D/SVG rotative. 100 % utilisable. |
| **Tier 1 : Mobile Fluide** | **WebGL2** (`THREE.WebGLRenderer`) | **Smartphones iOS Safari & Android Chrome/Firefox** | `DPR ≤ 1.5`, textures 512 px WebP, pas de post-processing, `MeshStandardMaterial` + AO pré-calculée (*baked*), `< 60 draw calls`, `< 150 Mo VRAM`, barre de raccourcis caméra au pouce (*Bac · Platine · Ampli · Stats*). |
| **Tier 2 : Desktop Rich 3D *(Défaut PC)*** | **WebGL2** (`THREE.WebGLRenderer`) | **Tous PC Windows, macOS, Linux (Chrome, Firefox, Safari, Edge)** | `DPR ≤ 2.0`, textures 1024 px, **Bloom sélectif** sur VU-mètres/tubes/LEDs, éclairage studio HDR (PMREM), particules d'ambiance, 60 FPS fluides, `visibilityState` pause auto en arrière-plan. |
| **Tier 3 : PC Ultra *(Opt-in WebGPU)*** | **WebGPU** (`THREE.WebGPURenderer` + TSL) | **PC Desktop récents uniquement** (`navigator.gpu` détecté + toggle utilisateur) | Réflexions **anisotropes physiques** sur les microsillons du vinyle, ombres douces temps réel, réfraction verre/plexiglas avancée. **Fallback instantané vers WebGL2** au moindre souci. |

---

## 4. Socle Backend, Données Multi-Plateformes & Lecture Complète à 0 €

Le backend FastAPI (`backend/`) reste 100 % gratuit (0 € développeur, 0 € serveur) et conserve toute la puissance analytique V2/V3 :

### A. Imports RGPD / Takeout Multi-Plateformes (`backend/app/importers/`)
Détection automatique au drag & drop sur `POST /api/import` :
- **Apple Music** *(existant)* : `Apple Music Play Activity.csv` (ZIP imbriqués) + `Daily Tracks.csv` + `Library Tracks.json.zip`.
- **Spotify** : *Extended Streaming History* (`Streaming_History_Audio_*.json`, filtrage `spotify_track_uri != null`, filtre `incognito_mode`) + fallback *Account Data* (`StreamingHistory_music_*.json`).
- **YouTube Music** : *Google Takeout* (`watch-history.json`, filtrage `header == "YouTube Music"`, suppression dynamique du préfixe localisé et du suffixe `" - Topic"`, `duration_is_estimated = 1`).
- **Deezer** : Classeur `.xlsx` RGPD (`openpyxl` read-only, détection en-têtes EN/FR, rejet colonne IP, imputation des durées `-1`).
- **TIDAL** : Importateur `.csv` UTF-8 avec auto-détection d'alias + mappage assisté.

### B. Cascade d'Enrichissement Gratuite & Vrais Pressages Vinyles (`db.py`)
Nouvelles tables SQLite : `recording_isrcs` (N-à-M), `platform_track_mappings`, `vinyl_editions` (pressage 12" LP, Faces A/B, label, n° cat., recto/verso/macaron) et `api_metadata_cache` (TTL).
1. **Passe 1 — Deezer Public REST API (`50 req / 5 s` = `600 req/min`, ~1,7 min / 1 000 titres) :** Sans clé, récupère **ISRC natif**, durées et pochettes HD.
2. **Passe 2 — MusicBrainz WS/2 + Cover Art Archive (`1 req/s` = `60 req/min`, `User-Agent` nominatif, backoff HTTP 503) :** Résout les **éditions vinyles réelles** (Faces A/B/C/D, label, n° de catalogue, année/pays) + pochettes **Recto (`front`)**, **Verso (`back`)** et **Macaron (`medium`)**.
3. **Passe 3 — iTunes Search API (`~20 req/min`, espacé à 3,5 s) :** Fallback ciblé + `preview_url` 30s (Audio DNA).

### C. Lecture Complète Pluggable à 0 € (`PlaybackProvider`)
1. **Par Défaut (Universel PC & Mobile, 0 install) — `YouTubeIFrameProvider` + `ytmusicapi` :**
   - Résolution `videoId` gratuite via `YTMusic().search(..., filter="songs")` (sans auth, caché dans SQLite).
   - En-têtes `Referrer-Policy: strict-origin-when-cross-origin` + `referrerpolicy` (anti-Erreur 153) + `playsinline=1` (iOS).
   - Affiché dans le **Moniteur Studio 3D** (≥ 200 × 200 px visibles, 100 % conforme ToS YouTube).
2. **Option PC Multi-Comptes (Vrais comptes abonnés à 0 €) — `ExtensionBridgeProvider` (Extension MV3) :**
   - Extension Chrome/Edge/Firefox locale (`extensions/amdatawrap-bridge/`, WebSocket `127.0.0.1` avec keepalive 20 s Chrome 116+) pilotant l'onglet officiel connecté (héritant du DRM Widevine/FairPlay du navigateur) :
     - **Apple Music Web (`music.apple.com`) :** Appel direct `window.MusicKit.getInstance()` (`setQueue`, `play`, `pause`, `seekToTime`) — **lecture complète Apple Music à 0 € sans compte Developer à 99 $/an**.
     - **YouTube Music / Spotify Web / Deezer / TIDAL :** Pilotage `#movie_player` / adaptateurs DOM/ARIA inspirés de `WebNowPlaying-Redux`.
3. **Fallback Instantané & Audio DNA — `PreviewAudioProvider` (30s non-DRM) :** Vraie FFT Web Audio + Essentia.js WASM.

### D. Tracking Temps Réel Multi-OS / Web / Mobile à 0 €
- **Desktop OS (State Machine FastAPI) :** Windows SMTC (`pywinrt`/`winsdk`), macOS (`ungive/mediaremote-adapter` via `/usr/bin/perl`, contourne macOS 15.4+/26), Linux (`MPRIS2` D-Bus).
- **Navigateur & Mobile :** Webhook **Web Scrobbler** (`HTTP 200`) + endpoint **ListenBrainz local** (`/apis/listenbrainz/1/submit-listens` pour **Pano Scrobbler** Android, **FastScrobbler** iOS, **multi-scrobbler**) + Cloud ListenBrainz.
- **Sync Live vers la Platine 3D :** WebSocket `/ws/now-playing` — quand tu écoutes un album sur ton téléphone ou sur Apple Music/Spotify, **le vinyle tourne et les VU-mètres bougent en direct dans ton studio 3D !**

---

## 5. Roadmap Orientée « Effet WOW Immédiat » (5 Phases)

Pour ne pas reproduire l'erreur de la V3 (beaucoup de backend/cartes avant le plaisir visuel), **on commence par le cœur 3D WOW** :

| Phase | Objectif | Livrables concrets |
| :--- | :--- | :--- |
| **Phase 1 — « Vertical Slice WOW » (`frontend-v4/`, port `5176`)** | Prouver l'effet WOW immédiatement sur tes vraies données Apple Music déjà en base. | Scène 3D complète de la **Chaîne Hi-Fi** (Meuble bois, **Platine Vinyle interactive**, **Ampli VU-mètres & tubes**, **Bac à Vinyles 3D**, **Enceintes**, **Moniteur Studio**, **Éclairage réactif pochette**, **Caméra cinématique GSAP**, **Sound Design Web Audio**) + lecteur **YouTube IFrame + `ytmusicapi`** fonctionnel. |
| **Phase 2 — Vrais Pressages Vinyles & Multi-Plateformes 0 €** | Donner vie au recto/verso authentique et ouvrir l'import à tous les services. | Table `vinyl_editions` + enrichissement **Deezer (600/min) → MusicBrainz/CAA (1/s)** (Faces A/B, verso réel, macaron, label, n° cat.) + parseurs **Spotify, YouTube Music Takeout, Deezer `.xlsx`, TIDAL `.csv`**. |
| **Phase 3 — Extension Pont MV3 (Apple Music / Spotify 0 €) & Tracking Live Multi-OS** | Écouter via son vrai compte Apple Music / Spotify sans payer 99 $/an et synchroniser la platine en direct. | Extension MV3 `amdatawrap-bridge` (`MusicKit.getInstance()` + WebNowPlaying) + State Machine **Windows SMTC / macOS `mediaremote-adapter` / Linux MPRIS2** + Webhook **Web Scrobbler** + WebSocket `/ws/now-playing`. |
| **Phase 4 — Analytics Spatiaux, Galaxie 3D V4 & Wrapped Cinématique** | Réunir la richesse analytique V2+V3 dans un écrin spatial digne de la V4. | Overlays *glassmorphism* (Tops, Chrono, Persona, Science Lab, Atlas, Paroles LRCLIB, Historique) + **Galaxie Sonore 3D V4** + **Wrapped Sonic Odyssey V4**. |
| **Phase 5 — Optimisation Mobile, Profils Qualité & Mode Boost WebGPU (PC)** | Rendre l'expérience irréprochable sur téléphones et spectaculaire sur gros PC. | Détection auto Tier 0/1/2/3, tests Playwright Desktop + Mobile (390×844), opt-in **`WebGPURenderer`** (microsillons anisotropes, ombres douces PC), guide d'installation. |

---

## 6. Prochaine étape

Si cette direction **« HI-FI SANCTUARY 3D »** correspond exactement à l'effet WOW que tu veux :
- On peut soit **affiner quelques choix esthétiques** (ex : style de la chaîne Hi-Fi — *Vintage Bois/Marantz/Ambre* vs *Braun/Dieter Rams Alu/Orange* vs *Hybride Dark Audiophile*, ou personnalisable via le sélecteur d'ambiance !),
- Soit **démarrer directement la Phase 1 (`frontend-v4/`)** pour que tu voies la vraie chaîne Hi-Fi 3D tourner sur ton écran dès le premier jalon.
