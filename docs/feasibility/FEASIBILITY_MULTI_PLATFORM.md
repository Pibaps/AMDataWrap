# Analyse de faisabilité #2 — Ouverture Multi-Plateformes (Spotify, YouTube Music, Deezer, Tidal) : Modèle de Données & Lecture en Direct

**Projet :** `AMDataWrap` (V3 « Continuum »)  
**Date :** Novembre 2026  
**Statut :** Finalisé & vérifié (sources officielles & changelogs 2025–2026)

---

## 1. Verdict Exécutif (Paysage 2025–2026)

Le paysage des APIs de streaming a connu un **verrouillage sans précédent en 2025–2026**. Aucune plateforme ne réunit simultanément un SDK web gratuit sans friction, une API d'historique complète et une licence autorisant un déploiement public indépendant.

L'architecture viable pour `AMDataWrap` repose sur un modèle **Local Offline-First & BYOK (*Bring Your Own Keys*)** servi sur `http://127.0.0.1:PORT` :

| Plateforme | SDK Web officiel (titres complets) | Coût / Quota Dev (2025–2026) | Abonnement User requis ? | Web Audio FFT ? | Qualité Export RGPD | Viabilité Locale Perso vs Publique |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| **Spotify** | `Web Playback SDK` (`spotify-player.js`) *(bug iOS 26.5 juil. 2026)* | **Premium dev obligatoire** (fév. 2026) ; **5 users/app** ; 25 Client IDs/compte (juil. 2026) ; Extended Quota = ≥ 250k MAU + société | **Oui (Premium)** *(hors mobile-only)* | **Non** *(DRM EME + ToS)* | **Excellente** : JSON *Extended Streaming History* (`ms_played`, `reason_end`, `skipped`, URI) | **Locale : Élevée (BYOK)**<br>Publique : Nulle (mur 5 users) |
| **YouTube Music** | **Aucun SDK YT Music.** Repli officiel : `YouTube IFrame Player API` *(≥ 200×200 px visible)* | **Gratuit sans clé** (IFrame). Data API v3 = 10 000 u/j *(quotas granulaires juin 2026)* | **Non** *(gratuit avec pubs ; sans pub si Premium)* | **Non** *(iframe cross-origin)* | **Pauvre** : JSON rapide (5–10 min), mais **aucune durée**, aucun skip, purge auto à 36 mois | **Locale : Élevée** *(si iframe visible)*<br>Publique : Moyenne |
| **TIDAL** | `TIDAL SDK for Web` (`tidal-sdk-web`, TypeScript, Apache 2.0) | **Gratuit** (10 apps) ; Dev Mode non-commercial ; **extensions de quota gelées** | **Oui (TIDAL payant)** | **Non** *(module officiel protégé)* | **Faible / opaque** : ticket support manuel (CSV non garanti) ; **0 API Recently Played** | **Locale : Bonne (BYOK)**<br>Publique : Faible (quotas gelés) |
| **Deezer** | `DZ.player` **déprécié, non maintenu, cassé** (30s mobile) | **Portail fermé** (création d'apps bloquée 2024–2026) + révocation d'apps nov. 2025 (`code 50`) | **Oui (Premium)** | **Non** | **Moyenne / imparfaite** : `.xlsx` via support (≤ 30 j), lacunes de durée selon client | **Locale : Nulle (lecture/OAuth)**<br>*API catalogue publique utile pour ISRC* |

---

## 2. Adaptation du Modèle de Données `AMDataWrap`

### A. Pourquoi le modèle V3 est déjà prêt à ~70 %
Dans [`backend/app/db.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/db.py#L106-L148) et [`backend/app/continuum/reconciler.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/continuum/reconciler.py) :
- `play_events` possède déjà `source_provider`, `source_priority`, `source_event_id`, `canonical_track_key`, `duration_is_estimated` et `dedup_fingerprint`.
- `reconciler.py` fusionne déjà des sources hétérogènes via `canonical_key_for(song_name, artist_name)` + similarité ≥ 0.85 + fenêtre ±180s.

### B. Évolutions structurelles indispensables (3 chantiers)

#### 1. Relation N-à-M par ISRC (`canonical_recordings`, `recording_isrcs`, `platform_track_mappings`)
Un constat terrain crucial : **aucun export RGPD natif n'inclut directement l'ISRC** (ni Spotify, ni Apple Music, ni YouTube, ni Deezer). De plus, un même titre peut porter plusieurs ISRCs (album, single, remaster) et un même ISRC peut pointer vers plusieurs pistes régionales/compilations. Il faut donc remplacer le champ unique `itunes_track_id` par une structure N-à-M :

```sql
CREATE TABLE IF NOT EXISTS recording_isrcs (
    track_key TEXT NOT NULL,
    isrc TEXT NOT NULL,              -- Code 12 chars CCOOOYYSSSSS
    PRIMARY KEY (track_key, isrc),
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS platform_track_mappings (
    track_key TEXT NOT NULL,
    provider TEXT NOT NULL,          -- 'apple_music', 'spotify', 'youtube', 'deezer', 'tidal'
    external_id TEXT NOT NULL,       -- spotify:track:..., videoId, songId...
    url TEXT,
    PRIMARY KEY (track_key, provider, external_id),
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);
CREATE INDEX IF NOT EXISTS idx_rec_isrc ON recording_isrcs(isrc);
```

#### 2. Cloisonnement strict Données Souveraines vs Cache Éphémère (TTL)
Les **TIDAL Developer Terms 3.0** interdisent formellement de constituer une base de données permanente de contenu TIDAL (seul un cache temporaire est autorisé). Dans `db.py` :
- **Données utilisateur souveraines (persistantes) :** `play_events`, `lyric_events`, `search_events`, `favorites` (alimentés par exports RGPD + scrobbling local).
- **Cache métadonnées API (table avec `expires_at` / purge TTL) :** pochettes, attributs BPM/clé, résultats de recherche (TTL ≥ 24h pour métadonnées stables, 5–15 min pour playlists).

#### 3. Cascade d'enrichissement ISRC (du gratuit sans quota au plus restreint)
1. **Deezer Public API** (`GET https://api.deezer.com/search?q=...` et `GET /track/isrc:{ISRC}`) — **100 % gratuit, sans auth**. Meilleur pivot pour extraire l'ISRC depuis du texte (exports Apple Music / YouTube / Deezer).
2. **Spotify Web API unitaire** (`GET /v1/tracks/{id}`) — `external_ids.isrc` a été rétabli en mars 2026, mais l'endpoint batch `GET /v1/tracks` a été supprimé en fév. 2026. À cibler uniquement sur les URIs Spotify présents dans l'export RGPD.
3. **MusicBrainz WS/2** (`GET /ws/2/isrc/{ISRC}?fmt=json&inc=url-rels`) — **100 % gratuit** (User-Agent contactable requis), utile pour les liens cross-plateformes.
4. **TIDAL API v2** (`GET /tracks?filter[isrc]=...`, jusqu'à **20 ISRCs/requête** par pays) — Expose aussi **BPM, clé musicale (`key`) et gamme (`scale`)**, ce qui remplace avantageusement `/audio-features` supprimé par Spotify.

---

## 3. Analyse détaillée & Pièges 2025–2026 par plateforme

### 1. Spotify
- **Export RGPD :** Cocher impérativement **Extended Streaming History** (le package *Account Data* basique n'a que 12 mois et 4 champs). Livre `Streaming_History_Audio_YYYY-YYYY_X.json` avec : `ts` (UTC ISO 8601), `ms_played`, `platform`, `master_metadata_*`, `spotify_track_uri` (sans ISRC), `reason_start`, `reason_end` (`trackdone`, `fwdbtn`), `shuffle`, `skipped`, `offline`. Délai max 30 jours (souvent 1–2 jours en pratique).
- **Restrictions Dev Mode (fév. & juil. 2026) :**
  - Propriétaire **Spotify Premium obligatoire** (sinon l'app est coupée immédiatement).
  - Plafond strict de **5 utilisateurs autorisés** par app (allowlist email) ; 25 Client IDs/compte avec quotas partagés (HTTP 429 `QUOTA_EXCEEDED`).
  - *Extended Quota Mode* réservé aux sociétés avec **≥ 250 000 MAU**.
  - **`localhost` interdit en Redirect URI** (depuis avril/nov. 2025) : utiliser obligatoirement `http://127.0.0.1:PORT/callback` ou `http://[::1]:PORT/callback` + PKCE.
  - Endpoints coupés en Dev Mode : `/audio-features`, `/audio-analysis`, `/recommendations`, `preview_url` sur `SimpleTrack`, batch `/tracks` / `/albums` / `/artists`, `GET /search` réduit à 10 résultats max.
- **Lecture & Tracking (`Web Playback SDK`) :**
  - Nécessite Spotify Premium (hors mobile-only). Bug critique connu sur **iOS 26.5 / 26.5.2 (juil. 2026)** : erreur `403` sur `/v1/fairplay-license/v1/audio/license` bloquant la lecture sur Safari/Chrome iOS.
  - Aucun événement natif de fin de piste : détecter la fin naturelle par heuristique sur `player_state_changed` (`!prev.paused && curr.paused && curr.position === 0` + présence dans `track_window.previous_tracks`).
  - API `recently-played` plafonnée aux **50 derniers titres** (> 30s), sans durée ni raison de fin.

### 2. YouTube Music
- **Export RGPD (`Google Takeout`) :** Très rapide (5–10 min) en choisissant le format JSON (`watch-history.json`, filtrable via `header: "YouTube Music"`). **Limite majeure :** aucune durée d'écoute, aucun skip, aucun appareil, aucun ISRC, et **purge automatique à 36 mois** par défaut sur les comptes créés depuis juin 2020. L'utilisation de `duration_is_estimated = 1` dans `play_events` est donc obligatoire.
- **API & `ytmusicapi` :** Aucune API officielle YouTube Music (la playlist `HL` de la Data API v3 est vide depuis 2016). `ytmusicapi` (reverse-engineering par cookies/OAuth) viole les ToS YouTube et casse régulièrement (403) → à proscrire ou cantonner à un module expérimental désactivé par défaut.
- **Lecture & Tracking (`YouTube IFrame Player API`) :**
  - **Gratuit, sans clé, sans abonnement requis** (pubs pour non-Premium).
  - **Contraintes strictes ToS & UI :** La vidéo doit rester **visible (≥ 200 × 200 px, 480 × 270 px recommandé)** — interdit de masquer l'iframe, de faire du background audio-only ou de séparer l'audio. Conserver l'en-tête HTTP `Referer` (sinon erreur 153) et passer `enablejsapi=1`, `origin`, `playsinline=1` (iOS).
  - **Tracking idéal :** `onStateChange` renvoie sans ambiguïté `YT.PlayerState.ENDED === 0` (vs `PLAYING = 1`, `PAUSED = 2`), et `player.getCurrentTime()` / `getDuration()` (en secondes) permettent un suivi précis.
  - **Mapping ISRC :** YouTube Data API v3 (10 000 unités/j, quotas granulaires depuis juin 2026) ne supporte pas l'ISRC → résolution via MusicBrainz `url-rels` ou matching texte/durée.

### 3. TIDAL
- **Lecture & SDK :** `tidal-sdk-web` (TypeScript, Apache 2.0) est actif en 2026, utilise OAuth 2.1 + PKCE (avec rotation des refresh tokens) et impose la lecture via `packages/player` (DRM, pas de Web Audio FFT). Inscription gratuite (10 apps), mais **quotas gelés** (pas d'extension Production) et usage **strictement non-commercial**.
- **Historique :** **Aucun endpoint `Recently Played`** via l'API v2 en 2026. Export RGPD uniquement par ticket support manuel (CSV non garanti).

### 4. Deezer
- **Statut 2025–2026 :** **À écarter pour l'authentification et la lecture.** Le portail développeur est fermé à toute nouvelle app (2024–2026), des `app_id` existants ont été révoqués en nov. 2025 (`OAuthException code 50`), et le SDK `DZ.player` est officiellement déprécié/abandonné.
- **Ce qu'on garde :** Uniquement l'**API catalogue publique** (sans clé) pour la résolution ISRC et un éventuel parseur d'import pour les exports RGPD `.xlsx`.

---

## 4. Abstraction Frontend `PlaybackAdapter` & Priorisation

### Interface unifiée recommandée (`frontend-v3/src/audio/`)
```ts
export interface PlaybackAdapter {
  id: 'preview' | 'spotify_sdk' | 'youtube_iframe' | 'tidal_sdk' | 'apple_musickit'
  supportsFullTrack: boolean
  supportsWebAudioFft: boolean // true uniquement pour 'preview' (non-DRM)

  load(track: ResolvedTrack): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  seek(positionMs: number): Promise<void>
  onStateChange(cb: (state: NormalizedPlayerState) => void): () => void
}
```
Toutes les durées sont normalisées en **millisecondes** (conversion `sec × 1000` pour YouTube IFrame) et chaque session validée envoie un événement vers FastAPI (`POST /api/v3/player/track-event`) pour alimenter `play_events` via `reconciler.py`.

### Ordre de déploiement pragmatique
1. **Tier 1 (Prioritaire) :**
   - **Spotify :** Parseur *Extended Streaming History* JSON + *Web Playback SDK* en BYOK sur `http://127.0.0.1:PORT`.
   - **YouTube IFrame Player API :** Lecteur universel gratuit de repli (compatible avec tous les exports, en intégrant un encart vidéo visible ≥ 200 × 200 px dans l'interface).
2. **Tier 2 (Optionnel / Enrichissement) :**
   - **Apple Music :** `MusicKit JS v3` en module BYOK optionnel (pour les détenteurs d'une clé `.p8` à 99 $/an).
   - **TIDAL :** `tidal-sdk-web` en BYOK + enrichissement BPM/clé via `GET /tracks?filter[isrc]=...`.
3. **Tier 3 (Passif) :**
   - **Deezer :** API catalogue publique uniquement pour la résolution ISRC + parseur `.xlsx` si besoin.
