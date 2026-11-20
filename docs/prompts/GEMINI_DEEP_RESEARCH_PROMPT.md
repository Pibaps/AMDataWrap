# Prompt Gemini Deep Research — Vérification APIs/SDKs Streaming Musical (2025–2026)

Copie-colle le prompt ci-dessous dans **Gemini Deep Research** et transmets-moi son rapport pour enrichir et finaliser les deux analyses de faisabilité dans `docs/`.

---

```text
Agis comme un architecte logiciel senior spécialisé dans les APIs de streaming musical et les lecteurs web DRM. Je développe une application web locale open-source d'analyse d'historique d'écoute et de lecture interactive (type Spotify Wrapped / lecteur vinyle 3D en local sur localhost) avec un backend Python (FastAPI + SQLite) et un frontend React/Three.js.

Réalise une recherche approfondie et vérifiée (sources officielles développeurs, changelogs 2025-2026, forums développeurs, issues GitHub) sur les 5 plateformes suivantes : Apple Music, Spotify, YouTube Music, Deezer et Tidal.

Pour CHAQUE plateforme, réponds précisément avec des faits datés de 2025-2026 aux 5 points suivants :

1. LECTURE COMPLÈTE DANS UN NAVIGATEUR WEB (SDK / API officielle) :
- Quel est le SDK officiel exact pour lire des morceaux entiers (pas des extraits 30s) dans un navigateur web ?
- Quels sont les prérequis côté développeur (coût, validation manuelle, quotas, limites d'utilisateurs en mode développement vs production, restrictions pour projets open-source ou localhost) ?
- Quels sont les prérequis côté utilisateur (abonnement payant obligatoire ?).
- Quelles sont les limitations techniques connues (DRM FairPlay/Widevine EME, blocage de la Web Audio API `AnalyserNode` / `createMediaElementSource` qui renvoie des zéros sur flux DRM, absence de gapless playback, restrictions Safari iOS / Chrome, obligatoires UI/ToS comme ne pas cacher l'iframe).

2. TRACKING D'ÉCOUTE EN DIRECT (SCROBBLING / TÉLÉMÉTRIE) :
- Quels événements temps réel exacts le SDK lecteur expose-t-il (changement de piste, play/pause, progression en ms, fin naturelle vs skip) ?
- Existe-t-il des endpoints API pour récupérer l'historique récent d'écoute (et quelle est la limite exacte : ex. 25 derniers titres, 50 derniers titres, sans durée d'écoute, etc.) ?

3. EXPORT HISTORIQUE COMPLET (RGPD / TAKEOUT) :
- Quel est le format exact des fichiers d'export RGPD pour chaque plateforme (JSON, CSV, Excel) et quels champs précis sont fournis pour chaque écoute (horodatage UTC/local, durée exacte écoutée en ms, appareil, raison de fin/skip, identifiant unique/URI, ISRC) ?
- Quel est le délai et la facilité d'obtention pour l'utilisateur final en 2025-2026 ?

4. POINTS D'ATTENTION RÉCENTS (2025–2026) :
- Changements récents de politique développeur :
  * Spotify : détails exacts des restrictions Development Mode / Extended Quota Mode (février 2026, juillet 2026, limite de 5 ou 25 utilisateurs, dépréciation d'endpoints comme Audio Features).
  * Apple Music : règles de licence MusicKit §3.3.6 / §4.5.2 concernant les apps web, et si un projet local/open-source nécessite que chaque utilisateur ait sa propre clé Apple Developer à 99 $/an ou un backend proxy.
  * Tidal : état actuel du TIDAL SDK for Web (`tidal-sdk-web`) et gel éventuel des quotas API.
  * Deezer : état actuel de maintenance du JavaScript SDK (`DZ.player`), création de nouvelles apps développeurs, et support OAuth2 sur localhost.
  * YouTube Music : statut (toujours aucune API officielle ?), risques ToS de `ytmusicapi`, et règles exactes d'utilisation du YouTube IFrame Player API pour un lecteur musical.

5. TABLEAU COMPARATIF FINAL & RECOMMANDATION D'ARCHITECTURE :
- Synthétise dans un tableau comparatif clair : Plateforme | SDK Web | Coût/Quota Dev | Abonnement User Requis | Web Audio FFT possible ? | Qualité Export RGPD | Viabilité App Locale Perso vs App Publique.
- Indique comment l'ISRC permet de réconcilier un même morceau entre ces 5 plateformes et quelles APIs l'exposent gratuitement.

Cite tes sources officielles et date les informations importantes.
```
