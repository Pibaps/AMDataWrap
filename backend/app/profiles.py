"""V4 Multi-Profile Management, Cross-Platform Fusion & Capabilities Matrix.

Provides:
- CRUD & activation for standard and virtual merged profiles (`/api/v4/profiles*`)
- Cross-platform deduplication engine (`recompute_merged_exclusions`) using
  ISRC (N-to-M `recording_isrcs` + `play_events.isrc`), `canonical_key_for`,
  fuzzy `similarity_score >= 0.85`, and ±180s sliding window with strict 4-level
  winner ranking
- Dynamic Capabilities Matrix (`GET /api/v4/profile/capabilities`)
- Reusable helpers for M2A importers (`record_profile_source`,
  `refresh_all_merged_profiles_containing`, `get_or_create_standard_profile`)
"""

from __future__ import annotations

import gzip
import json
import re
import sqlite3
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .analytics.duckdb_engine import export_parquet_snapshot
from .continuum.reconciler import (
    DEFAULT_DEDUP_WINDOW_SEC,
    PROVIDER_PRIORITY,
    canonical_key_for,
)
from .db import db_session, rebuild_fts_indexes
from .filters import (
    build_profile_id_clause,
    canonical_platform_for,
    expand_source_providers,
)
from .normalize import clean_group_key, similarity_score

profiles_router = APIRouter(prefix="/api/v4", tags=["v4-profiles"])

MERGE_DEDUP_WINDOW_SEC: int = DEFAULT_DEDUP_WINDOW_SEC  # 180 seconds
DEFAULT_PROFILE_ID: int = 1
DEFAULT_PROFILE_NAME: str = "Profil Principal"

# Extends reconciler.PROVIDER_PRIORITY without modifying reconciler.py during M1
V4_PROVIDER_PRIORITY: dict[str, int] = {
    **PROVIDER_PRIORITY,
    "spotify_extended": 95,
    "spotify_rgpd": 95,
    "spotify_technical_log": 92,
    "spotify_account": 90,
    "deezer_rgpd": 85,
    "deezer": 85,
    "tidal_csv": 85,
    "tidal_rgpd": 85,
    "tidal": 85,
    "extension_bridge": 80,
    "musickit_web": 80,
    "youtube_iframe": 75,
    "os_media": 70,
    "web_scrobbler": 65,
    "youtube_music": 60,
    "youtube_takeout": 60,
}

_APPLE_PROVIDERS: frozenset[str] = frozenset(
    {"apple_rgpd_zip", "apple_music", "musickit_web"}
)

_SKIP_CAPABLE_PROVIDERS: tuple[str, ...] = (
    "apple_rgpd_zip",
    "apple_music",
    "spotify_extended",
    "spotify_technical_log",
    "spotify_account",
    "spotify_rgpd",
    "spotify",
    "deezer_rgpd",
    "deezer",
    "local_smtc",
    "os_media",
    "youtube_iframe",
    "extension_bridge",
    "musickit_web",
)

_NO_NATIVE_END_REASON_PROVIDERS: tuple[str, ...] = (
    "youtube_music",
    "youtube_takeout",
    "spotify_account",
    "deezer_rgpd",
    "deezer",
    "tidal_csv",
    "tidal_rgpd",
    "tidal",
    "listenbrainz",
    "lastfm",
)

_INCOGNITO_PROVIDERS: tuple[str, ...] = (
    "spotify_extended",
    "spotify_technical_log",
    "spotify_rgpd",
)

_ISRC_CLEAN_RE = re.compile(r"[^A-Za-z0-9]")


class ProfileCreateIn(BaseModel):
    name: str = Field(..., description="Nom affiché du profil")
    kind: str = Field("standard", description="standard | merged")
    merged_profile_ids: list[int] = Field(default_factory=list)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_isrc(raw: str | None) -> str | None:
    if not raw:
        return None
    cleaned = _ISRC_CLEAN_RE.sub("", str(raw)).upper()
    return cleaned if len(cleaned) >= 8 else None


def _parse_merged_ids(raw_json: str | None) -> list[int]:
    if not raw_json:
        return []
    try:
        parsed = json.loads(raw_json)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[int] = []
    for item in parsed:
        try:
            pid = int(item)
        except (TypeError, ValueError):
            continue
        if pid > 0 and pid not in out:
            out.append(pid)
    return out


def ensure_default_profile(conn: sqlite3.Connection) -> int:
    """Idempotently ensure default profile id=1 exists and at least one profile is active."""
    now = _utc_now_iso()
    conn.execute(
        """
        INSERT OR IGNORE INTO profiles (
            id, name, kind, merged_profile_ids_json, is_active, created_at, updated_at
        ) VALUES (?, ?, 'standard', '[]', 1, ?, ?)
        """,
        (DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, now, now),
    )
    active_row = conn.execute(
        "SELECT id FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1"
    ).fetchone()
    if not active_row:
        conn.execute(
            "UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?",
            (now, DEFAULT_PROFILE_ID),
        )
        return DEFAULT_PROFILE_ID
    return int(active_row["id"])


