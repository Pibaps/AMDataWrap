# Plan Draft V4 — « Disquaire 3D Tactile, Lecture Complète & Multi-Plateformes à 0 € »

**Base technique :** `AMDataWrap` V3 « Continuum » (FastAPI + SQLite WAL + DuckDB/Parquet + React 19 / Three.js)  
**Statut :** Draft d'architecture complet (prêt pour revue & affinage avant implémentation)  
**Contrainte cardinale :** **100 % gratuit (0 € de coût développeur, 0 € d'hébergement, aucune clé API payante)** et **compatible tous navigateurs, PC et smartphones**.  
**Sources de référence :** [`docs/references/`](../references/) (`Architecture Streaming Musical Local Gratuit.pdf`, `APIs Streaming Musical Web DRM.pdf`) et [`docs/feasibility/`](../feasibility/).

---

## 1. Vision & Objectifs de la V4

La V4 transforme `AMDataWrap` d'un tableau de bord analytique Apple Music en un **disquaire personnel universel et vivant** :

1. **Multi-Plateformes à 0 € (Données) :** Importer en drag & drop ses archives RGPD/Takeout depuis **Apple Music, Spotify, YouTube Music, Deezer et TIDAL**, avec réconciliation croisée par **ISRC** et enrichissement gratuit haute vitesse.
2. **Tracking Temps Réel Universel à 0 € :** Capturer automatiquement les écoutes en direct depuis **Windows, macOS, Linux, Navigateur, Android et iOS** vers SQLite, et animer le tourne-disque 3D en temps réel.
3. **Lecture Complète Pilotée à 0 € :** Pouvoir écouter des **morceaux et albums entiers** (plus seulement des extraits de 30s) directement depuis l'interface, via un moteur pluggable (`YouTube IFrame + ytmusicapi` par défaut sur tous appareils, complété sur PC par une **extension navigateur MV3** pilotant l'onglet officiel Apple Music / Spotify / YouTube Music / Deezer / TIDAL sans payer de licence développeur).
4. **Expérience Phare « Bac à Vinyles → Tourne-Disque 3D Interactif » :**
   - Fouiller dans un **bac à vinyles 3D** rempli de ses vrais albums.
   - **Prendre un vinyle**, l'inspecter, le **retourner** (Recto/Verso authentique + vraies infos du pressage vinyle : faces A/B, tracklist, label, n° de catalogue, année).
   - **Sortir le disque de sa pochette**, choisir la Face A ou B, et le **poser sur le tourne-disque 3D**.
   - **Tout est interactif** : plateau rotatif à inertie, bras de lecture (*tonearm*) déplaçable sur les sillons, changement de piste, bouton Start/Stop, levier Cue, couvercle, et synchronisation directe avec le lecteur audio.
5. **Universel & Performant (PC + Mobile) :** Baseline **WebGL2** optimisée pour tourner sur tous les PC et téléphones (Chrome, Safari, Firefox, Edge), avec **WebGPU uniquement en mode boosté optionnel sur PC**.

---

## 2. Architecture Backend V4 — Multi-Plateformes & Enrichissement (0 €)

### A. Évolution du Schéma SQLite (`backend/app/db.py`)
Le schéma V3 (`play_events` avec `source_provider`, `source_priority`, `canonical_track_key`, `duration_is_estimated`) est étendu sans casser la rétrocompatibilité :

1. **Réconciliation N-à-M par ISRC & Mapping Plateformes :**
   ```sql
   CREATE TABLE IF NOT EXISTS recording_isrcs (
       track_key TEXT NOT NULL,
       isrc TEXT NOT NULL,
       PRIMARY KEY (track_key, isrc),
       FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
   );

   CREATE TABLE IF NOT EXISTS platform_track_mappings (
       track_key TEXT NOT NULL,
       provider TEXT NOT NULL,      -- 'apple_music' | 'spotify' | 'youtube' | 'deezer' | 'tidal'
       external_id TEXT NOT NULL,   -- itunes_id, spotify:track:..., videoId, deezer_id...
       url TEXT,
       resolved_at TEXT,
       PRIMARY KEY (track_key, provider, external_id),
       FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
   );
   ```
