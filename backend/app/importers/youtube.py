"""YouTube Music Google Takeout importer (`watch-history.json` & `watch-history.html`).

Handles both JSON and HTML Google Takeout exports (standalone or inside `.zip`):
- Normalizes non-breaking spaces (`YouTube\xa0Music` in French Takeout -> `YouTube Music`)
- Accepts `header == "YouTube Music"`, `music.youtube.com` URLs, and unambiguous YouTube music
  channels (`- Topic` / `- Sujet` / `- Thema` / `VEVO`) while filtering out non-music videos
- Multilingual prefix stripping on `title` ("Watched ", "Vous avez regardé ", etc.)
- `" - Topic"` / `" - Sujet"` / `" - Thema"` / `"VEVO"` cleanup on artist name
- Deleted / unavailable video tolerance (skips cleanly without crashing)
- Sets `duration_is_estimated = 1` (Google Takeout does not include listen duration)
- Stores YouTube `videoId` in `platform_track_mappings` (`provider='youtube'`) for instant 0 € playback!
"""

from __future__ import annotations

import html
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from ..db import db_session
from ..normalize import make_track_key
from .base import (
    NormalizedPlayEvent,
    ProgressCallback,
    compute_sha256,
    parse_utc_timestamp,
    persist_normalized_events,
)

# Multilingual Takeout prefixes before the song title
_WATCHED_PREFIX_RE = re.compile(
    r"^(?:"
    r"Watched\s+|"
    r"Vous avez regardé\s+|"
    r"Vous avez écouté\s+|"
    r"Angesehen:\s*|"
    r"Visto\s+|"
    r"Has visto\s+|"
    r"Visualizzato\s+|"
    r"Hai guardato\s+|"
    r"Assistiu a\s+|"
    r"Você assistiu\s+|"
    r"Bekeken:\s*|"
    r"Obejrzano:\s*|"
    r"Просмотрено:\s*|"
    r"視聴済み:\s*"
    r")",
    re.IGNORECASE,
)

# Multilingual YouTube auto-generated artist channel suffixes
_TOPIC_SUFFIX_RE = re.compile(
    r"\s*-\s*(?:Topic|Sujet|Thema|Tema|Temat|Тема|トピック)$",
    re.IGNORECASE,
)

# Deleted / private video title markers
_DELETED_TITLE_MARKERS = (
    "a video that has been removed",
    "une vidéo qui a été supprimée",
    "https://www.youtube.com/watch?v=",
    "https://music.youtube.com/watch?v=",
)

_ESTIMATED_PLAY_MS = 210_000  # 3m30s default estimate until Deezer/YTM enriches exact duration

