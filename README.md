# AMDataWrap — Apple Music Spatial Analytics & Interactive Wrapped

Application web locale complète d'analyse et de visualisation de vos données d'écoute Apple Music issues de l'export RGPD (`Apple Media Services information.zip`).

Le projet fait tourner **deux interfaces en simultané** sur un même backend **FastAPI + SQLite** :
- **V2 Spatial 3D (`frontend-v2/`, port `5174`)** — *Sonic Odyssey* : expérience WebGL **Three.js** audio-réactive, **Galaxie Sonore 3D**, platine vinyle avec **analyseur FFT temps réel**, connecteurs gratuits (**LRCLIB**, **Wikipédia**, **Deezer BPM**) et **Wrapped 11 chapitres** avec mode *Ticket Collector*.
- **V1 Classique (`frontend/`, port `5173`)** — *Obsidian Glass* : interface analytique épurée avec sidebar, mesh gradients adaptatifs et Wrapped 8 slides.

---

## 1. Démarrage rapide & Ports

Double-cliquez sur **`start.bat`** (ou lancez **`start.ps1`** en PowerShell) :

| Service | URL | Dossier | Rôle |
| :--- | :--- | :--- | :--- |
| **Backend API** | `http://127.0.0.1:8000` | `backend/` | FastAPI + SQLite (WAL) + Enrichissement SSE + Proxies CORS |
| **V2 Spatial 3D** | `http://localhost:5174` | `frontend-v2/` | Interface principale (Three.js, FFT, Odyssey 3D) |
| **V1 Classique** | `http://localhost:5173` | `frontend/` | Version V1 conservée intacte en parallèle (lien `V1 ↗` dans V2) |

> **Repo Git** : la V1 pure est sauvegardée sur la branche `v1-classic` (tag `v1.0-classic`), tandis que `main` contient `backend/`, `frontend/` (V1) et `frontend-v2/` (V2). Les données personnelles (`*.zip`, `data/`) et `node_modules/` sont exclues via `.gitignore`.

---

## 2. Comment ça fonctionne sous le capot (Pipeline & Architecture)

### A. Ingestion & Règles de parsing (`backend/app/ingestion.py`)
Au premier démarrage (si la base `data/amdatawrap.sqlite` est vide) ou lors d'un import drag & drop via `/api/import`, le backend analyse l'archive `Apple Media Services information.zip` :

1. **Anti double-comptage strict** :
   - Seuls les événements `Event Type == PLAY_END` et `Media Type == AUDIO` sont comptés comme écoutes (les `PLAY_START` et `VIDEO` sont exclus du comptage).
   - Les événements `LYRIC_DISPLAY` sont extraits dans une table dédiée (`lyric_events`).