2. **Métadonnées Réelles de Pressage Vinyle (`vinyl_editions`) :**
   Stocke les informations authentiques récupérées gratuitement sur **MusicBrainz WS/2 + Cover Art Archive** pour chaque album du bac :
   ```sql
   CREATE TABLE IF NOT EXISTS vinyl_editions (
       album_key TEXT PRIMARY KEY,
       mbid_release_group TEXT,
       mbid_vinyl_release TEXT,     -- Release spécifique au format "12\" Vinyl" / "Vinyl"
       label_name TEXT,
       catalog_number TEXT,
       country TEXT,
       press_year INTEGER,
       disc_count INTEGER DEFAULT 1,
       vinyl_color_hex TEXT,        -- Couleur du disque (noir classique ou palette édition)
       front_cover_url TEXT,
       back_cover_url TEXT,         -- Cover Art Archive type=Back
       medium_label_url TEXT,       -- Cover Art Archive type=Medium (macaron central)
       sides_json TEXT,             -- JSON: [{"side":"A","tracks":[{"pos":"A1","title":"...","duration_ms":...,"track_key":"..."}]}, ...]
       enriched_at TEXT
   );
   ```
3. **Cache Éphémère API (`api_metadata_cache` avec TTL) :**
   Sépare les données utilisateur souveraines (persistantes) des caches temporaires (ex: résultats de recherche, TTL 24h) pour la conformité multi-services.

### B. Parseurs d'Import Multi-Plateformes (`backend/app/importers/`)
Détection automatique du type d'archive lors du drag & drop sur `POST /api/import` :

| Source | Détection automatique | Règles & garde-fous de parsing |
| :--- | :--- | :--- |
| **Apple Music** *(existant)* | `Apple Music Play Activity.csv` (ZIP imbriqués) | Décompression récursive + jointure `Daily Tracks.csv` + `Library Tracks.json.zip`. |
| **Spotify Extended** | `Streaming_History_Audio_*.json` (`ts`, `ms_played`) | Filtrer `spotify_track_uri IS NOT NULL` (exclut podcasts/audiobooks), option d'exclusion `incognito_mode`, gérer les `skipped` historiques (2015–2022) et chevauchements `offline_timestamp`. |
| **Spotify Account Data** | `StreamingHistory_music_*.json` (`msPlayed`) | Supporté en fallback (~12 derniers mois, sans album/URI). |
| **YouTube Music Takeout** | `watch-history.json` (`header == "YouTube Music"`) | Suppression dynamique du préfixe localisé (*"Watched "* / *"Vous avez regardé "*), suppression du suffixe `" - Topic"` sur `subtitles[0].name`, tolérance vidéos supprimées, flag `duration_is_estimated = 1`. |
| **Deezer RGPD** | Classeur `.xlsx` (`openpyxl` en lecture seule) | Détection d'en-têtes EN/FR, horodatages UTC, **rejet strict de la colonne IP**, durées `-1` remplacées par durée canonique ou intervalle jusqu'à l'écoute suivante. |
| **TIDAL RGPD / CSV** | Fichier `.csv` UTF-8 générique | Auto-détection d'alias (`Title`/`Track Name`, `Artist`, `Album`, `Duration`, `ISRC`) + écran de mappage assisté si colonnes inconnues. |

### C. Cascade d'Enrichissement Gratuite (Basée sur les débits vérifiés)
Exécutée en arrière-plan uniquement sur les paires `(artiste_normalisé, titre_normalisé)` uniques et mises en cache permanent dans SQLite :

1. **Passe 1 — Deezer Public REST API (`50 req / 5 s` = `600 req/min`, ~1,7 min / 1 000 titres) :**
   - 100 % gratuit, sans auth. Récupère en priorité **ISRC natif**, durée, album et pochette HD.
2. **Passe 2 — MusicBrainz WS/2 + Cover Art Archive (`1 req/s` = `60 req/min`, ~16,7 min / 1 000 titres) :**
   - `User-Agent` nominatif obligatoire (`AMDataWrap/4.0 (https://github.com/Pibaps/AMDataWrap)`), backoff automatique sur `HTTP 503`.
   - Résout les **éditions vinyles réelles** (`/ws/2/release-group/{id}?inc=releases`, sélection du format `12" Vinyl` / `Vinyl` avec `inc=recordings+labels+media` pour obtenir les **vraies faces A/B/C/D**, n° de catalogue et label) + **Cover Art Archive** (`front`, `back`, `medium` en 500/1200 px).
