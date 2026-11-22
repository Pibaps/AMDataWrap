"""Spotify RGPD importer (Extended Streaming History, Account Data & Technical Log Information).

Handles both 2024 and 2026 Spotify RGPD exports:
- Extended Streaming History (`Streaming_History_Audio_*.json`, `endsong_*.json` or ZIP containing them):
  `ts`, `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`,
  `master_metadata_album_album_name`, `spotify_track_uri`, `reason_start`, `reason_end`,
  `shuffle`, `skipped`, `offline`, `offline_timestamp`, `incognito_mode`, `platform`.
  Strict filter: `spotify_track_uri IS NOT NULL` (excludes podcasts/audiobooks).
- Account Data (`StreamingHistory_music_*.json` or `StreamingHistory*.json`):
  `endTime`, `artistName`, `trackName`, `msPlayed` (no URI/end_reason/incognito).
- Technical Log Information (`RawCoreStream*.json` or fallback `PlaybackSegments*.json`):
  `timestamp_utc` / `context_time`, `message_content_uri` (`spotify:track:...`),
  `message_ms_played`, `message_reason_start`, `message_reason_end`, `message_shuffle`,
  `message_incognito_mode`, `message_content_is_downloaded`, `context_device_*`, `context_os_name`.
  Resolves `spotify:track:<id>` URIs without any API key via Spotify's public Embed/oEmbed
  endpoints (cached in SQLite `external_cache`).
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from ..db import db_session
from ..normalize import make_track_key
from .base import (
    NormalizedPlayEvent,
    ProgressCallback,
    compute_sha256,
    parse_utc_timestamp,
    persist_normalized_events,
)

_REASON_END_MAP = {
    "trackdone": "NATURAL_END_OF_TRACK",
    "fwdbtn": "TRACK_SKIPPED_FORWARDS",
    "backbtn": "TRACK_SKIPPED_BACKWARDS",
    "endplay": "MANUALLY_SELECTED_PLAYBACK_OF_A_DIFF_ITEM",
    "logout": "EXIT_APPLICATION",
    "remote": "REMOTE_CONTROL",
    "unexpected-exit-while-paused": "EXIT_APPLICATION",
    "unexpected-exit": "EXIT_APPLICATION",
}

_NEXT_DATA_RE = re.compile(r"<script[^>]*id=[\"']__NEXT_DATA__[\"'][^>]*>(.*?)</script>", re.DOTALL)


def _extract_spotify_id(uri: str | None) -> str | None:
    if not uri:
        return None
    parts = str(uri).strip().split(":")
    if len(parts) == 3 and parts[0] == "spotify" and parts[1] == "track" and parts[2]:
        return parts[2]
    return None


def _is_extended_record(rec: dict[str, Any]) -> bool:
    return (
        "master_metadata_track_name" in rec
        or "spotify_track_uri" in rec
        or ("ts" in rec and "ms_played" in rec)
    )


def _is_account_record(rec: dict[str, Any]) -> bool:
    return "trackName" in rec and "msPlayed" in rec and "endTime" in rec


def _is_technical_core_record(rec: dict[str, Any]) -> bool:
    return "message_content_uri" in rec and (
        "message_ms_played" in rec or "timestamp_utc" in rec or "context_time" in rec
    )


def _is_technical_segment_record(rec: dict[str, Any]) -> bool:
    return "message_track_uri" in rec and "message_segments" in rec


def _load_json_records(
    path: Path,
    progress_cb: ProgressCallback | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Load Spotify JSON records from a single `.json` file or a `.zip` archive."""
    records: list[dict[str, Any]] = []
    detected_mode = "spotify_extended"

    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".json") and not n.startswith("__MACOSX")]
            # 1. Prefer Extended Streaming History or Account Data files if present
            audio_files = [
                n for n in names
                if "streaming_history_audio" in n.lower()
                or "streaminghistory_music" in n.lower()
                or "streaminghistory" in n.lower()
                or "endsong" in n.lower()
            ]
            # 2. Otherwise check Technical Log Information (`RawCoreStream*`, fallback `PlaybackSegments*`)
            if not audio_files:
                raw_core_files = [n for n in names if "rawcorestream" in n.lower()]
                if raw_core_files:
                    audio_files = raw_core_files
                else:
                    audio_files = [n for n in names if "playbacksegments" in n.lower()]

            target_files = audio_files or names
            total_files = max(1, len(target_files))
            for f_idx, name in enumerate(target_files):
                if progress_cb:
                    pct = 10 + int(25 * (f_idx / total_files))
                    progress_cb("reading", pct, f"Lecture de {Path(name).name} ({f_idx + 1}/{total_files})…")
                try:
                    data = json.loads(zf.read(name).decode("utf-8", errors="replace"))
                except Exception:
                    continue
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and (
                            _is_extended_record(item)
                            or _is_account_record(item)
                            or _is_technical_core_record(item)
                            or _is_technical_segment_record(item)
                        ):
                            records.append(item)
    else:
        if progress_cb:
            progress_cb("reading", 20, f"Lecture de {path.name}…")
        raw = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        if isinstance(raw, list):
            records = [r for r in raw if isinstance(r, dict)]

    if records and any(_is_extended_record(r) for r in records[:20]):
        detected_mode = "spotify_extended"
    elif records and any(_is_account_record(r) for r in records[:20]):
        detected_mode = "spotify_account"
    elif records and any(_is_technical_core_record(r) or _is_technical_segment_record(r) for r in records[:20]):
        detected_mode = "spotify_technical_log"

    return records, detected_mode