def resolve_profile_scope(
    conn: sqlite3.Connection,
    profile_id: int | None,
) -> tuple[int, str, list[int]]:
    """Resolve target profile_id (or active profile if None) into (profile_id, kind, member_ids).

    Raises HTTPException(404) if an explicit profile_id does not exist.
    """
    active_id = ensure_default_profile(conn)
    target_id = active_id if profile_id is None else int(profile_id)
    row = conn.execute(
        "SELECT id, kind, merged_profile_ids_json FROM profiles WHERE id = ?",
        (target_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Profil introuvable : {target_id}")
    kind = row["kind"] or "standard"
    if kind == "merged":
        return int(row["id"]), "merged", _parse_merged_ids(row["merged_profile_ids_json"])
    return int(row["id"]), "standard", [int(row["id"])]


# ---------------------------------------------------------------------------
# Cross-Platform Fusion Deduplication Engine
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _MergeEvent:
    id: int
    profile_id: int
    started_epoch: int
    source_priority: int
    duration_is_estimated: int
    play_duration_ms: int
    canon_key: str
    artist_gk: str
    song_name: str
    artist_name: str
    isrcs: frozenset[str]


def _winner_rank(ev: _MergeEvent) -> tuple[int, int, int, int]:
    """Strict total order for cross-platform duplicate winner selection:
    1. Highest source_priority
    2. Exact duration (duration_is_estimated == 0 beats 1)
    3. Longer play_duration_ms
    4. Lowest play_events.id (strictly unique -> zero ties)
    """
    return (
        ev.source_priority,
        1 if ev.duration_is_estimated == 0 else 0,
        ev.play_duration_ms,
        -ev.id,
    )


def _events_match(a: _MergeEvent, b: _MergeEvent) -> str | None:
    """Return match reason ('isrc'|'canonical_key'|'similarity') if events are cross-profile duplicates."""
    # Never deduplicate legitimate repeats within the same member profile
    if a.profile_id == b.profile_id:
        return None
    if abs(a.started_epoch - b.started_epoch) > MERGE_DEDUP_WINDOW_SEC:
        return None
    # 1. Shared normalized ISRC (from play_events.isrc or recording_isrcs N-to-M)
    if a.isrcs and b.isrcs and not a.isrcs.isdisjoint(b.isrcs):
        return "isrc"
    # 2. Exact canonical_key_for(song_name, artist_name) match
    if a.canon_key and a.canon_key != "||" and a.canon_key == b.canon_key:
        return "canonical_key"
    # 3. Same normalized artist (or artist similarity >= 0.85) + title similarity >= 0.85
    if a.artist_gk and b.artist_gk:
        same_artist = (a.artist_gk == b.artist_gk) or (
            similarity_score(a.artist_name, b.artist_name) >= 0.85
        )
        if same_artist and similarity_score(a.song_name, b.song_name) >= 0.85:
            return "similarity"
    return None


def recompute_merged_exclusions(
    conn: sqlite3.Connection,
    merged_profile_id: int,
) -> dict[str, int]:
    """Recompute cross-platform deduplication exclusions for a merged profile.

    Algorithm (Active-Survivors Chronological Sliding Window, +-180s):
    - Loads `recording_isrcs` into a dict `track_key -> set[normalized_isrc]`.
    - Streams all `play_events` belonging to `member_ids` ordered by `started_epoch ASC, id ASC`.
    - Maintains a `deque[_MergeEvent]` of currently-kept (non-excluded) events within
      `[cur.started_epoch - 180, cur.started_epoch]`.
    - For each incoming event `cur`:
        1. Evict stale survivors where `cur.started_epoch - ev.started_epoch > 180`.
        2. Find ALL matching active survivors in the window across distinct member profiles.
        3. If no matches: append `cur` to active window.
        4. If ANY matching survivor outranks `cur` (`_winner_rank(ev) > _winner_rank(cur)`):
           exclude `cur` (using the highest-ranked matching survivor's match reason) and do NOT add `cur`.
        5. Otherwise (`cur` strictly outranks ALL matching survivors):
           exclude every matched survivor, remove them from the active window, and append `cur`.
    """
    row = conn.execute(
        "SELECT id, kind, merged_profile_ids_json FROM profiles WHERE id = ?",
        (merged_profile_id,),
    ).fetchone()
    conn.execute(
        "DELETE FROM profile_merged_exclusions WHERE merged_profile_id = ?",
        (merged_profile_id,),
    )
    if not row or row["kind"] != "merged":
        return {"checked": 0, "excluded": 0, "kept": 0}

    member_ids = _parse_merged_ids(row["merged_profile_ids_json"])
    if len(member_ids) < 2:
        if not member_ids:
            return {"checked": 0, "excluded": 0, "kept": 0}
        cnt = conn.execute(
            "SELECT COUNT(*) FROM play_events WHERE COALESCE(profile_id, 1) = ?",
            (member_ids[0],),
        ).fetchone()[0]
        return {"checked": int(cnt), "excluded": 0, "kept": int(cnt)}

    # 1. Load N-to-M recording_isrcs lookup
    track_isrcs: dict[str, set[str]] = {}
    for ir in conn.execute("SELECT track_key, isrc FROM recording_isrcs"):
        norm = _normalize_isrc(ir["isrc"])
        if norm:
            track_isrcs.setdefault(ir["track_key"], set()).add(norm)

    # 2. Fetch member events in chronological order
    placeholders = ",".join("?" for _ in member_ids)
    rows = conn.execute(
        f"""
        SELECT
            pe.id,
            COALESCE(pe.profile_id, 1) AS profile_id,
            pe.track_key,
            pe.canonical_track_key,
            pe.started_epoch,
            COALESCE(pe.play_duration_ms, 0) AS play_duration_ms,
            COALESCE(pe.duration_is_estimated, 0) AS duration_is_estimated,
            pe.source_priority,
            COALESCE(pe.source_provider, 'apple_rgpd_zip') AS source_provider,
            pe.isrc AS event_isrc,
            tc.song_name,
            tc.artist_name
        FROM play_events pe
        JOIN tracks_catalog tc ON tc.track_key = pe.track_key
        WHERE COALESCE(pe.profile_id, 1) IN ({placeholders})
        ORDER BY pe.started_epoch ASC, pe.id ASC
        """,
        member_ids,
    ).fetchall()

    window: deque[_MergeEvent] = deque()
    excluded: dict[int, str] = {}  # play_event_id -> reason (strictly unique keys)

    for r in rows:
        song = r["song_name"] or ""
        artist = r["artist_name"] or ""
        sp = r["source_provider"] or "apple_rgpd_zip"
        prio = (
            int(r["source_priority"])
            if r["source_priority"] is not None
            else V4_PROVIDER_PRIORITY.get(sp, 50)
        )
        canon = r["canonical_track_key"] or canonical_key_for(song, artist)
        isrc_set = set(track_isrcs.get(r["track_key"], ()))
        ev_isrc = _normalize_isrc(r["event_isrc"])
        if ev_isrc:
            isrc_set.add(ev_isrc)

        cur = _MergeEvent(
            id=int(r["id"]),
            profile_id=int(r["profile_id"]),
            started_epoch=int(r["started_epoch"]),
            source_priority=prio,
            duration_is_estimated=int(r["duration_is_estimated"] or 0),
            play_duration_ms=int(r["play_duration_ms"] or 0),
            canon_key=canon,
            artist_gk=clean_group_key(artist, strip_feat=True),
            song_name=song,
            artist_name=artist,
            isrcs=frozenset(isrc_set),
        )

        # Evict survivors outside the 180s lookback window
        cutoff = cur.started_epoch - MERGE_DEDUP_WINDOW_SEC
        while window and window[0].started_epoch < cutoff:
            window.popleft()

        matches: list[tuple[_MergeEvent, str]] = []
        for ev in window:
            reason = _events_match(cur, ev)
            if reason is not None:
                matches.append((ev, reason))

        if not matches:
            window.append(cur)
            continue

        cur_rank = _winner_rank(cur)
        stronger = [(ev, reason) for ev, reason in matches if _winner_rank(ev) > cur_rank]
        if stronger:
            _, best_reason = max(stronger, key=lambda pair: _winner_rank(pair[0]))
            excluded[cur.id] = best_reason
        else:
            remove_ids: set[int] = set()
            for ev, reason in matches:
                excluded[ev.id] = reason
                remove_ids.add(ev.id)
            window = deque(ev for ev in window if ev.id not in remove_ids)
            window.append(cur)

    if excluded:
        conn.executemany(
            """
            INSERT OR REPLACE INTO profile_merged_exclusions (merged_profile_id, play_event_id, reason)
            VALUES (?, ?, ?)
            """,
            [(merged_profile_id, eid, reason) for eid, reason in excluded.items()],
        )

    checked = len(rows)
    excl_cnt = len(excluded)
    return {"checked": checked, "excluded": excl_cnt, "kept": checked - excl_cnt}


# ---------------------------------------------------------------------------
# Reusable M2A Importer Helpers
# ---------------------------------------------------------------------------


def record_profile_source(
    conn: sqlite3.Connection,
    profile_id: int,
    *,
    source_provider: str,
    filename: str | None = None,
    file_sha256: str | None = None,
    events_count: int = 0,
    unique_tracks: int = 0,
    min_date: str | None = None,
    max_date: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> int:
    """Record an import source batch in `profile_sources` and bump `profiles.updated_at`.

    Returns the created `profile_sources.id`.
    """
    now = _utc_now_iso()
    cur = conn.execute(
        """
        INSERT INTO profile_sources (
            profile_id, source_provider, filename, file_sha256,
            imported_at, events_count, unique_tracks, min_date, max_date, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            profile_id,
            source_provider,
            filename,
            file_sha256,
            now,
            int(events_count),
            int(unique_tracks),
            min_date,
            max_date,
            json.dumps(metadata or {}, ensure_ascii=False),
        ),
    )
    conn.execute("UPDATE profiles SET updated_at = ? WHERE id = ?", (now, profile_id))
    return int(cur.lastrowid)


def refresh_all_merged_profiles_containing(
    conn: sqlite3.Connection,
    profile_id: int,
) -> dict[int, dict[str, int]]:
    """Recompute deduplication exclusions for every merged profile containing `profile_id`."""
    now = _utc_now_iso()
    results: dict[int, dict[str, int]] = {}
    merged_rows = conn.execute(
        "SELECT id, merged_profile_ids_json FROM profiles WHERE kind = 'merged'"
    ).fetchall()
    for mr in merged_rows:
        m_ids = _parse_merged_ids(mr["merged_profile_ids_json"])
        if profile_id in m_ids:
            mid = int(mr["id"])
            results[mid] = recompute_merged_exclusions(conn, mid)
            conn.execute("UPDATE profiles SET updated_at = ? WHERE id = ?", (now, mid))
    return results


def get_or_create_standard_profile(
    conn: sqlite3.Connection,
    *,
    profile_id: int | None = None,
    profile_name: str | None = None,
) -> int:
    """Resolve target standard profile for M2A imports (creating one if `profile_name` is provided)."""
    ensure_default_profile(conn)
    if profile_id is not None:
        row = conn.execute(
            "SELECT id, kind FROM profiles WHERE id = ?", (profile_id,)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail=f"Profil introuvable : {profile_id}"
            )
        if row["kind"] != "standard":
            raise HTTPException(
                status_code=400,
                detail="Impossible d'importer directement dans un profil fusionné. Sélectionnez un profil standard.",
            )
        return int(row["id"])
    clean_name = (profile_name or "").strip()
    if clean_name:
        existing = conn.execute(
            "SELECT id FROM profiles WHERE kind = 'standard' AND LOWER(name) = LOWER(?) LIMIT 1",
            (clean_name,),
        ).fetchone()
        if existing:
            return int(existing["id"])
        now = _utc_now_iso()
        cur = conn.execute(
            """
            INSERT INTO profiles (name, kind, merged_profile_ids_json, is_active, created_at, updated_at)
            VALUES (?, 'standard', '[]', 0, ?, ?)
            """,
            (clean_name[:120], now, now),
        )
        return int(cur.lastrowid)
    # Fallback to active standard profile, or default profile 1 if active is merged
    active = conn.execute(
        "SELECT id, kind FROM profiles WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    if active and active["kind"] == "standard":
        return int(active["id"])
    return DEFAULT_PROFILE_ID


# ---------------------------------------------------------------------------
# Serialization & Core Service Functions
# ---------------------------------------------------------------------------


def _serialize_source_row(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(r["id"]),
        "source_provider": r["source_provider"],
        "filename": r["filename"],
        "imported_at": r["imported_at"],
        "events_count": int(r["events_count"] or 0),
        "unique_tracks": int(r["unique_tracks"] or 0),
        "min_date": r["min_date"],
        "max_date": r["max_date"],
    }


def _serialize_profile_row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    pid = int(row["id"])
    kind = row["kind"] or "standard"
    merged_ids = _parse_merged_ids(row["merged_profile_ids_json"]) if kind == "merged" else []

    if kind == "merged":
        if merged_ids:
            ph = ",".join("?" for _ in merged_ids)
            source_rows = conn.execute(
                f"""
                SELECT id, source_provider, filename, imported_at, events_count,
                       unique_tracks, min_date, max_date
                FROM profile_sources
                WHERE profile_id IN ({ph})
                ORDER BY imported_at DESC, id DESC
                """,
                merged_ids,
            ).fetchall()
            prof_clause, prof_params = build_profile_id_clause(
                pid, "pe", include_exclusions=True
            )
            total_plays = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM play_events pe WHERE {prof_clause}",
                    prof_params,
                ).fetchone()[0]
                or 0
            )
        else:
            source_rows = []
            total_plays = 0
    else:
        source_rows = conn.execute(
            """
            SELECT id, source_provider, filename, imported_at, events_count,
                   unique_tracks, min_date, max_date
            FROM profile_sources
            WHERE profile_id = ?
            ORDER BY imported_at DESC, id DESC
            """,
            (pid,),
        ).fetchall()
        total_plays = int(
            conn.execute(
                "SELECT COUNT(*) FROM play_events WHERE COALESCE(profile_id, 1) = ?",
                (pid,),
            ).fetchone()[0]
            or 0
        )

    return {
        "id": pid,
        "name": row["name"],
        "kind": kind,
        "merged_profile_ids": merged_ids,
        "is_active": bool(int(row["is_active"] or 0)),
        "sources": [_serialize_source_row(sr) for sr in source_rows],
        "total_plays": total_plays,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_profiles() -> dict[str, Any]:
    with db_session() as conn:
        active_id = ensure_default_profile(conn)
        rows = conn.execute("SELECT * FROM profiles ORDER BY id ASC").fetchall()
        profiles = [_serialize_profile_row(conn, r) for r in rows]
    return {
        "active_profile_id": active_id,
        "profiles": profiles,
    }


def get_profile_capabilities(
    profile_id: int | None = None,
    source_provider: str | None = None,
) -> dict[str, Any]:
    """Dynamically inspect real data present in a profile (standard or merged) and return capabilities."""
    with db_session() as conn:
        resolved_id, kind, member_ids = resolve_profile_scope(conn, profile_id)
        if not member_ids:
            return {
                "profile_id": resolved_id,
                "platforms": [],
                "source_providers": [],
                "total_plays": 0,
                "has_exact_duration": False,
                "estimated_duration_pct": 0.0,
                "has_skips": False,
                "has_end_reasons": False,
                "has_lyrics_events": False,
                "has_search_events": False,
                "has_devices": False,
                "has_audio_quality": False,
                "has_incognito_flag": False,
                "has_shuffle_flag": False,
            }

        prof_clause, prof_params = build_profile_id_clause(
            resolved_id, "pe", include_exclusions=True
        )
        clauses: list[str] = [prof_clause or "1=1"]
        params: list[Any] = list(prof_params)

        providers = expand_source_providers(source_provider)
        if providers:
            prov_ph = ", ".join("?" for _ in providers)
            clauses.append(
                f"COALESCE(pe.source_provider, 'apple_rgpd_zip') IN ({prov_ph})"
            )
            params.extend(providers)

        pe_where = " AND ".join(clauses)

        # Query 1: distinct source_providers & canonical platforms
        sp_rows = conn.execute(
            f"""
            SELECT DISTINCT COALESCE(pe.source_provider, 'apple_rgpd_zip') AS sp
            FROM play_events pe
            WHERE {pe_where}
            """,
            params,
        ).fetchall()
        source_providers = sorted(r["sp"] for r in sp_rows if r["sp"])
        platforms = sorted({canonical_platform_for(sp) for sp in source_providers})

        # Query 2: single-pass aggregate over play_events
        skip_ph = ", ".join("?" for _ in _SKIP_CAPABLE_PROVIDERS)
        no_er_ph = ", ".join("?" for _ in _NO_NATIVE_END_REASON_PROVIDERS)
        incog_ph = ", ".join("?" for _ in _INCOGNITO_PROVIDERS)

        agg_params: list[Any] = [
            *_SKIP_CAPABLE_PROVIDERS,
            *_NO_NATIVE_END_REASON_PROVIDERS,
            *_INCOGNITO_PROVIDERS,
            *params,
        ]
        agg = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total_plays,
                COALESCE(SUM(CASE WHEN COALESCE(pe.duration_is_estimated, 0) = 1 THEN 1 ELSE 0 END), 0) AS estimated_plays,
                COALESCE(SUM(CASE WHEN COALESCE(pe.duration_is_estimated, 0) = 0 AND pe.play_duration_ms > 0 THEN 1 ELSE 0 END), 0) AS exact_duration_plays,
                COALESCE(SUM(CASE WHEN
                    pe.skipped IS NOT NULL
                    OR pe.is_skip_30s = 1
                    OR (COALESCE(pe.duration_is_estimated, 0) = 0 AND pe.play_duration_ms > 0
                        AND COALESCE(pe.source_provider, 'apple_rgpd_zip') IN ({skip_ph}))
                THEN 1 ELSE 0 END), 0) AS skip_capable_plays,
                COALESCE(SUM(CASE WHEN
                    pe.end_reason_type IS NOT NULL
                    AND TRIM(pe.end_reason_type) != ''
                    AND UPPER(TRIM(pe.end_reason_type)) NOT IN ('UNKNOWN', 'NONE', 'NULL')
                    AND (
                        UPPER(TRIM(pe.end_reason_type)) != 'NATURAL_END_OF_TRACK'
                        OR COALESCE(pe.source_provider, 'apple_rgpd_zip') NOT IN ({no_er_ph})
                    )
                THEN 1 ELSE 0 END), 0) AS end_reason_plays,
                COALESCE(SUM(CASE WHEN
                    pe.device_label IS NOT NULL
                    AND TRIM(pe.device_label) != ''
                    AND LOWER(TRIM(pe.device_label)) NOT IN ('inconnu', 'unknown', 'appareil inconnu', 'none', 'null')
                    AND LOWER(TRIM(pe.device_label)) != LOWER(COALESCE(pe.source_provider, ''))
                THEN 1 ELSE 0 END), 0) AS device_plays,
                COALESCE(SUM(CASE WHEN
                    pe.audio_quality IS NOT NULL
                    AND TRIM(pe.audio_quality) != ''
                    AND UPPER(TRIM(pe.audio_quality)) NOT IN ('UNKNOWN', 'NON_SPECIFIE', 'NONE', 'NULL')
                THEN 1 ELSE 0 END), 0) AS audio_quality_plays,
                COALESCE(SUM(CASE WHEN
                    COALESCE(pe.incognito_mode, 0) = 1
                    OR COALESCE(pe.source_provider, 'apple_rgpd_zip') IN ({incog_ph})
                THEN 1 ELSE 0 END), 0) AS incognito_capable_plays,
                COALESCE(SUM(CASE WHEN
                    pe.shuffle_play IS NOT NULL
                    AND TRIM(pe.shuffle_play) != ''
                    AND UPPER(TRIM(pe.shuffle_play)) NOT IN ('UNKNOWN', 'NONE', 'NULL')
                THEN 1 ELSE 0 END), 0) AS shuffle_plays
            FROM play_events pe
            WHERE {pe_where}
            """,
            agg_params,
        ).fetchone()

        # Query 3 & 4: lyric_events & search_events (Apple Music RGPD exclusive)
        if providers and not (_APPLE_PROVIDERS & set(providers)):
            has_lyrics_events = False
            has_search_events = False
        else:
            le_clause, le_params = build_profile_id_clause(
                resolved_id, "le", include_exclusions=False
            )
            se_clause, se_params = build_profile_id_clause(
                resolved_id, "se", include_exclusions=False
            )
            has_lyrics_events = bool(
                conn.execute(
                    f"SELECT EXISTS(SELECT 1 FROM lyric_events le WHERE {le_clause})",
                    le_params,
                ).fetchone()[0]
            )
            has_search_events = bool(
                conn.execute(
                    f"SELECT EXISTS(SELECT 1 FROM search_events se WHERE {se_clause})",
                    se_params,
                ).fetchone()[0]
            )

    total_plays = int(agg["total_plays"] or 0)
    estimated_plays = int(agg["estimated_plays"] or 0)
    estimated_pct = (
        round((estimated_plays / total_plays) * 100.0, 1) if total_plays > 0 else 0.0
    )

    return {
        "profile_id": resolved_id,
        "platforms": platforms,
        "source_providers": source_providers,
        "total_plays": total_plays,
        "has_exact_duration": bool(int(agg["exact_duration_plays"] or 0) > 0),
        "estimated_duration_pct": estimated_pct,
        "has_skips": bool(int(agg["skip_capable_plays"] or 0) > 0),
        "has_end_reasons": bool(int(agg["end_reason_plays"] or 0) > 0),
        "has_lyrics_events": bool(has_lyrics_events),
        "has_search_events": bool(has_search_events),
        "has_devices": bool(int(agg["device_plays"] or 0) > 0),
        "has_audio_quality": bool(int(agg["audio_quality_plays"] or 0) > 0),
        "has_incognito_flag": bool(int(agg["incognito_capable_plays"] or 0) > 0),
        "has_shuffle_flag": bool(int(agg["shuffle_plays"] or 0) > 0),
    }


# ---------------------------------------------------------------------------
# FastAPI Router Endpoints (/api/v4/profiles* & /api/v4/profile/capabilities)
# ---------------------------------------------------------------------------


@profiles_router.get("/profiles")
def api_list_profiles() -> dict[str, Any]:
    return list_profiles()


@profiles_router.post("/profiles", status_code=201)
def api_create_profile(payload: ProfileCreateIn) -> dict[str, Any]:
    clean_name = (payload.name or "").strip()
    if not clean_name or len(clean_name) > 120:
        raise HTTPException(
            status_code=400,
            detail="Le nom du profil doit contenir entre 1 et 120 caractères.",
        )

    kind = (payload.kind or "standard").strip().lower()
    if kind not in ("standard", "merged"):
        raise HTTPException(
            status_code=400,
            detail="Type de profil invalide (attendu : 'standard' ou 'merged').",
        )

    with db_session() as conn:
        ensure_default_profile(conn)
        merged_ids: list[int] = []
        if kind == "merged":
            raw_ids = list(payload.merged_profile_ids or [])
            if not raw_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Un profil fusionné doit sélectionner au moins un profil source.",
                )
            if any(pid <= 0 for pid in raw_ids):
                raise HTTPException(
                    status_code=400,
                    detail="Les identifiants de profils à fusionner doivent être strictement positifs.",
                )
            if len(set(raw_ids)) != len(raw_ids):
                raise HTTPException(
                    status_code=400,
                    detail="La liste des profils à fusionner contient des doublons.",
                )
            ph = ",".join("?" for _ in raw_ids)
            found = conn.execute(
                f"SELECT id, kind FROM profiles WHERE id IN ({ph})",
                raw_ids,
            ).fetchall()
            found_map = {int(r["id"]): r["kind"] for r in found}
            missing = [pid for pid in raw_ids if pid not in found_map]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Profil(s) source introuvable(s) : {missing}",
                )
            nested_merged = [pid for pid in raw_ids if found_map[pid] == "merged"]
            if nested_merged:
                raise HTTPException(
                    status_code=400,
                    detail=f"Impossible de fusionner un profil déjà fusionné : {nested_merged}",
                )
            merged_ids = raw_ids

        now = _utc_now_iso()
        cur = conn.execute(
            """
            INSERT INTO profiles (
                name, kind, merged_profile_ids_json, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, 0, ?, ?)
            """,
            (clean_name, kind, json.dumps(merged_ids), now, now),
        )
        new_id = int(cur.lastrowid)

        dedup_stats: dict[str, int] | None = None
        if kind == "merged":
            dedup_stats = recompute_merged_exclusions(conn, new_id)

        row = conn.execute("SELECT * FROM profiles WHERE id = ?", (new_id,)).fetchone()
        serialized = _serialize_profile_row(conn, row)
        if dedup_stats is not None:
            serialized["dedup_stats"] = dedup_stats
        return serialized


@profiles_router.post("/profiles/{profile_id}/activate")
def api_activate_profile(profile_id: int) -> dict[str, Any]:
    with db_session() as conn:
        ensure_default_profile(conn)
        row = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail=f"Profil introuvable : {profile_id}"
            )
        now = _utc_now_iso()
        conn.execute("UPDATE profiles SET is_active = 0")
        conn.execute(
            "UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?",
            (now, profile_id),
        )
        updated = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
        serialized = _serialize_profile_row(conn, updated)
    return {
        "ok": True,
        "active_profile_id": profile_id,
        "profile": serialized,
    }