3. **Passe 3 — iTunes Search API (`~20 req/min`, espacé à 3,5 s) :**
   - Repli ciblé uniquement pour les titres non résolus (notamment Apple Music) et pour récupérer les `preview_url` 30s (Audio DNA).

---

## 3. Tracking Temps Réel Unifié à 0 € (`backend/app/continuum/`)

Tout converge vers FastAPI → `reconciler.py` → SQLite → WebSocket `/ws/now-playing` vers le **Tourne-Disque 3D** :

1. **Couche Desktop OS (State Machine OS dans FastAPI) :**
   - **Windows :** `pywinrt` (`winrt-Windows.Media.Control`) / `winsdk` — conservation d'une référence forte sur les tâches asyncio + polling hybride si `SessionsChanged` ne se déclenche pas.
   - **macOS (15.4+ Sequoia / macOS 26) :** Pilotage de `ungive/mediaremote-adapter` (`media-control stream` via `/usr/bin/perl`) avec auto-test au démarrage (contourne le verrouillage `mediaremoted` sans désactiver SIP).
   - **Linux :** `MPRIS2` via D-Bus (`org.mpris.MediaPlayer2.Player`) avec contournement du bug Spotify Linux (`Position = 0`) grâce au chronomètre interne de la State Machine.
   - *Règle commune :* Incrémentation du temps effectif uniquement quand `PlaybackStatus == Playing`, détection des seeks et inférence skip vs fin naturelle.
2. **Couche Navigateur :**
   - **Webhook Receiver Web Scrobbler (`POST /api/v4/webhooks/web-scrobbler`) :** Gère `nowplaying`, `scrobble`, `loved`, `paused`, `resumedplaying` et renvoie systématiquement `HTTP 200`.
3. **Couche Mobile & Cloud Gratuit :**
   - **Endpoint ListenBrainz Local (`/apis/listenbrainz/1/submit-listens` — déjà présent) :** Compatible nativement avec **Pano Scrobbler** (Android), **FastScrobbler** / **Scrobbler for ListenBrainz** (iOS), **Web Scrobbler** et **multi-scrobbler**.
   - **ListenBrainz Cloud Polling :** Respect strict des headers `X-RateLimit-Remaining` et `X-RateLimit-Reset-In`.

---

## 4. Moteur de Lecture Complète Pluggable à 0 € (`PlaybackProvider`)

Abstraction frontend unique dans `frontend-v3/src/audio/providers/` (ou `frontend-v4/`) :
`playAlbum(album, startTrackIndex)`, `playTrack(track)`, `pause()`, `resume()`, `seek(ms)`, `setVolume(v)`, `onProgress(cb)`, `onTrackEnd(cb)`.

### Provider 1 (Par Défaut — Universel PC & Mobile, 0 installation) : `YouTubeIFrameProvider`
- **Résolution `videoId` gratuite (sans quota 100 req/j de YouTube Data API) :**
  - Backend FastAPI : `sigma67/ytmusicapi` **sans authentification** (`YTMusic().search(f"{artist} {title}", filter="songs")`), résultat mis en cache définitif dans `platform_track_mappings`.
  - Fallback opportuniste via les `url-rels` MusicBrainz déjà en base.
- **Lecture & Conformité Anti-Erreur 153 :**
  - En-tête FastAPI `Referrer-Policy: strict-origin-when-cross-origin` + `referrerpolicy="strict-origin-when-cross-origin"` sur l'`<iframe>` + paramètre `origin` + `playsinline=1` (iOS).
  - **Encart vidéo visible (≥ 200 × 200 px)** intégré avec style dans le studio (ex : petit « Moniteur CRT / Clip » escamotable mais jamais `display: none`).
  - Timeline exacte (`getCurrentTime()`, `YT.PlayerState.ENDED === 0`) synchronisée à 60 FPS avec l'angle du bras du tourne-disque 3D.

