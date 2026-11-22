# AMDataWrap — Multi-Platform Music Analytics & 3D Vinyl Studio (V4.1)

Application web locale **100 % privée et à 0 €** d'analyse, d'exploration musicologique et d'écoute vinyle 3D de vos historiques musicaux (**Apple Music**, **Spotify**, **YouTube Music**, **Deezer**, **TIDAL** & CSV personnalisés).

L'interface principale actuelle est **V4.1 « Salon d'écoute » (`frontend-v4.1/`, port `5177`)**, adossée au backend unifié **FastAPI + SQLite WAL/FTS5 + DuckDB/Parquet (`backend/`, port `8000`)** et à l'extension navigateur optionnelle **AMDataWrap Bridge MV3 (`extensions/amdatawrap-bridge/`)**.

---

## 1. Démarrage rapide & Services

Double-cliquez sur **`start.bat`** (ou lancez **`.\start.ps1`** en PowerShell) pour démarrer le backend et **toutes les interfaces** (V1 à V4.1) :

```powershell
# Démarrage complet (Backend :8000 + V1 :5173, V2 :5174, V3 :5175, V4.0 :5176, V4.1 :5177)
.\start.ps1

# Démarrer uniquement certaines versions (ex. V3 et V4.1)
.\start.ps1 -Versions 3,4.1
```

| Service | URL | Dossier | Rôle |
| :--- | :--- | :--- | :--- |
| **Backend API** | `http://127.0.0.1:8000` | `backend/` | FastAPI + SQLite (WAL + FTS5 + aiosqlite) + DuckDB/Parquet + Importers + Playback & Bridge WS |
| **V4.1 Salon 3D *(Principal)*** | `http://localhost:5177` | `frontend-v4.1/` | Interface principale : Salon d'écoute 3D optimisé (RAM ≤ 120 Mo), 11 onglets analytiques, lecteur hybride 0 € |
| **Extension Bridge MV3** | `ws://127.0.0.1:8000/ws/bridge` | `extensions/amdatawrap-bridge/` | Pilotage 0 € d'un onglet ouvert Apple Music (MusicKit v3), Spotify, Deezer ou YouTube Music |
| **V4.0 *(Référence)*** | `http://localhost:5176` | `frontend-v4/` | Version V4.0 initiale (avant optimisations WebGL/RAM V4.1) |
| **V3 Continuum *(Legacy)*** | `http://localhost:5175` | `frontend-v3/` | 3 univers visuels, Science, Atlas MapLibre, Hub Continuum |
| **V2 Spatial 3D *(Legacy)*** | `http://localhost:5174` | `frontend-v2/` | *Sonic Odyssey* WebGL, Galaxie 3D, Wrapped 11 chapitres |
| **V1 Classique *(Legacy)*** | `http://localhost:5173` | `frontend/` | *Obsidian Glass* avec sidebar et Wrapped 8 slides |

> **Confidentialité & Git** : les exports personnels (`*.zip`, `data/`, `*.sqlite`, `*.parquet`) et `node_modules/` sont exclus via `.gitignore`. Tout s'exécute en local sans aucun envoi vers un serveur externe.

---

## 2. Fonctionnalités Clés — V4.1 « Salon d'écoute » (`frontend-v4.1/`)