@profiles_router.post("/profiles/{profile_id}/recompute-merge")
def api_recompute_merge(profile_id: int) -> dict[str, Any]:
    with db_session() as conn:
        ensure_default_profile(conn)
        row = conn.execute(
            "SELECT id, kind FROM profiles WHERE id = ?", (profile_id,)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail=f"Profil introuvable : {profile_id}"
            )
        if row["kind"] != "merged":
            raise HTTPException(
                status_code=400,
                detail="Le recalcul de fusion s'applique uniquement à un profil de type 'merged'.",
            )
        stats = recompute_merged_exclusions(conn, profile_id)
        conn.execute(
            "UPDATE profiles SET updated_at = ? WHERE id = ?",
            (_utc_now_iso(), profile_id),
        )
    return {
        "ok": True,
        "profile_id": profile_id,
        **stats,
    }


@profiles_router.delete("/profiles/{profile_id}")
def api_delete_profile(profile_id: int) -> dict[str, Any]:
    if profile_id == DEFAULT_PROFILE_ID:
        raise HTTPException(
            status_code=400,
            detail="Impossible de supprimer le profil principal par défaut (id=1).",
        )

    with db_session() as conn:
        ensure_default_profile(conn)
        row = conn.execute(
            "SELECT id, is_active FROM profiles WHERE id = ?", (profile_id,)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail=f"Profil introuvable : {profile_id}"
            )
        was_active = bool(int(row["is_active"] or 0))
        now = _utc_now_iso()

        # 1. Clean exclusions referencing this profile or its events
        conn.execute(
            """
            DELETE FROM profile_merged_exclusions
            WHERE merged_profile_id = ?
               OR play_event_id IN (SELECT id FROM play_events WHERE profile_id = ?)
            """,
            (profile_id, profile_id),
        )

        # 2. Delete all profile-scoped data
        conn.execute("DELETE FROM profile_sources WHERE profile_id = ?", (profile_id,))
        conn.execute("DELETE FROM play_events WHERE profile_id = ?", (profile_id,))
        conn.execute("DELETE FROM lyric_events WHERE profile_id = ?", (profile_id,))
        conn.execute("DELETE FROM search_events WHERE profile_id = ?", (profile_id,))
        conn.execute("DELETE FROM favorites WHERE profile_id = ?", (profile_id,))

        # 3. Delete profile row
        conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))

        # 4. Strip deleted ID from any remaining merged profiles and recompute cleanly
        merged_rows = conn.execute(
            "SELECT id, merged_profile_ids_json FROM profiles WHERE kind = 'merged'"
        ).fetchall()
        for mr in merged_rows:
            m_ids = _parse_merged_ids(mr["merged_profile_ids_json"])
            if profile_id in m_ids:
                new_ids = [mid for mid in m_ids if mid != profile_id]
                merged_pid = int(mr["id"])
                conn.execute(
                    "UPDATE profiles SET merged_profile_ids_json = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(new_ids), now, merged_pid),
                )
                recompute_merged_exclusions(conn, merged_pid)

        # 5. If deleted profile was active, re-activate default profile id=1
        if was_active:
            conn.execute("UPDATE profiles SET is_active = 0")
            conn.execute(
                "UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?",
                (now, DEFAULT_PROFILE_ID),
            )
        active_id = ensure_default_profile(conn)
        _sync_import_meta_counts(conn)
        rebuild_fts_indexes(conn)

    try:
        export_parquet_snapshot()
    except Exception:
        pass

    return {
        "ok": True,
        "deleted_profile_id": profile_id,
        "active_profile_id": active_id,
    }


