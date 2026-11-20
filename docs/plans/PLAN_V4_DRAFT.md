# Plan Draft V4 — « HI-FI SANCTUARY 3D » : Vraie Chaîne Hi-Fi 3D, Disquaire Interactif & Multi-Plateformes à 0 €

**Statut :** Draft d'architecture V4 (revu suite au retour visuel sur la V3)  
**Frontend dédié :** `frontend-v4/` (port `5176`) — *V1, V2 et V3 conservées intactes en parallèle sur le même backend FastAPI + SQLite WAL + DuckDB.*  
**Contrainte cardinale :** **Gros effet WOW 3D dès la première seconde**, **100 % gratuit (0 € développeur / 0 € serveur)**, et **fluide sur tous les navigateurs PC & smartphones** (WebGL2 par défaut, WebGPU en boost optionnel PC).  
**Références techniques :** [`docs/references/`](../references/) & [`docs/feasibility/`](../feasibility/).

---

## 1. Constat V2 vs V3 & Manifeste Créatif V4

### Pourquoi la V3 n'a pas convaincu
- La **V2 (*Sonic Odyssey*)** avait réussi l'effet « wahou » grâce à sa profondeur WebGL, ses auras lumineuses extraites des pochettes, sa Galaxie 3D et son dock flottant spatial.
- La **V3 (*Continuum*)** a fait le choix inverse : une interface éditoriale plate et austère (« Zéro Néon »), où la promesse « Studio Hi-Fi » s'est réduite à des cartes CSS 2D avec des boutons stylisés au lieu d'une **vraie chaîne Hi-Fi reconstituée**.

