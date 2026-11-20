# Audit Statique, Vérifications & Correctifs — AMDataWrap V3 « Continuum »

Ce document récapitule la passe d'analyse statique, de contrôle des contrats de données front-to-back, de tests de propriétés (**Hypothesis**) et de fuzzing OpenAPI (**Schemathesis**) effectuée sur **AMDataWrap V3 (`frontend-v3/` + `backend/`)**, ainsi que les correctifs vérifiés appliqués.

---

## 1. Périmètre des vérifications exécutées

| Couche | Outil / Commande | Statut |
| :--- | :--- | :--- |
| **Compilation Python** | `python3 -m compileall -q backend/` | **OK** (0 erreur de syntaxe ou d'import) |
| **TypeScript Strict V3** | `tsc -b` avec `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true` | **OK** (0 erreur, 0 variable/paramètre inutilisé) |
| **Build Production Vite V3** | `vite build` (`frontend-v3/`, incluant `fftCanvas.worker.ts` & `audioDna.worker.ts`) | **OK** |
| **Non-régression V1 & V2** | `tsc -b && vite build` sur `frontend/` (`:5173`) et `frontend-v2/` (`:5174`) | **OK** |
| **Tests de propriétés (Hypothesis)** | `pytest backend/tests/test_properties.py` (normalisation, Eddington, Gini/D_eff, Shannon, Camelot, réconciliation Continuum, FTS5 `unicode61` + `trigram`, écart ≤ 30 min des sessions) | **9 / 9 PASS** |
| **Contrats OpenAPI & Schemathesis** | `pytest backend/tests/test_openapi_fuzz.py` (schéma OpenAPI 3.0.0, 20 endpoints GET/POST, Schemathesis fuzzing, vérification stricte des clés JSON consommées par le frontend V3) | **4 / 4 PASS** |

---

## 2. Anomalies détectées lors de l'audit & Correctifs appliqués

Lors de l'inspection croisée entre les payloads JSON réels renvoyés par les modules analytiques V1/V2 (`backend/app/analytics/{overview,chrono,persona,behavior,detail,wrapped}.py`) et les composants React de `frontend-v3/`, **6 désalignements de clés JSON**, **1 exception asynchrone de worker** et **1 paramètre TypeScript inutilisé** ont été identifiés et corrigés :

### A. Alignement du contrat `/api/analytics/overview` dans [`StudioOverviewPage.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/pages/StudioOverviewPage.tsx) & [`GamesAndCollectorPage.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/pages/GamesAndCollectorPage.tsx)
- **Constat** :
  - `get_overview()` renvoie `kpis.plays`, `kpis.daily_avg_ms`, `kpis.avg_completion_pct`, `kpis.skip_rate_30s_pct`, `kpis.total_sessions`, `kpis.offline_plays`, tandis que les records sont placés sous `records.longest_streak.days` et `records.record_day.date`, et les appareils sous `breakdowns.devices` (avec `{ label, plays, total_ms }`).
  - Les entrées de `top_artists` et `top_albums` exposent `artist_group_key`, `primary_genre` et `album_group_key`.
  - Or `StudioOverviewPage.tsx` lisait initialement `kpis.total_plays`, `kpis.avg_daily_ms`, `kpis.avg_completion`, `kpis.skip_rate_pct`, `kpis.longest_streak_days`, `data.devices` (`d.device`) et `a.artist_key` / `al.album_key`.
- **Correctif** : branchement exact sur `kpis.plays`, `kpis.daily_avg_ms`, `kpis.avg_completion_pct`, `kpis.skip_rate_30s_pct`, `kpis.total_sessions`, `kpis.offline_plays`, `records.longest_streak.days`, `records.record_day.date`, `breakdowns.devices` (`d.label`), `artist_group_key`, `primary_genre` et `album_group_key`.

### B. Alignement des contrats `/chronobiology`, `/persona`, `/behavior`, `/tops` et `/sessions` dans [`AnalyticsCorePage.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/pages/AnalyticsCorePage.tsx)
- **Constat** :
  - `/api/analytics/chronobiology` renvoie `{ matrix, heatmap }` (et non `{ hour_dow_matrix, daily_heatmap }`).
  - `/api/analytics/persona` renvoie `{ listening_age: { age, weighted_median_year, heart_decade, formula_explanation }, persona: { title, tagline, description, radial_scores: [{ axis, score }] } }` (et non des champs plats à la racine avec `value`).
  - `/api/analytics/behavior` renvoie `{ phases: [{ start_date, end_date, lift, ... }], loops: { top_looped: [{ max_consecutive, ... }] }, searches: { total_searches, top_queries: [...] } }` (et non `{ obsessions, loops: [...], top_searches }`).
  - `/api/sessions` expose `start_local` et `plays` pour chaque session (et non `started_at_local` / `tracks_count`).
- **Correctif** : alignement complet des sélecteurs et des options ECharts (`matrix`, `heatmap`, `persona.radial_scores[].score`, `listening_age.*`, `phases`, `loops.top_looped[].max_consecutive`, `searches.top_queries`, `start_local`, `plays`, `artist_group_key`, `album_group_key`).

### C. Alignement des contrats `/api/detail/{artist,album,day}` dans [`DetailDrawer.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/components/DetailDrawer.tsx)
- **Constat** :
  - `get_artist_detail()` et `get_album_detail()` encapsulent les métadonnées principales dans un sous-objet `summary` (`summary.artist_name`, `summary.album_name`, `summary.total_ms`, `summary.plays`, `summary.unique_tracks`, `summary.artwork_url`), et `get_day_detail()` expose `plays` (et non `total_plays`).
- **Correctif** : lecture via `const summary = data?.summary || data` pour supporter uniformément la fiche Artiste et la fiche Album, et lecture de `data.plays` pour le journal d'une journée.

### D. Alignement du contrat `/api/v3/wrapped/scrollytelling` dans [`ScrollyWrappedModal.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/pages/ScrollyWrappedModal.tsx)
- **Constat** :
  - `get_wrapped_story()` place les totaux sous `wrapped.kpis` (`kpis.total_hours`, `kpis.total_ms`, `kpis.plays`) et les classements synthétiques sous `wrapped.summary_card` (`summary_card.top_artists`, `summary_card.top_tracks`).
- **Correctif** : lecture directe de `w.kpis.total_hours`, `w.kpis.plays`, `w.summary_card.top_artists` et `w.summary_card.top_tracks`.

### E. Durcissement de `PersistentJobWorker._loop` dans [`backend/app/jobs/worker.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/jobs/worker.py)
- **Constat** :
  - `httpx.AsyncClient()` était instancié *à l'extérieur* du bloc `try/except` de traitement d'un job. Dans un environnement où une variable proxy système est malformée (`httpx.InvalidURL`), la tâche de fond s'arrêtait dès son démarrage en remontant `Task exception was never retrieved`.
- **Correctif** : instanciation de `httpx.AsyncClient` *à l'intérieur* du bloc `try/except` du job uniquement lorsqu'un job `pending` est dépilé, permettant au mécanisme de retry/backoff exponentiel de capturer proprement toute erreur réseau ou proxy sans jamais faire tomber la boucle `asyncio`.

### F. Activation permanente de `noUnusedLocals` & `noUnusedParameters` dans [`frontend-v3/tsconfig.json`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/tsconfig.json)
- **Constat** : le paramètre `val` du callback `symbolSize` dans [`ScienceLabPage.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/pages/ScienceLabPage.tsx) déclenchait `TS6133` lorsque `noUnusedParameters` était activé.
- **Correctif** : renommage en `_val` et activation permanente de `"noUnusedLocals": true` et `"noUnusedParameters": true` dans `frontend-v3/tsconfig.json`.

### G. Sécurité multi-boucles `asyncio` (`start()` / `stop()`) lors de cycles `lifespan` répétés
- **Constat** : lorsque plusieurs instances `TestClient(app)` ou rechargements ASGI créent successivement des boucles d'événements distinctes, `self._task` dans [`PersistentJobWorker`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/jobs/worker.py), [`EnrichmentManager`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/enrichment.py) et [`WindowsSMTCWorker`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/continuum/smtc_worker.py) pouvait conserver une référence vers une `Task` rattachée à une boucle précédente (`RuntimeError: Task got Future attached to a different loop`).
- **Correctif** : vérification `self._task.get_loop() is asyncio.get_running_loop()` dans `start()` et `stop()` et remise à `None` (`self._task = None`) à l'arrêt.

---

## 3. Verrouillage par test de contrat automatisé

Un test dédié [`test_v3_frontend_contract_keys`](file:///home/antigravity/Pibaps/AMDataWrap/backend/tests/test_openapi_fuzz.py) a été ajouté à la suite `pytest` pour vérifier systématiquement la présence de toutes les clés imbriquées consommées par les vues V3 (`/api/analytics/overview`, `/chronobiology`, `/persona`, `/behavior`, `/api/v3/wrapped/scrollytelling`).