def _sync_import_meta_counts(conn: sqlite3.Connection) -> None:
    totals = conn.execute(
        """
        SELECT COUNT(*) AS cnt, COUNT(DISTINCT track_key) AS u_tracks,
               MIN(local_date) AS min_d, MAX(local_date) AS max_d
        FROM play_events
        """
    ).fetchone()
    cnt = int(totals["cnt"] or 0) if totals else 0
    u_tracks = int(totals["u_tracks"] or 0) if totals else 0
    conn.execute(
        """
        UPDATE import_meta
        SET total_play_events = ?, unique_tracks = ?, min_date = ?, max_date = ?
        WHERE id = 1
        """,
        (cnt, u_tracks, totals["min_d"] if totals else None, totals["max_d"] if totals else None),
    )


@profiles_router.delete("/profiles/{profile_id}/sources/{source_id}")
def api_delete_profile_source(profile_id: int, source_id: int) -> dict[str, Any]:
    """Granularly delete a single imported source batch from a standard profile."""
    with db_session() as conn:
        src = conn.execute(
            "SELECT * FROM profile_sources WHERE id = ? AND profile_id = ?",
            (source_id, profile_id),
        ).fetchone()
        if not src:
            raise HTTPException(status_code=404, detail="Source introuvable pour ce profil.")

        batch_cnt = conn.execute(
            "SELECT COUNT(*) FROM play_events WHERE profile_id = ? AND source_batch_id = ?",
            (profile_id, source_id),
        ).fetchone()[0]

        if batch_cnt > 0:
            conn.execute(
                """
                DELETE FROM profile_merged_exclusions
                WHERE play_event_id IN (
                    SELECT id FROM play_events WHERE profile_id = ? AND source_batch_id = ?
                )
                """,
                (profile_id, source_id),
            )
            del_cur = conn.execute(
                "DELETE FROM play_events WHERE profile_id = ? AND source_batch_id = ?",
                (profile_id, source_id),
            )
        else:
            conn.execute(
                """
                DELETE FROM profile_merged_exclusions
                WHERE play_event_id IN (
                    SELECT id FROM play_events WHERE profile_id = ? AND source_provider = ?
                )
                """,
                (profile_id, src["source_provider"]),
            )
            del_cur = conn.execute(
                "DELETE FROM play_events WHERE profile_id = ? AND source_provider = ?",
                (profile_id, src["source_provider"]),
            )

        deleted_events = int(del_cur.rowcount or 0)
        conn.execute("DELETE FROM profile_sources WHERE id = ?", (source_id,))
        refresh_all_merged_profiles_containing(conn, profile_id)
        _sync_import_meta_counts(conn)
        rebuild_fts_indexes(conn)

    try:
        export_parquet_snapshot()
    except Exception:
        pass

    return {"ok": True, "profile_id": profile_id, "deleted_source_id": source_id, "deleted_events": deleted_events}


