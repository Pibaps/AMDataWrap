# AMDataWrap V4.1 Bridge (Extension Navigateur MV3 — 0 €)

Pilote tes vrais comptes **Apple Music Web** (`window.MusicKit.getInstance()` avec résolution 4 paliers), **Spotify Web** (`open.spotify.com`), **Deezer** (`www.deezer.com`) et **YouTube Music** (`music.youtube.com`) directement depuis le Tourne-Disque 3D d'AMDataWrap V4.1 (`http://localhost:5177`), **sans clé Apple Developer à 99 $/an**.

## Installation (Chrome / Edge / Brave / Arc)
1. Ouvre `chrome://extensions` (ou `edge://extensions`).
2. Active le **Mode développeur** (en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier `extensions/amdatawrap-bridge/`.
4. Ouvre un onglet connecté sur `music.apple.com`, `open.spotify.com`, `www.deezer.com` ou `music.youtube.com`.
5. L'extension se connecte automatiquement à `ws://127.0.0.1:8000/ws/bridge` (keepalive 20 s + `chrome.alarms`) et affiche un badge vert dans la barre de lecture d'AMDataWrap V4.1.
