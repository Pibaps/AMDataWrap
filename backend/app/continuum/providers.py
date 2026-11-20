"""Real-Time Sync Providers (Phase 1):
1. ListenBrainz (Recommended, 100% free): incremental GET /1/user/{user}/listens (min_ts/max_ts) + playing-now + playlist export.
2. Last.fm (Optional, Pro gate Dec 1 2026): incremental user.getRecentTracks (from, extended=1, limit=1000, <5 req/s,
   handling limit+1 @attr.nowplaying, HTTP 403 error 17 private profile, and Pro API key rejection).
3. Local Scrobble Receiver: ListenBrainz-compatible POST /apis/listenbrainz/1/submit-listens
   for Pano Scrobbler (Android), AMWin-RP (Windows), FastScrobbler (iOS/macOS), Multi-Scrobbler.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ..analytics.duckdb_engine import export_parquet_snapshot
from ..db import db_session
from .reconciler import IncomingScrobble, clear_now_playing, reconcile_batch, update_now_playing

USER_AGENT = "AMDataWrap/3.0 (https://github.com/Pibaps/AMDataWrap; local-continuum)"


def _get_provider_cfg(provider: str) -> dict[str, Any]:
    with db_session() as conn:
        row = conn.execute("SELECT * FROM sync_providers_config WHERE provider = ?", (provider,)).fetchone()
    if not row:
        return {"provider": provider, "enabled": 0, "last_cursor_ts": 0}
    d = dict(row)
    try:
        d["extra"] = json.loads(d.get("extra_json") or "{}")
    except Exception:
        d["extra"] = {}
    return d


def _update_provider_status(
    provider: str,
    *,
    status: str,
    error: str | None = None,
    cursor_ts: int | None = None,
    added: int = 0,
):
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        if cursor_ts is not None:
            conn.execute(
                """
                UPDATE sync_providers_config
                SET last_sync_at = ?, last_cursor_ts = MAX(COALESCE(last_cursor_ts, 0), ?),
                    last_status = ?, last_error = ?, total_synced = COALESCE(total_synced, 0) + ?
                WHERE provider = ?
                """,
                (now_iso, cursor_ts, status, error, added, provider),
            )
        else:
            conn.execute(
                """
                UPDATE sync_providers_config
                SET last_sync_at = ?, last_status = ?, last_error = ?,
                    total_synced = COALESCE(total_synced, 0) + ?
                WHERE provider = ?
                """,
                (now_iso, status, error, added, provider),
            )


def save_provider_config(
    provider: str,
    *,
    enabled: bool,
    username: str | None = None,
    token: str | None = None,
    api_key: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    with db_session() as conn:
        existing = conn.execute("SELECT token, api_key, extra_json FROM sync_providers_config WHERE provider = ?", (provider,)).fetchone()
        keep_token = token if (token is not None and token != "") else (existing["token"] if existing else None)
        keep_key = api_key if (api_key is not None and api_key != "") else (existing["api_key"] if existing else None)
        extra_str = json.dumps(extra if extra is not None else (json.loads(existing["extra_json"]) if existing and existing["extra_json"] else {}), ensure_ascii=False)
        conn.execute(
            """
            INSERT INTO sync_providers_config (provider, enabled, username, token, api_key, extra_json, last_status)
            VALUES (?, ?, ?, ?, ?, ?, 'configured')
            ON CONFLICT(provider) DO UPDATE SET
                enabled = excluded.enabled,
                username = COALESCE(excluded.username, sync_providers_config.username),
                token = excluded.token,
                api_key = excluded.api_key,
                extra_json = excluded.extra_json
            """,
            (provider, 1 if enabled else 0, username, keep_token, keep_key, extra_str),
        )
    return _get_provider_cfg(provider)


# ---------------------------------------------------------------------------
# 1. ListenBrainz Connector (Recommended, 100% Free)
# ---------------------------------------------------------------------------
async def sync_listenbrainz(max_pages: int = 5) -> dict[str, Any]:
    cfg = _get_provider_cfg("listenbrainz")
    username = (cfg.get("username") or "").strip()
    if not username:
        return {
            "provider": "listenbrainz",
            "ok": False,
            "error": "Nom d'utilisateur ListenBrainz non configuré.",
            "error_code": "MISSING_USERNAME",
            "hint": "Renseignez votre pseudo ListenBrainz gratuit dans le Hub Continuum.",
        }

    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if cfg.get("token"):
        headers["Authorization"] = f"Token {cfg['token']}"

    min_ts = int(cfg.get("last_cursor_ts") or 0)
    scrobbles: list[IncomingScrobble] = []
    max_seen_ts = min_ts
    now_playing_updated = False

    try:
        async with httpx.AsyncClient(timeout=12.0, headers=headers) as client:
            # 1. Playing-now endpoint
            np_resp = await client.get(f"https://api.listenbrainz.org/1/user/{username}/playing-now")
            if np_resp.status_code == 200:
                np_data = np_resp.json().get("payload", {})
                listens = np_data.get("listens") or []
                if listens:
                    meta = listens[0].get("track_metadata") or {}
                    add = meta.get("additional_info") or {}
                    update_now_playing(
                        provider="listenbrainz",
                        song_name=meta.get("track_name") or "",
                        artist_name=meta.get("artist_name") or "",
                        album_name=meta.get("release_name") or "",
                        duration_ms=int(add.get("duration_ms") or (add.get("duration") or 0) * 1000 or 0),
                        is_playing=True,
                    )
                    now_playing_updated = True

            # 2. Incremental listens fetch (using min_ts / max_ts)
            max_ts: int | None = None
            for _ in range(max_pages):
                params: dict[str, Any] = {"count": 100}
                if min_ts > 0:
                    params["min_ts"] = min_ts
                if max_ts is not None:
                    params["max_ts"] = max_ts
                resp = await client.get(f"https://api.listenbrainz.org/1/user/{username}/listens", params=params)
                if resp.status_code == 404:
                    _update_provider_status("listenbrainz", status="error", error="Utilisateur introuvable")
                    return {
                        "provider": "listenbrainz",
                        "ok": False,
                        "error": f"Utilisateur ListenBrainz '{username}' introuvable.",
                        "error_code": "USER_NOT_FOUND",
                    }
                resp.raise_for_status()
                payload = resp.json().get("payload", {})
                items = payload.get("listens") or []
                if not items:
                    break

                oldest_in_page: int | None = None
                for item in items:
                    ts = int(item.get("listened_at") or 0)
                    if ts <= 0:
                        continue
                    if ts > max_seen_ts:
                        max_seen_ts = ts
                    if oldest_in_page is None or ts < oldest_in_page:
                        oldest_in_page = ts
                    meta = item.get("track_metadata") or {}
                    add = meta.get("additional_info") or {}
                    dur_ms = int(add.get("duration_ms") or (add.get("duration") or 0) * 1000 or 0)
                    device = add.get("music_service_name") or add.get("media_player") or "ListenBrainz"
                    scrobbles.append(
                        IncomingScrobble(
                            source_provider="listenbrainz",
                            song_name=meta.get("track_name") or "",
                            artist_name=meta.get("artist_name") or "",
                            album_name=meta.get("release_name") or "",
                            started_epoch=ts,
                            play_duration_ms=dur_ms if dur_ms > 0 else None,
                            media_duration_ms=dur_ms if dur_ms > 0 else None,
                            source_event_id=f"lb:{ts}:{item.get('recording_msid') or meta.get('track_name')}",
                            device_label=str(device),
                            device_os="ListenBrainz",
                            mbid_recording=add.get("recording_mbid"),
                            mbid_artist=(add.get("artist_mbids") or [None])[0] if isinstance(add.get("artist_mbids"), list) else None,
                        )
                    )
                if len(items) < 100 or oldest_in_page is None:
                    break
                max_ts = oldest_in_page - 1
                await asyncio.sleep(0.25)

        stats = await asyncio.to_thread(reconcile_batch, scrobbles)
        if stats["inserted"] > 0 or stats["upgraded"] > 0:
            await asyncio.to_thread(export_parquet_snapshot)
        _update_provider_status(
            "listenbrainz",
            status="ok",
            error=None,
            cursor_ts=max_seen_ts if max_seen_ts > 0 else None,
            added=stats["inserted"],
        )
        return {
            "provider": "listenbrainz",
            "ok": True,
            **stats,
            "now_playing_updated": now_playing_updated,
        }
    except Exception as exc:
        _update_provider_status("listenbrainz", status="error", error=str(exc))
        return {
            "provider": "listenbrainz",
            "ok": False,
            "error": str(exc),
            "error_code": "NETWORK_OR_API_ERROR",
        }


# ---------------------------------------------------------------------------
# 2. Last.fm Connector (Optional, Pro API key required since Dec 1, 2026)
# ---------------------------------------------------------------------------
async def sync_lastfm(max_pages: int = 5) -> dict[str, Any]:
    cfg = _get_provider_cfg("lastfm")
    username = (cfg.get("username") or "").strip()
    api_key = (cfg.get("api_key") or "").strip()
    if not username or not api_key:
        return {
            "provider": "lastfm",
            "ok": False,
            "error": "Pseudo et clé API Last.fm requis (abonnement Last.fm Pro obligatoire dès le 1er déc. 2026).",
            "error_code": "MISSING_CREDENTIALS",
            "hint": "Utilisez ListenBrainz (100 % gratuit) ou renseignez une clé API rattachée à Last.fm Pro.",
        }

    min_ts = int(cfg.get("last_cursor_ts") or 0)
    scrobbles: list[IncomingScrobble] = []
    max_seen_ts = min_ts
    now_playing_updated = False

    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": USER_AGENT}) as client:
            for page in range(1, max_pages + 1):
                params: dict[str, Any] = {
                    "method": "user.getrecenttracks",
                    "user": username,
                    "api_key": api_key,
                    "format": "json",
                    "extended": 1,
                    "limit": 1000,  # Accepted in practice (5x faster than documented 200)
                    "page": page,
                }
                if min_ts > 0:
                    params["from"] = min_ts + 1

                t0 = time.monotonic()
                resp = await client.get("https://ws.audioscrobbler.com/2.0/", params=params)
                data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}

                # Handle Last.fm specific errors: HTTP 403 / code 17 (private profile) & code 10/26 (Pro key gate)
                err_code = data.get("error")
                if resp.status_code == 403 or err_code == 17:
                    msg = "Profil Last.fm privé (HTTP 403 / code 17) : vos écoutes récentes sont masquées."
                    _update_provider_status("lastfm", status="error", error=msg)
                    return {
                        "provider": "lastfm",
                        "ok": False,
                        "error": msg,
                        "error_code": "LASTFM_PRIVATE_PROFILE_17",
                        "hint": "Rendez vos écoutes récentes publiques dans les paramètres de confidentialité Last.fm.",
                    }
                if err_code in (10, 26, 29) or (resp.status_code in (401, 402, 403) and "pro" in str(data.get("message", "")).lower()):
                    msg = (
                        f"Clé API Last.fm refusée (code {err_code or resp.status_code}) : "
                        "à partir du 1er décembre 2026, une clé API requiert Last.fm Pro (4,99 $/mois)."
                    )
                    _update_provider_status("lastfm", status="pro_required", error=msg)
                    return {
                        "provider": "lastfm",
                        "ok": False,
                        "error": msg,
                        "error_code": "LASTFM_PRO_REQUIRED",
                        "hint": "Basculez en 1 clic sur ListenBrainz (100 % gratuit et open source) dans le Hub Continuum.",
                    }
                resp.raise_for_status()

                rt = data.get("recenttracks") or {}
                tracks = rt.get("track") or []
                if isinstance(tracks, dict):
                    tracks = [tracks]
                if not tracks:
                    break

                for tr in tracks:
                    attr = tr.get("@attr") or {}
                    artist_obj = tr.get("artist") or {}
                    artist_name = artist_obj.get("name") or artist_obj.get("#text") or ""
                    album_name = (tr.get("album") or {}).get("#text") or ""
                    song_name = tr.get("name") or ""
                    images = tr.get("image") or []
                    artwork = images[-1].get("#text") if images and isinstance(images[-1], dict) else None

                    # Handle limit + 1 pitfall: @attr.nowplaying == "true" has no timestamp -> route to Now Playing!
                    if str(attr.get("nowplaying", "")).lower() == "true":
                        update_now_playing(
                            provider="lastfm",
                            song_name=song_name,
                            artist_name=artist_name,
                            album_name=album_name,
                            artwork_url=artwork or None,
                            is_playing=True,
                        )
                        now_playing_updated = True
                        continue

                    uts = int((tr.get("date") or {}).get("uts") or 0)
                    if uts <= 0:
                        continue
                    if uts > max_seen_ts:
                        max_seen_ts = uts

                    scrobbles.append(
                        IncomingScrobble(
                            source_provider="lastfm",
                            song_name=song_name,
                            artist_name=artist_name,
                            album_name=album_name,
                            started_epoch=uts,
                            play_duration_ms=None,  # Imputed transparently from tracks_catalog
                            source_event_id=f"lfm:{uts}:{song_name[:40]}",
                            device_label="Last.fm",
                            device_os="Last.fm",
                            artwork_url=artwork or None,
                            mbid_recording=tr.get("mbid") or None,
                            mbid_artist=artist_obj.get("mbid") or None,
                        )
                    )

                total_pages = int((rt.get("@attr") or {}).get("totalPages") or 1)
                if page >= total_pages:
                    break
                # Strict rate limit <= 5 req/s (>= 220ms between calls)
                elapsed = time.monotonic() - t0
                if elapsed < 0.22:
                    await asyncio.sleep(0.22 - elapsed)

        stats = await asyncio.to_thread(reconcile_batch, scrobbles)
        if stats["inserted"] > 0 or stats["upgraded"] > 0:
            await asyncio.to_thread(export_parquet_snapshot)
        _update_provider_status(
            "lastfm",
            status="ok",
            error=None,
            cursor_ts=max_seen_ts if max_seen_ts > 0 else None,
            added=stats["inserted"],
        )
        return {
            "provider": "lastfm",
            "ok": True,
            **stats,
            "now_playing_updated": now_playing_updated,
        }
    except Exception as exc:
        _update_provider_status("lastfm", status="error", error=str(exc))
        return {
            "provider": "lastfm",
            "ok": False,
            "error": str(exc),
            "error_code": "LASTFM_SYNC_ERROR",
        }


# ---------------------------------------------------------------------------
# 3. Local Scrobble Receiver (ListenBrainz-compatible POST /apis/listenbrainz/1/submit-listens)
#    Compatible with Pano Scrobbler (Android), AMWin-RP (Windows), FastScrobbler, Multi-Scrobbler
# ---------------------------------------------------------------------------
def ingest_listenbrainz_submit_payload(payload: dict[str, Any], client_label: str = "Pano / Local Scrobbler") -> dict[str, Any]:
    listen_type = str(payload.get("listen_type") or "single").lower()
    items = payload.get("payload") or []
    if not isinstance(items, list):
        items = [items]

    if listen_type == "playing_now":
        if items:
            meta = (items[0] or {}).get("track_metadata") or {}
            add = meta.get("additional_info") or {}
            update_now_playing(
                provider="local_receiver",
                song_name=meta.get("track_name") or "",
                artist_name=meta.get("artist_name") or "",
                album_name=meta.get("release_name") or "",
                duration_ms=int(add.get("duration_ms") or (add.get("duration") or 0) * 1000 or 0),
                is_playing=True,
            )
        return {"status": "ok", "listen_type": "playing_now", "accepted": len(items)}

    scrobbles: list[IncomingScrobble] = []
    max_ts = 0
    for idx, item in enumerate(items):
        meta = (item or {}).get("track_metadata") or {}
        add = meta.get("additional_info") or {}
        song = (meta.get("track_name") or "").strip()
        artist = (meta.get("artist_name") or "").strip()
        if not song:
            continue
        ts = int(item.get("listened_at") or time.time())
        if ts > max_ts:
            max_ts = ts
        dur_ms = int(add.get("duration_ms") or (add.get("duration") or 0) * 1000 or 0)
        player = add.get("media_player") or add.get("submission_client") or client_label
        scrobbles.append(
            IncomingScrobble(
                source_provider="local_receiver",
                song_name=song,
                artist_name=artist or "Artiste inconnu",
                album_name=(meta.get("release_name") or "").strip(),
                started_epoch=ts,
                play_duration_ms=dur_ms if dur_ms > 0 else None,
                media_duration_ms=dur_ms if dur_ms > 0 else None,
                source_event_id=f"rx:{ts}:{idx}:{song[:32]}",
                device_label=str(player),
                device_os=str(add.get("submission_client") or "Scrobbler"),
                mbid_recording=add.get("recording_mbid"),
            )
        )

    stats = reconcile_batch(scrobbles)
    if stats["inserted"] > 0 or stats["upgraded"] > 0:
        export_parquet_snapshot()
    _update_provider_status(
        "local_receiver",
        status="ok",
        cursor_ts=max_ts if max_ts > 0 else None,
        added=stats["inserted"],
    )
    return {"status": "ok", "listen_type": listen_type, **stats}


async def push_playlist_to_listenbrainz(name: str, tracks: list[dict[str, Any]], description: str = "") -> dict[str, Any]:
    """Create a JSPF playlist directly on the user's ListenBrainz account via POST /1/playlist/create."""
    cfg = _get_provider_cfg("listenbrainz")
    token = (cfg.get("token") or "").strip()
    username = (cfg.get("username") or "").strip()
    if not token:
        return {
            "ok": False,
            "error": "Jeton utilisateur ListenBrainz requis pour créer une playlist distante.",
            "hint": "Renseignez votre User Token ListenBrainz dans le Hub Continuum.",
        }

    jspf_tracks = []
    for t in tracks:
        entry: dict[str, Any] = {
            "title": t.get("song_name") or "",
            "creator": t.get("artist_name") or "",
            "album": t.get("album_name") or "",
        }
        if t.get("mbid_recording"):
            entry["identifier"] = f"https://musicbrainz.org/recording/{t['mbid_recording']}"
        jspf_tracks.append(entry)

    body = {
        "playlist": {
            "title": name,
            "annotation": description or "Générée par AMDataWrap V3 Continuum",
            "creator": username or "AMDataWrap",
            "extension": {
                "https://musicbrainz.org/doc/jspf#playlist": {
                    "public": False,
                }
            },
            "track": jspf_tracks,
        }
    }
    try:
        async with httpx.AsyncClient(
            timeout=12.0,
            headers={"Authorization": f"Token {token}", "User-Agent": USER_AGENT},
        ) as client:
            resp = await client.post("https://api.listenbrainz.org/1/playlist/create", json=body)
            if resp.status_code in (200, 201):
                data = resp.json()
                mbid = data.get("playlist_mbid")
                return {
                    "ok": True,
                    "playlist_mbid": mbid,
                    "url": f"https://listenbrainz.org/playlist/{mbid}/" if mbid else None,
                }
            return {"ok": False, "error": f"ListenBrainz HTTP {resp.status_code}: {resp.text[:200]}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
