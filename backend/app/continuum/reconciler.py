"""Continuum Reconciliation & Deduplication Engine (Phase 1).

Truth Hierarchy:
    apple_rgpd_zip (100) > local_smtc (70) > listenbrainz (50) == lastfm (50) == local_receiver (55)

Guarantees:
1. Canonical grouping key (NFKC, accent-stripped, edition/remaster & feat stripped) + fuzzy similarity >= 0.85.
2. Temporal deduplication window of +-180s (or +-track duration) across sources without double-counting.
3. Higher-priority source upgrades & enriches lower-priority event in-place (preserving exact ms, skips, device).
4. Transparent duration imputation from `tracks_catalog.duration_ms` with `duration_is_estimated = 1`.
5. Strict idempotence via `(source_provider, source_event_id)` and deterministic `dedup_fingerprint`.
"""

from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from ..db import db_session, upsert_track_fts
from ..normalize import (
    clean_display_title,
    clean_group_key,
    make_track_key,
    normalize_basic,
    primary_artist_name,
    similarity_score,
)

PROVIDER_PRIORITY: dict[str, int] = {
    "apple_rgpd_zip": 100,
    "local_smtc": 70,
    "local_receiver": 55,
    "listenbrainz": 50,
    "lastfm": 50,
}

DEFAULT_DEDUP_WINDOW_SEC = 180
DEFAULT_ESTIMATED_DURATION_MS = 210_000  # 3m30s fallback when track duration unknown
SESSION_GAP_SECONDS = 30 * 60


@dataclass
class IncomingScrobble:
    source_provider: str
    song_name: str
    artist_name: str
    album_name: str = ""
    started_epoch: int = 0
    play_duration_ms: int | None = None
    media_duration_ms: int | None = None
    source_event_id: str | None = None
    device_label: str | None = None
    device_os: str | None = None
    container_type: str = "LIVE_SCROBBLE"
    end_reason_type: str = "NATURAL_END_OF_TRACK"
    utc_offset_sec: int = 3600
    is_valid_lastfm: int = 1
    is_skip_30s: int = 0
    offline: int = 0
    artwork_url: str | None = None
    mbid_recording: str | None = None
    mbid_artist: str | None = None


def canonical_key_for(song_name: str, artist_name: str) -> str:
    s = clean_group_key(song_name, strip_feat=True)
    a = clean_group_key(artist_name, strip_feat=True)
    return f"{s}||{a}"


def make_dedup_fingerprint(source_provider: str, canonical_key: str, started_epoch: int) -> str:
    raw = f"{source_provider}|{canonical_key}|{started_epoch}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _season_for_month(month: int) -> str:
    if month in (12, 1, 2):
        return "Hiver"
    if month in (3, 4, 5):
        return "Printemps"
    if month in (6, 7, 8):
        return "Été"
    return "Automne"


