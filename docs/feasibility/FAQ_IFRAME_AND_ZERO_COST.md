# Réponses d'Architecture — Iframe masqué & Stratégie 100 % Gratuite (Zéro Coût)

**Projet :** `AMDataWrap` (V3 « Continuum »)  
**Date :** Novembre 2026  

---

## 1. Peut-on intégrer Apple Music / Spotify / YouTube Music dans un `<iframe>` caché et piloter la lecture depuis notre tourne-disque 3D ?

**Réponse courte : Non, c'est techniquement bloqué par les navigateurs (et par les plateformes) pour Apple Music, Spotify, Deezer et TIDAL.** Seul **YouTube** permet un contrôle JS officiel, mais **l'iframe ne peut pas être caché**.

### A. Pourquoi l'iframe masqué vers un lecteur web officiel (`music.apple.com`, `open.spotify.com`, etc.) ne fonctionne pas
1. **Blocage d'affichage (`X-Frame-Options` / `CSP frame-ancestors`) :**  
   Les lecteurs web complets (`music.apple.com`, `open.spotify.com`, `music.youtube.com`, `listen.tidal.com`, `www.deezer.com`) envoient des en-têtes HTTP de sécurité (`X-Frame-Options: SAMEORIGIN` / `DENY` ou `Content-Security-Policy: frame-ancestors 'self'`). Le navigateur **refuse de charger la page** dans un `<iframe>` hébergé sur `127.0.0.1` ou `localhost` (erreur console immédiate + cadre vide).
2. **Isolation Cross-Origin (Same-Origin Policy) :**  
   Même si un site autorisait l'iframe, le navigateur interdit formellement au JavaScript de `AMDataWrap` d'accéder au DOM interne de l'iframe (`contentDocument` bloqué), de cliquer sur Play/Pause, de changer de piste ou de lire la progression.
3. **Limites des widgets Embed officiels :**
   - **Apple Music Embed (`embed.music.apple.com`) / Spotify Embed (`open.spotify.com/embed`) :** Ils se chargent bien en iframe, mais n'offrent **aucune API JS de contrôle** (impossible de changer de disque depuis notre Bac à Vinyles 3D ou de suivre le temps exact écouté), et se limitent souvent à des extraits de 30s sans gestion de file d'attente personnalisée.

### B. Le cas particulier de YouTube IFrame Player API
- **Ce qui marche :** Le `YouTube IFrame Player API` est **100 % gratuit, sans clé API**, et expose un contrôle total en JS (`loadVideoById`, `playVideo`, `pauseVideo`, `getCurrentTime()`, `onStateChange`).
- **Pourquoi on ne peut pas le cacher :**
  - *Technique :* Firefox n'initialise pas le lecteur s'il est en `display: none`.
  - *Contractuel (ToS YouTube) :* L'iframe doit rester **visible (minimum 200 × 200 px)**.
- **Compromis UX viable :** Dans l'interface tourne-disque 3D, intégrer un petit moniteur « Clip / Pochette Live » de `200 × 200 px` dans un coin du studio. Cela reste 100 % conforme, gratuit, et piloté par notre tourne-disque 3D.

### C. L'alternative 100 % gratuite pour Apple Music / Spotify sans SDK payant : « Deep Link + SMTC »
Si l'utilisateur possède déjà Apple Music ou Spotify ouvert sur son PC/Mac :
1. Cliquer sur un vinyle dans le Bac 3D de `AMDataWrap` ouvre le **deep link officiel** de l'album (`https://music.apple.com/...` ou `spotify:album:...`), ce qui lance la lecture complète dans l'application native/web de l'utilisateur.
2. Le worker local déjà présent dans `AMDataWrap` ([`smtc_worker.py`](file:///home/antigravity/Pibaps/AMDataWrap/backend/app/continuum/smtc_worker.py)) ou une extension navigateur capte automatiquement la lecture en cours et l'enregistre dans SQLite en temps réel — **coût total : 0 €**.

---

## 2. Import de données & Tracking en direct à 0 € (Aucune option payante)

Si la règle stricte est **« 0 € pour le développeur et 0 € d'infrastructure »** :

### A. Import historique via Archives RGPD / Takeout (100 % Gratuit)
L'import de fichiers `.zip` / `.json` / `.csv` ne nécessite **aucun compte développeur ni aucune clé API** sur aucune des 5 plateformes :

| Plateforme | Fichier d'export gratuit | Délai d'obtention | Richesse pour `AMDataWrap` | Faisabilité d'import |
| :--- | :--- | :--- | :--- | :---: |
| **Apple Music** | `Apple Media Services information.zip` (`Apple Music Play Activity.csv`) | Quelques jours à ~40 j | **Maximale** (ms, skips, appareil, contexte, paroles) | **Déjà implémenté** |
| **Spotify** | *Extended Streaming History* (`Streaming_History_Audio_*.json`) | 1–30 jours | **Maximale** (`ms_played`, `reason_end`, `skipped`, appareil, URI) | **Très élevée (Priorité 1)** |
| **YouTube Music** | *Google Takeout* (`watch-history.json`) | **5–10 minutes** | **Partielle** (horodatage + titre/vidéo, **pas de durée** ; purge auto 36 mois) | **Élevée** (`duration_is_estimated = 1`) |
| **Deezer** | Export RGPD via support (`.xlsx`) | Jusqu'à 30 jours | **Moyenne** (lacunes de durée selon appareil) | **Moyenne** |
| **TIDAL** | Export RGPD via ticket support (`.csv`) | Jusqu'à 30 jours | **Faible / non garantie** | **Faible** |

> **Enrichissement ISRC gratuit :** Pour croiser les titres entre ces archives sans clé payante, le backend peut interroger gratuitement et sans authentification l'**API publique Deezer** (`https://api.deezer.com/search`) et **MusicBrainz WS/2**.

### B. Tracking en direct 100 % Gratuit (Multi-plateformes)
Pour suivre les écoutes au jour le jour sans payer 99 $/an chez Apple ni être bloqué par les quotas :

1. **Windows SMTC (`smtc_worker.py` — déjà intégré) :**  
   Capte gratuitement au niveau de l'OS toutes les lectures issues de **Apple Music (app Windows / web), Spotify, YouTube Music, TIDAL, Deezer** sur le PC.
2. **Récepteur local ListenBrainz (`POST /apis/listenbrainz/1/submit-listens` — déjà intégré) :**  
   - **Sur navigateur (PC/Mac) :** L'extension gratuite et open-source **Web Scrobbler** détecte automatiquement ce qui joue sur `music.apple.com`, `open.spotify.com`, `music.youtube.com`, `deezer.com`, `listen.tidal.com` et l'envoie vers ListenBrainz ou directement vers `AMDataWrap`.
   - **Sur Android :** **Pano Scrobbler** (gratuit, open-source) scrobble toutes ces apps vers le récepteur local de `AMDataWrap`.
3. **Lecteur intégré gratuit dans `AMDataWrap` :**  
   - **YouTube IFrame Player API** (lecture complète gratuite + tracking exact `PLAYING`/`ENDED` sans clé payante, avec encart vidéo visible ≥ 200×200 px).
   - **Extraits 30s** Apple/Deezer déjà en place pour l'aperçu instantané et l'analyse FFT/Essentia.js réelle.
