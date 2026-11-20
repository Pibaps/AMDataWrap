# Plan Final Validé — AMDataWrap V4 (« SONIC ODYSSEY × VINYL STUDIO 3D »)

**Statut :** Spécification validée via `/grill-me` — prête pour implémentation  
**Frontend dédié :** `frontend-v4/` (port `5176`) — *V1 (`5173`), V2 (`5174`) et V3 (`5175`) conservées intactes en parallèle sur le même backend FastAPI (`8000`).*  
**Enjeu #1 :** **Connexion multi-plateformes (Apple Music, Spotify, YouTube Music, Deezer, TIDAL), profils séparés/fusionnés, tracking automatique et lecture réelle de morceaux entiers à 0 €.**  
**Direction artistique :** **ADN visuel V2 (*Sonic Odyssey*)** corrigé (zéro reset brutal d'animation, Galaxie 3D lisible) centré sur un **Bac à Vinyles & Tourne-Disque 3D interactif** (sans chaîne Hi-Fi).  
**Compatibilité :** **Tous PCs, navigateurs et smartphones** (WebGL2 par défaut, WebGPU en mode boosté PC opt-in).

---

## 1. Décisions d'Architecture Verrouillées (`/grill-me`)

| Domaine | Décision validée |
| :--- | :--- |
| **Lecture complète à 0 €** | **Hybride :** `YouTube IFrame + ytmusicapi` (universel PC & Mobile, 0 install) **+** **Extension Navigateur MV3** (PC, pilotes tes vrais comptes connectés dans un onglet à 0 €). |
| **Plateformes Extension MV3** | **V4.0 :** Apple Music Web (`window.MusicKit.getInstance()`), Spotify Web, YouTube Music. **V4.1 :** Deezer & TIDAL. |
| **Intégration YouTube IFrame (≥ 200×200 px ToS)** | **Double affichage intelligent :** Cartouche *glassmorphism* flottant style V2 (`240×200 px`, déplaçable, affiché uniquement quand YouTube est actif) sur les pages stats **+** **Afficheur digital intégré directement sur le modèle 3D du tourne-disque** sur la scène Vinyle. |
| **Profils & Multi-Plateformes** | Onboarding guidé par plateforme → **Profils séparés** (un par plateforme/utilisateur) **ET fusion à la demande** (ex: Spotify historique + Apple Music actuel, ou usage simultané dédupliqué par ISRC/±180s) + filtre global « Plateforme ». |
| **Différences entre plateformes** | **Matrice de capacités (`capabilities`)** renvoyée par le backend : masquage propre des widgets non supportés, badges transparents (*« Durée estimée »* sur YTM), mise en valeur des champs exclusifs (ex: `incognito_mode`/`shuffle` Spotify, `LYRIC_DISPLAY`/`Search` Apple Music). |
| **Parseurs d'import RGPD V4.0** | **Les 5 dès la V4.0 :** Apple Music, Spotify (Extended & Account Data), YouTube Music (Takeout JSON), Deezer (`.xlsx`), TIDAL (`.csv` assisté). |
| **Tracking temps réel 0 € V4.0** | **Pack complet PC + Mobile avec setup guidé simple (QR code / copie 1 clic) :** Windows SMTC, macOS (`mediaremote-adapter`), Linux (`MPRIS2`), Webhook Web Scrobbler, ListenBrainz local (Pano Scrobbler Android, FastScrobbler iOS, multi-scrobbler) + WebSocket live vers le tourne-disque 3D. |
| **Frontend V4 (`frontend-v4/`)** | ADN V2 (*Sonic Odyssey*) + meilleurs modules V3 (Science Lab, Atlas, Hub Live, FTS5) + Studio Vinyle & Tourne-Disque 3D central (**sans chaîne Hi-Fi**). Corrections V2 : **Galaxie 3D lisible** + **zéro reset brutal d'animations**. |
| **Interactions Vinyle 3D V4.0** | **Expérience complète dès la V4.0 :** feuilletage du bac, retournement Recto/Verso authentique (vraies infos pressage + tracklist cliquable), glissement du disque hors pochette, Flip Face A/B, bras de lecture déplaçable sur sillons proportionnels + bruitages mécaniques Web Audio optionnels. |
| **Finitions du Tourne-Disque 3D** | **Personnalisables en 1 clic :** *Obsidian Glass & Alu brossé* (défaut, harmonie V2) + *Noyer Vintage* + *Alu Studio*. |
| **Ordre de développement** | **Phase 1 :** Socle Multi-Plateformes + Tracking 0 € + Moteur Lecture (YouTube IFrame + Extension MV3) → **Phase 2 :** Frontend V4 (Studio Vinyle & Tourne-Disque 3D + ADN V2 corrigé + modules V3) → **Phase 3 :** Mobile, WebGPU PC opt-in & V4.1. |

---

## 2. Phase 1 — Socle Multi-Plateformes, Profils, Tracking Live & Lecture Complète (0 €)

### 2.1 Gestion Multi-Profils, Fusion & Matrice de Capacités (`backend/app/db.py`, `backend/app/profiles.py`)
1. **Table `profiles` & `profile_sources` :**
   - Chaque import crée ou alimente un `profile_id` (ex: *« Mon Apple Music »*, *« Mon Spotify »*, ou un profil virtuel fusionné `merged_profile_ids = [1, 2]`).
   - L'utilisateur peut à tout moment basculer de profil, importer une nouvelle plateforme dans un profil séparé, ou créer une **vue fusionnée** (déduplication croisée via **ISRC** + `canonical_key_for` + fenêtre temporelle ±180s).
   - Ajout d'un filtre global `source_provider` dans `FilterParams` ([`backend/app/filters.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/filters.py)).
2. **Endpoint `GET /api/v4/profile/capabilities` :**
   Calcule dynamiquement ce que le profil actif contient réellement :
   ```json
   {
     "platforms": ["apple_music", "spotify"],
     "has_exact_duration": true,
     "estimated_duration_pct": 0.0,
     "has_skips": true,
     "has_end_reasons": true,
     "has_lyrics_events": true,
     "has_search_events": true,
     "has_devices": true,
     "has_audio_quality": true,
     "has_incognito_flag": true,
     "has_shuffle_flag": true
   }
   ```
   Le frontend adapte automatiquement chaque vue (ex : n'affiche pas un bloc « Recherches » vide sur Spotify, affiche un indicateur *« Durées estimées »* si le profil inclut YouTube Music Takeout, débloque les stats `incognito_mode` / `shuffle` si Spotify est présent).

### 2.2 Les 5 Parseurs d'Import RGPD / Takeout (`backend/app/importers/`)
Auto-détection du format au drag & drop sur `POST /api/v4/import` + assistant guidé par plateforme :
- **Apple Music (`apple.py`) :** Existant (`Apple Music Play Activity.csv`, ZIP imbriqués, jointure `Daily Tracks` & `Library Tracks`).
- **Spotify (`spotify.py`) :**
  - Détection automatique *Extended Streaming History* (`Streaming_History_Audio_*.json` : `ts`, `ms_played`, `spotify_track_uri`, `reason_start`, `reason_end`, `shuffle`, `skipped`, `offline`, `incognito_mode`) vs *Account Data* (`StreamingHistory_music_*.json` : `msPlayed`).
  - Filtrage strict `spotify_track_uri IS NOT NULL` (exclut podcasts/audiobooks), option de filtre `incognito_mode`, gestion des anomalies historiques (`skipped` 2015–2022, `offline_timestamp`).
- **YouTube Music (`youtube.py`) :**
  - Parse `watch-history.json` filtré sur `header == "YouTube Music"`.
  - Nettoyage dynamique multilingue du préfixe (*"Watched "*, *"Vous avez regardé "*, etc.) et du suffixe `" - Topic"` sur `subtitles[0].name`, tolérance vidéos supprimées, flag `duration_is_estimated = 1`.
- **Deezer (`deezer.py`) :**
  - Lecture `openpyxl` read-only sur le classeur `.xlsx`, détection d'en-têtes EN/FR, horodatages UTC, **rejet strict de la colonne IP**, imputation des durées `-1`.
- **TIDAL (`tidal.py`) :**
  - Importateur `.csv` UTF-8 avec auto-détection d'alias (`Title`/`Track Name`, `Artist`, `Album`, `Duration`, `ISRC`) + écran de mappage manuel assisté si colonnes atypiques.

### 2.3 Réconciliation ISRC N-à-M & Enrichissement Vrais Vinyles (`backend/app/enrichment.py`)
Nouvelles tables SQLite :
- `recording_isrcs (track_key, isrc)` — relation N-à-M.
- `platform_track_mappings (track_key, provider, external_id, url, resolved_at)`.
- `vinyl_editions (album_key, mbid_release_group, mbid_vinyl_release, label_name, catalog_number, country, press_year, disc_count, vinyl_color_hex, front_cover_url, back_cover_url, medium_label_url, sides_json, enriched_at)`.
- `api_metadata_cache (cache_key, payload_json, expires_at)` — cache TTL conforme.

**Cascade gratuite à 3 passes (après déduplication par `(artiste, titre)`) :**
1. **Deezer Public REST API** (`50 req / 5 s` = `600 req/min`, ~1,7 min / 1 000 titres) — 0 auth, **ISRC natif** + durées + pochettes HD.
2. **MusicBrainz WS/2 + Cover Art Archive** (`1 req/s` = `60 req/min`, `User-Agent` nominatif, backoff HTTP 503) — **éditions vinyles réelles 12" LP** (Faces A/B/C/D, label, n° de catalogue, pays/année) + pochettes **Recto (`front`)**, **Verso (`back`)** et **Macaron (`medium`)**.
3. **iTunes Search API** (`~20 req/min`, espacé à 3,5 s) — repli ciblé + `preview_url` 30s (Audio DNA).

### 2.4 Tracking Temps Réel 0 € (PC + Mobile) & WebSocket Live (`backend/app/continuum/`)
- **State Machine OS (FastAPI) :**
  - **Windows :** `pywinrt` (`winrt-Windows.Media.Control`) / `winsdk` (référence forte asyncio + polling de secours).
  - **macOS (15.4+ / 26) :** Sous-processus `ungive/mediaremote-adapter` (`media-control stream` via `/usr/bin/perl`) avec auto-test au démarrage.
  - **Linux :** `MPRIS2` D-Bus (`org.mpris.MediaPlayer2.Player`) avec chronomètre interne contre le bug `Position = 0` de Spotify Linux.
- **Webhook Web Scrobbler :** `POST /api/v4/webhooks/web-scrobbler` (`nowplaying`, `scrobble`, `loved`, `paused`, `resumedplaying`, retour `HTTP 200`).
- **Endpoint ListenBrainz Local :** `/apis/listenbrainz/1/submit-listens` (déjà présent) + assistant de setup **1 clic / QR Code** pour **Pano Scrobbler (Android)**, **FastScrobbler (iOS)**, **Web Scrobbler** et **multi-scrobbler**.
- **WebSocket Live (`WS /ws/now-playing`) :** Diffuse l'état de lecture temps réel vers le Tourne-Disque 3D pour que le vinyle tourne en direct même lors d'écoutes externes (téléphone ou app desktop).

### 2.5 Moteur de Lecture Complète Pluggable à 0 € (`PlaybackProvider`)
1. **`YouTubeIFrameProvider` (Par défaut — PC & Mobile, 0 install) :**
   - Résolution `videoId` backend via `sigma67/ytmusicapi` sans auth (`YTMusic().search(..., filter="songs")`) mise en cache permanent dans `platform_track_mappings` (+ repli `url-rels` MusicBrainz).
   - Headers anti-Erreur 153 : `Referrer-Policy: strict-origin-when-cross-origin` + `referrerpolicy` sur l'`<iframe>` + `origin` + `playsinline=1` (iOS).
   - Timeline exacte (`getCurrentTime()`, `YT.PlayerState.ENDED === 0`) + tracking automatique vers `reconciler.py`.
2. **`ExtensionBridgeProvider` (Option PC — Vrais comptes abonnés à 0 €) :**
   - Extension open-source **Manifest V3** dans `extensions/amdatawrap-bridge/` (Chrome, Edge, Firefox).
   - WebSocket locale (`ws://127.0.0.1:8000/ws/bridge`, keepalive **20 s** pour Chrome 116+ + `chrome.alarms`).
   - **Connecteurs V4.0 :**
     - **Apple Music Web (`music.apple.com`) :** Appel direct `window.MusicKit.getInstance()` (`setQueue`, `play`, `pause`, `seekToTime`) — **lecture complète à 0 € sans compte Apple Developer à 99 $/an**.
     - **Spotify Web (`open.spotify.com`) :** Navigation URL album/piste + adaptateurs DOM/ARIA maintenus (`WebNowPlaying-Redux`).
     - **YouTube Music (`music.youtube.com`) :** `#movie_player` + élément `<video>`.
   - Gestion fluide de l'Autoplay Policy (bouton d'amorçage de session / focus ponctuel si `NotAllowedError`).
3. **`PreviewAudioProvider` (Fallback & Audio DNA) :** Extraits 30s non-DRM pour vraie FFT Web Audio + Essentia.js WASM.

---

## 3. Phase 2 — Frontend V4 (`frontend-v4/`, port `5176`) : ADN V2 Corrigé & Studio Vinyle 3D

### 3.1 ADN Visuel V2 Sublimé & Corrections des Défauts V2
- **On garde ce qui faisait le WOW de la V2 :** Nébuleuse WebGL douce en arrière-plan, auras chromatiques extraites de la pochette en cours (`--aura-1`, `--aura-2`, `--aura-3`), dock flottant *glassmorphism* style visionOS, typographie éditoriale (`Syne` + `Instrument Serif` + `JetBrains Mono`).
- **Zéro chaîne Hi-Fi :** L'espace est pur, aérien, entièrement dédié à l'objet culte (**Bac à Vinyles + Tourne-Disque 3D**) et aux données.
- **Correction #1 (Zéro reset brutal d'animations) :**
  - **Un seul Canvas 3D persistant** monté à la racine, qui ne démonte jamais lors des changements de filtres, de morceaux ou d'onglets.
  - Toute l'animation 60 FPS (rotation plateau, bras, particules, auras, caméra) vit dans des refs mutables hors-React + **transitions interpolées GSAP** (plus jamais de saut ou de réinitialisation sèche !).
- **Correction #2 (Galaxie 3D enfin 100 % lisible) :**
  - Légende HUD claire et discrète (secteurs = genres, taille = temps d'écoute, hauteur = époque).
  - Labels typographiques propres avec anti-collision (affichage des top artistes + focus net sur l'artiste survolé en estompant les autres).
  - Filtres rapides par genre/époque directement dans la scène + panneau inspecteur clair au clic.

### 3.2 Scène Phare : Bac à Vinyles & Tourne-Disque 3D Complet (V4.0)
Machine à états fluide (`CRATE_BROWSE` → `SLEEVE_INSPECT` → `DISC_SLIDE_OUT` → `TURNTABLE_PLAY`) :
1. **Bac à Vinyles 3D (*Record Crate*) :**
   - Feuilletage physique (*flip-through* fluide à la souris ou au doigt), filtres (*Top Albums*, *Par Ère*, *Par Genre*, *Récents*, *Pioche aléatoire*).
2. **Inspection & Retournement Recto / Verso Authentique :**
   - Sortie vers la caméra, retournement 360° souple :
     - **Recto :** Pochette HD officielle + tranche (*spine*) imprimée.
     - **Verso :** Vraie pochette arrière Cover Art Archive si dispo, ou **verso pressage vinyle généré haute résolution** (Faces A/B/C/D réelles MusicBrainz, durées, Label, N° de catalogue, année/pays, code-barres, tes stats perso).
     - **Tracklist cliquable :** cliquer sur un morceau lance la pose directe sur son sillon.
3. **Extraction & Pose du Disque 12" :**
   - Geste glisser-tirer (ou bouton) → la sous-pochette s'entrouvre, le disque glisse dehors (microsillons concentriques proportionnels aux vraies durées + macaron central authentique), choix **Face A ↔ Face B**, puis vol fluide vers le plateau pendant que la pochette se pose sur le chevalet *« Now Playing »*.
4. **Tourne-Disque 3D Interactif (3 Finitions en 1 clic) :**
   - **Finitions :** *Obsidian Glass & Alu brossé* (défaut, harmonie V2), *Noyer Vintage*, *Alu Studio*.
   - **Afficheur Digital Intégré dans le Modèle 3D du Tourne-Disque :**
     - Affiche proprement et nativement l'écran **YouTube IFrame** (≥ 200×200 px, bascule auto en cartouche flottant V2 si caméra dézoomée ou changement de vue) ou, hors YouTube, les infos live (BPM, Camelot, spectre BPM-synced / FFT, timer).
   - **Commandes physiques 3D :**
     - Plateau **33⅓ / 45 RPM à inertie physique**,
     - **Bras de lecture (*Tonearm*) déplaçable à la souris/au doigt** sur les sillons (`seek` / changement de piste),
     - Boutons `START / STOP`, levier `CUE`, `FLIP A/B` (retournement physique du disque en 3D), `EJECT`, capot transparent,
     - **Bruitages mécaniques Web Audio optionnels** (carton, déclic, léger *crackle* au posé du diamant, désactivables en 1 clic).

### 3.3 Modules Analytiques & Navigation Unifiée
- **Onboarding & Hub Connexions/Profils :** Choix plateforme, import drag & drop guidé, gestionnaire de profils (séparés / fusion), assistant Tracking Live 0 € (QR code mobile + état SMTC/Web Scrobbler/Extension MV3).
- **Vues V2 + V3 intégrées en style V2 (*glassmorphism*) :** Vue d'ensemble, Tops, Chronobiologie, Persona & Époques, Obsessions/Skips/Paroles, **Science Lab V3** (Ères PELT, Boussole Russell, Roue Camelot + Mix Harmonique), **Atlas Mondial V3**, **Recherche instantanée FTS5**, **Galaxie 3D V4 (lisible)**, **Wrapped Sonic Odyssey V4**.

---

## 4. Phase 3 — Compatibilité Universelle (PC & Smartphones), Mode Boost WebGPU & V4.1

### 4.1 4 Paliers Graphiques Automatiques (WebGL2-First, WebGPU en Boost PC)
- **Tier 0 (Eco / Fallback) :** CSS 3D + Canvas 2D si WebGL indisponible.
- **Tier 1 (Mobile Fluide — WebGL2) :** Smartphones iOS Safari & Android Chrome/Firefox. `DPR ≤ 1.5`, proxy `/api/artwork-proxy?w=512&fmt=webp`, `< 60 draw calls`, `< 150 Mo VRAM`, contrôles tactiles accessibles au pouce en bas d'écran, `webglcontextlost/restored` robuste.
- **Tier 2 (Desktop Rich 3D — WebGL2 par défaut sur PC/Mac/Linux) :** `DPR ≤ 2.0`, textures 1024 px, Bloom sélectif léger, reflets HDR studio, 60 FPS fluides, pause énergétique sur `visibilityState === 'hidden'`.
- **Tier 3 (PC Ultra — WebGPU Opt-in) :** `THREE.WebGPURenderer` activé uniquement sur PC compatible (`navigator.gpu` + toggle utilisateur) pour réflexions anisotropes physiques sur les microsillons et ombres douces avancées, avec fallback instantané WebGL2.

### 4.2 Accès Smartphone sur Réseau Local (0 €)
- Backend & Vite configurés pour écouter sur le réseau local (`--host 0.0.0.0`, CORS LAN propre) + affichage d'un **QR Code dans l'app PC** pour ouvrir immédiatement `AMDataWrap V4` sur son téléphone sur le même Wi-Fi.

### 4.3 Suite V4.1 (Post-V4.0)
- Ajout des connecteurs **Deezer Web** & **TIDAL Web** dans l'extension navigateur MV3 `amdatawrap-bridge`.
- Packaging optionnel Desktop **Castlabs Electron ECS + EVS VMP gratuit** si demandé ultérieurement.

---

## 5. Checklist de Validation avant Livraison V4.0
- [ ] Import testé (unitaires + Hypothesis) sur les 5 formats : Apple Music, Spotify Extended/Account, YouTube Music Takeout, Deezer `.xlsx`, TIDAL `.csv`.
- [ ] Profils séparés + Fusion multi-plateformes sans doublon (ISRC + ±180s) + Matrice de capacités vérifiée dans l'UI.
- [ ] Lecture complète vérifiée sur `YouTube IFrame + ytmusicapi` (PC & Mobile, zéro Erreur 153) et sur l'Extension MV3 (`MusicKit.getInstance()` Apple Music Web, Spotify Web, YouTube Music).
- [ ] Scène Bac à Vinyles & Tourne-Disque 3D testée en Playwright (Desktop 1440p + Mobile 390×844) : zéro reset brutal d'animation, `< 60 draw calls`, afficheur digital intégré fonctionnel, 3 finitions opérationnelles.
- [ ] Galaxie 3D V4 vérifiée lisible avec légende et anti-collision des labels.