def _resolve_or_create_track(
    conn: sqlite3.Connection,
    scrobble: IncomingScrobble,
) -> tuple[str, int, str]:
    """Match an incoming scrobble to an existing `tracks_catalog` row or create one.

    Returns `(track_key, known_duration_ms, canonical_key)`.
    """
    song_disp = clean_display_title(scrobble.song_name) or "Titre inconnu"
    artist_disp = primary_artist_name(scrobble.artist_name) or "Artiste inconnu"
    album_disp = clean_display_title(scrobble.album_name) or song_disp

    song_gk = clean_group_key(song_disp, strip_feat=True)
    artist_gk = clean_group_key(artist_disp, strip_feat=True)
    album_gk = clean_group_key(album_disp)
    canon = canonical_key_for(song_disp, artist_disp)

    # 1. Exact song_group_key + artist_group_key match in catalog
    row = conn.execute(
        """
        SELECT track_key, duration_ms, album_name, artwork_url
        FROM tracks_catalog
        WHERE song_group_key = ? AND (artist_group_key = ? OR artist_group_key IS NULL OR artist_group_key = '')
        ORDER BY total_plays DESC
        LIMIT 1
        """,
        (song_gk, artist_gk),
    ).fetchone()

    # 2. Fuzzy similarity match within same artist if exact didn't hit
    if not row and artist_gk:
        candidates = conn.execute(
            """
            SELECT track_key, song_name, duration_ms
            FROM tracks_catalog
            WHERE artist_group_key = ?
            ORDER BY total_plays DESC
            LIMIT 80
            """,
            (artist_gk,),
        ).fetchall()
        best_score = 0.0
        best_row = None
        for cand in candidates:
            sc = similarity_score(song_disp, cand["song_name"])
            if sc > best_score:
                best_score = sc
                best_row = cand
        if best_row is not None and best_score >= 0.85:
            row = best_row

    if row:
        tkey = row["track_key"]
        dur = int(row["duration_ms"] or 0)
        if dur <= 0:
            # Check median media_duration_ms from play_events
            drow = conn.execute(
                "SELECT MAX(media_duration_ms) AS m FROM play_events WHERE track_key = ? AND media_duration_ms > 0",
                (tkey,),
            ).fetchone()
            dur = int(drow["m"] or 0) if drow else 0
            if dur > 0:
                conn.execute("UPDATE tracks_catalog SET duration_ms = ? WHERE track_key = ?", (dur, tkey))
        return tkey, dur, canon

    # 3. Create new catalog entry
    tkey = make_track_key(song_disp, album_disp)
    existing_tkey = conn.execute("SELECT track_key, duration_ms FROM tracks_catalog WHERE track_key = ?", (tkey,)).fetchone()
    if existing_tkey:
        return existing_tkey["track_key"], int(existing_tkey["duration_ms"] or 0), canon

    dur = int(scrobble.media_duration_ms or scrobble.play_duration_ms or 0)
    dt_utc = datetime.fromtimestamp(scrobble.started_epoch, tz=timezone.utc)
    dt_local = dt_utc + timedelta(seconds=scrobble.utc_offset_sec)
    conn.execute(
        """
        INSERT INTO tracks_catalog (
            track_key, song_name, song_norm, song_group_key,
            album_name, album_norm, album_group_key,
            artist_name, artist_norm, artist_group_key,
            artwork_url, total_plays, total_ms, first_played_local,
            enrichment_status, enrichment_source, duration_ms,
            mbid_recording, mbid_artist
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'local_only', ?, ?, ?, ?)
        """,
        (
            tkey,
            song_disp,
            normalize_basic(song_disp),
            song_gk,
            album_disp,
            normalize_basic(album_disp),
            album_gk,
            artist_disp,
            normalize_basic(artist_disp),
            artist_gk,
            scrobble.artwork_url,
            dt_local.strftime("%Y-%m-%dT%H:%M:%S"),
            scrobble.source_provider,
            dur,
            scrobble.mbid_recording,
            scrobble.mbid_artist,
        ),
    )
    upsert_track_fts(conn, tkey)
    return tkey, dur, canon


