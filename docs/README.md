# Documentation Technique, Études de Faisabilité & Plans — AMDataWrap

Ce dossier centralise les analyses de faisabilité, les plans d'évolution (V4.0 → V4.1), les prompts Deep Research et les rapports PDF de référence.

## 📂 `plans/` — Feuilles de Route & Suivi
- **[PLAN_V4_5_V5_DRAFT.md](plans/PLAN_V4_5_V5_DRAFT.md)** *(Draft préparatoire V4.5 / V5.0 — en attente de `/grill-me`)*  
  Analyse complète de la base V4.1, inventaire des capacités backend non exposées, dette technique et proposition multi-angles pour la prochaine génération (V4.5 locale complète vs V5.0 distribuable).
- **[PLAN_V4_1.md](plans/PLAN_V4_1.md)** *(Implémenté dans `frontend-v4.1/`, port `5177`)*  
  Optimisation extrême RAM/GPU (RAM ≤ 120 Mo, 1-draw-call `DataArrayTexture` + `InstancedMesh`, shaders GLSL analytiques, demand-driven 4 voies 0 Hz idle, AudioWorklet, DuckDB confiné 64 Mo, Pillow `draft()` + `ETag`), platine agrandie sans chevauchement, verrouillage capot fermé, retournement 3D + Double LP Gatefold, Bridge Deezer et simplification grand public.
- **[PLAN_V4_FINAL.md](plans/PLAN_V4_FINAL.md)** *(Spécification V4.0 validée via `/grill-me`)*  
  Architecture multi-plateformes 0 € (5 parseurs RGPD/Takeout, profils séparés + fusion ISRC ±180 s, lecture hybride YouTube IFrame + Extension MV3) et Salon 3D.
- **[V4_ETAT_DES_LIEUX.md](plans/V4_ETAT_DES_LIEUX.md)** — Bilan technique à l'issue de la V4.0 (`frontend-v4/`, port `5176`).
- **[V4_TODO_PROCHAINE_SESSION.md](plans/V4_TODO_PROCHAINE_SESSION.md)** — Archive des chantiers préparatoires qui ont abouti à la V4.1.
- **[PLAN_V4_DRAFT.md](plans/PLAN_V4_DRAFT.md)** — Archive du draft initial V4.

## 📂 `feasibility/` — Analyses de Faisabilité
- **[FEASIBILITY_APPLE_MUSIC_PLAYER.md](feasibility/FEASIBILITY_APPLE_MUSIC_PLAYER.md)**  
  Analyse de l'intégration officielle de **MusicKit JS v3** (DRM EME, clauses §2.8 / §3.3.6(D), clé 99 $/an vs BYOK).
- **[FEASIBILITY_MULTI_PLATFORM.md](feasibility/FEASIBILITY_MULTI_PLATFORM.md)**  
  Analyse de l'ouverture vers **Spotify, YouTube Music, TIDAL et Deezer** (verrouillages API 2025–2026, modèle N-à-M ISRC, cache TTL).
- **[FAQ_IFRAME_AND_ZERO_COST.md](feasibility/FAQ_IFRAME_AND_ZERO_COST.md)**  
  Pourquoi l'`<iframe>` masqué est bloqué et synthèse de la stratégie 100 % à 0 €.

## 📂 `prompts/` — Prompts Deep Research
- **[GEMINI_DEEP_RESEARCH_OPTIMISATION_V4.md](prompts/GEMINI_DEEP_RESEARCH_OPTIMISATION_V4.md)**  
  Prompt d'optimisation extrême Three.js / WebGL2 / React 19 / FastAPI / DuckDB.
- **[GEMINI_DEEP_RESEARCH_PROMPT.md](prompts/GEMINI_DEEP_RESEARCH_PROMPT.md)**  
  Prompt de vérification des APIs/SDKs officiels 2025–2026.
- **[GEMINI_DEEP_RESEARCH_ZERO_COST_PROMPT.md](prompts/GEMINI_DEEP_RESEARCH_ZERO_COST_PROMPT.md)**  
  Prompt ciblé sur les solutions 100 % gratuites (0 €).

## 📂 `references/` — Rapports PDF de Référence
- **[Optimisation Extrême Three.js et FastAPI.pdf](references/Optimisation%20Extr%C3%AAme%20Three.js%20et%20FastAPI.pdf)** — Base technique des optimisations RAM/GPU V4.1.
- **[Résolution Et Pilotage MusicKit V3.pdf](references/R%C3%A9solution%20Et%20Pilotage%20MusicKit%20V3.pdf)** — Stratégie de résolution 4 paliers et pilotage `window.MusicKit.getInstance()` pour l'extension MV3.
- **[Architecture Streaming Musical Local Gratuit.pdf](references/Architecture%20Streaming%20Musical%20Local%20Gratuit.pdf)** — Architecture 0 € : exports RGPD, débits APIs publiques, tracking multi-OS, lecture pilotée.
- **[APIs Streaming Musical Web DRM.pdf](references/APIs%20Streaming%20Musical%20Web%20DRM.pdf)** — État des APIs officielles & DRM 2025–2026.
- **[Évolution Ambitieuse de AMDataWrap.pdf](references/%C3%89volution%20Ambitieuse%20de%20AMDataWrap.pdf)** — Spécifications initiales de la V3 Continuum.
