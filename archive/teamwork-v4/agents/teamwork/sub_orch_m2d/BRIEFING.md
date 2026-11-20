# Briefing — Milestone M2D

## Objective
Deliver the Phase 1 **0€ Playback Resolver (`backend/app/playback/`)** and the genuine, loadable **Manifest V3 Browser Extension (`extensions/amdatawrap-bridge/`)**, plus comprehensive offline deterministic tests (`backend/tests/test_playback_v4.py`), strictly adhering to `PROJECT.md` Interface Contract §5, `docs/plans/PLAN_V4_FINAL.md` §2.5, and `.agents/teamwork/ORIGINAL_REQUEST.md`.

## Key Technical Requirements
1. **`backend/app/playback/youtube_resolver.py`**:
   - Step 1: Permanent cache lookup in `platform_track_mappings` where `track_key = ? AND provider = 'youtube'` -> return immediately (`source="cache"`).
   - Step 2: Unauthenticated `ytmusicapi` search `YTMusic().search(f"{artist_name} {song_name}", filter="songs")` executed in `asyncio.to_thread` (never blocking event loop), clean artist/title candidate scoring, persist best `videoId` & `https://www.youtube.com/watch?v={videoId}` into `platform_track_mappings`, return `source="ytmusicapi"`.
   - Step 3: MusicBrainz `url-rels` fallback on `ytmusicapi` empty/exception: look up `tracks_catalog.mbid_recording` (or `mbid_release_group`), query `https://musicbrainz.org/ws/2/recording/{mbid}?inc=url-rels&fmt=json` (and release-group fallback if needed) with contactable `User-Agent` & `api_metadata_cache` TTL, extract YouTube `videoId` from `youtube.com/watch?v=` / `youtu.be/` / `music.youtube.com/watch?v=`, persist to `platform_track_mappings`, return `source="musicbrainz_url_rel"`.
   - Always include `preview_url` from `tracks_catalog` for instant `PreviewAudioProvider` fallback.
   - Support injectable `ytmusic_client` and `http_client` for 100% deterministic offline testing.
2. **`backend/app/playback/router.py`**:
   - `playback_router = APIRouter(prefix="/api/v4/playback", tags=["v4-playback"])`:
     - `GET /api/v4/playback/resolve?song_name=...&artist_name=...&track_key=...`
     - `POST /api/v4/playback/track-event` (updates `now_playing_state`, broadcasts via lazy-imported `backend.app.continuum.ws_hub.now_playing_hub.publish_threadsafe`, commits qualified plays/skips to `reconciler.py`)
     - `GET /api/v4/playback/bridge/status` (calls lazy-imported `bridge_hub.get_status()`, safe default if `ws_hub` absent)
     - `POST /api/v4/playback/bridge/command` (relays `{ action, payload, target_platform }` to `await bridge_hub.send_command(...)`)
3. **`extensions/amdatawrap-bridge/`**:
   - Complete Manifest V3 browser extension for Chrome, Edge, Firefox (`minimum_chrome_version: "116"`, `browser_specific_settings.gecko`, `background.js` with 20s `PING` keepalive + `chrome.alarms` wake-up + exponential reconnect + extensible `CONNECTORS` registry ready for V4.1 Deezer/TIDAL + Autoplay `NotAllowedError` recovery).
   - `connectors/apple_music_main.js` (`world: "MAIN"`, direct `window.MusicKit.getInstance()`) + `connectors/apple_music_bridge.js` (`window.postMessage` bridge).
   - `connectors/spotify_web.js` (URL navigation + maintained ARIA/DOM selectors + MediaSession/DOM telemetry + `NotAllowedError`).
   - `connectors/youtube_music.js` (`/watch?v=VIDEO_ID` + `#movie_player` async `resolvePlayerApi()` + `<video>` control + `NotAllowedError`).
   - `popup.html` & `popup.js` (dark obsidian status popup, WS status, detected tabs, 1-click "Activate Tab / Unlock Autoplay", backend URL config).
   - `README.md` (clear French installation guide for Chrome/Edge & Firefox).
4. **`backend/tests/test_playback_v4.py`**:
   - Comprehensive offline unit/API tests for resolver, router, reconciler integration, lazy ws_hub fallback & binding, plus MV3 extension manifest/JS syntax/contract validation tests.