def _assign_session_id(conn: sqlite3.Connection, started_epoch: int) -> int:
    """Attach to nearest prior session if within <= 30 min gap, else allocate next session_id."""
    prev = conn.execute(
        """
        SELECT session_id, started_epoch, play_duration_ms
        FROM play_events
        WHERE started_epoch <= ?
        ORDER BY started_epoch DESC
        LIMIT 1
        """,
        (started_epoch,),
    ).fetchone()
    if prev:
        prev_end = int(prev["started_epoch"]) + int((prev["play_duration_ms"] or 0) // 1000)
        if started_epoch - prev_end <= SESSION_GAP_SECONDS:
            return int(prev["session_id"])
    max_row = conn.execute("SELECT COALESCE(MAX(session_id), 0) AS m FROM play_events").fetchone()
    return int(max_row["m"] or 0) + 1


def reconcile_scrobble(conn: sqlite3.Connection, scrobble: IncomingScrobble) -> str:
    """Reconcile a single scrobble into `play_events`.

    Returns one of: `'inserted'`, `'upgraded'`, `'deduplicated'`.
    """
    priority = PROVIDER_PRIORITY.get(scrobble.source_provider, 50)
    tkey, known_dur_ms, canon = _resolve_or_create_track(conn, scrobble)

    # 1. Exact idempotence check via (source_provider, source_event_id)
    if scrobble.source_event_id:
        dup = conn.execute(
            "SELECT id FROM play_events WHERE source_provider = ? AND source_event_id = ?",
            (scrobble.source_provider, scrobble.source_event_id),
        ).fetchone()
        if dup:
            return "deduplicated"

    fp = make_dedup_fingerprint(scrobble.source_provider, canon, scrobble.started_epoch)
    dup_fp = conn.execute("SELECT id FROM play_events WHERE dedup_fingerprint = ?", (fp,)).fetchone()
    if dup_fp:
        return "deduplicated"

    # 2. Temporal deduplication window +-180s (or +-track duration)
    est_dur_ms = scrobble.media_duration_ms or known_dur_ms or DEFAULT_ESTIMATED_DURATION_MS
    window_sec = max(DEFAULT_DEDUP_WINDOW_SEC, int(est_dur_ms // 1000))

    nearby = conn.execute(
        """
        SELECT pe.id, pe.source_provider, pe.source_priority, pe.canonical_track_key,
               pe.track_key, tc.song_name, tc.artist_name
        FROM play_events pe
        JOIN tracks_catalog tc ON tc.track_key = pe.track_key
        WHERE pe.started_epoch BETWEEN ? AND ?
        """,
        (scrobble.started_epoch - window_sec, scrobble.started_epoch + window_sec),
    ).fetchall()

    matched_existing = None
    for row in nearby:
        row_canon = row["canonical_track_key"] or canonical_key_for(row["song_name"], row["artist_name"] or "")
        if row_canon == canon or row["track_key"] == tkey:
            matched_existing = row
            break
        # Fuzzy match fallback across providers
        if (
            similarity_score(scrobble.song_name, row["song_name"]) >= 0.85
            and similarity_score(scrobble.artist_name, row["artist_name"] or "") >= 0.85
        ):
            matched_existing = row
            break

    # Compute exact or imputed duration
    if scrobble.play_duration_ms is not None and scrobble.play_duration_ms > 0:
        play_ms = int(scrobble.play_duration_ms)
        media_ms = int(scrobble.media_duration_ms or known_dur_ms or play_ms)
        dur_estimated = 0
    else:
        media_ms = int(scrobble.media_duration_ms or known_dur_ms or DEFAULT_ESTIMATED_DURATION_MS)
        play_ms = media_ms
        dur_estimated = 1

    completion = min(1.0, round(play_ms / max(media_ms, 1), 4))
    is_skip = scrobble.is_skip_30s if dur_estimated == 0 else 0
    is_valid = scrobble.is_valid_lastfm if dur_estimated == 0 else (1 if (play_ms >= 30_000 and (completion >= 0.5 or play_ms >= 240_000)) else 0)

    dt_utc = datetime.fromtimestamp(scrobble.started_epoch, tz=timezone.utc)
    dt_local = dt_utc + timedelta(seconds=scrobble.utc_offset_sec)
    started_at_utc = dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    started_at_local = dt_local.strftime("%Y-%m-%dT%H:%M:%S")
    local_date = dt_local.strftime("%Y-%m-%d")
    local_year = dt_local.year
    local_month = dt_local.strftime("%Y-%m")
    local_month_num = dt_local.month
    local_season = _season_for_month(local_month_num)
    local_dow = dt_local.weekday()
    local_hour = dt_local.hour

    if matched_existing is not None:
        existing_prio = int(matched_existing["source_priority"] or 100)
        if priority > existing_prio:
            # Higher-priority source upgrades the existing event in place (zero double count!)
            conn.execute(
                """
                UPDATE play_events
                SET track_key = ?,
                    started_at_utc = ?,
                    started_at_local = ?,
                    started_epoch = ?,
                    local_date = ?,
                    local_year = ?,
                    local_month = ?,
                    local_month_num = ?,
                    local_season = ?,
                    local_dow = ?,
                    local_hour = ?,
                    play_duration_ms = ?,
                    media_duration_ms = ?,
                    completion_ratio = ?,
                    end_reason_type = ?,
                    is_valid_lastfm = ?,
                    is_skip_30s = ?,
                    device_label = COALESCE(?, device_label),
                    device_os = COALESCE(?, device_os),
                    source_provider = ?,
                    source_priority = ?,
                    source_event_id = COALESCE(?, source_event_id),
                    canonical_track_key = ?,
                    duration_is_estimated = ?,
                    dedup_fingerprint = ?
                WHERE id = ?
                """,
                (
                    tkey,
                    started_at_utc,
                    started_at_local,
                    scrobble.started_epoch,
                    local_date,
                    local_year,
                    local_month,
                    local_month_num,
                    local_season,
                    local_dow,
                    local_hour,
                    play_ms,
                    media_ms,
                    completion,
                    scrobble.end_reason_type,
                    is_valid,
                    is_skip,
                    scrobble.device_label,
                    scrobble.device_os,
                    scrobble.source_provider,
                    priority,
                    scrobble.source_event_id,
                    canon,
                    dur_estimated,
                    fp,
                    matched_existing["id"],
                ),
            )
            return "upgraded"
        return "deduplicated"

    session_id = _assign_session_id(conn, scrobble.started_epoch)
    conn.execute(
        """
        INSERT INTO play_events (
            event_id, track_key, started_at_utc, started_at_local, started_epoch,
            local_date, local_year, local_month, local_month_num, local_season,
            local_dow, local_hour, utc_offset_sec,
            play_duration_ms, media_duration_ms, completion_ratio,
            end_reason_type, is_valid_lastfm, is_skip_30s,
            container_type, container_origin_type, playlist_name, feature_name,
            device_label, device_os, source_type, offline,
            session_id, source_provider, source_priority, source_event_id,
            canonical_track_key, duration_is_estimated, dedup_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            scrobble.source_event_id,
            tkey,
            started_at_utc,
            started_at_local,
            scrobble.started_epoch,
            local_date,
            local_year,
            local_month,
            local_month_num,
            local_season,
            local_dow,
            local_hour,
            scrobble.utc_offset_sec,
            play_ms,
            media_ms,
            completion,
            scrobble.end_reason_type,
            is_valid,
            is_skip,
            scrobble.container_type,
            scrobble.source_provider.upper(),
            "",
            scrobble.source_provider,
            scrobble.device_label or scrobble.source_provider,
            scrobble.device_os or scrobble.source_provider,
            scrobble.source_provider.upper(),
            scrobble.offline,
            session_id,
            scrobble.source_provider,
            priority,
            scrobble.source_event_id,
            canon,
            dur_estimated,
            fp,
        ),
    )
    conn.execute(
        """
        UPDATE tracks_catalog
        SET total_plays = total_plays + 1,
            total_ms = total_ms + ?,
            first_played_local = CASE
                WHEN first_played_local IS NULL OR ? < first_played_local THEN ?
                ELSE first_played_local
            END
        WHERE track_key = ?
        """,
        (play_ms, started_at_local, started_at_local, tkey),
    )
    return "inserted"


def reconcile_batch(scrobbles: list[IncomingScrobble]) -> dict[str, int]:
    """Reconcile a batch of incoming scrobbles atomically, updating import_meta bounds."""
    stats = {"fetched": len(scrobbles), "inserted": 0, "upgraded": 0, "deduplicated": 0}
    if not scrobbles:
        return stats
    ordered = sorted(scrobbles, key=lambda s: s.started_epoch)
    with db_session() as conn:
        for s in ordered:
            outcome = reconcile_scrobble(conn, s)
            stats[outcome] += 1
        # Keep import_meta totals and date bounds fresh
        row = conn.execute(
            "SELECT COUNT(*) AS c, MIN(local_date) AS mn, MAX(local_date) AS mx FROM play_events"
        ).fetchone()
        tc_count = conn.execute("SELECT COUNT(*) FROM tracks_catalog").fetchone()[0]
        if row and row["c"] > 0:
            conn.execute(
                """
                UPDATE import_meta
                SET total_play_events = ?, unique_tracks = ?,
                    min_date = COALESCE(?, min_date),
                    max_date = COALESCE(?, max_date)
                WHERE id = 1
                """,
                (row["c"], tc_count, row["mn"], row["mx"]),
            )
    return stats


def update_now_playing(
    *,
    provider: str,
    song_name: str,
    artist_name: str,
    album_name: str = "",
    artwork_url: str | None = None,
    duration_ms: int = 0,
    position_ms: int = 0,
    is_playing: bool = True,
) -> dict[str, Any]:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        if not artwork_url:
            # Lookup local catalog artwork if available
            row = conn.execute(
                """
                SELECT artwork_url FROM tracks_catalog
                WHERE song_group_key = ? AND artist_group_key = ? AND artwork_url IS NOT NULL
                LIMIT 1
                """,
                (clean_group_key(song_name, strip_feat=True), clean_group_key(artist_name, strip_feat=True)),
            ).fetchone()
            if row:
                artwork_url = row["artwork_url"]
        conn.execute(
            """
            INSERT OR REPLACE INTO now_playing_state (
                id, provider, song_name, artist_name, album_name, artwork_url,
                started_at_utc, duration_ms, position_ms, is_playing, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                provider,
                song_name,
                artist_name,
                album_name,
                artwork_url,
                now_iso,
                duration_ms,
                position_ms,
                1 if is_playing else 0,
                now_iso,
            ),
        )
    return {
        "active": is_playing,
        "provider": provider,
        "song_name": song_name,
        "artist_name": artist_name,
        "album_name": album_name,
        "artwork_url": artwork_url,
        "started_at_utc": now_iso,
        "duration_ms": duration_ms,
        "position_ms": position_ms,
        "is_playing": is_playing,
        "updated_at": now_iso,
    }


def clear_now_playing():
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        conn.execute("UPDATE now_playing_state SET is_playing = 0, updated_at = ? WHERE id = 1", (now_iso,))
