"""Deezer RGPD `.xlsx` importer using `openpyxl` in read-only mode.

Handles:
- EN & FR column header detection (`Song Title`/`Titre de la chanson`, `Artist`/`Artiste`,
  `Album`, `ISRC`, `Date`, `Listening Time`/`Temps d'écoute`, `Platform Name`/`Plateforme`)
- Strict rejection of IP address columns (`IP Address`, `Adresse IP`, `IP`) — never stored or logged
- UTC timestamp parsing
- Imputation of `-1` listening durations (sets `duration_is_estimated = 1` and 180s fallback)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from .base import (
    NormalizedPlayEvent,
    compute_sha256,
    normalize_isrc,
    parse_utc_timestamp,
    persist_normalized_events,
)

_FORBIDDEN_IP_HEADERS = frozenset(
    {"ip", "ip address", "adresse ip", "ip_address", "client ip", "user ip"}
)

_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "song": ("song title", "titre de la chanson", "titre", "track", "track title", "title", "song"),
    "artist": ("artist", "artiste", "artist name", "nom de l'artiste"),
    "album": ("album", "album title", "titre de l'album"),
    "isrc": ("isrc", "track isrc"),
    "date": ("date", "listening date", "date d'écoute", "date d'ecoute", "timestamp"),
    "duration": (
        "listening time",
        "temps d'écoute",
        "temps d'ecoute",
        "duration",
        "durée",
        "duree",
        "listening_time",
    ),
    "platform": ("platform name", "plateforme", "platform", "platform model", "device"),
}

_IMPUTED_DURATION_MS = 180_000


def _norm_header(h: Any) -> str:
    if h is None:
        return ""
    return " ".join(str(h).strip().lower().replace("\u2019", "'").split())


def _map_headers(raw_headers: list[Any]) -> tuple[dict[str, int], list[str]]:
    mapping: dict[str, int] = {}
    rejected_ip_cols: list[str] = []
    for idx, raw in enumerate(raw_headers):
        norm = _norm_header(raw)
        if not norm:
            continue
        if norm in _FORBIDDEN_IP_HEADERS or "ip address" in norm or "adresse ip" in norm:
            rejected_ip_cols.append(str(raw))
            continue
        for field, aliases in _HEADER_ALIASES.items():
            if field not in mapping and norm in aliases:
                mapping[field] = idx
                break
    return mapping, rejected_ip_cols


def _pick_history_sheet(wb) -> Any:
    """Prefer the listening history sheet (EN/FR) if multiple sheets exist."""
    for name in wb.sheetnames:
        low = name.lower()
        if any(k in low for k in ("listening", "historique", "history", "ecoute", "écoute", "streams")):
            return wb[name]
    return wb[wb.sheetnames[0]]


def parse_deezer_xlsx(path: Path) -> tuple[list[NormalizedPlayEvent], dict[str, Any]]:
    wb = load_workbook(filename=str(path), read_only=True, data_only=True)
    events: list[NormalizedPlayEvent] = []
    stats: dict[str, Any] = {
        "total_raw": 0,
        "ip_columns_rejected": [],
        "imputed_durations": 0,
        "invalid_timestamps": 0,
    }
    try:
        ws = _pick_history_sheet(wb)
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = list(next(rows_iter))
        except StopIteration:
            return events, stats

        col_map, rejected_ips = _map_headers(header_row)
        stats["ip_columns_rejected"] = rejected_ips
        if "song" not in col_map or "date" not in col_map:
            return events, stats

        for idx, row in enumerate(rows_iter):
            stats["total_raw"] += 1
            if not row:
                continue

            def _cell(field: str) -> Any:
                cidx = col_map.get(field)
                if cidx is None or cidx >= len(row):
                    return None
                return row[cidx]

            song = str(_cell("song") or "").strip()
            if not song:
                continue
            artist = str(_cell("artist") or "Artiste inconnu").strip() or "Artiste inconnu"
            album = str(_cell("album") or "Single / Inconnu").strip() or "Single / Inconnu"
            dt_utc = parse_utc_timestamp(_cell("date"))
            if dt_utc is None:
                stats["invalid_timestamps"] += 1
                continue

            raw_dur = _cell("duration")
            duration_estimated = 0
            play_ms = 0
            try:
                dur_val = float(raw_dur) if raw_dur not in (None, "") else -1.0
            except (TypeError, ValueError):
                dur_val = -1.0

            if dur_val < 0:
                play_ms = _IMPUTED_DURATION_MS
                duration_estimated = 1
                stats["imputed_durations"] += 1
            elif dur_val > 10_000:
                # Already milliseconds
                play_ms = int(dur_val)
            else:
                # Deezer RGPD reports listening time in seconds
                play_ms = int(dur_val * 1000)

            isrc = normalize_isrc(_cell("isrc"))
            platform_raw = str(_cell("platform") or "").strip() or None

            events.append(
                NormalizedPlayEvent(
                    song_name=song,
                    artist_name=artist,
                    album_name=album,
                    started_at_utc=dt_utc,
                    play_duration_ms=play_ms,
                    media_duration_ms=max(play_ms, 180_000),
                    source_provider="deezer_rgpd",
                    source_event_id=f"dz:{int(dt_utc.timestamp())}:{idx}",
                    duration_is_estimated=duration_estimated,
                    device_label=platform_raw,
                    device_os=platform_raw,
                    isrc=isrc,
                )
            )
    finally:
        wb.close()

    return events, stats


def import_deezer_xlsx(
    path: Path,
    *,
    filename: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
) -> dict[str, Any]:
    events, stats = parse_deezer_xlsx(path)
    res = persist_normalized_events(
        events,
        source_provider="deezer_rgpd",
        filename=filename or path.name,
        file_sha256=compute_sha256(path),
        profile_id=profile_id,
        profile_name=profile_name,
        metadata={"parser": "deezer_rgpd", **stats},
    )
    res["parser_stats"] = stats
    return res
