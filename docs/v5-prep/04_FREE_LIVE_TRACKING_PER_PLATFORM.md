# AMDataWrap V5 — Écoute Active Gratuite (0 €) par Plateforme

> **Objectif** : Capturer l'écoute en direct sur PC et Mobile **sans payer d'API propriétaire** (ex. Apple Developer Program à 99 $/an ou quotas Spotify/TIDAL restrictifs).

## 1. Matrice Comparative par Plateforme (0 €)

| Plateforme | Desktop Web / App | Android | iOS | Fiabilité / Limites |
|---|---|---|---|---|
| **Apple Music** | Extension Chrome MV3 (`amdatawrap-bridge`) sur `music.apple.com` + AppleScript/MediaRemote macOS | `NotificationListenerService` / `MediaSessionManager` (ou Pano Scrobbler → Webhook) | Raccourci iOS (*Automation* sur changement de morceau / app Musique) ou Last.fm/ListenBrainz | iOS : pas d'accès background permanent sans MusicKit payant ; le bridge ListenBrainz / Pano Scrobbler reste 0 € |
| **Spotify** | Extension Chrome MV3 sur `open.spotify.com` + Web Scrobbler / ListenBrainz | `MediaSession` Android / Pano Scrobbler → Webhook V5 | Spotify OAuth (gratuit pour usage perso / Dev Mode limité à 25 users, sinon ListenBrainz) | API Spotify *Recently Played* limitée aux 50 derniers titres ; l'extension MV3 + ListenBrainz contourne cette limite |
| **YouTube Music** | Extension Chrome MV3 sur `music.youtube.com` + lecteur YouTube intégré AMDataWrap | `MediaSession` Android / Pano Scrobbler | Web / Raccourci iOS | Nettoyage `- Topic` & `(Official Video)` réutilisant `clean_ytm_title` / `clean_ytm_artist` |
| **Deezer** | Extension Chrome MV3 sur `deezer.com` | `MediaSession` Android / Pano Scrobbler | ListenBrainz / Last.fm scrobbler | API publique Deezer (track/BPM/cover) reste gratuite sans clé |
| **TIDAL** | Extension Chrome MV3 sur `listen.tidal.com` | `MediaSession` Android / Pano Scrobbler | Last.fm scrobbler intégré dans l'app TIDAL | TIDAL intègre nativement le scrobbling Last.fm (connectable à un pont Last.fm → AMDataWrap) |

## 2. Architecture Unifiée d'Ingestion Live V5

```
[MV3 Bridge (PC)] ────┐
[Pano Scrobbler (And)] ┼──► POST /api/v5/scrobble (Bearer token scoped)
[ListenBrainz Sync] ───┤         │
[Web Scrobbler] ───────┘         ▼
                       Déduplication (±180 s, ISRC / canonical_key)
                                 │
                                 ▼
                       play_events + WebSocket /ws/now-playing
```

## 3. Règles de Déduplication & Qualité
- **Tolérance temporelle ±180 s** : si l'utilisateur importe plus tard son archive RGPD officielle (Apple Music / Spotify), les scrobbles live déjà enregistrés sont réconciliés sans doublon grâce à la même fenêtre `±180 s` et `canonical_key_for` que les profils fusionnés V4.5.
- **Sync ListenBrainz (0 €)** : tâche cron optionnelle (toutes les 15 min) interrogeant `GET https://api.listenbrainz.org/1/user/{username}/listens` sans aucune clé payante.
