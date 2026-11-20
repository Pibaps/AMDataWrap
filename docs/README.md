# Documentation Technique & Études de Faisabilité — AMDataWrap

Ce dossier regroupe les analyses de faisabilité et les prompts de recherche associés pour l'évolution d'`AMDataWrap` vers la lecture complète et le support multi-plateformes.

## 📂 `feasibility/` — Analyses de faisabilité
- **[FEASIBILITY_APPLE_MUSIC_PLAYER.md](feasibility/FEASIBILITY_APPLE_MUSIC_PLAYER.md)**  
  Analyse complète de l'intégration de **MusicKit JS v3** (connexion compte, lecture titres entiers, expérience Bac à Vinyles 3D → Tourne-Disque, tracking temps réel vers `reconciler.py`, blocages DRM EME et clauses Apple §2.8 / §3.3.6(D)).
- **[FEASIBILITY_MULTI_PLATFORM.md](feasibility/FEASIBILITY_MULTI_PLATFORM.md)**  
  Analyse de l'ouverture vers **Spotify, YouTube Music, TIDAL et Deezer** (adaptation du modèle SQLite N-à-M par ISRC, cache TTL, restrictions APIs 2025–2026, exports RGPD/Takeout, abstraction `PlaybackAdapter`).
- **[FAQ_IFRAME_AND_ZERO_COST.md](feasibility/FAQ_IFRAME_AND_ZERO_COST.md)**  
  Réponses ciblées sur l'impossibilité d'un `<iframe>` caché, les contournements gratuits et la stratégie **100 % à 0 €** (imports RGPD/Takeout + tracking OS/extension/mobile).

## 📂 `prompts/` — Prompts Deep Research
- **[GEMINI_DEEP_RESEARCH_PROMPT.md](prompts/GEMINI_DEEP_RESEARCH_PROMPT.md)**  
  Prompt initial de vérification des APIs/SDKs officiels 2025–2026.
- **[GEMINI_DEEP_RESEARCH_ZERO_COST_PROMPT.md](prompts/GEMINI_DEEP_RESEARCH_ZERO_COST_PROMPT.md)**  
  Prompt ciblé sur les **solutions 100 % gratuites (0 €)** : imports RGPD, tracking temps réel (SMTC/MediaRemote/MPRIS/Web Scrobbler/Pano Scrobbler), et pilotage de lecture sans clé payante (pont extension navigateur, Tauri/Electron WebView, `librespot`/AppleScript, YouTube IFrame).