### A. Salon d'Écoute 3D & Tourne-Disque Direct-Drive (`PersistentStageCanvas.tsx`)
- **Direction artistique « Salon d'écoute / Liner Notes »** : palette chaude mate (`#0f0c0a`, ambre `#e8873e`, laiton `#c9a86b`), typographie *Fraunces* + *Inter* + *JetBrains Mono*, zéro `backdrop-filter: blur()` au-dessus du WebGL.
- **Tourne-disque Direct-Drive (type Technics SL-1200 MK II)** :
  - 3 finitions commutables (*Technics Noir*, *Alu Brossé*, *Noyer Huilé*), châssis agrandi (+20 % d'espacement mécanique, zéro chevauchement).
  - Plateau stroboscopique, vinyle 12" avec sillons proportionnels aux vraies durées de pistes, bras en S qui suit la position réelle de lecture, **needle drop 3D** par clic direct sur les sillons.
  - **Retournement physique 3D** (clic sur le macaron central → levée du bras, flip 180° Face A/B/C/D) et **Double LP Gatefold** (pochette dépliante à 2 volets + 2 disques physiques LP 1 / LP 2).
  - **Verrouillage physique sous capot fermé** (`lidOpen === false`) avec retour haptique/sonore et toast discret.
  - Boutons 3D cliquables (`START·STOP`, `33`, `45`, `POWER`, lampe d'architecte, lampe cible) + **fader linéaire `VOLUME` glissable en 3D**.
- **Bac à vinyles 3D en chêne** : 20 pochettes feuilletables à la molette ou au clavier (`←`/`→`, `J`/`K` pour piste précédente/suivante), tri dynamique (`Top`, `Récents`, `Décennie`, `Genre`, `Aléatoire`), présence physique exclusive (l'album sur la platine est retiré du bac) et mode **Free Cam** (`ZQSD`/`WASD` + `OrbitControls`).
- **AudioWorklet & Foley (`vinylFoley.ts`)** : bruitages mécaniques distincts et grain vinyle analogique (filtre bruit rose de Paul Kellet + micro-craquements) sur `AudioWorklet` avec `ctx.suspend()` automatique au repos.

### B. Optimisations Extrêmes RAM & GPU (V4.1)
- **Planificateur demand-driven 4 voies** (`DIRTY_WEBGL`, `DIRTY_CAMERA`, `DIRTY_SHADOW`, `DIRTY_RAYCAST`) : boucle `requestAnimationFrame` auto-endormante (**0 Hz / < 2 % GPU** au repos).
- **Bac à vinyles en 1 seul draw call** : `InstancedMesh` + `DataArrayTexture` GPU-only (`384×384×20`) via `createImageBitmap` + `bitmap.close()` (**0 MiB RAM CPU**). Pochettes HD `1024px` éphémères pour le chevalet *Now Playing* et l'inspection.
- **Shaders GLSL analytiques (`textures.ts`)** : vinyle (micro-sillons + reflet anisotrope en sablier + vraies pauses inter-pistes `uTrackStops[16]`), crédence en noyer, mur en plâtre et stroboscope générés sur GPU (**0 Mo VRAM**).
- **Ombres gelées & Raycasting zéro-GC** : `shadowMap.autoUpdate = false`, `three-mesh-bvh` ciblé sur les géométries denses, raycasting bridé à ≤ 30 Hz, `CSS3DRenderer` événementiel (0 écriture DOM pendant la rotation).
- **Façade YouTube Lazy-Mount + Hibernation 45 s** (`HybridPlaybackDeck.tsx`) : démontage déterministe (`about:blank` + `destroy()` + `replaceChildren()`) après 45 s de pause ou `POWER OFF`, et montage offscreen actif hors onglet `Salon 3D` pour garantir la lecture depuis tous les onglets.

### C. Lecture Complète Hybride à 0 € (`playback.py` + `amdatawrap-bridge`)
1. **YouTube intégré (par défaut, 0 installation)** : résolution des titres via `ytmusicapi` (sans auth, cache permanent SQLite) + fallback MusicBrainz `url-rels`, affichage sur l'écran OLED 3D du châssis.
2. **Mon onglet ouvert (Extension MV3 `extensions/amdatawrap-bridge/`)** : pilotage bidirectionnel gratuit de vos vrais comptes connectés :
   - **Apple Music Web (`music.apple.com`)** : pilotage direct `window.MusicKit.getInstance()` avec résolution 4 paliers (cache catalogue, ISRC via Deezer/DB, recherche MusicKit filtrée, fallback strict) + sync volume & temps réel.
   - **Spotify Web (`open.spotify.com`)**, **Deezer (`deezer.com`)** et **YouTube Music (`music.youtube.com`)**.
3. **Extrait 30 s** : fallback non-DRM via `/api/audio-proxy`.

### D. Les 11 Onglets Analytiques (`frontend-v4.1/src/views/pages/`)
Tous chargés en *lazy-loading* (`React.lazy`) avec filtrage global multi-plateformes, par année et bascule d'unité **`h` ↔ `min`**, plus infobulles pédagogiques `<InfoTooltip />` (`?`) sur les concepts avancés :
1. **Synthèse (`OverviewPage`)** : KPIs globaux, records (streak, journée record, plus longue session), Top 5 Artistes/Titres/Albums/Genres, appareils, contextes et qualité audio.
2. **Classements (`TopsPage`)** : Top 50 Artistes, Albums, Titres et Top 40 Genres avec complétion, taux de skip, date de découverte et lecture directe.
3. **Rythmes (`ChronoPage`)** : Calendrier Heatmap quotidien, matrice circadienne `7×24h`, tranches horaires, volume mensuel et petits multiples d'évolution des artistes.
4. **Portrait (`PersonaPage`)** : Archétype d'auditeur, radar 6 axes, âge musical (âge de cristallisation ~19 ans), époques, décennies et millésimes.
5. **Habitudes (`BehaviorPage`)** : Écoutes en boucle, phases d'obsession sur 14 jours (*Lift ×*), Intouchables vs Souvent écourtés, causes de fin de piste et consultation des paroles.
6. **Science (`SciencePage`)** : Nombre d'Eddington, Indice de Gini & Courbe de Lorenz, Entropie de Shannon (globale et par appareil), courbes de survie & demi-vie, artistes-passerelles, transitions de Markov, ères PELT (`ruptures`) et Roue de Camelot.
7. **Atlas (`AtlasPage`)** : Carte mondiale SVG équirectangulaire (zéro dépendance tuiles), foyers géographiques MusicBrainz/Wikidata et arcs d'écoute.
8. **Constellation (`GalaxyPage`)** : Graphe spatial de co-occurrence en session (Canvas 2D demand-driven, zéro boucle idle).
9. **Recherche (`SearchPage`)** : Recherche intelligente multi-entités (**Titres, Artistes, Albums, Paroles**) combinant **SQLite FTS5 `unicode61`**, trigrammes, **tolérance aux fautes de frappe** (Damerau-Levenshtein + *« Vouliez-vous dire… »*), **auto-complétion** (`/api/v3/search/suggest`) et filtres (périmètre, genre, année, écoutes min, tri).
10. **Wrapped (`WrappedPage`)** : Rétrospective éditoriale en 6 chapitres navigables au clavier (`←`/`→`) avec fiche collector.
11. **Archives (`HubPage`)** : Parcours grand public simplifié (import multi-plateformes avec barre de progression temps réel, gestion des profils) + tiroir repliable *Options avancées / Technique* (matrice de capacités, fusion multi-profils ISRC ±180 s, Extension MV3, webhooks locaux, QR code LAN smartphone).

---

## 3. Architecture Backend (`backend/app/`)

- **Ingestion Multi-Plateformes (`backend/app/importers/`)** :
  - **Apple Music** (`.zip` RGPD) : anti double-comptage (`PLAY_END` + `AUDIO`), horodatage local exact, sessions (gap 30 min), paroles (`LYRIC_DISPLAY`), recherches dédupliquées, Passe 1 locale (~98 % artistes).
  - **Spotify** (`.zip` / `.json` — Extended Streaming History, Account Data et Technical Logs) avec filtrage podcasts/audiobooks et gestion `incognito_mode`.
  - **YouTube Music** (Google Takeout `.json` / `.html` / `.zip`).
  - **Deezer** (RGPD `.xlsx`, sans stockage d'adresse IP).
  - **TIDAL / CSV personnalisé** (`.csv` UTF-8 avec auto-détection et assistant de mappage manuel).
- **Profils & Fusion Cross-Platform (`profiles.py`)** : profils standard isolés + profils virtuels fusionnés avec déduplication ISRC N-to-M (`recording_isrcs`) + similarité floue dans une fenêtre glissante `±180 s` et matrice de capacités dynamique.
- **Stockage & Moteur Analytique (`db.py`, `analytics/duckdb_engine.py`)** :
  - SQLite en mode `WAL` + `aiosqlite` + index FTS5 (`data/amdatawrap.sqlite`).
  - Export atomique vers `data/analytics_snapshot.parquet` interrogé par **DuckDB éphémère confiné** (`memory_limit: 64MB`, `threads: 2`, spill disque).
- **Enrichissement & Proxies (`enrichment.py`, `vinyl_enrichment.py`, `jobs/worker.py`, `main.py`)** :
  - Cascade 0 € : Deezer (ISRC, BPM, pochettes), MusicBrainz + Cover Art Archive (vrais pressages vinyles 12" Faces A/B/C/D, géolocalisation artistes), iTunes (previews 30 s), LRCLIB (paroles), Wikipédia (bios).
  - `/api/artwork-proxy` optimisé : client `httpx` mutualisé, `ETag` déterministe (`304 Not Modified`), Pillow `im.draft("RGB", ...)` + `Cache-Control: immutable`.

---

## 4. Endpoints Principaux (`backend/app/main.py` & Routers)

- **Système & Import** : `GET /api/health`, `POST /api/import`, `POST /api/v4/import`, `POST /api/v4/import/preview`, `GET /api/v4/import/progress/{import_id}`, `GET /api/v4/import/guides`, `POST /api/v4/data/clear`.
- **Enrichissement & Jobs** : `GET /api/enrichment/status`, `POST /api/enrichment/start|stop`, `GET /api/enrichment/stream` (SSE), `GET /api/v3/jobs/status`, `POST /api/v3/parquet/rebuild`.
- **Profils & Vinyles V4** : `GET|POST /api/v4/profiles`, `POST /api/v4/profiles/{id}/activate`, `GET /api/v4/profile/capabilities`, `GET /api/v4/vinyl/crate`, `GET /api/v4/vinyl/{album_key}`, `POST /api/v4/vinyl/{album_key}/enrich`.
- **Lecture & Temps Réel** : `GET /api/v4/playback/resolve`, `GET /api/v4/playback/apple-hints`, `POST /api/v4/playback/scrobble`, `WS /ws/bridge`, `WS /ws/now-playing`, `GET /api/v4/tracking/setup`, `POST /api/v4/webhooks/web-scrobbler`, `POST /apis/listenbrainz/1/submit-listens`.
- **Analytique & Science** : `GET /api/filters`, `/api/analytics/{overview,tops/*,chronobiology,persona,behavior,galaxy,wrapped}`, `/api/detail/{artist,album,day}/*`, `/api/sessions`, `/api/history`, `/api/history/export.csv`, `/api/v3/search`, `/api/v3/search/suggest`, `/api/v3/analytics/{science,eras,compass,camelot,atlas,graph2d,iceberg}`, `/api/v3/games/blind-test`, `/api/v3/playlists/{generate,export}`.
- **Connecteurs & Proxies** : `GET /api/external/{lyrics,artist-bio,track-bpm}`, `GET /api/artwork-proxy`, `GET /api/audio-proxy`.

---

## 5. Tests, Build & Documentation

```powershell
# Tests Backend (pytest + Hypothesis + Schemathesis)
.\backend\.venv\Scripts\pytest.exe -q

# Build & Typecheck Frontend V4.1
cd frontend-v4.1
npm run build

# Tests E2E Playwright (Desktop 1440p + vérification WebGL stats & 12 onglets)
cd frontend-v4.1
npm run test:e2e
```

---

## 6. Correctifs & Évolutions V4.5 (Post-Release)

- **Synchronisation Platine 3D depuis tous les onglets** (`frontend-v4.1/src/audio/playTrack.ts`, `backend/app/playback.py`) :
  - Lancer un titre depuis *Synthèse*, *Classements*, *Recherche*, *Habitudes*, *Constellation* ou *Wrapped* charge automatiquement le vinyle correspondant sur le plateau (`onPlatter`), bascule sur la bonne face (`activeSideIndex` / `activeDiscIndex`) et positionne le bras sur le bon sillon (`nowPlaying.vinyl`).
  - `/api/v4/playback/resolve` et `/api/v4/playback/apple-hints` retournent `album_key`, `track_key` et `duration_ms` (avec fallback par titre + artiste).
- **Fiabilité & Consensus Multi-Pistes des Pochettes** (`backend/app/vinyl_enrichment.py`, `backend/app/analytics/overview.py`, `backend/app/enrichment.py`) :
  - Les pochettes d'albums dans le bac (`/api/v4/vinyl/crate`), la prise en main (`/api/v4/vinyl/{album_key}`) et les classements (`get_top_albums`) sont validées par **consensus multi-pistes** : priorité aux URLs partagées par au moins 2 pistes (`COUNT(*) >= 2`), départagées par total d'écoutes (`SUM(total_plays) DESC`), afin d'éliminer les pochettes erronées isolées.
  - `_search_itunes` exige désormais une similarité minimale sur l'artiste (`>= 0.4`) et l'album (`>= 0.35`) pour éviter les faux positifs sur les titres génériques (ex. `Intro`).
  - Le cache de textures 3D (`PersistentStageCanvas.tsx`) est isolé par `${albumKey}::${artworkUrl}`.
- **Affichage & Proxy des Pochettes** (`frontend-v4.1/src/components/ui.tsx`, `backend/app/main.py`, `backend/app/routers/proxy_router.py`) :
  - Correction du composant `Cover` où les images déjà présentes en cache navigateur restaient bloquées à `opacity-0` (ex. Top 5 de *Classements*) et ajout d'un fallback automatique vers l'URL `https://` directe en cas d'erreur proxy.
  - Pool HTTP `/api/artwork-proxy` élargi (`max_connections=32`, `pool=20s`) et cache disque étendu à 2 000 fichiers.
- **Header 2 étages & Sources Épurées** (`frontend-v4.1/src/App.tsx`, `backend/app/profiles.py`, `backend/app/analytics/overview.py`) :
  - Header structuré sur 2 étages à partir de `Enrich.` (Étage 1 : marque + 12 onglets ; Étage 2 : `Enrich.`, sources, année, `Filtres`, `FR|EN`, `h|min`) avec marges latérales équilibrées.
  - Masquage des providers internes de lecture (`extension_bridge`, `preview_audio`, `youtube_iframe`) dans le sélecteur de sources du header.
- **Recherche Intelligente, Auto-Complétion & Tolérance aux Fautes** (`backend/app/analytics/iceberg_games.py`, `backend/app/routers/analytics_router.py`, `frontend-v4.1/src/views/pages/SearchPage.tsx`) :
  - Nouvel endpoint `GET /api/v3/search/suggest` (auto-complétion artistes/albums/titres/genres avec navigation clavier).
  - Fallback fuzzy (Damerau-Levenshtein + `SequenceMatcher` insensible aux accents), suggestion *« Vouliez-vous dire… »*, résultats multi-entités (Artistes, Albums, Titres, Paroles) et filtres (périmètre, genre, année min/max, écoutes min, tri).

Toute la documentation technique, les études de faisabilité 0 €, les plans d'architecture et les rapports de référence sont indexés dans **[docs/README.md](docs/README.md)**.
