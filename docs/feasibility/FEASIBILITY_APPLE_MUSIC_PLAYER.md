# Analyse de faisabilité #1 — Lecteur Apple Music complet (MusicKit JS v3), Expérience « Bac à Vinyles → Tourne-Disque » & Tracking Temps Réel

**Projet :** `AMDataWrap` (V3 « Continuum »)  
**Date :** Novembre 2026  
**Statut :** Finalisé & vérifié (sources officielles & changelogs 2025–2026)

---

## 1. Verdict Exécutif

| Critère | Faisabilité | Niveau d'effort | Notes clés (état 2026) |
| :--- | :---: | :---: | :--- |
| **Connexion compte Apple Music** | **Oui** | Moyen | OAuth Apple via MusicKit JS v3 (`Music User Token`). |
| **Lecture de titres entiers (non-extraits)** | **Oui** | Moyen | Requiert abonnement Apple Music actif côté utilisateur + **Apple Developer Program (99 $/an)**. |
| **Usage personnel local vs Open-Source** | **Contraint** | — | La clause **§2.8** interdit le partage de clé/accès : en pur `localhost`, chaque utilisateur doit avoir son propre compte Developer (99 $/an). |
| **Expérience Bac à Vinyles 3D → Platine** | **Oui** | Faible–Moyen | Le Bac 3D (`UnifiedObservatoryCanvas`) et le Dock (`SpatialAudioDock`) existent déjà ; câblage queue album MusicKit. |
| **Tracking automatique vers SQLite/Continuum** | **Oui** | Moyen | Écoute des événements MusicKit + inférence fin naturelle vs skip → `reconciler.py`. |
| **Analyse FFT temps réel (`AnalyserNode`)** | **Non (natif)** | — | **Bloqué par le DRM FairPlay / Widevine (W3C EME)** dans le navigateur (renvoie des zéros). Contournement hybride via previews 30s. |

> **Conclusion :** Techniquement, l'intégration du lecteur complet Apple Music dans `AMDataWrap` est **totalement faisable** et s'emboîte dans l'architecture V3 existante. Le principal frein n'est pas technique mais **économique et contractuel** : pour un outil local open-source distribué sur `127.0.0.1`, la licence Apple (§2.8) empêche de fournir une clé partagée (chaque utilisateur devrait payer 99 $/an), tandis que le DRM EME impose de remplacer l'analyseur FFT réel par une animation rythmique d'ambiance.

---

## 2. Architecture actuelle vs Architecture cible

