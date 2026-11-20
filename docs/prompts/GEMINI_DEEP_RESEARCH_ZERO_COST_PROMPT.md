# Prompt Gemini Deep Research — Solutions 100 % Gratuites (0 €) : Import, Tracking & Pilotage de Lecture Multi-Plateformes

Copie-colle ce prompt dans **Gemini Deep Research** pour valider toutes les pistes gratuites (sans compte Apple Developer à 99 $/an, sans coût serveur, sans API payante).

---

```text
Agis comme un architecte logiciel senior spécialisé en systèmes locaux (FastAPI + SQLite + React/Three.js), extensions navigateur, médias web/DRM et APIs de streaming musical.

Je développe une application web locale open-source et 100 % GRATUITE (0 € de coût développeur, 0 € d'infrastructure, exécutée en local sur l'ordinateur de l'utilisateur : http://127.0.0.1:PORT). L'utilisateur souhaite :
1. Importer gratuitement son historique d'écoute depuis d'autres plateformes (Spotify, YouTube Music, Deezer, TIDAL).
2. Tracker gratuitement ses écoutes en direct.
3. Lancer et piloter la lecture de morceaux ENTIERS depuis notre interface (un "Bac à Vinyles 3D + Tourne-Disque 3D") en utilisant son compte déjà connecté sur Apple Music, Spotify, YouTube Music, Deezer ou TIDAL, SANS payer de licence développeur (ex: pas de compte Apple Developer à 99 $/an) — quitte à passer par un autre onglet, une extension navigateur locale, une WebView desktop (Tauri/Electron), ou tout autre pont technique fonctionnel.

Réalise une recherche approfondie et vérifiée (état 2025–2026, projets open-source GitHub actifs, documentations navigateurs/OS, limitations DRM) sur les 3 axes suivants :

---

AXE 1 : IMPORT D'HISTORIQUE 100 % GRATUIT (EXPORTS RGPD / TAKEOUT / AUTRES)
Pour Spotify, YouTube Music, Deezer et TIDAL (et éventuellement Apple Music en référence) :
- Quels sont les schémas exacts (noms de fichiers et noms exacts de colonnes/champs JSON/CSV/XLSX) des exports RGPD/Takeout en 2025–2026 ?
- Quels pièges de parsing sont documentés (ex: encodage, fuseaux horaires, lignes sans durée, filtrage vidéo vs musique sur YouTube Takeout, différences entre "Account Data" et "Extended Streaming History" sur Spotify) ?
- Comment résoudre gratuitement les métadonnées manquantes (artiste, album, pochette, durée, ISRC) sans aucune clé API payante ni quota bloquant (ex: API publique Deezer sans auth, iTunes Search API sans auth, MusicBrainz WS/2, Cover Art Archive) ? Y a-t-il des limites de rate-limit précises sur ces APIs publiques gratuites ?

---

AXE 2 : TRACKING EN DIRECT 100 % GRATUIT (MULTI-PLATEFORMES)
Quelles sont toutes les solutions gratuites et fiables en 2025–2026 pour capturer en temps réel les écoutes d'un utilisateur sur Apple Music, Spotify, YouTube Music, Deezer et TIDAL vers un backend local (FastAPI/SQLite) :
- Niveau OS Desktop : Windows SMTC (winrt / winsdk), macOS (`MediaRemote` / AppleScript / NowPlaying — attention aux restrictions macOS Sequoia/Tahoe 15/16+ sur `MediaRemote` !), Linux (`MPRIS` / D-Bus). Quelles sont les limites exactes de chaque OS (ex: pas de durée réelle écoutée ni de raison de skip ?).
- Niveau Navigateur : Extensions open-source comme `Web Scrobbler` (supporte-t-elle un webhook / serveur local custom type ListenBrainz API sur 127.0.0.1 ?).
- Niveau Mobile : `Pano Scrobbler` (Android), `Multi-Scrobbler` (self-hosted), solutions iOS gratuites éventuelles pour Apple Music / Spotify.
- Niveau Cloud gratuit : `ListenBrainz` API (polling gratuit, limites).

---

AXE 3 : LECTURE COMPLÈTE PILOTÉE DEPUIS NOTRE SITE À 0 € (CONTOURNEMENT IFRAME / AUTRE ONGLET / EXTENSION / DESKTOP)
Puisque l'intégration directe en `<iframe>` caché de `music.apple.com`, `open.spotify.com`, `music.youtube.com` est bloquée par `X-Frame-Options` / `CSP frame-ancestors` et la Same-Origin Policy, évalue la faisabilité réelle (technique + DRM + stabilité 2025–2026) de chacune de ces architectures alternatives 100 % gratuites :

1. **Architecture "Pont Extension Navigateur" (Chrome/Edge/Firefox) + Onglet officiel ouvert :**
   - L'utilisateur ouvre `music.apple.com` (ou `open.spotify.com` / `music.youtube.com` / `deezer.com` / `listen.tidal.com`) dans un onglet normal de son navigateur (où il est connecté avec son vrai compte).
   - Une petite extension navigateur open-source (installée en local par l'utilisateur) communique via `WebSocket` (ou `Native Messaging`) avec notre app `AMDataWrap` (`127.0.0.1`).
   - Question précise : L'extension peut-elle *vraiment* recevoir une commande de notre tourne-disque 3D ("joue cet album / ce titre"), naviguer ou déclencher la lecture dans l'onglet du lecteur web officiel (ou via le DOM / API interne / recherche + clic simulé), contrôler Play/Pause/Next/Seek, et renvoyer la progression exacte (`currentTime`, `duration`, titre en cours) vers notre tourne-disque 3D ? Quelles plateformes résistent à l'automatisation DOM (ex: Shadow DOM sur Apple Music Web, React state sur Spotify, DRM autoplay policy sans clic utilisateur dans l'onglet cible) ?

2. **Architecture "Application Desktop" (Tauri / Electron / PyWebView) avec WebView secondaire (visible ou masquée) :**
   - Peut-on embarquer `music.apple.com` ou `open.spotify.com` dans une fenêtre/WebView secondaire et y injecter un script de contrôle ?
   - Quel est l'état réel du **DRM Widevine / FairPlay** dans **Electron** (Castlabs Electron-releases ?), **Tauri** (WebView2 sous Windows / WebKitGTK sous Linux / WKWebView sous macOS) en 2025–2026 ? Est-ce que Widevine fonctionne gratuitement sans licence payante dans Tauri/WebView2 ou Electron ?

3. **Architecture "Spotify Connect / Librespot / AppleScript / Deep Links" :**
   - Sur Spotify (avec compte Premium utilisateur) : des projets open-source comme `librespot` ou `spotifyd` permettent-ils encore en 2025–2026 de créer un lecteur local ou de piloter la lecture à 0 € sans passer par le portail Spotify Developer (ou sont-ils bloqués) ?
   - Sur macOS / Windows : peut-on piloter l'application native Apple Music (ex: AppleScript / Music.app sur macOS, ou COM/URI sur Windows) depuis notre backend Python local pour jouer un titre/album précis ?
   - Deep Links (`music.apple.com/...`, `spotify:album:...`) + Windows SMTC / MPRIS : limites pour l'autoplay immédiat d'un titre précis.

4. **Architecture "YouTube IFrame Player API" (comme lecteur universel gratuit dans le navigateur) :**
   - Confirme si le `YouTube IFrame Player API` reste 100 % gratuit sans clé pour la lecture.
   - Pour résoudre un titre Apple Music/Spotify vers un `videoId` YouTube sans dépasser le quota de 10 000 unités/jour de la YouTube Data API v3 (`search.list` coûte 100 unités = seulement 100 recherches/jour !), quelles solutions gratuites fiables existent en 2025–2026 (ex: MusicBrainz, `yt-dlp` en recherche locale, `ytmusicapi` search sans auth, scraping léger côté client/backend) ?

Conclue par un **classement des architectures réalistes à 0 €** (du plus fiable et pérenne au plus fragile), avec les exactes limitations par OS (Windows / macOS / Linux) et par navigateur. Cite des projets open-source récents (2024–2026) qui prouvent la faisabilité de chaque piste.
```