### Le Manifeste V4 : « Le 3D n'est pas un onglet, c'est ton salon d'écoute »
Dans la V4, tu n'arrives plus sur un tableau de bord plat : **tu entres dans ton propre studio d'écoute Hi-Fi en 3D temps réel**, chaleureux, tactile et vivant :
- **Matériaux physiques tangibles :** bois de noyer chaleureux, aluminium brossé anodisé, verre/plexiglas, feutrine, vinyle brillant à microsillons, aiguilles de VU-mètres rétro-éclairées ambre, tubes à vide incandescents.
- **Éclairage vivant (l'âme de la V2 sublimée) :** Les lampes d'ambiance, les reflets sur l'aluminium et le halo mural derrière la chaîne s'adaptent en fondu doux à la **palette de couleurs de l'album posé sur la platine**.
- **Caméra cinématique fluide :** Pas de sauts secs entre pages. Cliquer sur le Bac à Vinyles, la Platine, l'Ampli, le Moniteur ou le Portail Galaxie fait **glisser la caméra en douceur** (courbes amorties GSAP + profondeur visuelle) vers l'objet choisi.
- **Sound Design mécanique (Web Audio local, 0 DRM, désactivable) :** Clic lourd du bouton Power de l'ampli, glissement du carton de la pochette, *clack* des potentiomètres crantés, léger crépitement vinyle au posé du diamant.

---

## 2. La Vraie Chaîne Hi-Fi 3D Reconstituée (5 Modules Interactifs)

Toute l'application s'articule autour d'une **scène 3D persistante unique** composée de 5 éléments physiques interactifs posés sur un meuble audiophile :

### Module 1 — Le Bac à Vinyles 3D (*Record Crate*)
- Meuble bac en bois/métal rempli de **tes vrais albums les plus écoutés** (filtrables : *Top Albums*, *Par Ère*, *Par Genre*, *Récents*, bouton *« Digging Aléatoire »*).
- **Feuilletage physique (*flip-through*) :** Glisser à la souris ou au doigt incline les pochettes en cascade comme chez un vrai disquaire.
- **Inspection & Retournement 360° (Recto ↔ Verso) :**
  - Clic/Tap sur une pochette → elle sort du bac et vient face caméra.
  - **Recto :** Pochette HD officielle avec tranche (*spine*) imprimée et grain carton subtil.
  - **Verso authentique :**
    - Si disponible sur **Cover Art Archive** : la **vraie pochette arrière (`back_cover_url`)**.
    - Sinon (ou en bascule *« Fiche Pressage »*) : un **verso haute fidélité généré sur `<canvas>`** avec les **vraies informations du pressage vinyle** issues de MusicBrainz (découpage réel **Face A / Face B / C / D**, durées exactes, **Label**, **N° de catalogue**, année & pays de pressage, code-barres) + ton **tampon collector personnel** (nombre d'écoutes, heures, première découverte).
    - **Tracklist cliquable :** cliquer sur une piste sur le verso lance directement le vinyle sur ce sillon précis.
- **Extraction du disque (`DISC_SLIDE_OUT`) :** Glisser vers le côté (ou clic *« Sortir le vinyle »*) ouvre la sous-pochette et fait glisser le **disque vinyle 12"** hors de la pochette, avec choix **Face A ↔ Face B**.

### Module 2 — La Platine Vinyle Audiophile 3D (*Turntable*)
Inspirée des platines cultes (*Technics SL-1200 / Braun / platines bois vintage*) :
- **Pose cinématique :** Le disque vole en courbe fluide jusqu'au **plateau en aluminium brossé** (bord à points stroboscopiques lumineux) pendant que la pochette va se poser sur le **chevalet *« Now Playing »*** à côté de la platine.
- **Disque vinyle ultra-crédible :**
  - **Sillons proportionnels aux vraies durées** des morceaux de la face (bandes sombres *rills* séparant chaque piste).
  - **Macaron central (*Center Label*)** : vraie texture Cover Art Archive (`medium`) si disponible, sinon macaron typographié généré (Label, Face A/B, 33⅓ RPM).
  - Rotation **33⅓ / 45 RPM à inertie physique** (accélération progressive au démarrage, ralentissement réaliste au freinage).
- **Bras de lecture (*Tonearm*) 100 % interactif :**
  - Se lève, se déplace automatiquement jusqu'au sillon exact du morceau lancé et descend doucement.
  - Avance progressivement vers le centre au rythme de `currentTime / faceDuration`.
  - **Drag manuel du bras (ou clic direct sur un sillon)** : permet de changer de morceau ou de naviguer (`seek`) en temps réel !
- **Commandes physiques cliquables en 3D :** `START / STOP` lumineux, levier `CUE` (lève/baisse le bras sans stopper le plateau), bouton `FLIP A/B` (lève le bras, retourne physiquement le disque en l'air et lance la face B), `EJECT` (range le vinyle dans sa pochette), capot plexiglas articulé.

### Module 3 — L'Amplificateur Hi-Fi Intégré 3D (*Vintage Amp Stack*)
Inspiré des amplis mythiques (*McIntosh / Marantz / Pioneer SX*) :
- **Façade aluminium brossé & verre noir** avec **2 vrais VU-mètres analogiques à aiguilles rétro-éclairées** (ambre chaud ou bleu glacier) animés par physique de ressort amorti (*damped spring*).
- **Tubes à vide (*Vacuum Tubes*)** sur le dessus du châssis qui s'allument progressivement en orange incandescent quand la lecture démarre.
- **Potentiomètres rotatifs 3D fonctionnels :**
  - `VOLUME` (tourne en 3D au drag/molette et pilote le volume réel),
  - `SOURCE` (sélecteur cranté : `YOUTUBE` · `APPLE MUSIC` · `SPOTIFY` · `PREVIEW 30s` · `LIVE SYNC`),
  - `AMBIANCE` (bascule l'éclairage de la pièce : *Studio Warm* · *Midnight Aura* · *Daylight*).
- **Afficheur VFD / OLED intégré dans la façade :** Affiche en temps réel le titre, l'artiste, le timer, le **BPM**, la **tonalité Camelot** et un **spectre 28 bandes** (vrai FFT sur extraits 30s non-DRM ; animation rythmique BPM-synced ultra-réaliste sur flux DRM).

### Module 4 — Les Enceintes Hi-Fi & Ambiance Spatiale
- Paire d'enceintes bois & tissu acoustique de part et d'autre de la chaîne : les **membranes des woofers vibrent physiquement** au rythme des basses.
- **Aura dynamique (héritage V2) :** L'éclairage de la pièce épouse la pochette en cours, avec subtiles poussières lumineuses dans le faisceau (PC) et reflets doux sur la table.

### Module 5 — Le Moniteur Studio « Clip & Data » + Portail Galaxie 3D
Un petit **moniteur de contrôle rétro-futuriste** posé sur le meuble Hi-Fi, qui résout élégamment deux besoins :
1. **Intégration naturelle du lecteur YouTube IFrame (0 €) :** En mode lecture gratuite universelle, l'iframe vidéo obligatoire (≥ 200 × 200 px selon les ToS YouTube) s'affiche **dans l'écran de ce moniteur studio** (encadré, esthétique, jamais caché) — plus aucun carré disgracieux !
2. **Accès à toutes les Analytics V2/V3 sans casser l'immersion :**
   - Cliquer sur le moniteur ou le dock flottant *glassmorphism* (style visionOS/V2) ouvre en surimpression translucide les vues **Tops, Chronobiologie, Persona, Science Lab (Ères, Camelot, Russell), Atlas Mondial, Paroles LRCLIB, Sessions & Historique**.
   - Un bouton **« Portail Galaxie 3D »** et **« Wrapped Sonic Odyssey 3D »** fait basculer la scène 3D en douceur vers la Galaxie Sonore 3D et le Wrapped cinématique plein écran !

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