### Provider 2 (Optionnel Desktop — Vrais comptes Apple Music / Spotify / YTM / Deezer / TIDAL à 0 €) : `ExtensionBridgeProvider`
- Petite extension open-source **Manifest V3** (`extensions/amdatawrap-bridge/`, Chrome/Edge/Firefox) communiquant en **WebSocket local** (`ws://127.0.0.1:8000/ws/bridge`, keepalive toutes les **20 s** pour Chrome 116+ + `chrome.alarms`).
- L'utilisateur garde un onglet normal ouvert et connecté à son service (héritant nativement de ses cookies et du **DRM Widevine / FairPlay** du navigateur) :
  - **Apple Music Web (`music.apple.com`) :** Appel direct au singleton `window.MusicKit.getInstance()` (`setQueue({ songs: [...] })`, `play()`, `pause()`, `seekToTime()`) — **lecture complète Apple Music à 0 € sans compte Developer 99 $/an et sans fragilité Shadow DOM !**
  - **YouTube Music (`music.youtube.com`) :** Pilotage de `#movie_player` et du nœud `<video>`.
  - **Spotify Web / Deezer / TIDAL :** Navigation vers l'URL album/piste + adaptateurs DOM/ARIA maintenus sur le modèle de `WebNowPlaying-Redux`.
- **Gestion Autoplay Policy :** Bouton *« Activer le pont lecteur »* dans l'UI qui focalise brièvement l'onglet cible au 1er clic (ou en cas de `NotAllowedError` sous Firefox/Chrome).

### Provider 3 (Fallback Instantané & Audio DNA) : `PreviewAudioProvider`
- Extraits 30s Apple/Deezer via `/api/audio-proxy` (seul flux non-DRM permettant la vraie FFT Web Audio et le scan Essentia.js WASM).
- Pendant la lecture sur Provider 1 ou 2 (flux DRM/iframe), le visualiseur et les LEDs de la platine basculent automatiquement en **mode ambiance BPM-synced** (calé sur le BPM réel de la piste + progression).

### Option Future (Hors V4 Core) : Shell Desktop `Castlabs Electron ECS`
- Si le maintien d'un 2e onglet sur PC gêne certains utilisateurs, l'architecture découplée permettra d'empaqueter la V4 ultérieurement dans **Castlabs Electron ECS + signature EVS VMP gratuite** (zéro réécriture du moteur 3D ni du backend).

---

## 5. Expérience Phare V4 : « Disquaire & Tourne-Disque 3D Interactif »