### Ce qui existe déjà dans `AMDataWrap`
- **Catalogue local & IDs Apple :** `tracks_catalog` ([`backend/app/db.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/db.py#L76-L104)) stocke déjà `itunes_track_id` pour la majorité des titres enrichis.
- **Bac à Vinyles 3D :** [`Observatory3DPage.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/pages/Observatory3DPage.tsx#L45-L50) et [`UnifiedObservatoryCanvas.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/components/UnifiedObservatoryCanvas.tsx) affichent déjà les pochettes d'albums cliquables en 3D.
- **Lecteur & Store :** [`playerStore.ts`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/store/playerStore.ts) et [`SpatialAudioDock.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/components/SpatialAudioDock.tsx) gèrent la lecture actuelle (extraits 30s via `/api/audio-proxy`).
- **Moteur de réconciliation :** [`reconciler.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/continuum/reconciler.py) gère déjà la déduplication multi-sources (`PROVIDER_PRIORITY`, fenêtre ±180s, `canonical_key_for`).

### Ce qu'il faut ajouter
1. **Backend — Générateur de Developer Token :** Endpoint `GET /api/v3/musickit/developer-token` signant un JWT ES256 à l'aide de la clé privée `.p8` (MusicKit Key) stockée localement en mode **BYOK** (*Bring Your Own Key*).
2. **Frontend — Provider `MusicKitAdapter` :** Chargement obligatoire depuis le CDN Apple (`https://js-cdn.music.apple.com/musickit/v3/musickit.js`), configuration asynchrone (`await MusicKit.configure(...)`), authentification (`await music.authorize()`), contrôle plat (`music.setQueue()`, `music.play()`).
3. **Frontend/Backend — Tracker de session :** Hook d'écoute des événements MusicKit envoyant les écoutes validées au backend (`POST /api/v3/player/track-event` ou via `/apis/listenbrainz/1/submit-listens`).

---

## 3. Fonctionnement détaillé de MusicKit JS v3

### A. Double authentification requise
1. **Developer Token (JWT ES256) :**
   - Généré côté backend Python (`PyJWT` + `cryptography`) à partir d'un *Media Identifier*, d'un *Key ID* et d'une clé privée `.p8` (max 2 clés par identifiant) issus d'un compte **Apple Developer Program (99 $/an)** (ou 299 $/an Enterprise).
   - Durée de validité maximale : **6 mois (`15 777 000 s`)**.
   - **Claim `origin` :** Pour le web, le JWT doit intégrer le claim `origin` verrouillé à l'origine exacte du site (fonctionne sur une origine locale Chrome en développement).
   - **Quotas :** Aucun plafond d'utilisateurs type « 5 users » sur le web ; rate limit non publié (renvoie `HTTP 429` en cas de dépassement).
2. **Music User Token (MUT) :**
   - Obtenu via `await music.authorize()` (popup Apple ID + 2FA/Passkey).
   - **Point d'attention :** Le MUT **ne se rafraîchit pas automatiquement** — à son expiration, l'utilisateur doit se ré-autoriser manuellement.
   - Si l'utilisateur possède un abonnement Apple Music actif, MusicKit débloque la lecture intégrale. Sans autorisation ou sans abonnement, MusicKit bascule automatiquement en mode **`previewOnly`** (extraits 30s non chiffrés).

### B. Résolution des vinyles (Albums) & Pistes
Dans le scénario *« piocher un vinyle dans le bac et le poser sur la platine »* :
1. L'utilisateur clique sur un vinyle dans [`UnifiedObservatoryCanvas.tsx`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/components/UnifiedObservatoryCanvas.tsx) (`album_key`).
2. Le backend renvoie les pistes de l'album (`GET /api/detail/album/{album_key}`) avec leurs `itunes_track_id`.
3. **Cas 1 (IDs présents) :** `await music.setQueue({ songs: ['123456', '123457', ...], startPlaying: true })`.
4. **Cas 2 (Album complet) :** Résolution via `GET https://api.music.apple.com/v1/catalog/{storefront}/search?term={artist}+{album}&types=albums` puis `await music.setQueue({ album: appleAlbumId })`.

---

## 4. Tracking temps réel & Réconciliation (`Continuum`)

### A. Pourquoi le tracking côté lecteur est indispensable
L'API REST Apple Music est très limitée pour l'historique :
- `GET /v1/me/recent/played/tracks` est plafonné à **30 pistes maximum**, dédoublonne automatiquement les écoutes répétées (une chanson jouée 5 fois n'apparaît qu'une fois) et ne fournit **ni durée écoutée ni motif de fin**.
- `GET /v1/me/recent/played` ne renvoie que des conteneurs (50 max), sans horodatage `playedAt`.
- L'export RGPD (`Apple Music Play Activity.csv`) reste très riche, mais son délai d'obtention peut atteindre plusieurs semaines (jusqu'à ~40 jours rapportés).

### B. Télémétrie MusicKit JS v3 → `reconciler.py`
`MusicKit.getInstance()` expose `playbackStateDidChange`, `playbackStateWillChange`, `nowPlayingItemDidChange`, ainsi que `playbackTime`, `playbackState` (`MusicKit.PlaybackStates`) et `nowPlayingItem` (`MediaItem`).

**Algorithme de tracking recommandé :**
1. À `nowPlayingItemDidChange`, démarrer un compteur de lecture effective (`accumulatedPlayMs`, incrémenté uniquement quand `playbackState === playing`).
2. **Inférence fin naturelle vs skip :** MusicKit JS ne distinguant pas nativement une fin naturelle d'un skip, comparer la position atteinte lors du changement de `nowPlayingItem` à `duration` :
   - `completion_ratio = accumulatedPlayMs / media_duration_ms`
   - `is_skip_30s = 1` si `accumulatedPlayMs < 30_000`
   - `is_valid_lastfm = 1` si `accumulatedPlayMs >= 30_000 && (completion_ratio >= 0.5 || accumulatedPlayMs >= 240_000)`
   - `end_reason_type` : `NATURAL_END_OF_TRACK` si `completion_ratio >= 0.95`, sinon `TRACK_SKIPPED_FORWARDS` / `MANUALLY_STOPPED`.
3. **Priorité dans [`PROVIDER_PRIORITY`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/continuum/reconciler.py#L32-L38) :**
   - Ajouter `'musickit_web': 80` (entre `apple_rgpd_zip: 100` et `local_smtc: 70`).
   - Évite tout doublon si `smtc_worker.py` tourne en parallèle sur Windows, et sera enrichi proprement si un futur import RGPD (priorité 100) est chargé.

---

## 5. Limitations critiques & Contraintes 2026

### A. Le mur du DRM (W3C EME) sur `reactiveAudio.ts`
Dans [`reactiveAudio.ts`](file:///home/antigravity/Pibaps/AMDataWrap/frontend-v3/src/audio/reactiveAudio.ts#L53-L69), `AMDataWrap` utilise `AudioContext.createMediaElementSource()` + `AnalyserNode` pour le spectre FFT 32 bandes et le worker WASM Essentia.js (`audioDna.worker.ts`).

**Fait technique :** Les flux complets MusicKit JS sont déchiffrés dans un *Content Decryption Module* (CDM FairPlay/Widevine via W3C EME). Le navigateur isole le signal PCM et **force `AnalyserNode` à renvoyer des zéros (silence)**.

**Contournement propre & conforme :**
1. **Audio DNA (BPM, tonalité Camelot) :** Continuer d'analyser le `preview_url` (30s non-DRM via `/api/audio-proxy`) en arrière-plan pour `audioDna.worker.ts`, ou interroger l'API TIDAL v2 / Deezer.
2. **Animation de la platine 3D & Dock :** Piloter les visuels par l'état de lecture (`playing/paused`), la progression temporelle (angle du bras de lecture proportionnel à `position / duration`), la palette de pochette et une animation rythmique d'ambiance calée sur le BPM.

### B. Bugs & limites navigateurs documentés (2025–2026)
- **Pas de gapless parfait :** Des coupures audibles entre pistes enchaînées (*« Significant Gap Between Tracks »*) restent signalées sur Chrome et Safari en juillet 2026.
- **Electron bloqué :** MusicKit JS échoue à lancer la lecture dans un prototype Electron standard (`playbackTime` figé à 0), alors que le même code fonctionne dans Chrome.
- **iOS 26.4–26.6.2 (2026) :** Blocages possibles si l'app native Apple Music affiche un écran « Nouveautés » non validé, et perte de continuité PiP en `WKWebView`.

### C. Règles contractuelles Apple (§2.8, §3.3.6(D) & Guideline 4.5.2)
- **Interdiction de partage de clé (§2.8) :** La clé `.p8` ne doit jamais être embarquée dans un code client distribué. En usage purement local open-source (`127.0.0.1`), chaque utilisateur doit fournir sa propre clé (99 $/an). Un proxy serveur n'est envisageable que sur un domaine public hébergé, strictement **non monétisé**.
- **Anti-synchronisation (§3.3.6(D)) :** Interdiction de synchroniser étroitement le contenu MusicKit avec un média visuel. L'animation du vinyle 3D doit rester un **indicateur d'état d'ambiance** (rotation/bras/palette) et non une synchronisation audiovisuelle stricte.
- **Branding & Contrôles :** Conserver les contrôles standard (play/pause/skip), ne pas dissocier pochettes/textes de la lecture, ne pas juxtaposer le badge Apple Music à ceux de concurrents, et charger MusicKit JS uniquement depuis le CDN officiel Apple.

---

## 6. Plan d'implémentation recommandé

> **Positionnement stratégique :** En raison du coût de 99 $/an imposé par la clause §2.8 pour les utilisateurs locaux, MusicKit JS v3 est idéal comme **module optionnel (BYOK)** pour les utilisateurs possédant déjà un compte Apple Developer, en complément d'un lecteur universel gratuit (YouTube IFrame) ou Spotify BYOK.

1. **Phase 1 — Infrastructure Token & Auth (BYOK)** : Endpoint `/api/v3/musickit/developer-token` + configuration `.p8` dans le Hub Continuum (`ContinuumHubPage.tsx`).
2. **Phase 2 — Double Moteur (`Preview` ↔ `MusicKit`)** : Abstraction `PlaybackAdapter` dans `frontend-v3/src/audio/`, mode FFT d'ambiance BPM-synced, câblage Bac à Vinyles 3D → Platine.
3. **Phase 3 — Tracking & Réconciliation** : Endpoint `POST /api/v3/player/track-event` → `reconcile_batch()` avec `musickit_web` (priorité 80).
