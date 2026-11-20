"""Shared persistence & normalization layer for all V4 multi-platform importers."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..analytics.duckdb_engine import export_parquet_snapshot
from ..continuum.reconciler import canonical_key_for, make_dedup_fingerprint
from ..db import db_session, rebuild_fts_indexes
from ..normalize import clean_display_title, clean_group_key, make_track_key, normalize_basic, primary_artist_name
from ..profiles import (
    V4_PROVIDER_PRIORITY,
    get_or_create_standard_profile,
    record_profile_source,
    refresh_all_merged_profiles_containing,
)

_ISRC_CLEAN_RE = re.compile(r"[^A-Za-z0-9]")


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_isrc(raw: str | None) -> str | None:
    if not raw:
        return None
    cleaned = _ISRC_CLEAN_RE.sub("", str(raw)).upper()
    return cleaned if len(cleaned) >= 8 else None


def season_for_month(month: int) -> str:
    if month in (12, 1, 2):
        return "Hiver"
    if month in (3, 4, 5):
        return "Printemps"
    if month in (6, 7, 8):
        return "Été"
    return "Automne"


def parse_utc_timestamp(raw: Any) -> datetime | None:
    """Parse ISO-8601, epoch (s/ms), or common YYYY-MM-DD HH:MM:SS timestamps to UTC datetime."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=timezone.utc)
        return raw.astimezone(timezone.utc)
    if isinstance(raw, (int, float)):
        val = float(raw)
        if val <= 0:
            return None
        if val > 10_000_000_000:  # milliseconds
            val /= 1000.0
        try:
            return datetime.fromtimestamp(val, tz=timezone.utc)
        except Exception:
            return None

    s = str(raw).strip()
    if not s:
        return None
    # Numeric string epoch
    if s.isdigit():
        return parse_utc_timestamp(int(s))

    # ISO-8601 Z / offset
    cand = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(cand)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


@dataclass
class NormalizedPlayEvent:
    song_name: str
    artist_name: str
    album_name: str = ""
    started_at_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    play_duration_ms: int = 0
    media_duration_ms: int = 0
    source_provider: str = "unknown"
    source_event_id: str | None = None
    utc_offset_sec: int = 3600
    end_reason_type: str | None = None
    reason_start: str | None = None
    skipped: int | None = None
    offline: int = 0
    shuffle_play: str | None = None
    incognito_mode: int = 0
    duration_is_estimated: int = 0
    device_label: str | None = None
    device_os: str | None = None
    audio_quality: str | None = None
    isrc: str | None = None
    external_id: str | None = None
    external_url: str | None = None
    external_provider: str | None = None