# HTML parsing regexes for Google Takeout `watch-history.html`
_HTML_HEADER_RE = re.compile(r'mdl-typography--title[^>]*>(.*?)<', re.DOTALL)
_HTML_LINK_RE = re.compile(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
_HTML_DATE_RE = re.compile(r'<br>\s*([^<>]+?)\s*<br>\s*</div>', re.DOTALL)

_FR_MONTHS = {
    "janv": 1, "jan": 1, "janvier": 1,
    "févr": 2, "fevr": 2, "fév": 2, "fev": 2, "février": 2, "fevrier": 2,
    "mars": 3, "mar": 3,
    "avr": 4, "avril": 4, "apr": 4,
    "mai": 5, "may": 5,
    "juin": 6, "jun": 6,
    "juil": 7, "juill": 7, "juillet": 7, "jul": 7,
    "août": 8, "aout": 8, "aug": 8,
    "sept": 9, "sep": 9, "septembre": 9,
    "oct": 10, "octobre": 10,
    "nov": 11, "novembre": 11,
    "déc": 12, "dec": 12, "décembre": 12, "decembre": 12,
    "feb": 2,
}

_TZ_OFFSETS = {
    "UTC": 0,
    "GMT": 0,
    "CET": 3600,
    "CEST": 7200,
    "WET": 0,
    "WEST": 3600,
    "EST": -18000,
    "EDT": -14400,
    "PST": -28800,
    "PDT": -25200,
}

# e.g. "20 nov. 2026, 19:23:52 CET" or "5 juin 2026, 21:39:37 CEST"
_FR_DATE_RE = re.compile(
    r"(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s+([A-Z]{2,5}))?"
)
# e.g. "Jun 5, 2026, 9:39:37 PM UTC"
_EN_DATE_RE = re.compile(
    r"([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?(?:\s+([A-Z]{2,5}))?",
    re.IGNORECASE,
)


def _parse_takeout_html_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = html.unescape(raw).replace("\u00a0", " ").replace("\u202f", " ").strip()
    dt = parse_utc_timestamp(s)
    if dt is not None:
        return dt

    m = _FR_DATE_RE.search(s)
    if m:
        day, mon_str, year, hh, mm, ss, tz = m.groups()
        mon = _FR_MONTHS.get(mon_str.lower().rstrip("."))
        if mon:
            try:
                local_dt = datetime(int(year), mon, int(day), int(hh), int(mm), int(ss), tzinfo=timezone.utc)
                offset = _TZ_OFFSETS.get((tz or "UTC").upper(), 3600)
                return local_dt - timedelta(seconds=offset)
            except ValueError:
                return None

    m = _EN_DATE_RE.search(s)
    if m:
        mon_str, day, year, hh, mm, ss, ampm, tz = m.groups()
        mon = _FR_MONTHS.get(mon_str.lower().rstrip("."))
        if mon:
            hour = int(hh)
            if ampm:
                ap = ampm.upper()
                if ap == "PM" and hour < 12:
                    hour += 12
                elif ap == "AM" and hour == 12:
                    hour = 0
            try:
                local_dt = datetime(int(year), mon, int(day), hour, int(mm), int(ss), tzinfo=timezone.utc)
                offset = _TZ_OFFSETS.get((tz or "UTC").upper(), 0)
                return local_dt - timedelta(seconds=offset)
            except ValueError:
                return None

    return None


def _extract_video_id(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        vid = qs.get("v", [None])[0]
        if vid and len(vid) >= 6:
            return vid
    except Exception:
        pass
    return None


def clean_ytm_title(raw_title: str) -> str:
    return _WATCHED_PREFIX_RE.sub("", raw_title.replace("\u00a0", " ").strip()).strip()


def clean_ytm_artist(raw_artist: str) -> str:
    return _TOPIC_SUFFIX_RE.sub("", raw_artist.replace("\u00a0", " ").strip()).strip()


def _is_music_channel(artist_raw: str) -> bool:
    if not artist_raw:
        return False
    low = artist_raw.replace("\u00a0", " ").strip().lower()
    return (
        bool(_TOPIC_SUFFIX_RE.search(artist_raw))
        or low.endswith("vevo")
    )


def _parse_watch_history_html(
    raw_html: str,
    progress_cb: ProgressCallback | None = None,
) -> list[dict[str, Any]]:
    """Fast streaming-style parser converting Google Takeout `watch-history.html` into JSON-equivalent dicts."""
    blocks = raw_html.split('outer-cell ')
    total = max(1, len(blocks) - 1)
    records: list[dict[str, Any]] = []
    step = max(2000, total // 15)

    for idx, blk in enumerate(blocks[1:], start=1):
        if progress_cb and idx % step == 0:
            pct = 15 + int(35 * (idx / total))
            progress_cb(
                "parsing",
                pct,
                f"Analyse watch-history.html ({idx:,} / {total:,} entrées)…".replace(",", " "),
            )

        # Fast pre-filter before running regexes: only keep YouTube Music, music.youtube.com, - Topic/- Sujet, or VEVO
        head_slice = blk[:300]
        is_ytm_hdr = "Music" in head_slice
        is_music_hint = (
            is_ytm_hdr
            or "music.youtube.com" in blk
            or " - Topic</a>" in blk
            or " - Sujet</a>" in blk
            or " - Thema</a>" in blk
            or "VEVO</a>" in blk
        )
        if not is_music_hint:
            records.append({"header": "YouTube", "title": "", "time": None})
            continue

        hm = _HTML_HEADER_RE.search(head_slice)
        header = html.unescape(hm.group(1)).replace("\u00a0", " ").strip() if hm else "YouTube"

        links = _HTML_LINK_RE.findall(blk[:1500])
        if not links:
            records.append({"header": header, "title": "", "time": None})
            continue

        title_url = html.unescape(links[0][0])
        title = html.unescape(links[0][1])
        subtitles = []
        if len(links) >= 2:
            subtitles.append({"name": html.unescape(links[1][1]), "url": html.unescape(links[1][0])})

        dm = _HTML_DATE_RE.search(blk[:1800])
        dt_str = dm.group(1).strip() if dm else None

        records.append(
            {
                "header": header,
                "title": title,
                "titleUrl": title_url,
                "subtitles": subtitles,
                "time": dt_str,
            }
        )

    return records


def _load_takeout_records(
    path: Path,
    progress_cb: ProgressCallback | None = None,
) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            names = [n for n in zf.namelist() if not n.startswith("__MACOSX")]
            # 1. Prefer JSON watch-history if present
            json_candidates = [
                n for n in names
                if n.lower().endswith(".json")
                and ("watch-history" in n.lower() or "historique" in n.lower() or "youtube" in n.lower())
            ]
            for name in json_candidates:
                if progress_cb:
                    progress_cb("reading", 15, f"Lecture de {Path(name).name}…")
                try:
                    data = json.loads(zf.read(name).decode("utf-8", errors="replace"))
                    if isinstance(data, list):
                        return [r for r in data if isinstance(r, dict)]
                except Exception:
                    continue

            # 2. Fallback to HTML watch-history (Google Takeout default format!)
            html_candidates = [
                n for n in names
                if n.lower().endswith(".html")
                and ("watch-history" in n.lower() or "historique des vidéos" in n.lower())
            ]
            for name in html_candidates:
                if progress_cb:
                    progress_cb("reading", 12, f"Extraction de {Path(name).name}…")
                raw_html = zf.read(name).decode("utf-8", errors="replace")
                return _parse_watch_history_html(raw_html, progress_cb=progress_cb)
        return []

    if path.suffix.lower() in (".html", ".htm"):
        if progress_cb:
            progress_cb("reading", 12, f"Lecture de {path.name}…")
        raw_html = path.read_text(encoding="utf-8", errors="replace")
        return _parse_watch_history_html(raw_html, progress_cb=progress_cb)

    if progress_cb:
        progress_cb("reading", 15, f"Lecture de {path.name}…")
    raw = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    return [r for r in raw if isinstance(r, dict)] if isinstance(raw, list) else []


def parse_youtube_takeout_records(
    records: list[dict[str, Any]],
) -> tuple[list[NormalizedPlayEvent], dict[str, int]]:
    events: list[NormalizedPlayEvent] = []
    stats = {
        "total_raw": len(records),
        "non_ytm_filtered": 0,
        "deleted_skipped": 0,
        "invalid_timestamps": 0,
    }

    for idx, rec in enumerate(records):
        header = (rec.get("header") or "").replace("\u00a0", " ").strip()
        title_url = rec.get("titleUrl") or ""
        subtitles = rec.get("subtitles")
        artist_raw = ""
        if isinstance(subtitles, list) and subtitles and isinstance(subtitles[0], dict):
            artist_raw = str(subtitles[0].get("name") or "")

        is_ytm = (
            header.lower() == "youtube music"
            or "music.youtube.com" in title_url.lower()
            or _is_music_channel(artist_raw)
        )
        if not is_ytm:
            stats["non_ytm_filtered"] += 1
            continue

        raw_title = (rec.get("title") or "").strip()
        cleaned_title = clean_ytm_title(raw_title)
        low_title = cleaned_title.lower()
        if not cleaned_title or any(marker in low_title for marker in _DELETED_TITLE_MARKERS):
            stats["deleted_skipped"] += 1
            continue

        artist = clean_ytm_artist(artist_raw) or "Artiste inconnu"

        raw_time = rec.get("time")
        dt_utc = parse_utc_timestamp(raw_time) or _parse_takeout_html_timestamp(str(raw_time) if raw_time else None)
        if dt_utc is None:
            stats["invalid_timestamps"] += 1
            continue

        video_id = _extract_video_id(title_url)

        events.append(
            NormalizedPlayEvent(
                song_name=cleaned_title,
                artist_name=artist,
                album_name="YouTube Music",
                started_at_utc=dt_utc,
                play_duration_ms=_ESTIMATED_PLAY_MS,
                media_duration_ms=_ESTIMATED_PLAY_MS,
                source_provider="youtube_music",
                source_event_id=f"ytm:{int(dt_utc.timestamp())}:{video_id or idx}",
                duration_is_estimated=1,
                external_id=video_id,
                external_url=title_url or (f"https://music.youtube.com/watch?v={video_id}" if video_id else None),
                external_provider="youtube",
            )
        )

    return events, stats


def import_youtube_takeout_file(
    path: Path,
    *,
    filename: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    progress_cb: ProgressCallback | None = None,
) -> dict[str, Any]:
    records = _load_takeout_records(path, progress_cb=progress_cb)
    if progress_cb:
        progress_cb("parsing", 54, f"Filtrage musical sur {len(records):,} entrées YouTube…".replace(",", " "))
    events, stats = parse_youtube_takeout_records(records)
    res = persist_normalized_events(
        events,
        source_provider="youtube_music",
        filename=filename or path.name,
        file_sha256=compute_sha256(path),
        profile_id=profile_id,
        profile_name=profile_name,
        metadata={"parser": "youtube_takeout", **stats},
        progress_cb=progress_cb,
    )
    # Immediately populate YouTube thumbnails (`i.ytimg.com`) for instant covers without waiting for Pass 2
    thumb_updates: list[tuple[str, str]] = []
    seen_tk: set[str] = set()
    for ev in events:
        if not ev.external_id:
            continue
        tk = make_track_key(ev.song_name, ev.album_name or "YouTube Music")
        if tk in seen_tk:
            continue
        seen_tk.add(tk)
        thumb_updates.append((f"https://i.ytimg.com/vi/{ev.external_id}/hqdefault.jpg", tk))
    if thumb_updates:
        with db_session() as conn:
            conn.executemany(
                "UPDATE tracks_catalog SET artwork_url = COALESCE(artwork_url, ?) WHERE track_key = ?",
                thumb_updates,
            )
    res["parser_stats"] = stats
    return res
