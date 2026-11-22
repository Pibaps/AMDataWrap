# AMDataWrap — Analyse Complète (Base V4.1) & Draft Stratégique V4.5 / V5.0

> **Statut :** Draft préparatoire (à valider via `/grill-me`) · **Date :** 2026-11-22  
> **Base analysée :** Backend unifié (`4.1.0`) + Frontend `frontend-v4.1/` (port `5177`) + Extension MV3 (`extensions/amdatawrap-bridge/`)

---

## 1. Diagnostic Complet de l'Existant (V4.1)

### 1.1 Cartographie & Santé Technique
- **Backend (`backend/app/`)** : ~15 000 lignes Python (36 modules) — FastAPI, SQLite WAL + `aiosqlite` + FTS5 `unicode61`, Parquet atomique + DuckDB éphémère confiné (`64MB`, 2 threads), 5 parseurs RGPD/Takeout, enrichissement 3 passes 0 €, WebSockets `/ws/bridge` et `/ws/now-playing`.
- **Frontend principal (`frontend-v4.1/src/`)** : ~10 400 lignes TypeScript/React 19/Three.js r174/Tailwind v4 (27 fichiers).
- **Extension MV3 (`extensions/amdatawrap-bridge/`)** : Manifest v3 (`4.1.0`) — Apple Music Web (`MusicKit.getInstance()` résolution 4 paliers), Spotify Web, Deezer, YouTube Music.
- **Santé vérifiée** : `pytest` 36/36 verts, `tsc --noEmit` 0 erreur, perf WebGL V4.1 validée (demand-driven 0 Hz idle, 1-draw-call crate `DataArrayTexture`, `ImageBitmap.close()`, GLSL procédural, façade YouTube + hibernation 45 s, `AudioWorklet`).

### 1.2 Le « Trésor Caché » Backend Non Exposé dans V4.1
14 capacités déjà implémentées et testées dans `backend/app/` ne sont pas encore branchées dans `frontend-v4.1` :
- **Drawers contextuels** : `/api/detail/{artist,album,day}/*`
- **Sessions & Historique + Export CSV** : `/api/sessions`, `/api/history`, `/api/history/export.csv`
- **Boussole Émotionnelle (Russell)** : `/api/v3/analytics/compass`
- **Iceberg Musical (8 strates)** : `/api/v3/analytics/iceberg`
- **Blind-Test Personnel** : `/api/v3/games/blind-test`
- **Playlists Intelligentes & Mix Harmonique** : `/api/v3/playlists/generate`, `/api/v3/playlists/export` (JSPF/XSPF/M3U8 + push ListenBrainz)
- **Atelier Collector & Scrollytelling** : `/api/v3/collector/atelier`, `/api/v3/wrapped/scrollytelling`
- **Connecteurs gratuits** : Paroles synchronisées LRCLIB (`/api/external/lyrics`), Bio Wikipédia (`/api/external/artist-bio`), BPM Deezer (`/api/external/track-bpm`), Setlists (`/api/v3/external/setlists/{artist_key}`)
- **Audio DNA & NLP Sentiment** : `/api/v3/audio-dna`, `/api/v3/nlp/sentiment`
- **Statut Enrichissement SSE & Jobs** : `/api/enrichment/stream`, `/api/v3/jobs/status`
- **Filtres avancés** (`backend/app/filters.py`) : Mois, Saison, Plage custom, Skip mode, Métrique `ms`/`plays`, Genre, Artiste, Appareil, Hors-ligne, Incognito.

### 1.3 Dette Technique & Points de Friction
1. **Monolithes** : `PersistentStageCanvas.tsx` (2 659 L), `v3_science.py` (1 861 L), `textures.ts` (1 147 L), `ingestion.py` (990 L), `profiles.py` (981 L), `main.py` (911 L).
2. **5 Frontends cohabitant** (`frontend/`, `frontend-v2/`, `frontend-v3/`, `frontend-v4/`, `frontend-v4.1/`) → maintenance dupliquée.
3. **Dépendance morte** : `echarts` dans `frontend-v4.1/package.json` (non importé) + réponses API typées `any`.
4. **Wrapped V4.1 limité** : 6 slides statiques sans bande-son ni export PNG HD (Poster / Ticket Collector).
5. **Architecture mono-tenant locale** : `CORS *`, SQLite local, pas d'auth ni de packaging Desktop/Web distribuable.