@profiles_router.get("/profiles/{profile_id}/export")
def api_export_profile_backup(
    profile_id: int,
    fmt: str = Query("gz", alias="format", description="gz | json"),
) -> Response:
    """Export a portable `.amdw.json.gz` or `.json` backup of a profile."""
    with db_session() as conn:
        prof = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
        if not prof:
            raise HTTPException(status_code=404, detail=f"Profil introuvable : {profile_id}")

        sources = [dict(r) for r in conn.execute("SELECT * FROM profile_sources WHERE profile_id = ?", (profile_id,))]
        plays = [dict(r) for r in conn.execute("SELECT * FROM play_events WHERE profile_id = ?", (profile_id,))]
        track_keys = sorted({p["track_key"] for p in plays if p.get("track_key")})
        tracks: list[dict[str, Any]] = []
        isrcs: list[dict[str, Any]] = []
        mappings: list[dict[str, Any]] = []
        for i in range(0, len(track_keys), 400):
            chunk = track_keys[i : i + 400]
            ph = ",".join("?" for _ in chunk)
            tracks.extend(
                dict(r) for r in conn.execute(f"SELECT * FROM tracks_catalog WHERE track_key IN ({ph})", chunk)
            )
            isrcs.extend(
                dict(r) for r in conn.execute(f"SELECT * FROM recording_isrcs WHERE track_key IN ({ph})", chunk)
            )
            mappings.extend(
                dict(r) for r in conn.execute(f"SELECT * FROM platform_track_mappings WHERE track_key IN ({ph})", chunk)
            )

        lyrics = [dict(r) for r in conn.execute("SELECT * FROM lyric_events WHERE profile_id = ?", (profile_id,))]
        searches = [dict(r) for r in conn.execute("SELECT * FROM search_events WHERE profile_id = ?", (profile_id,))]
        favorites = [dict(r) for r in conn.execute("SELECT * FROM favorites WHERE profile_id = ?", (profile_id,))]

    bundle = {
        "schema": "amdw-backup-v1",
        "exported_at": _utc_now_iso(),
        "profile": dict(prof),
        "sources": sources,
        "tracks_catalog": tracks,
        "play_events": plays,
        "recording_isrcs": isrcs,
        "platform_track_mappings": mappings,
        "lyric_events": lyrics,
        "search_events": searches,
        "favorites": favorites,
    }
    raw_json = json.dumps(bundle, ensure_ascii=False).encode("utf-8")
    if fmt.lower() == "json":
        return Response(
            content=raw_json,
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="amdatawrap_profile_{profile_id}.json"'},
        )
    gz_bytes = gzip.compress(raw_json, compresslevel=6)
    return Response(
        content=gz_bytes,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="amdatawrap_profile_{profile_id}.amdw.json.gz"'},
    )