Refonte et extension majeure de [`UnifiedObservatoryCanvas.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/components/UnifiedObservatoryCanvas.tsx) en une scène unifiée **« Studio Vinyle »** pilotée par une machine à états fluide (`useVinylStudioStore`) :

### Les 4 États & Animations Physiques (Ressorts / Lerp)

1. **`CRATE_BROWSE` — Le Bac à Vinyles 3D**
   - Meuble bac en bois/métal brossé (adapté aux 3 thèmes V3 : Studio Field, Atlas Clair, Observatoire Sombre) contenant les pochettes d'albums en rangées feuilletables.
   - **Interactions :** Molette / glisser horizontal ou vertical (*flip-through* façon disquaire avec inclinaison dynamique des pochettes voisines), filtres rapides (*Top Albums*, *Par Ère*, *Par Genre*, *Écoutés récemment*, bouton *« Pioche aléatoire »*).
   - Survol / focus : la pochette se soulève légèrement du bac avec affichage discret du titre + heures d'écoute.

2. **`SLEEVE_INSPECT` — Inspection & Retournement Recto / Verso**
   - Clic/Tap sur un vinyle : la pochette sort du bac et vient se placer face caméra.
   - **Retournement 180° (Recto ↔ Verso) :** Bouton dédié + geste glisser/double-tap.
     - **Face Recto :** Pochette HD officielle avec texture carton mat/satiné subtile et tranche (*spine*) imprimée avec le nom de l'artiste/album.
     - **Face Verso :**
       - Si disponible sur Cover Art Archive : **vraie image verso (`back_cover_url`)** avec overlay discret dépliable.
       - Sinon (ou en mode *« Fiche Pressage »*) : **verso généré sur `<canvas>` haute résolution** reproduisant une vraie pochette vinyle :
         - **Tracklist réelle découpée en Face A / Face B** (et C/D pour les doubles LP) avec durées exactes (issues de `vinyl_editions.sides_json`, sinon répartition automatique équilibrée ~22 min/face).
         - **Vraies infos de pressage :** Label, N° de catalogue (ex: *CAT. 006025…*), année & pays de pressage, code-barres stylisé.
         - **Tampon Collector Personnel :** Ton nombre d'écoutes, heures cumulées et date de première découverte sur cet album.
         - **Cliquable :** Cliquer sur une piste de la tracklist lance directement la pose du vinyle sur ce sillon précis !

3. **`DISC_SLIDE_OUT` — Sortie du Disque & Choix de Face**
   - Action *« Sortir le vinyle »* (ou geste *drag* vers la droite / vers la platine) :
     - La pochette s'incline, la sous-pochette anti-statique s'entrouvre, et le **disque vinyle 12"** glisse hors de la pochette.
     - **Rendu réaliste du disque :**
       - Microsillons concentriques (normal map procédurale + bandes de séparation *rills* proportionnelles aux durées exactes des morceaux de la face !).
       - **Macaron central (*Center Label*)** : vraie texture `medium_label_url` si dispo, sinon macaron typographié généré (Label, Face A/B, 33⅓ RPM, liste des titres).
       - Option de retourner le disque **Face A ↔ Face B** avant de le poser (ou pendant la lecture).

4. **`TURNTABLE_PLAY` — Le Tourne-Disque 3D Interactif**
   - Le disque vole en courbe de Bézier jusqu'au **plateau en aluminium brossé** (avec repères stroboscopiques) ; la pochette vient se poser sur le **chevalet *« Now Playing »*** à côté de la platine.
   - **Éléments 100 % interactifs :**
     - **Plateau rotatif :** Rotation à **33⅓ RPM** (ou 45 RPM pour singles) avec **inertie physique** au démarrage et à l'arrêt (accélération/décélération réaliste).
     - **Bras de lecture (*Tonearm*) articulé :**
       - Se lève, se positionne automatiquement sur le sillon de la piste active, et descend en douceur au lancement.
       - **Drag manuel du bras (ou clic sur un sillon du disque) :** Permet de changer de piste ou de naviguer dans le morceau (`seek`), synchronisé instantanément avec le `PlaybackProvider`.
       - Avance progressivement vers le centre en fonction de `currentTime / faceDuration`.
     - **Boutons physiques sur le châssis :**
       - `START / STOP` (play/pause + inertie plateau),
       - Levier `CUE` (lève/abaisse le bras sans stopper le plateau),
       - Bouton `FLIP SIDE A/B` (lève le bras, retourne le disque en 3D, passe aux pistes de la face B),
       - `EJECT` (range le disque dans la pochette et revient au bac),
       - Capot anti-poussière transparent ouvrable/fermable.
     - **Bruitages mécaniques optionnels (Web Audio local, 0 DRM, activables/désactivables) :** Frottement papier à la sortie de pochette, déclic mécanique du bouton Start, léger *crackle* au posé de l'aiguille.

---

## 6. Stratégie Cross-Device & Cross-Browser (PC, Mac, Linux, iOS, Android)

### A. Architecture Graphique à 3 Paliers (WebGL2-First, WebGPU en Boost PC)

| Palier | Moteur | Cible | Détails techniques |
| :--- | :--- | :--- | :--- |
| **Palier 0 : Eco / Fallback** | CSS 3D + Canvas 2D | Très vieux PC, WebGL désactivé, mode Économie d'énergie | Bac à pochettes fluide en CSS 3D + platine 2D/SVG rotative interactive. Zéro perte fonctionnelle. |
| **Palier 1 : Standard Universel *(Défaut)*** | **WebGL2** (`THREE.WebGLRenderer`) | **Tous les PC, Mac, Linux, iOS Safari, Android Chrome/Firefox** | `frameloop="demand"`, `DPR ≤ 1.5` (mobile) / `≤ 2.0` (desktop), `MeshStandardMaterial` + normal map procédurale pour les sillons, textures WebP redimensionnées (512 px mobile / 1024 px PC), `< 60 draw calls`, `< 150 Mo VRAM`. |
| **Palier 2 : Boost PC *(Opt-in)*** | **WebGPU** (`THREE.WebGPURenderer` + TSL) | **PC Desktop récents uniquement** (`navigator.gpu` détecté + bouton *« Mode Studio Hi-Fi (WebGPU) »*) | Réflexions anisotropes physiques sur les microsillons, éclairage HDR studio (PMREM), ombres douces temps réel. Fallback automatique vers WebGL2 au moindre échec de contexte. |

### B. Optimisations Mobiles & Tactiles
- **Un seul Canvas WebGL persistant** (règle V3 conservée) + gestion propre `webglcontextlost` / `webglcontextrestored` (crucial sur iOS Safari lors du changement d'onglet).
- **Proxy d'images adaptatif :** Étendre `/api/artwork-proxy` avec `?w=512&fmt=webp` pour diviser par 4 la mémoire GPU sur smartphone.
- **Gestes tactiles + Accessibilité :** Tous les gestes 3D (glisser le disque, déplacer le bras) disposent de **contrôles tactiles directs en bas d'écran** (accessibles au pouce en mode portrait) pour une utilisation fluide à une main sur téléphone.
- **Pause énergétique automatique :** `document.visibilityState === 'hidden'` stoppe immédiatement la boucle d'animation 3D tout en laissant la musique et le tracking actifs.

---

## 7. Roadmap d'Implémentation V4 (5 Phases)

| Phase | Contenu | Livrables & Validation |
| :--- | :--- | :--- |
| **Phase 1 — Socle Données Multi-Plateformes & Vinyles** | Tables `recording_isrcs`, `platform_track_mappings`, `vinyl_editions` ; parseurs **Spotify (Extended/Account)**, **YouTube Music Takeout**, **Deezer `.xlsx`**, **TIDAL `.csv`** ; cascade **Deezer (600/min) → MusicBrainz/CAA (1/s) → iTunes (20/min)**. | Tests unitaires & Hypothesis sur chaque format d'import ; résolution réelle Faces A/B + pochettes recto/verso vérifiée. |
| **Phase 2 — Tracking Temps Réel 0 € (Multi-OS & Web)** | Refactoring State Machine OS (Windows SMTC + macOS `mediaremote-adapter` + Linux `MPRIS2`), Webhook **Web Scrobbler**, WebSocket `/ws/now-playing` vers le frontend. | Tests de non-duplication `reconciler.py` ; synchronisation live du plateau depuis une lecture externe. |
| **Phase 3 — Moteur Lecture Pluggable 0 €** | Interface `PlaybackProvider`, implémentation **Provider 1 (`YouTube IFrame` + `ytmusicapi` + fix Error 153)** et **Provider 2 (Extension MV3 `amdatawrap-bridge` avec `MusicKit.getInstance()` + WebNowPlaying)**. | Lecture album complet sur Chrome/Firefox/Safari + mobile (YouTube) et Apple Music/Spotify Web (PC via extension). |
| **Phase 4 — Studio Disquaire & Tourne-Disque 3D (WebGL2)** | Machine à états `CRATE_BROWSE` → `SLEEVE_INSPECT` (Recto/Verso + infos pressage) → `DISC_SLIDE_OUT` → `TURNTABLE_PLAY` (bras interactif, sillons proportionnels, inertie 33⅓ RPM, tactile mobile). | Tests Playwright E2E (Desktop 1440p + Mobile 390×844), vérification `< 60 draw calls` et 0 % GPU au repos. |
| **Phase 5 — Polish, Mode Boost WebGPU (PC) & Packaging** | Mode opt-in `WebGPURenderer` (anisotropie sillons PC), bruitages mécaniques Web Audio optionnels, documentation utilisateur (installation extension MV3 & exports RGPD). | Benchmark FPS PC & smartphone + guide complet de démarrage 0 €. |

---

## 8. Questions Ouvertes pour Affiner le Draft

1. **Versioning Frontend :** Préfères-tu faire évoluer directement `frontend-v3/` en V4 (en gardant V1/V2 intactes) ou créer un nouveau dossier `frontend-v4/` sur un port dédié (`5176`) ?
2. **Design du Mini-Moniteur YouTube (200×200 px) :** Pour respecter les ToS YouTube IFrame en mode gratuit universel, préfères-tu qu'il apparaisse comme un petit « écran de contrôle studio » intégré à côté du tourne-disque, ou dans un coin du Dock audio inférieur ?
3. **Priorité d'implémentation :** Veux-tu attaquer d'abord **le Bac à Vinyles + Tourne-Disque 3D avec lecture YouTube IFrame** (effet « wahou » immédiat utilisable partout), ou d'abord **les parseurs multi-plateformes (Spotify / YouTube / Deezer)** ?