2. **Horodatage fiable** :
   - Utilise strictement `Event Start Timestamp` (ou `Event End Timestamp` moins `Play Duration Milliseconds`), **jamais** `Event Received Timestamp` (qui peut être décalé en cas d'écoute hors-ligne).
   - Conversion UTC + application de `UTC Offset In Seconds` pour stocker l'heure locale exacte (`started_at_local`, `local_date`, `local_year`, `local_month`, `local_season`, `local_dow`, `local_hour`).
3. **Normalisation & Regroupement (`backend/app/normalize.py`)** :
   - Normalisation Unicode `NFKC`, suppression des accents pour les clés de regroupement, nettoyage des mentions `(Remastered)`, `(Deluxe Edition)`, `[Single]`, et gestion des `feat.` / `ft.` pour fusionner proprement les pistes, albums et artistes.
4. **Reconstitution automatique des sessions** :
   - Les écoutes sont triées chronologiquement ; toute écoute espacée de moins de **30 minutes** (`SESSION_GAP_SECONDS = 1800`) de la fin de la précédente est regroupée sous le même `session_id`.
5. **Streaming de l'historique de recherche** :
   - Lecture en streaming de `Apple Music Click Activity.csv` pour extraire `Search Term` tout en **dédupliquant les frappes d'autocomplétion** (fenêtre de 25 secondes).

*Chiffres observés lors de l'ingestion de votre archive (`37 339` lignes brutes, du `2025-07-31` au `2026-11-15`)* :
- **17 439** écoutes audio brutes (**3 974** paires titre/album uniques)
- **8 714** écoutes validées selon la règle Last.fm par défaut (**470,8 heures**)
- **3 199** affichages de paroles (`LYRIC_DISPLAY`)
- **1 493** recherches dédupliquées
- **1 120** sessions reconstituées

---

### B. Enrichissement en 2 passes (`backend/app/ingestion.py` & `backend/app/enrichment.py`)

1. **Passe 1 (Instantanée, 100 % locale, ~5,4 s à l'import)** :
   - `Container Artist Name` étant vide dans `Apple Music Play Activity.csv`, le pipeline croise automatiquement `Apple Music Library Tracks.json.zip`, `Apple Music - Play History Daily Tracks.csv`, `Apple Music - Track Play History.csv`, `Apple Music - Recently Played Tracks.csv`, `Apple Music Library Playlists.json.zip`, `Apple Music - Recently Played Containers.csv` et `Customer Device History - *.csv`.
   - Résout localement **97,88 %** des artistes, **83,71 %** des couples genre + année de sortie, ainsi que les noms réels de playlists et d'appareils (`Motorola Edge 60 Neo`, `Realme RMX3472`, `Samsung Galaxy A8`, `Windows PC`, `Chromecast`, `Apple Music Web`).
2. **Passe 2 (Arrière-plan non-bloquante + SSE temps réel sur `/api/enrichment/stream`)** :
   - **Étape 2a (iTunes Lookup en batch)** : requêtes groupées par paquets de 80 IDs catalogue (`itunes_track_id`) triés par nombre d'écoutes décroissant.
   - **Étape 2b (iTunes Search + fallback Deezer)** : pour les titres sans ID, requête combinant `Song Name + Album Name` avec scoring de similarité (`similarity_score`), puis fallback sur l'API publique Deezer.
   - Récupère : artiste exact, pochette HD (`600x600bb`), extrait audio 30s (`previewUrl`), année de sortie (`releaseDate`) et genre (`primaryGenreName`).
   - Tout est persisté dans `enrichment_cache` (SQLite) pour survivre aux réimports de `.zip`.

---

### C. Connecteurs externes gratuits & Proxies CORS (`backend/app/external.py` & `backend/app/main.py`)
Tous les appels externes sont mis en cache dans la table SQLite `external_cache` et ne nécessitent aucune clé API :
- **LRCLIB** (`/api/external/lyrics`) : récupération des paroles complètes / synchronisées.
- **Wikipédia REST API** (`/api/external/artist-bio`, FR avec fallback EN) : description courte et biographie d'artiste.
- **Deezer Track API** (`/api/external/track-bpm`) : tempo (`bpm`) et gain du morceau.
- **Proxy Artwork** (`/api/artwork-proxy`) : sert les pochettes avec en-têtes CORS propres pour l'extraction de palette dominante sur `<canvas>` et l'export PNG HD.
- **Proxy Audio** (`/api/audio-proxy`) : sert les extraits 30s Apple/Deezer avec `Access-Control-Allow-Origin: *` pour permettre à la **Web Audio API (`AnalyserNode`)** de lire le spectre FFT en temps réel.

---

### D. Schéma SQLite (`backend/app/db.py`)
Base locale `data/amdatawrap.sqlite` en mode `WAL` avec index composites :
- `import_meta` : métadonnées de l'archive importée.
- `tracks_catalog` : catalogue normalisé des titres uniques, métadonnées locales/enrichies, pochettes, previews.
- `play_events` : tous les `PLAY_END AUDIO` avec horodatages UTC/locaux, durées, ratio de complétion, flags `is_valid_lastfm` / `is_skip_30s`, contexte, appareil, qualité audio, `session_id`.
- `lyric_events` : événements `LYRIC_DISPLAY`.
- `search_events` : recherches dédupliquées issues de `Apple Music Click Activity.csv`.
- `favorites` : favoris issus de `Apple Music - Favorites.csv`.
- `enrichment_cache` & `external_cache` : caches persistants iTunes/Deezer/LRCLIB/Wikipédia.

---

## 3. Fonctionnalités détaillées — Version 2 (`frontend-v2/`, port `5174`)

### A. Ambiance Spatiale, Moteur 3D & Audio Réactif
- **Dock flottant supérieur visionOS** + grain pellicule subtil (`film-grain`) + typographie éditoriale (`Syne` + `Instrument Serif` italique + `JetBrains Mono` tabulaire).
- **Scène WebGL Three.js en arrière-plan (`AmbientNebulaCanvas.tsx`)** :
  - Nuage de 900 particules, 3 anneaux harmoniques toroïdaux et orbe icosaédrique wireframe.
  - Adapte ses 3 couleurs d'aura (`--aura-1`, `--aura-2`, `--aura-3`) à la palette extraite de la pochette de l'artiste #1 ou du morceau en cours d'écoute.
  - Pulse en temps réel sur les bandes **basses / médiums / aigus** extraites à 60 FPS par `reactiveAudio.ts` (`AnalyserNode`, `fftSize = 128`).
- **Platine Vinyle Spatiale (`SpatialVinylDeck.tsx`)** :
  - Disque vinyle rotatif de la pochette en cours.
  - **Égaliseur spectral live 28 bandes** dessiné sur `<canvas>`.
  - **Badge BPM live** (via Deezer) et **tiroir Paroles live** (via LRCLIB) accessible en 1 clic.

### B. Barre de Filtres Globale Persistante (`FilterBar.tsx`)
Toutes les vues analytiques (et le Wrapped) réagissent instantanément aux filtres :
- **Période** : `Tout`, `Année`, `Mois`, `Saison` (`Hiver`, `Printemps`, `Été`, `Automne`), ou `Plage` personnalisée (`date_from` → `date_to`).
- **Règle d'écoute / Skips** :
  - `Sans skips (Last.fm)` *(par défaut)* : durée ≥ 30 s ET (complétion ≥ 50 % OU durée ≥ 4 min).
  - `Toutes lectures` : inclut les skips rapides.
  - `Seuil custom` : réglage libre en secondes (`min_seconds`) et pourcentage (`min_completion_pct`).
- **Métrique de classement** : bascule globale `Temps` (`ms`) ↔ `Écoutes` (`plays`).
- **Filtres avancés** : `Artiste`, `Genre`, `Décennie`, `Contexte / Source` (`PLAYLIST`, `ALBUM`, `RADIO`, `UNKNOWN`), `Appareil`, `Mode Hors-ligne`.

### C. Les 7 Vues de la V2
1. **Studio (`OverviewPage.tsx`)** :
   - Hero asymétrique avec compteur animé du temps total + **vinyle rotatif cliquable** du #1 en rotation (lance l'extrait 30s).
   - KPIs : écoutes validées, moyenne/jour, **plus longue streak**, **journée record** (cliquable), complétion moyenne et taux de skip &lt;30s.
   - Cartes Bento : Top 5 Artistes, Top 5 Titres (avec lecture 30s sur pochette), Top 5 Albums, Appareils, Playlists favorites, Genres majeurs.
2. **Galaxie 3D (`SonicGalaxy3D.tsx`)** :
   - Constellation Three.js des **75 meilleurs artistes** sous forme de planètes vinyles texturées.
   - Positionnement par **secteur de genre**, **altitude selon l'année moyenne de sortie**, **rayon selon le temps d'écoute**.
   - **Filaments de co-occurrence** reliant les artistes fréquemment écoutés dans les mêmes sessions.
   - Orbite souris, zoom molette, survol HUD, clic = lance l'extrait 30s + ouvre l'inspecteur spatial + pulse de la galaxie.
3. **Tops (`TopsPage.tsx`)** :
   - Classements détaillés **Artistes**, **Albums**, **Titres** (jusqu'à 100 entrées) et **Genres** (40 entrées) avec barres de progression, taux de skip, complétion moyenne et date de première découverte.
4. **Rythmes / Chronobiologie (`ChronoPage.tsx`)** :
   - **Calendrier Heatmap façon GitHub** multi-années (clic sur n'importe quel jour → ouvre le journal complet de la journée).
   - **Matrice Heure × Jour de la semaine** (7×24) avec détection de l'heure de pic.
   - **Rythme circadien** en 4 tranches (`Matin`, `Journée`, `Soirée`, `Nuit`).
   - **Streamgraph d'évolution** mois par mois : bascule `Top 10 Artistes` ↔ `Top 8 Genres`.
5. **Persona & Époques (`PersonaPage.tsx`)** :
   - **Âge d'écoute** transparent (formule affichée : `19 + (année_courante - année_médiane_pondérée)`), année médiane vs moyenne, décennie de cœur, taux de couverture des dates.
   - Répartition en **4 époques** (`Classiques <1990`, `Rétro 1990–2009`, `Récents 2010–2021`, `Nouveautés 2022+`) + histogramme par année de sortie.
   - **Archétype d'auditeur** calculé sur vos métriques réelles (*Le Noctambule*, *Le Monomaniaque Passionné*, *L'Explorateur Sonore*, *Le Voyageur Temporel*, *L'Archiviste d'Albums*, *Le Zappeur Exigeant*) + **graphique Radar 6 axes** (`Fidélité`, `Diversité`, `Endurance`, `Noctambulisme`, `Nostalgie`, `Boucles`).
6. **Obsessions, Skips, Paroles & Recherches (`BehaviorPage.tsx`)** :
   - **Radar d'Obsessions & Phases** : détection automatique des fenêtres glissantes de 14 jours où un artiste explose sa part habituelle (`lift ×`).
   - **Écoutes en boucle** : record consécutif dans une même session + top des titres joués en boucle.
   - **Raisons de fin de lecture** (`End Reason Type` en donut).
   - **Les Intouchables** (≥ 8 écoutes, plus faible taux de skip) vs **Les Mal-Aimés / Faux départs** (plus skippés avant 30 s).
   - **Affichage des Paroles** (`LYRIC_DISPLAY`) : langues et top titres lus.
   - **Top Recherches Apple Music** : requêtes les plus fréquentes + historique récent.
7. **Sessions & Historique (`SessionsHistoryPage.tsx`)** :
   - **Sessions d'écoute** : timelines horizontales des 1 120 sessions reconstituées, triables par `Récentes`, `Plus longues`, `Plus de titres`.
   - **Historique complet virtualisé** (`@tanstack/react-virtual`) : parcourt les 17 000+ événements sans lag, avec recherche instantanée, tri multi-colonnes et **Export CSV** (`/api/history/export.csv`).

### D. Drawers Contextuels (`DetailDrawer.tsx`)
- **Drawer Artiste** : pochette, **biographie Wikipédia live**, KPIs, **meilleure journée** (cliquable), courbe d'évolution mensuelle, top albums et top titres.
- **Drawer Album** : pochette, lien vers l'artiste, KPIs, courbe mensuelle, pistes de l'album avec aperçus 30s.
- **Drawer Journée** : liste chronologique complète de toutes les écoutes du jour sélectionné.

### E. Wrapped « Sonic Odyssey 3D » (`SonicOdysseyWrapped.tsx`)
Mode plein écran fonctionnant sur **n'importe quelle période filtrée**, navigable au clic ou au clavier (`←`, `→`, `Espace`, `Échap`), avec **scène WebGL Three.js dédiée** qui change de mode (`nebula`, `rings`, `orb`, `tunnel`) et **bande-son automatique 30s (`Son ON / Muet`)** :
1. **01 · Ouverture** : heures totales & équivalents insolites (vols Paris→Tokyo, trilogies LOTR, marathons).
2. **02 · Chronobiologie** : heure d'or et répartition circadienne.
3. **03 · En boucle** : titre le plus rejoué d'affilée dans une session.
4. **04 · Ta Phase** : plus gros pic d'obsession sur 14 jours.
5. **05 · Artiste #1** : vinyle rotatif, pic mensuel de gloire + **biographie Wikipédia**.
6. **06 · Titre #1** : vinyle rotatif, **BPM Deezer** + **paroles LRCLIB** en direct + bouton écoute 30s.
7. **07 · Album #1** : pochette interactive 3D et stats.
8. **08 · Voyage Temporel** : tunnel 3D + Âge d'écoute + 4 époques.
9. **09 · Ton Aura** : Archétype d'auditeur + 6 scores comportementaux.
10. **10 · Paroles & Recherches** : top paroles affichées + top recherches Apple Music.
11. **11 · Poster Collector** : bascule entre **Poster Spatial** et **Ticket de Caisse Musical Collector (style Receiptify)** avec code-barres, tous deux **exportables en PNG HD (ratio 2,5×)**.

---

## 4. Ce que propose la Version 1 (`frontend/`, port `5173`)

La V1 est conservée intacte et utilisable en parallèle sur `http://localhost:5173`. Elle partage le même backend FastAPI et les mêmes données SQLite que la V2, avec :
- Une **interface classique à sidebar latérale** (`App.tsx`) et fond mesh gradient CSS (`index.css`).
- Toutes les vues analytiques : Vue d'ensemble, Tops détaillés, Chronobiologie, Persona & Époques, Obsessions & Skips, Sessions & Historique virtualisé, Drawers Artiste/Album/Jour, Import `.zip` drag & drop et barre d'enrichissement SSE.
- Un **lecteur audio miniature 30s** (`MiniAudioPlayer.tsx`) sans analyseur FFT ni paroles.
- Un **Wrapped interactif en 8 slides** (`WrappedStoryModal.tsx`) avec export PNG HD, sans scène Three.js ni mode Ticket Collector.

---

## 5. Endpoints API disponibles (`backend/app/main.py`)

- `GET /api/health` — État du backend, métadonnées d'import et snapshot Passe 2.
- `POST /api/import` — Upload d'un nouveau `.zip` Apple Music.
- `GET /api/enrichment/status`, `POST /api/enrichment/start`, `POST /api/enrichment/stop`, `GET /api/enrichment/stream` (SSE).
- `GET /api/filters` — Valeurs disponibles pour les filtres (années, mois, genres, décennies, artistes, appareils, conteneurs).
- `GET /api/analytics/overview`, `/tops/artists`, `/tops/albums`, `/tops/tracks`, `/tops/genres`, `/chronobiology`, `/persona`, `/behavior`, `/galaxy`, `/wrapped`.
- `GET /api/detail/artist/{artist_key}`, `/api/detail/album/{album_key}`, `/api/detail/day/{target_date}`.
- `GET /api/sessions`, `GET /api/history`, `GET /api/history/export.csv`.
- `GET /api/external/lyrics`, `/api/external/artist-bio`, `/api/external/track-bpm`.
- `GET /api/artwork-proxy`, `GET /api/audio-proxy`.