def _ensure_external_cache_table() -> None:
    with db_session() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS external_cache (
                cache_key TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def _load_cached_track_metadata(track_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not track_ids:
        return {}
    _ensure_external_cache_table()
    resolved: dict[str, dict[str, Any]] = {}
    keys = [f"spotify_embed:{tid}" for tid in track_ids]
    with db_session() as conn:
        for i in range(0, len(keys), 500):
            chunk = keys[i : i + 500]
            placeholders = ",".join("?" for _ in chunk)
            rows = conn.execute(
                f"SELECT cache_key, payload_json FROM external_cache WHERE cache_key IN ({placeholders})",
                chunk,
            ).fetchall()
            for r in rows:
                tid = r["cache_key"].split(":", 1)[1]
                try:
                    data = json.loads(r["payload_json"])
                    if isinstance(data, dict) and data.get("song_name"):
                        resolved[tid] = data
                except Exception:
                    continue
    return resolved


def _save_cached_track_metadata(items: dict[str, dict[str, Any]]) -> None:
    if not items:
        return
    _ensure_external_cache_table()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO external_cache (cache_key, payload_json, updated_at) VALUES (?, ?, ?)",
            [
                (f"spotify_embed:{tid}", json.dumps(meta, ensure_ascii=False), now_iso)
                for tid, meta in items.items()
            ],
        )


async def fetch_single_spotify_embed(
    client: httpx.AsyncClient,
    tid: str,
) -> tuple[dict[str, Any] | None, bool]:
    """Fetch metadata for a single Spotify track ID via public Embed/oEmbed.

    Returns (meta_dict_or_none, was_rate_limited).
    """
    meta: dict[str, Any] = {}
    rate_limited = False
    try:
        resp = await client.get(f"https://open.spotify.com/embed/track/{tid}")
        if resp.status_code == 429:
            return None, True
        if resp.status_code == 200:
            m = _NEXT_DATA_RE.search(resp.text)
            if m:
                nd = json.loads(m.group(1))
                ent = (
                    nd.get("props", {})
                    .get("pageProps", {})
                    .get("state", {})
                    .get("data", {})
                    .get("entity", {})
                )
                if isinstance(ent, dict) and (ent.get("name") or ent.get("title")):
                    artists = [
                        a.get("name").strip()
                        for a in (ent.get("artists") or [])
                        if isinstance(a, dict) and a.get("name")
                    ]
                    images = (ent.get("visualIdentity") or {}).get("image") or []
                    artwork_url = None
                    if isinstance(images, list) and images:
                        best = max(images, key=lambda im: int(im.get("maxWidth") or 0))
                        artwork_url = best.get("url")
                    rel_iso = ((ent.get("releaseDate") or {}).get("isoString") or "").strip() or None
                    rel_year = None
                    if rel_iso and len(rel_iso) >= 4 and rel_iso[:4].isdigit():
                        y = int(rel_iso[:4])
                        if 1900 <= y <= 2035:
                            rel_year = y
                    preview_url = ((ent.get("audioPreview") or {}).get("url") or "").strip() or None
                    meta = {
                        "song_name": str(ent.get("name") or ent.get("title")).strip(),
                        "artist_name": ", ".join(artists) if artists else "Artiste inconnu",
                        "duration_ms": int(ent.get("duration") or 0),
                        "release_date": rel_iso,
                        "release_year": rel_year,
                        "artwork_url": artwork_url,
                        "preview_url": preview_url,
                    }
    except Exception:
        pass

    if not meta.get("song_name"):
        try:
            o_resp = await client.get(
                "https://open.spotify.com/oembed",
                params={"url": f"https://open.spotify.com/track/{tid}"},
            )
            if o_resp.status_code == 429:
                rate_limited = True
            elif o_resp.status_code == 200:
                odata = o_resp.json()
                title = (odata.get("title") or "").strip()
                if title:
                    meta = {
                        "song_name": title,
                        "artist_name": "Artiste inconnu",
                        "artwork_url": odata.get("thumbnail_url"),
                    }
        except Exception:
            pass

    return (meta if meta.get("song_name") else None), rate_limited


async def _fetch_spotify_embed_batch(track_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Resolve Spotify track IDs without any API key using public Embed & oEmbed endpoints."""
    results: dict[str, dict[str, Any]] = {}
    sem = asyncio.Semaphore(4)
    consecutive_429 = 0
    abort_event = asyncio.Event()

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(8.0),
        follow_redirects=True,
        headers={"User-Agent": "AMDataWrap/4.1 (Local Spotify RGPD Importer)"},
    ) as client:
        async def _fetch_one(tid: str) -> None:
            nonlocal consecutive_429
            if abort_event.is_set():
                return
            async with sem:
                if abort_event.is_set():
                    return
                await asyncio.sleep(0.12)
                meta, rate_limited = await fetch_single_spotify_embed(client, tid)
                if rate_limited:
                    consecutive_429 += 1
                    if consecutive_429 >= 12:
                        # Background enrichment_manager will finish remaining tracks politely
                        abort_event.set()
                        return
                    await asyncio.sleep(1.5)
                    meta, rate_limited = await fetch_single_spotify_embed(client, tid)
                if meta:
                    consecutive_429 = 0
                    results[tid] = meta

        await asyncio.gather(*(_fetch_one(tid) for tid in track_ids))

    return results


def resolve_spotify_track_ids(track_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Resolve a list of Spotify track IDs (cache-first, then concurrent public Embed fetch)."""
    unique_ids = list(dict.fromkeys(tid for tid in track_ids if tid))
    if not unique_ids:
        return {}

    resolved = _load_cached_track_metadata(unique_ids)
    missing = [tid for tid in unique_ids if tid not in resolved]
    if not missing:
        return resolved

    try:
        asyncio.get_running_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            fetched = pool.submit(asyncio.run, _fetch_spotify_embed_batch(missing)).result()
    except RuntimeError:
        fetched = asyncio.run(_fetch_spotify_embed_batch(missing))

    if fetched:
        _save_cached_track_metadata(fetched)
        resolved.update(fetched)

    return resolved


def _extract_needed_track_ids(records: list[dict[str, Any]]) -> list[str]:
    """Collect Spotify track IDs that need metadata resolution."""
    ids: list[str] = []
    seen: set[str] = set()
    for rec in records:
        if _is_technical_core_record(rec):
            tid = _extract_spotify_id(rec.get("message_content_uri"))
        elif _is_technical_segment_record(rec):
            tid = _extract_spotify_id(rec.get("message_track_uri"))
        elif _is_extended_record(rec) and not rec.get("master_metadata_track_name"):
            tid = _extract_spotify_id(rec.get("spotify_track_uri"))
        else:
            tid = None
        if tid and tid not in seen:
            seen.add(tid)
            ids.append(tid)
    return ids


def _normalize_spotify_platform(raw: str | None) -> tuple[str | None, str | None]:
    """Map raw Spotify `platform` strings (2020–2026) to clean (device_label, device_os)."""
    s = (raw or "").strip()
    if not s:
        return None, None
    low = s.lower()
    if "web_player" in low:
        return "Spotify Web Player", "Web"
    if "windows" in low:
        return "Windows PC", "Windows"
    if "android" in low:
        if "sm-a530f" in low:
            return "Samsung Galaxy A8", "Android"
        if "rmx3472" in low:
            return "Realme RMX3472", "Android"
        return "Android", "Android"
    if "iphone" in low or "ipad" in low or low == "ios" or "ios " in low:
        return "iPhone / iOS", "iOS"
    if "osx" in low or "macos" in low or "mac " in low:
        return "Mac", "macOS"
    if "ps4" in low or "ps5" in low or "playstation" in low or "scei" in low:
        return "PlayStation", "PlayStation"
    if "cast" in low:
        return "Google Cast", "Cast"
    if "linux" in low:
        return "Linux", "Linux"
    return s, s


def _format_technical_device(rec: dict[str, Any]) -> tuple[str | None, str | None]:
    mfg = (rec.get("context_device_manufacturer") or "").strip()
    model = (rec.get("context_device_model") or "").strip()
    dtype = (rec.get("context_device_type") or "").strip()
    os_name = (rec.get("context_os_name") or "").strip()
    combined = f"{mfg} {model}".strip()
    if combined:
        label = combined
    elif dtype:
        label = dtype
    elif os_name:
        label = os_name
    else:
        label = None
    return label, (os_name or None)


def _sum_segments_ms(raw_segments: Any) -> int:
    if isinstance(raw_segments, str):
        try:
            raw_segments = json.loads(raw_segments)
        except Exception:
            return 0
    if not isinstance(raw_segments, list):
        return 0
    total = 0
    for seg in raw_segments:
        if isinstance(seg, (list, tuple)) and len(seg) >= 2:
            try:
                start, end = int(seg[0]), int(seg[1])
                if end > start:
                    total += end - start
            except (TypeError, ValueError):
                continue
    return max(0, total)


def parse_spotify_records(
    records: list[dict[str, Any]],
    *,
    include_incognito: bool = True,
    track_metadata: dict[str, dict[str, Any]] | None = None,
) -> tuple[list[NormalizedPlayEvent], str, dict[str, int]]:
    """Pure parser converting raw Spotify JSON dicts to `NormalizedPlayEvent` list."""
    events: list[NormalizedPlayEvent] = []
    stats = {
        "total_raw": len(records),
        "podcasts_filtered": 0,
        "incognito_filtered": 0,
        "invalid_timestamps": 0,
        "resolved_tracks": 0,
        "unresolved_tracks": 0,
    }
    mode = "spotify_account"
    meta_map = track_metadata or {}

    for idx, rec in enumerate(records):
        if _is_extended_record(rec):
            mode = "spotify_extended"
            track_uri = rec.get("spotify_track_uri")
            # Strict filter: exclude podcasts, audiobooks, episodes (spotify_track_uri IS NULL)
            if not track_uri or not str(track_uri).startswith("spotify:track:"):
                stats["podcasts_filtered"] += 1
                continue

            is_incognito = 1 if rec.get("incognito_mode") else 0
            if is_incognito and not include_incognito:
                stats["incognito_filtered"] += 1
                continue

            sp_id = _extract_spotify_id(track_uri)
            tmeta = meta_map.get(sp_id or "", {})

            song = rec.get("master_metadata_track_name") or tmeta.get("song_name") or ""
            artist = rec.get("master_metadata_album_artist_name") or tmeta.get("artist_name") or "Artiste inconnu"
            album = rec.get("master_metadata_album_album_name") or "Single / Inconnu"
            if not str(song).strip():
                continue

            ms_played = max(0, int(rec.get("ms_played") or 0))
            offline_flag = 1 if rec.get("offline") else 0

            # Timestamp handling: ts is end time in Extended History; offline_timestamp anomaly
            dt_utc: datetime | None = None
            offline_ts = rec.get("offline_timestamp")
            if offline_flag and offline_ts not in (None, 0, "0", ""):
                dt_utc = parse_utc_timestamp(offline_ts)
            if dt_utc is None:
                dt_end = parse_utc_timestamp(rec.get("ts"))
                if dt_end is not None:
                    dt_utc = dt_end - timedelta(milliseconds=ms_played)
            if dt_utc is None:
                stats["invalid_timestamps"] += 1
                continue

            reason_end_raw = (rec.get("reason_end") or "").strip().lower()
            end_reason = _REASON_END_MAP.get(reason_end_raw, reason_end_raw.upper() if reason_end_raw else None)
            reason_start = (rec.get("reason_start") or "").strip() or None

            # Historical anomaly (2015-2022): `skipped` field is often null
            raw_skipped = rec.get("skipped")
            if isinstance(raw_skipped, bool):
                skipped_val: int | None = 1 if raw_skipped else 0
            elif reason_end_raw in ("fwdbtn", "backbtn"):
                skipped_val = 1
            elif reason_end_raw == "trackdone":
                skipped_val = 0
            else:
                skipped_val = 1 if (0 < ms_played < 30_000) else 0

            shuffle_raw = rec.get("shuffle")
            shuffle_str = "SHUFFLE" if shuffle_raw is True else ("OFF" if shuffle_raw is False else None)

            device_label, device_os = _normalize_spotify_platform(rec.get("platform"))
            media_ms = int(tmeta.get("duration_ms") or 0) or max(ms_played, 180_000)

            events.append(
                NormalizedPlayEvent(
                    song_name=str(song),
                    artist_name=str(artist),
                    album_name=str(album),
                    started_at_utc=dt_utc,
                    play_duration_ms=ms_played,
                    media_duration_ms=media_ms,
                    source_provider="spotify_extended",
                    source_event_id=f"sp_ext:{int(dt_utc.timestamp())}:{sp_id or idx}",
                    end_reason_type=end_reason,
                    reason_start=reason_start,
                    skipped=skipped_val,
                    offline=offline_flag,
                    shuffle_play=shuffle_str,
                    incognito_mode=is_incognito,
                    duration_is_estimated=0,
                    device_label=device_label,
                    device_os=device_os,
                    external_id=sp_id,
                    external_url=f"https://open.spotify.com/track/{sp_id}" if sp_id else None,
                    external_provider="spotify",
                )
            )
        elif _is_account_record(rec):
            song = rec.get("trackName") or ""
            artist = rec.get("artistName") or "Artiste inconnu"
            if not str(song).strip():
                continue
            ms_played = max(0, int(rec.get("msPlayed") or 0))
            dt_end = parse_utc_timestamp(rec.get("endTime"))
            if dt_end is None:
                stats["invalid_timestamps"] += 1
                continue
            dt_utc = dt_end - timedelta(milliseconds=ms_played)
            events.append(
                NormalizedPlayEvent(
                    song_name=str(song),
                    artist_name=str(artist),
                    album_name="Single / Inconnu",
                    started_at_utc=dt_utc,
                    play_duration_ms=ms_played,
                    media_duration_ms=max(ms_played, 180_000),
                    source_provider="spotify_account",
                    source_event_id=f"sp_acc:{int(dt_utc.timestamp())}:{idx}",
                    skipped=1 if (0 < ms_played < 30_000) else 0,
                    duration_is_estimated=0,
                )
            )
        elif _is_technical_core_record(rec) or _is_technical_segment_record(rec):
            mode = "spotify_technical_log"
            is_core = _is_technical_core_record(rec)
            track_uri = rec.get("message_content_uri") if is_core else rec.get("message_track_uri")
            if not track_uri or not str(track_uri).startswith("spotify:track:"):
                stats["podcasts_filtered"] += 1
                continue

            is_incognito = 1 if rec.get("message_incognito_mode") else 0
            if is_incognito and not include_incognito:
                stats["incognito_filtered"] += 1
                continue

            sp_id = _extract_spotify_id(track_uri)
            if not sp_id:
                continue

            tmeta = meta_map.get(sp_id)
            if tmeta and tmeta.get("song_name"):
                song = str(tmeta["song_name"])
                artist = str(tmeta.get("artist_name") or "Artiste inconnu")
                stats["resolved_tracks"] += 1
            else:
                song = f"Spotify Track {sp_id[:8]}"
                artist = "Artiste inconnu"
                stats["unresolved_tracks"] += 1

            ms_played = (
                max(0, int(rec.get("message_ms_played") or 0))
                if is_core
                else _sum_segments_ms(rec.get("message_segments"))
            )

            dt_end = parse_utc_timestamp(rec.get("timestamp_utc")) or parse_utc_timestamp(rec.get("context_time"))
            if dt_end is None:
                stats["invalid_timestamps"] += 1
                continue
            dt_utc = dt_end - timedelta(milliseconds=ms_played)

            reason_end_raw = (rec.get("message_reason_end") or "").strip().lower()
            end_reason = _REASON_END_MAP.get(reason_end_raw, reason_end_raw.upper() if reason_end_raw else None)
            reason_start = (rec.get("message_reason_start") or "").strip() or None

            if reason_end_raw in ("fwdbtn", "backbtn"):
                skipped_val = 1
            elif reason_end_raw == "trackdone":
                skipped_val = 0
            else:
                skipped_val = 1 if (0 < ms_played < 30_000) else 0

            shuffle_raw = rec.get("message_shuffle")
            shuffle_str = "SHUFFLE" if shuffle_raw is True else ("OFF" if shuffle_raw is False else None)
            offline_flag = 1 if rec.get("message_content_is_downloaded") else 0
            device_label, device_os = _format_technical_device(rec)
            media_ms = int((tmeta or {}).get("duration_ms") or 0) or max(ms_played, 180_000)

            events.append(
                NormalizedPlayEvent(
                    song_name=song,
                    artist_name=artist,
                    album_name="Single / Inconnu",
                    started_at_utc=dt_utc,
                    play_duration_ms=ms_played,
                    media_duration_ms=media_ms,
                    source_provider="spotify_technical_log",
                    source_event_id=f"sp_tech:{int(dt_utc.timestamp())}:{sp_id}:{idx}",
                    end_reason_type=end_reason,
                    reason_start=reason_start,
                    skipped=skipped_val,
                    offline=offline_flag,
                    shuffle_play=shuffle_str,
                    incognito_mode=is_incognito,
                    duration_is_estimated=0,
                    device_label=device_label,
                    device_os=device_os,
                    external_id=sp_id,
                    external_url=f"https://open.spotify.com/track/{sp_id}",
                    external_provider="spotify",
                )
            )

    return events, mode, stats


def _apply_resolved_metadata_to_catalog(
    events: list[NormalizedPlayEvent],
    track_metadata: dict[str, dict[str, Any]],
) -> None:
    """Populate artwork_url, preview_url, release_date, release_year from Spotify Embed cache."""
    if not track_metadata:
        return
    updates: list[tuple[Any, ...]] = []
    seen_keys: set[str] = set()
    for ev in events:
        if not ev.external_id:
            continue
        meta = track_metadata.get(ev.external_id)
        if not meta:
            continue
        tkey = make_track_key(ev.song_name, ev.album_name or "Single / Inconnu")
        if tkey in seen_keys:
            continue
        seen_keys.add(tkey)
        updates.append(
            (
                meta.get("artwork_url"),
                meta.get("preview_url"),
                meta.get("release_year"),
                meta.get("release_date"),
                int(meta.get("duration_ms") or 0) or None,
                tkey,
            )
        )
    if not updates:
        return
    with db_session() as conn:
        conn.executemany(
            """
            UPDATE tracks_catalog SET
                artwork_url = COALESCE(artwork_url, ?),
                preview_url = COALESCE(preview_url, ?),
                release_year = COALESCE(release_year, ?),
                release_date = COALESCE(release_date, ?),
                duration_ms = CASE WHEN COALESCE(duration_ms, 0) <= 0 AND ? IS NOT NULL THEN ? ELSE duration_ms END
            WHERE track_key = ?
            """,
            [(a, p, y, d, dur, dur, tk) for (a, p, y, d, dur, tk) in updates],
        )


def import_spotify_file(
    path: Path,
    *,
    filename: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    include_incognito: bool = True,
    progress_cb: ProgressCallback | None = None,
) -> dict[str, Any]:
    records, _ = _load_json_records(path, progress_cb=progress_cb)
    needed_ids = _extract_needed_track_ids(records)
    if needed_ids and progress_cb:
        progress_cb("resolving", 38, f"Résolution de {len(needed_ids)} titres Spotify…")
    track_metadata = resolve_spotify_track_ids(needed_ids) if needed_ids else {}

    if progress_cb:
        progress_cb("parsing", 54, f"Analyse de {len(records):,} entrées Spotify…".replace(",", " "))
    events, mode, stats = parse_spotify_records(
        records,
        include_incognito=include_incognito,
        track_metadata=track_metadata,
    )
    res = persist_normalized_events(
        events,
        source_provider=mode,
        filename=filename or path.name,
        file_sha256=compute_sha256(path),
        profile_id=profile_id,
        profile_name=profile_name,
        metadata={"spotify_mode": mode, **stats},
        progress_cb=progress_cb,
    )
    if track_metadata:
        _apply_resolved_metadata_to_catalog(events, track_metadata)
    res["parser_stats"] = stats
    return res