---

## 2. Trajectoires Possibles : V4.5 vs V5.0

- **V4.5 « Édition Complète » (Consolidation Locale)** : nettoyage/refactoring, réactivation de tout le trésor backend (Drawers, Filtres avancés, Paroles LRCLIB, File d'attente, Sessions/Historique, Wrapped HD, Blind-Test, Playlists), 1 seul frontend actif. Effort moyen, risque faible.
- **V5.0 « Nouvelle Génération » (Saut Produit & Distribution)** : tout V4.5 + Salon 3D personnalisable (ambiances, enceintes/VU-mètres, bac paginé infini), Comparateur de périodes & **Taste Match entre 2 profils**, Liner Notes narratives, et **mode de distribution produit** (Option A : App Desktop Tauri 1-clic · Option B : Web 100 % Browser DuckDB-WASM · Option C : Hybride Cloud + Auth + ListenBrainz live).

---

## 3. Plan Détaillé par Domaines (Draft)

1. **Architecture & Hygiène** : archivage V1–V4.0, découpage de `PersistentStageCanvas.tsx` / `v3_science.py` / `main.py`, génération des types TS depuis OpenAPI, suppression `echarts`, CI GitHub Actions + Vitest + Playwright Mobile/Desktop.
2. **Salon 3D Next-Level** : 4 ambiances lumineuses, enceintes/VU-mètres optionnels, étagère murale Top 3, bac à vinyles paginé sans limite de 20 albums, feuillet Paroles Live synchronisé, gestes tactiles mobiles + paliers GPU auto.
3. **Audio & File d'Attente** : Queue (« À suivre ») + historique de session + mode Radio / Mix Harmonique Camelot, tiroir Paroles LRCLIB + BPM, fiabilisation Bridge MV3 (auto-reconnexion + indicateur de match).
4. **Analytique & Exploration** : Drawers universels (Artiste/Album/Jour), barre de filtres avancés repliable, Comparateur de périodes/plateformes, Sessions & Historique virtualisé + CSV, Boussole Russell, Iceberg 8 strates, Atelier Playlists, Blind-Test sur platine 3D, pastille SSE Enrichissement/Atlas.
5. **Wrapped Collector, Social & IA** : Wrapped 10–12 chapitres avec bande-son + Export PNG HD 2.5× (Poster, Ticket, Fiche Pressage, Story 9:16), **Taste Match** entre 2 profils, Liner Notes narratives (templates locaux 0 € ou LLM BYOK/Ollama).
6. **Distribution V5** : arbitrage Desktop Tauri vs Web DuckDB-WASM vs Hybride Cloud + Thème Clair éditorial (APCA).

---

## 4. Arbitrages Clés pour le `/grill-me`
1. **V4.5 locale complète** d'abord ou **V5.0 distribuable** directement ?
2. **Distribution V5** : Desktop Tauri 1-clic, Web DuckDB-WASM 0-serveur, ou Hybride Cloud + Comptes ?
3. **Nettoyage des anciens frontends** (V1–V4.0) : archivage complet ?
4. **Top 2 priorités produit** : Analytique/Drawers/Filtres, Audio/Queue/Paroles, Salon 3D personnalisable, ou Wrapped/Social/Taste Match ?
5. **Tri des modules orphelins** : lesquels garder (Sessions/Historique, Blind-Test, Iceberg, Boussole, Playlists) et lesquels écarter ?
6. **Écoute en direct** : maintenue en réserve ou réactivée maintenant ?
7. **Liner Notes IA** : templates locaux 0 €, LLM BYOK/Ollama, ou pas prioritaire ?
