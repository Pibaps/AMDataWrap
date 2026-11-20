"""Spotify RGPD importer (Extended Streaming History & Account Data).

Handles:
- Extended Streaming History (`Streaming_History_Audio_*.json` or ZIP containing them):
  `ts`, `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`,
  `master_metadata_album_album_name`, `spotify_track_uri`, `reason_start`, `reason_end`,
  `shuffle`, `skipped`, `offline`, `offline_timestamp`, `incognito_mode`, `platform`.
  Strict filter: `spotify_track_uri IS NOT NULL` (excludes podcasts/audiobooks).
  Historical anomaly handling:
  - `skipped` was often null or unreliable before ~2022 -> infer from `reason_end` or duration if None
  - `offline_timestamp` can be in seconds or milliseconds when `offline=True`
- Account Data (`StreamingHistory_music_*.json` or `StreamingHistory*.json`):
  `endTime`, `artistName`, `trackName`, `msPlayed` (no URI/end_reason/incognito).
"""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .base import NormalizedPlayEvent, compute_sha256, parse_utc_timestamp, persist_normalized_events

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


def _load_json_records(path: Path) -> tuple[list[dict[str, Any]], str]:
    """Load Spotify JSON records from a single `.json` file or a `.zip` archive."""
    records: list[dict[str, Any]] = []
    detected_mode = "spotify_extended"

    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".json") and not n.startswith("__MACOSX")]
            # Prefer audio streaming history files if present
            audio_files = [
                n for n in names
                if "streaming_history_audio" in n.lower() or "streaminghistory_music" in n.lower() or "streaminghistory" in n.lower()
            ]
            target_files = audio_files or names
            for name in target_files:
                try:
                    data = json.loads(zf.read(name).decode("utf-8", errors="replace"))
                except Exception:
                    continue
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and (_is_extended_record(item) or _is_account_record(item)):
                            records.append(item)
    else:
        raw = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        if isinstance(raw, list):
            records = [r for r in raw if isinstance(r, dict)]

    if records and any(_is_extended_record(r) for r in records[:20]):
        detected_mode = "spotify_extended"
    elif records and any(_is_account_record(r) for r in records[:20]):
        detected_mode = "spotify_account"

    return records, detected_mode


def parse_spotify_records(
    records: list[dict[str, Any]],
    *,
    include_incognito: bool = True,
) -> tuple[list[NormalizedPlayEvent], str, dict[str, int]]:
    """Pure parser converting raw Spotify JSON dicts to `NormalizedPlayEvent` list."""
    events: list[NormalizedPlayEvent] = []
    stats = {
        "total_raw": len(records),
        "podcasts_filtered": 0,
        "incognito_filtered": 0,
        "invalid_timestamps": 0,
    }
    mode = "spotify_account"

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

            song = rec.get("master_metadata_track_name") or ""
            artist = rec.get("master_metadata_album_artist_name") or "Artiste inconnu"
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

            sp_id = _extract_spotify_id(track_uri)
            platform_raw = (rec.get("platform") or "").strip() or None

            events.append(
                NormalizedPlayEvent(
                    song_name=str(song),
                    artist_name=str(artist),
                    album_name=str(album),
                    started_at_utc=dt_utc,
                    play_duration_ms=ms_played,
                    media_duration_ms=max(ms_played, 180_000),
                    source_provider="spotify_extended",
                    source_event_id=f"sp_ext:{int(dt_utc.timestamp())}:{sp_id or idx}",
                    end_reason_type=end_reason,
                    reason_start=reason_start,
                    skipped=skipped_val,
                    offline=offline_flag,
                    shuffle_play=shuffle_str,
                    incognito_mode=is_incognito,
                    duration_is_estimated=0,
                    device_label=platform_raw,
                    device_os=platform_raw,
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

    return events, mode, stats


def import_spotify_file(
    path: Path,
    *,
    filename: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    include_incognito: bool = True,
) -> dict[str, Any]:
    records, _ = _load_json_records(path)
    events, mode, stats = parse_spotify_records(records, include_incognito=include_incognito)
    res = persist_normalized_events(
        events,
        source_provider=mode,
        filename=filename or path.name,
        file_sha256=compute_sha256(path),
        profile_id=profile_id,
        profile_name=profile_name,
        metadata={"spotify_mode": mode, **stats},
    )
    res["parser_stats"] = stats
    return res
