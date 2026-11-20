"""TIDAL `.csv` UTF-8 importer with alias auto-detection & assisted manual column mapping."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .base import (
    NormalizedPlayEvent,
    compute_sha256,
    normalize_isrc,
    parse_utc_timestamp,
    persist_normalized_events,
)

_TIDAL_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "song": ("title", "track name", "track", "song", "song title", "name", "titre"),
    "artist": ("artist", "artist name", "artists", "artiste", "performer"),
    "album": ("album", "album name", "album title", "release"),
    "duration": ("duration", "duration_ms", "duration (s)", "length", "durée", "ms_played"),
    "isrc": ("isrc", "track isrc", "isrc code"),
    "date": ("date", "played at", "played_at", "timestamp", "time", "date added", "created"),
    "tidal_id": ("tidal id", "track id", "id", "tidal_id"),
    "quality": ("quality", "audio quality", "audio_quality", "format"),
}


def _norm_col(name: str) -> str:
    return " ".join(name.strip().lower().replace("_", " ").split())


def _sniff_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return dialect.delimiter
    except Exception:
        if sample.count(";") > sample.count(","):
            return ";"
        return ","


def detect_tidal_columns(headers: list[str]) -> dict[str, str]:
    """Auto-detect canonical field -> CSV header name."""
    detected: dict[str, str] = {}
    for raw_h in headers:
        norm = _norm_col(raw_h)
        for field, aliases in _TIDAL_HEADER_ALIASES.items():
            if field not in detected and norm in aliases:
                detected[field] = raw_h
                break
    return detected


def preview_csv_columns(path: Path, max_rows: int = 5) -> dict[str, Any]:
    """Return CSV headers, sample rows, and auto-detected column mapping for assisted UI."""
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    delim = _sniff_delimiter(text[:4096])
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    headers = list(reader.fieldnames or [])
    sample_rows: list[dict[str, Any]] = []
    for i, row in enumerate(reader):
        if i >= max_rows:
            break
        sample_rows.append(dict(row))
    detected = detect_tidal_columns(headers)
    return {
        "headers": headers,
        "delimiter": delim,
        "detected_mapping": detected,
        "sample_rows": sample_rows,
        "needs_manual_mapping": "song" not in detected or "artist" not in detected,
    }


def _parse_duration_ms(raw: Any) -> tuple[int, int]:
    """Return `(duration_ms, duration_is_estimated)` from seconds, ms, or `MM:SS`."""
    if raw is None or str(raw).strip() == "":
        return 180_000, 1
    s = str(raw).strip()
    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 2:
                return (int(parts[0]) * 60 + int(float(parts[1]))) * 1000, 0
            if len(parts) == 3:
                return (int(parts[0]) * 3600 + int(parts[1]) * 60 + int(float(parts[2]))) * 1000, 0
        except ValueError:
            return 180_000, 1
    try:
        val = float(s)
        if val <= 0:
            return 180_000, 1
        if val > 10_000:
            return int(val), 0
        return int(val * 1000), 0
    except ValueError:
        return 180_000, 1


def parse_tidal_csv(
    path: Path,
    *,
    column_mapping: dict[str, str] | None = None,
) -> tuple[list[NormalizedPlayEvent], dict[str, Any]]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    delim = _sniff_delimiter(text[:4096])
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    headers = list(reader.fieldnames or [])
    col_map = detect_tidal_columns(headers)
    if column_mapping:
        for k, v in column_mapping.items():
            if v and v in headers:
                col_map[k] = v

    events: list[NormalizedPlayEvent] = []
    stats: dict[str, Any] = {
        "total_raw": 0,
        "column_mapping": col_map,
        "synthetic_timestamps": 0,
        "estimated_durations": 0,
    }
    if "song" not in col_map:
        return events, stats

    base_fallback_dt = datetime.now(timezone.utc) - timedelta(days=1)

    for idx, row in enumerate(reader):
        stats["total_raw"] += 1
        song = str(row.get(col_map["song"]) or "").strip()
        if not song:
            continue
        artist_col = col_map.get("artist")
        artist = str(row.get(artist_col) or "Artiste inconnu").strip() if artist_col else "Artiste inconnu"
        album_col = col_map.get("album")
        album = str(row.get(album_col) or "Single / Inconnu").strip() if album_col else "Single / Inconnu"

        date_col = col_map.get("date")
        dt_utc = parse_utc_timestamp(row.get(date_col)) if date_col else None
        if dt_utc is None:
            # Playlist/favorites CSV without play timestamp -> deterministic synthetic spacing
            dt_utc = base_fallback_dt + timedelta(minutes=idx * 4)
            stats["synthetic_timestamps"] += 1

        dur_col = col_map.get("duration")
        play_ms, dur_est = _parse_duration_ms(row.get(dur_col) if dur_col else None)
        if dur_est:
            stats["estimated_durations"] += 1

        isrc_col = col_map.get("isrc")
        isrc = normalize_isrc(row.get(isrc_col)) if isrc_col else None
        tid_col = col_map.get("tidal_id")
        tidal_id = str(row.get(tid_col) or "").strip() or None if tid_col else None
        qual_col = col_map.get("quality")
        quality = str(row.get(qual_col) or "").strip() or None if qual_col else None

        events.append(
            NormalizedPlayEvent(
                song_name=song,
                artist_name=artist or "Artiste inconnu",
                album_name=album or "Single / Inconnu",
                started_at_utc=dt_utc,
                play_duration_ms=play_ms,
                media_duration_ms=play_ms,
                source_provider="tidal_csv",
                source_event_id=f"tidal:{int(dt_utc.timestamp())}:{tidal_id or idx}",
                duration_is_estimated=dur_est,
                audio_quality=quality,
                isrc=isrc,
                external_id=tidal_id,
                external_url=f"https://listen.tidal.com/track/{tidal_id}" if tidal_id else None,
                external_provider="tidal",
            )
        )

    return events, stats


def import_tidal_csv(
    path: Path,
    *,
    filename: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    column_mapping: dict[str, str] | None = None,
) -> dict[str, Any]:
    events, stats = parse_tidal_csv(path, column_mapping=column_mapping)
    res = persist_normalized_events(
        events,
        source_provider="tidal_csv",
        filename=filename or path.name,
        file_sha256=compute_sha256(path),
        profile_id=profile_id,
        profile_name=profile_name,
        metadata={"parser": "tidal_csv", **stats},
    )
    res["parser_stats"] = stats
    return res