def persist_normalized_events(
    events: list[NormalizedPlayEvent],
    *,
    source_provider: str,
    filename: str | None = None,
    file_sha256: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    default_utc_offset_sec: int = 3600,
    rebuild_snapshot: bool = True,
) -> dict[str, Any]:
    """Persist normalized multi-platform events into SQLite under `profile_id`.

    Idempotent on `dedup_fingerprint` per profile: re-importing the same file will not
    duplicate existing events. Updates `tracks_catalog`, `recording_isrcs`,
    `platform_track_mappings`, `profile_sources`, `import_meta`, FTS5, and merged profiles.
    """
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    priority = V4_PROVIDER_PRIORITY.get(source_provider, 70)

    # Sort chronologically so session_id segmentation is accurate
    sorted_events = sorted(events, key=lambda e: int(e.started_at_utc.timestamp()))

    inserted = 0
    skipped_duplicates = 0
    seen_tracks: set[str] = set()
    min_date: str | None = None
    max_date: str | None = None

    with db_session() as conn:
        target_profile_id = get_or_create_standard_profile(
            conn, profile_id=profile_id, profile_name=profile_name
        )

        # Load existing fingerprints in this profile to keep re-imports idempotent
        existing_fps = {
            r["dedup_fingerprint"]
            for r in conn.execute(
                "SELECT dedup_fingerprint FROM play_events WHERE profile_id = ? AND dedup_fingerprint IS NOT NULL",
                (target_profile_id,),
            ).fetchall()
        }

        # Existing track catalog keys
        existing_tracks = {
            r["track_key"]
            for r in conn.execute("SELECT track_key FROM tracks_catalog").fetchall()
        }

        # Starting session_id
        max_sid_row = conn.execute("SELECT COALESCE(MAX(session_id), 0) AS m FROM play_events").fetchone()
        session_id = int(max_sid_row["m"] or 0) + 1
        prev_epoch: int | None = None

        play_rows: list[tuple[Any, ...]] = []
        new_tracks: dict[str, tuple[Any, ...]] = {}
        isrc_pairs: set[tuple[str, str]] = set()
        mapping_rows: set[tuple[str, str, str, str | None]] = set()
        track_increments: dict[str, list[int]] = {}  # track_key -> [plays, ms]

        for ev in sorted_events:
            song = clean_display_title(ev.song_name)
            if not song:
                continue
            artist = clean_display_title(ev.artist_name) or "Artiste inconnu"
            album = clean_display_title(ev.album_name) or "Single / Inconnu"

            tkey = make_track_key(song, album)
            ckey = canonical_key_for(song, artist)
            dt_utc = ev.started_at_utc.astimezone(timezone.utc)
            epoch = int(dt_utc.timestamp())
            fp = make_dedup_fingerprint(source_provider, ckey, epoch)
            if fp in existing_fps:
                skipped_duplicates += 1
                continue
            existing_fps.add(fp)

            offset_sec = ev.utc_offset_sec if ev.utc_offset_sec is not None else default_utc_offset_sec
            dt_local = dt_utc + timedelta(seconds=offset_sec)
            local_date = dt_local.strftime("%Y-%m-%d")
            local_year = dt_local.year
            local_month = dt_local.strftime("%Y-%m")
            local_month_num = dt_local.month
            local_season = season_for_month(local_month_num)
            local_dow = dt_local.weekday()
            local_hour = dt_local.hour

            if min_date is None or local_date < min_date:
                min_date = local_date
            if max_date is None or local_date > max_date:
                max_date = local_date

            play_ms = max(0, int(ev.play_duration_ms))
            media_ms = max(0, int(ev.media_duration_ms))
            if media_ms <= 0:
                media_ms = max(play_ms, 180_000)
            ratio = min(2.0, play_ms / max(media_ms, 1)) if play_ms > 0 else 0.0

            is_valid = 1 if (play_ms >= 30_000 and (ratio >= 0.5 or play_ms >= 240_000)) else 0
            if ev.duration_is_estimated and play_ms >= 30_000:
                is_valid = 1

            if ev.skipped is not None:
                is_skip = 1 if ev.skipped else 0
            else:
                is_skip = 1 if (0 < play_ms < 30_000 and ratio < 0.5) else 0

            if prev_epoch is not None and (epoch - prev_epoch) > 1800:
                session_id += 1
            prev_epoch = epoch

            if tkey not in existing_tracks and tkey not in new_tracks:
                p_artist = primary_artist_name(artist) or artist
                new_tracks[tkey] = (
                    tkey,
                    song,
                    normalize_basic(song),
                    clean_group_key(song, strip_feat=True) or normalize_basic(song),
                    album,
                    normalize_basic(album),
                    clean_group_key(album) or normalize_basic(album),
                    p_artist,
                    normalize_basic(p_artist),
                    clean_group_key(p_artist, strip_feat=True) or normalize_basic(p_artist),
                    dt_local.strftime("%Y-%m-%dT%H:%M:%S"),
                    media_ms,
                )

            seen_tracks.add(tkey)
            inc = track_increments.setdefault(tkey, [0, 0])
            inc[0] += 1
            inc[1] += play_ms

            norm_isrc = normalize_isrc(ev.isrc)
            if norm_isrc:
                isrc_pairs.add((tkey, norm_isrc))

            if ev.external_id:
                ext_prov = ev.external_provider or source_provider
                mapping_rows.add((tkey, ext_prov, str(ev.external_id), ev.external_url))

            play_rows.append(
                (
                    ev.source_event_id,
                    tkey,
                    dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    dt_local.strftime("%Y-%m-%dT%H:%M:%S"),
                    epoch,
                    local_date,
                    local_year,
                    local_month,
                    local_month_num,
                    local_season,
                    local_dow,
                    local_hour,
                    offset_sec,
                    play_ms,
                    media_ms,
                    round(ratio, 4),
                    ev.end_reason_type,
                    is_valid,
                    is_skip,
                    ev.device_label,
                    ev.device_os,
                    int(ev.offline),
                    ev.shuffle_play,
                    ev.audio_quality,
                    session_id,
                    source_provider,
                    priority,
                    ev.source_event_id,
                    ckey,
                    int(ev.duration_is_estimated),
                    fp,
                    target_profile_id,
                    int(ev.incognito_mode),
                    ev.reason_start,
                    ev.skipped,
                    norm_isrc,
                )
            )
            inserted += 1

        if new_tracks:
            conn.executemany(
                """
                INSERT OR IGNORE INTO tracks_catalog (
                    track_key, song_name, song_norm, song_group_key,
                    album_name, album_norm, album_group_key,
                    artist_name, artist_norm, artist_group_key,
                    first_played_local, duration_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                list(new_tracks.values()),
            )

        if play_rows:
            conn.executemany(
                """
                INSERT INTO play_events (
                    event_id, track_key, started_at_utc, started_at_local, started_epoch,
                    local_date, local_year, local_month, local_month_num, local_season,
                    local_dow, local_hour, utc_offset_sec, play_duration_ms, media_duration_ms,
                    completion_ratio, end_reason_type, is_valid_lastfm, is_skip_30s,
                    device_label, device_os, offline, shuffle_play, audio_quality,
                    session_id, source_provider, source_priority, source_event_id,
                    canonical_track_key, duration_is_estimated, dedup_fingerprint,
                    profile_id, incognito_mode, reason_start, skipped, isrc
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?
                )
                """,
                play_rows,
            )

        if track_increments:
            conn.executemany(
                """
                UPDATE tracks_catalog
                SET total_plays = COALESCE(total_plays, 0) + ?,
                    total_ms = COALESCE(total_ms, 0) + ?
                WHERE track_key = ?
                """,
                [(v[0], v[1], k) for k, v in track_increments.items()],
            )

        if isrc_pairs:
            conn.executemany(
                """
                INSERT OR IGNORE INTO recording_isrcs (track_key, isrc, source, created_at)
                VALUES (?, ?, ?, ?)
                """,
                [(tk, code, source_provider, now_iso) for tk, code in isrc_pairs],
            )

        if mapping_rows:
            conn.executemany(
                """
                INSERT OR REPLACE INTO platform_track_mappings (
                    track_key, provider, external_id, url, resolved_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                [(tk, prov, eid, url, now_iso) for tk, prov, eid, url in mapping_rows],
            )

        source_id = record_profile_source(
            conn,
            target_profile_id,
            source_provider=source_provider,
            filename=filename,
            file_sha256=file_sha256,
            events_count=inserted,
            unique_tracks=len(seen_tracks),
            min_date=min_date,
            max_date=max_date,
            metadata=metadata,
        )

        # Keep import_meta up to date so legacy V1/V2/V3 checks see data
        totals = conn.execute(
            """
            SELECT COUNT(*) AS cnt, COUNT(DISTINCT track_key) AS u_tracks,
                   MIN(local_date) AS min_d, MAX(local_date) AS max_d
            FROM play_events
            """
        ).fetchone()
        conn.execute(
            """
            INSERT INTO import_meta (
                id, zip_filename, zip_sha256, imported_at,
                total_raw_rows, total_play_events, unique_tracks, min_date, max_date
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                imported_at = excluded.imported_at,
                total_play_events = excluded.total_play_events,
                unique_tracks = excluded.unique_tracks,
                min_date = COALESCE(excluded.min_date, import_meta.min_date),
                max_date = COALESCE(excluded.max_date, import_meta.max_date)
            """,
            (
                filename or source_provider,
                file_sha256 or "",
                now_iso,
                int(totals["cnt"] or 0),
                int(totals["cnt"] or 0),
                int(totals["u_tracks"] or 0),
                totals["min_d"],
                totals["max_d"],
            ),
        )

        rebuild_fts_indexes(conn)
        merged_refreshed = refresh_all_merged_profiles_containing(conn, target_profile_id)

    if rebuild_snapshot and inserted > 0:
        try:
            export_parquet_snapshot()
        except Exception:
            pass

    return {
        "ok": True,
        "source_provider": source_provider,
        "profile_id": target_profile_id,
        "profile_source_id": source_id,
        "inserted_events": inserted,
        "skipped_duplicates": skipped_duplicates,
        "unique_tracks": len(seen_tracks),
        "min_date": min_date,
        "max_date": max_date,
        "merged_profiles_refreshed": list(merged_refreshed.keys()),
    }