_MAX_BACKUP_BYTES = 100 * 1024 * 1024


@profiles_router.post("/profiles/import-backup")
async def api_import_profile_backup(
    file: UploadFile = File(...),
    profile_name: str | None = Form(None),
) -> dict[str, Any]:
    """Restore a portable `.amdw.json.gz` or `.json` profile backup into a new standard profile."""
    raw = await file.read(_MAX_BACKUP_BYTES + 1)
    if len(raw) > _MAX_BACKUP_BYTES:
        raise HTTPException(status_code=413, detail="Sauvegarde trop volumineuse (max 100 Mo).")

    try:
        if raw[:2] == b"\x1f\x8b" or (file.filename or "").lower().endswith(".gz"):
            raw = gzip.decompress(raw)
        bundle = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fichier de sauvegarde invalide : {exc}") from exc

    if not isinstance(bundle, dict) or bundle.get("schema") != "amdw-backup-v1":
        raise HTTPException(status_code=400, detail="Schéma de sauvegarde non reconnu (attendu : amdw-backup-v1).")

    orig_prof = bundle.get("profile") or {}
    base_name = (profile_name or "").strip() or f"{orig_prof.get('name') or 'Profil restauré'} (Import)"
    now = _utc_now_iso()

    with db_session() as conn:
        ensure_default_profile(conn)
        cur = conn.execute(
            """
            INSERT INTO profiles (name, kind, merged_profile_ids_json, is_active, created_at, updated_at)
            VALUES (?, 'standard', '[]', 0, ?, ?)
            """,
            (base_name[:120], now, now),
        )
        new_pid = int(cur.lastrowid)

        tracks = bundle.get("tracks_catalog") or []
        restored_tracks = 0
        for t in tracks:
            if not t.get("track_key") or not t.get("song_name"):
                continue
            conn.execute(
                """
                INSERT OR IGNORE INTO tracks_catalog (
                    track_key, song_name, song_norm, song_group_key,
                    album_name, album_norm, album_group_key,
                    artist_name, artist_norm, artist_group_key,
                    itunes_track_id, genre, release_year, release_date,
                    artwork_url, preview_url, total_plays, total_ms,
                    first_played_local, enrichment_status, enrichment_source, enriched_at, duration_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    t["track_key"],
                    t["song_name"],
                    t.get("song_norm") or t["song_name"].lower(),
                    t.get("song_group_key") or t["song_name"].lower(),
                    t.get("album_name") or "Single / Inconnu",
                    t.get("album_norm") or "single inconnu",
                    t.get("album_group_key") or "single inconnu",
                    t.get("artist_name"),
                    t.get("artist_norm"),
                    t.get("artist_group_key"),
                    t.get("itunes_track_id"),
                    t.get("genre"),
                    t.get("release_year"),
                    t.get("release_date"),
                    t.get("artwork_url"),
                    t.get("preview_url"),
                    int(t.get("total_plays") or 0),
                    int(t.get("total_ms") or 0),
                    t.get("first_played_local"),
                    t.get("enrichment_status") or "local_only",
                    t.get("enrichment_source"),
                    t.get("enriched_at"),
                    int(t.get("duration_ms") or 0),
                ),
            )
            restored_tracks += 1

        for ir in bundle.get("recording_isrcs") or []:
            if ir.get("track_key") and ir.get("isrc"):
                conn.execute(
                    "INSERT OR IGNORE INTO recording_isrcs (track_key, isrc, source, created_at) VALUES (?, ?, ?, ?)",
                    (ir["track_key"], ir["isrc"], ir.get("source") or "backup", ir.get("created_at") or now),
                )

        for mp in bundle.get("platform_track_mappings") or []:
            if mp.get("track_key") and mp.get("provider") and mp.get("external_id"):
                conn.execute(
                    """
                    INSERT OR IGNORE INTO platform_track_mappings (track_key, provider, external_id, url, resolved_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (mp["track_key"], mp["provider"], mp["external_id"], mp.get("url"), mp.get("resolved_at") or now),
                )

        source_id_map: dict[int, int] = {}
        for s in bundle.get("sources") or []:
            scur = conn.execute(
                """
                INSERT INTO profile_sources (
                    profile_id, source_provider, filename, file_sha256,
                    imported_at, events_count, unique_tracks, min_date, max_date, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_pid,
                    s.get("source_provider") or "backup",
                    s.get("filename"),
                    s.get("file_sha256"),
                    s.get("imported_at") or now,
                    int(s.get("events_count") or 0),
                    int(s.get("unique_tracks") or 0),
                    s.get("min_date"),
                    s.get("max_date"),
                    s.get("metadata_json") or "{}",
                ),
            )
            if s.get("id") is not None:
                source_id_map[int(s["id"])] = int(scur.lastrowid)

        restored_events = 0
        for ev in bundle.get("play_events") or []:
            if not ev.get("track_key") or not ev.get("started_at_utc"):
                continue
            mapped_batch = source_id_map.get(int(ev["source_batch_id"])) if ev.get("source_batch_id") is not None else None
            conn.execute(
                """
                INSERT OR IGNORE INTO play_events (
                    event_id, track_key, started_at_utc, started_at_local, started_epoch,
                    local_date, local_year, local_month, local_month_num, local_season,
                    local_dow, local_hour, utc_offset_sec, play_duration_ms, media_duration_ms,
                    completion_ratio, end_reason_type, is_valid_lastfm, is_skip_30s,
                    container_type, container_origin_type, playlist_name, feature_name,
                    device_label, device_os, source_type, offline, auto_play, shuffle_play, repeat_play,
                    audio_quality, playback_format, session_id, source_provider, source_priority,
                    source_event_id, canonical_track_key, duration_is_estimated, dedup_fingerprint,
                    profile_id, incognito_mode, reason_start, skipped, isrc, source_batch_id
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )
                """,
                (
                    ev.get("event_id"),
                    ev["track_key"],
                    ev["started_at_utc"],
                    ev.get("started_at_local") or ev["started_at_utc"][:19],
                    int(ev.get("started_epoch") or 0),
                    ev.get("local_date") or ev["started_at_utc"][:10],
                    int(ev.get("local_year") or 2025),
                    ev.get("local_month") or ev["started_at_utc"][:7],
                    int(ev.get("local_month_num") or 1),
                    ev.get("local_season") or "Hiver",
                    int(ev.get("local_dow") or 0),
                    int(ev.get("local_hour") or 12),
                    int(ev.get("utc_offset_sec") or 3600),
                    int(ev.get("play_duration_ms") or 0),
                    int(ev.get("media_duration_ms") or 0),
                    float(ev.get("completion_ratio") or 0.0),
                    ev.get("end_reason_type"),
                    int(ev.get("is_valid_lastfm") or 0),
                    int(ev.get("is_skip_30s") or 0),
                    ev.get("container_type"),
                    ev.get("container_origin_type"),
                    ev.get("playlist_name"),
                    ev.get("feature_name"),
                    ev.get("device_label"),
                    ev.get("device_os"),
                    ev.get("source_type"),
                    int(ev.get("offline") or 0),
                    ev.get("auto_play"),
                    ev.get("shuffle_play"),
                    ev.get("repeat_play"),
                    ev.get("audio_quality"),
                    ev.get("playback_format"),
                    int(ev.get("session_id") or 1),
                    ev.get("source_provider") or "backup",
                    int(ev.get("source_priority") or 90),
                    ev.get("source_event_id"),
                    ev.get("canonical_track_key"),
                    int(ev.get("duration_is_estimated") or 0),
                    ev.get("dedup_fingerprint"),
                    new_pid,
                    int(ev.get("incognito_mode") or 0),
                    ev.get("reason_start"),
                    ev.get("skipped"),
                    ev.get("isrc"),
                    mapped_batch,
                ),
            )
            restored_events += 1

        for le in bundle.get("lyric_events") or []:
            if le.get("track_key"):
                conn.execute(
                    """
                    INSERT INTO lyric_events (
                        track_key, started_at_utc, started_at_local, local_date, local_year, local_month,
                        display_type, display_language, translation_displayed, pronunciation_displayed, device_label, profile_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        le["track_key"],
                        le.get("started_at_utc") or now,
                        le.get("started_at_local") or now[:19],
                        le.get("local_date") or now[:10],
                        int(le.get("local_year") or 2025),
                        le.get("local_month") or now[:7],
                        le.get("display_type"),
                        le.get("display_language"),
                        int(le.get("translation_displayed") or 0),
                        int(le.get("pronunciation_displayed") or 0),
                        le.get("device_label"),
                        new_pid,
                    ),
                )

        for se in bundle.get("search_events") or []:
            if se.get("query"):
                conn.execute(
                    """
                    INSERT INTO search_events (
                        query, query_norm, searched_at_utc, searched_at_local, local_date, local_year, local_month, device_os, profile_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        se["query"],
                        se.get("query_norm") or se["query"].lower(),
                        se.get("searched_at_utc") or now,
                        se.get("searched_at_local") or now[:19],
                        se.get("local_date") or now[:10],
                        int(se.get("local_year") or 2025),
                        se.get("local_month") or now[:7],
                        se.get("device_os"),
                        new_pid,
                    ),
                )

        _sync_import_meta_counts(conn)
        rebuild_fts_indexes(conn)

    try:
        export_parquet_snapshot()
    except Exception:
        pass

    return {
        "ok": True,
        "profile_id": new_pid,
        "profile_name": base_name[:120],
        "restored_events": restored_events,
        "restored_tracks": restored_tracks,
    }


@profiles_router.get("/profile/capabilities")
def api_get_profile_capabilities(
    profile_id: int | None = Query(None),
    source_provider: str | None = Query(None),
) -> dict[str, Any]:
    return get_profile_capabilities(
        profile_id=profile_id,
        source_provider=source_provider,
    )
