# Documentation Technique, Études de Faisabilité & Plans — AMDataWrap

Ce dossier centralise les analyses de faisabilité, le plan d'évolution V4, les prompts Deep Research et les rapports PDF de référence.

## 📂 `plans/` — Feuilles de Route
- **[PLAN_V4_DRAFT.md](plans/PLAN_V4_DRAFT.md)**  
  Plan draft complet de la **V4 (« Disquaire 3D Tactile, Lecture Complète & Multi-Plateformes à 0 € »)** :
  - Imports RGPD/Takeout (Apple Music, Spotify, YouTube Music, Deezer, TIDAL) + enrichissement ISRC & pressages vinyles réels (Deezer Public API → MusicBrainz/CAA → iTunes).
  - Tracking temps réel 0 € (Windows SMTC, macOS `mediaremote-adapter`, Linux MPRIS2, Web Scrobbler, ListenBrainz/Pano/FastScrobbler).
  - Lecture complète pluggable 0 € (`YouTube IFrame + ytmusicapi` universel + Extension navigateur MV3 pilotant `MusicKit.getInstance()` sur Apple Music Web & Spotify/YTM/Deezer/TIDAL).
  - Expérience **Bac à Vinyles 3D → Retournement Recto/Verso → Extraction du Disque → Tourne-Disque 3D interactif**.
  - Compatibilité universelle **WebGL2-first (PC & Smartphones)** + **WebGPU en mode boosté PC**.

## 📂 `feasibility/` — Analyses de Faisabilité
- **[FEASIBILITY_APPLE_MUSIC_PLAYER.md](feasibility/FEASIBILITY_APPLE_MUSIC_PLAYER.md)**  
  Analyse de l'intégration officielle de **MusicKit JS v3** (DRM EME, clauses §2.8 / §3.3.6(D), clé 99 $/an vs BYOK).
- **[FEASIBILITY_MULTI_PLATFORM.md](feasibility/FEASIBILITY_MULTI_PLATFORM.md)**  
  Analyse de l'ouverture vers **Spotify, YouTube Music, TIDAL et Deezer** (verrouillages API 2025–2026, modèle N-à-M ISRC, cache TTL).
- **[FAQ_IFRAME_AND_ZERO_COST.md](feasibility/FAQ_IFRAME_AND_ZERO_COST.md)**  
  Pourquoi l'`<iframe>` masqué est bloqué et synthèse de la stratégie 100 % à 0 €.

## 📂 `prompts/` — Prompts Deep Research
- **[GEMINI_DEEP_RESEARCH_PROMPT.md](prompts/GEMINI_DEEP_RESEARCH_PROMPT.md)**  
  Prompt de vérification des APIs/SDKs officiels 2025–2026.
- **[GEMINI_DEEP_RESEARCH_ZERO_COST_PROMPT.md](prompts/GEMINI_DEEP_RESEARCH_ZERO_COST_PROMPT.md)**  
  Prompt ciblé sur les solutions 100 % gratuites (0 €).

## 📂 `references/` — Rapports PDF de Référence
- **[Évolution Ambitieuse de AMDataWrap.pdf](references/%C3%89volution%20Ambitieuse%20de%20AMDataWrap.pdf)** — Spécifications initiales de la V3 Continuum.
- **[APIs Streaming Musical Web DRM.pdf](references/APIs%20Streaming%20Musical%20Web%20DRM.pdf)** — Rapport Deep Research #1 (APIs officielles & DRM 2025–2026).
- **[Architecture Streaming Musical Local Gratuit.pdf](references/Architecture%20Streaming%20Musical%20Local%20Gratuit.pdf)** — Rapport Deep Research #2 (Architecture 0 € : exports RGPD, débits APIs publiques, tracking multi-OS, lecture pilotée).
