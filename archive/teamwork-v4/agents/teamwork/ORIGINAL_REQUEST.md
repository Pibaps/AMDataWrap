# Original User Request

## Initial Request — 2026-11-20T14:57:07Z

L'utilisateur demande l'implémentation complète d'AMDataWrap V4 dans le dépôt `/home/antigravity/Pibaps/AMDataWrap` en suivant strictement `docs/plans/PLAN_V4_FINAL.md` (avec `docs/README.md` et le dossier `docs/` en contexte technique si besoin).

## Ordre validé à respecter strictement :
1. **Phase 1 — Socle Multi-Plateformes, Profils, Tracking Live & Lecture Complète (0 €) :**
   - Gestion Multi-Profils (`profiles`, `profile_sources`, profils séparés + vues fusionnées avec déduplication croisée ISRC + `canonical_key_for` + ±180s, filtre global `source_provider` dans `backend/app/filters.py`) & Matrice de Capacités (`GET /api/v4/profile/capabilities`).
   - Les 5 parseurs d'import RGPD/Takeout (`backend/app/importers/` + `POST /api/v4/import` avec auto-détection + assistant guidé) :
     1. Apple Music (`apple.py` — existant préservé/intégré)
     2. Spotify (`spotify.py` — Extended Streaming History & Account Data, filtre `spotify_track_uri IS NOT NULL`, `incognito_mode`, anomalies historiques)
     3. YouTube Music (`youtube.py` — `watch-history.json`, `header == "YouTube Music"`, nettoyage multilingue, suffixe `" - Topic"`, `duration_is_estimated = 1`)
     4. Deezer (`deezer.py` — `.xlsx` via `openpyxl` read-only, en-têtes EN/FR, rejet strict colonne IP, imputation durées `-1`)
     5. TIDAL (`tidal.py` — `.csv` UTF-8 avec auto-détection d'alias + support mappage manuel assisté)
   - Réconciliation ISRC N-à-M & Enrichissement Vrais Vinyles (`recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`, cascade 3 passes : Deezer Public REST API -> MusicBrainz WS/2 + Cover Art Archive -> iTunes Search API).
   - Tracking Temps Réel 0 € PC + Mobile (`backend/app/continuum/`) : state machine OS (Windows SMTC, macOS `mediaremote-adapter`, Linux `MPRIS2`), Webhook Web Scrobbler (`POST /api/v4/webhooks/web-scrobbler`), endpoint ListenBrainz local + setup 1 clic / QR code, et WebSocket Live (`WS /ws/now-playing`).
   - Moteur de Lecture Complète Pluggable à 0 € (`PlaybackProvider`) :
     - `YouTubeIFrameProvider` (résolution `videoId` via `ytmusicapi` sans auth + cache `platform_track_mappings` + repli MusicBrainz `url-rels`, headers anti-Erreur 153 `Referrer-Policy: strict-origin-when-cross-origin`, `playsinline=1`, timeline + tracking `reconciler.py`)
     - `ExtensionBridgeProvider` + Extension Navigateur Manifest V3 dans `extensions/amdatawrap-bridge/` (WebSocket locale `ws://127.0.0.1:8000/ws/bridge`, keepalive 20s + `chrome.alarms`, connecteurs V4.0 : Apple Music Web via `window.MusicKit.getInstance()`, Spotify Web, YouTube Music)
     - `PreviewAudioProvider` (fallback & Audio DNA)

2. **Phase 2 — Nouveau `frontend-v4/` (port `5176`) :**
   - Conserver intactes V1 (`frontend/`), V2 (`frontend-v2/`), V3 (`frontend-v3/`) en parallèle sur le même backend FastAPI (`8000`).
   - ADN visuel V2 (*Sonic Odyssey*) sublimé et corrigé : nébuleuse WebGL douce, auras chromatiques extraites (`--aura-1/2/3`), dock flottant glassmorphism visionOS, typo (`Syne`, `Instrument Serif`, `JetBrains Mono`), **SANS chaîne Hi-Fi**.
   - **Correction #1 :** Zéro reset brutal d'animations via un **seul Canvas 3D persistant** monté à la racine + refs mutables hors-React + transitions interpolées GSAP.
   - **Correction #2 :** **Galaxie 3D V4 lisible** (légende HUD claire, anti-collision des labels, focus au survol en estompant les autres, filtres rapides genre/époque, panneau inspecteur).
   - **Bac à Vinyles & Tourne-Disque 3D complet (`CRATE_BROWSE` -> `SLEEVE_INSPECT` -> `DISC_SLIDE_OUT` -> `TURNTABLE_PLAY`) :**
     - Bac 3D interactif (feuilletage physique + filtres),
     - Retournement Recto/Verso authentique (vrai verso CAA ou verso pressage vinyle généré haute résolution avec Faces A/B/C/D MusicBrainz, label, n° catalogue, année/pays, code-barres, stats perso, tracklist cliquable),
     - Extraction & pose du disque 12" (microsillons proportionnels aux durées, macaron central, Flip Face A/B, pochette sur chevalet « Now Playing »),
     - Tourne-Disque 3D avec **3 finitions en 1 clic** (*Obsidian Glass & Alu brossé*, *Noyer Vintage*, *Alu Studio*), **afficheur digital intégré directement dans le modèle 3D** (écran YouTube IFrame >= 200x200 px avec bascule auto vers cartouche flottant glassmorphism 240x200 px déplaçable hors scène Vinyle / caméra dézoomée, ou infos live BPM/Camelot/FFT hors YouTube), plateau 33⅓/45 RPM à inertie, bras de lecture déplaçable sur sillons (`seek`/changement piste), `START/STOP`, `CUE`, `FLIP A/B`, `EJECT`, capot transparent, bruitages mécaniques Web Audio optionnels.
   - Modules analytiques V2 + meilleurs modules V3 (Onboarding & Hub Connexions/Profils, Vue d'ensemble, Tops, Chronobiologie, Persona & Époques, Obsessions/Skips/Paroles, Science Lab V3 PELT/Russell/Camelot, Atlas Mondial V3, Recherche FTS5, Galaxie 3D V4, Wrapped Sonic Odyssey V4), pilotés par la matrice `capabilities`.

3. **Phase 3 — Optimisations Mobile WebGL2, Accès LAN par QR Code, Mode Boost WebGPU PC Opt-in & Validation Complète :**
   - 4 paliers graphiques automatiques : Tier 0 (CSS 3D / Canvas 2D fallback), Tier 1 (Mobile WebGL2 `DPR <= 1.5`, `/api/artwork-proxy?w=512&fmt=webp`, `< 60 draw calls`, `< 150 Mo VRAM`, contrôles tactiles bas d'écran, `webglcontextlost/restored`), Tier 2 (Desktop WebGL2 `DPR <= 2.0`, 1024px, Bloom sélectif léger, pause `visibilityState === 'hidden'`), Tier 3 (PC Ultra WebGPU Opt-in via `THREE.WebGPURenderer` avec fallback instantané WebGL2).
   - Accès LAN (`--host 0.0.0.0`, CORS LAN propre, endpoint/composant QR Code dans l'app PC pour ouvrir sur smartphone sur le même Wi-Fi, mise à jour scripts de démarrage si pertinent).
   - Validation complète (checklist section 5 de `PLAN_V4_FINAL.md`) : tests unitaires + Hypothesis sur les 5 parseurs, tests multi-profils/fusion sans doublon/capacités, tests lecture YouTube IFrame + ytmusicapi & Extension MV3, tests Playwright Desktop 1440p + Mobile 390×844 sur la scène Bac à Vinyles & Tourne-Disque 3D et la Galaxie 3D V4.

## Contraintes d'environnement et d'organisation :
- Dépôt : `/home/antigravity/Pibaps/AMDataWrap` (ne pas casser V1/V2/V3 ni les tests backend existants).
- Paralléliser intelligemment les chantiers indépendants (ex: parseurs/profils/enrichissement/tracking/extension MV3 en Phase 1, puis modules frontend-v4 / scène 3D / Galaxie / vues analytiques en Phase 2, puis optimisations Phase 3 & tests Playwright) tout en respectant l'ordre strict Phase 1 -> Phase 2 -> Phase 3 et un budget raisonnable.
- Environnement VM Linux : pas de `sudo`/`apt`, utiliser `uv` / `python3 -m venv` / `npm` en espace utilisateur. Utiliser uniquement le mode workspace `inherit` pour tous les sous-agents.
- Langue de communication avec l'utilisateur : Français.
