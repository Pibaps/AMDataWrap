"""YouTube Music Google Takeout importer (`watch-history.json`).

Handles:
- Strict filtering on `header == "YouTube Music"`
- Multilingual prefix stripping on `title`:
  "Watched ", "Vous avez regardé ", "Angesehen: ", "Visto ", "Visualizzato ",
  "Assistiu a ", "Bekeken: ", "Obejrzano: ", "Просмотрено: ", etc.
- `" - Topic"` / `" - Sujet"` / `" - Thema"` suffix removal on `subtitles[0].name`
- Deleted / unavailable video tolerance (skips cleanly without crashing)
- Sets `duration_is_estimated = 1` (Google Takeout does not include listen duration)
- Stores YouTube `videoId` in `platform_track_mappings` (`provider='youtube'`) for instant 0 € playback!
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .base import NormalizedPlayEvent, compute_sha256, parse_utc_timestamp, persist_normalized_events

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
    return _WATCHED_PREFIX_RE.sub("", raw_title.strip()).strip()


def clean_ytm_artist(raw_artist: str) -> str:
    return _TOPIC_SUFFIX_RE.sub("", raw_artist.strip()).strip()


def _load_takeout_records(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path, "r") as zf:
            candidates = [
                n for n in zf.namelist()
                if n.lower().endswith(".json")
                and ("watch-history" in n.lower() or "historique" in n.lower() or "youtube" in n.lower())
                and not n.startswith("__MACOSX")
            ]
            for name in candidates:
                try:
                    data = json.loads(zf.read(name).decode("utf-8", errors="replace"))
                    if isinstance(data, list):
                        return [r for r in data if isinstance(r, dict)]
                except Exception:
                    continue
        return []
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
        header = (rec.get("header") or "").strip()
        if header.lower() != "youtube music":
            stats["non_ytm_filtered"] += 1
            continue

        raw_title = (rec.get("title") or "").strip()
        cleaned_title = clean_ytm_title(raw_title)
        low_title = cleaned_title.lower()
        if not cleaned_title or any(marker in low_title for marker in _DELETED_TITLE_MARKERS):
            stats["deleted_skipped"] += 1
            continue

        subtitles = rec.get("subtitles")
        artist_raw = ""
        if isinstance(subtitles, list) and subtitles and isinstance(subtitles[0], dict):
            artist_raw = str(subtitles[0].get("name") or "")
        artist = clean_ytm_artist(artist_raw) or "Artiste inconnu"

        dt_utc = parse_utc_timestamp(rec.get("time"))
        if dt_utc is None:
            stats["invalid_timestamps"] += 1
            continue

        title_url = rec.get("titleUrl") or ""
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
) -> dict[str, Any]:
    records = _load_takeout_records(path)
    events, stats = parse_youtube_takeout_records(records)
    res = persist_normalized_events(
        events,
        source_provider="youtube_music",
        filename=filename or path.name,
        file_sha256=compute_sha256(path),
        profile_id=profile_id,
        profile_name=profile_name,
        metadata={"parser": "youtube_takeout", **stats},
    )
    res["parser_stats"] = stats
    return res
