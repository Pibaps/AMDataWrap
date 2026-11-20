# M1 Explorer 2 Blueprint — Profiles, Cross-Platform Fusion, Capabilities Matrix & Analytics

**Handoff Type:** Hard (Read-Only Exploration Complete)  
**Target Milestone:** M1 (Backend V4 Foundation, Env & Profiles/Capabilities)  
**Assigned Scope:** `backend/app/profiles.py`, `backend/app/analytics/overview.py`, `backend/app/analytics/behavior.py`, `backend/app/analytics/duckdb_engine.py`, `backend/tests/test_profiles_v4.py`  
**Output Path:** `/home/antigravity/Pibaps/AMDataWrap/.agents/teamwork/sub_orch_m1/iter1_explorer_profiles_analytics/handoff.md`

---

## 1. Observed Codebase Baseline & Conventions

Direct inspection of existing backend files established the following exact baselines and contracts:

| File | Exact Lines | Observed Facts / Contracts |
| :--- | :--- | :--- |
| `backend/app/main.py` | L112–148 | `FastAPI(version="3.0.0")` (MUST remain `"3.0.0"` per `test_openapi_fuzz.py:12`). Global `@app.exception_handler(HTTPException)` wraps `exc.detail` into `ErrorResponse(code=f"HTTP_{exc.status_code}", message=str(exc.detail), detail=exc.detail)`. Validation errors return HTTP `422` `ErrorResponse(code="VALIDATION_ERROR", ...)`. All error messages are in French. |
| `backend/app/main.py` | L333–335 | `GET /api/filters` calls `get_filter_options()` with **zero arguments**. Therefore `get_filter_options(profile_id: int | None = None)` MUST keep `profile_id` optional with default `None`. |
| `backend/app/db.py` | L15–37 | `db_session()` yields a `sqlite3.Connection` with `row_factory = sqlite3.Row`, WAL mode, auto-commit/rollback/close. `DB_PATH` & `PARQUET_SNAPSHOT_PATH` live at module level (L11–12). |
| `backend/app/schemas.py` | L7–13 | Pydantic v2 `BaseModel`, `ErrorResponse(error=True, code, message, detail, hint)`. Note: `schemas.py` is NOT owned by M1 (`PROJECT.md:97`), so V4 profile Pydantic models live inside `backend/app/profiles.py`. |
| `backend/app/normalize.py` | L37–87 | `clean_group_key(text, strip_feat=False)` strips NFKC, edition/remaster suffixes, accents, punctuation, and optionally `feat.`. `similarity_score(a, b)` uses `clean_group_key(..., strip_feat=True)` and returns `1.0` (exact), `0.88` (substring), or Jaccard token overlap in `[0.0, 1.0]`. |
| `backend/app/continuum/reconciler.py` | L32–40, L68–76 | `PROVIDER_PRIORITY = {"apple_rgpd_zip": 100, "local_smtc": 70, "local_receiver": 55, "listenbrainz": 50, "lastfm": 50}`. `DEFAULT_DEDUP_WINDOW_SEC = 180`. `canonical_key_for(song_name, artist_name)` returns `f"{clean_group_key(song, strip_feat=True)}||{clean_group_key(artist, strip_feat=True)}"`. Note: `reconciler.py` is owned by M2E (`PROJECT.md:102`), NOT M1. |
| `backend/app/analytics/overview.py` | L8–83, L117–588 | `get_filter_options()` queries `import_meta`, `play_events`, and `tracks_catalog` directly without `profile_id` scoping and without a `providers` list. All other functions (`get_overview`, `get_top_artists`, `get_top_albums`, `get_top_tracks`, `get_top_genres`) already delegate filtering to `build_where_clause(f, ...)`. |
| `backend/app/analytics/behavior.py` | L8–18, L201–295, L321–337 | `END_REASON_LABELS` maps Apple Music codes only. `get_behavior_and_obsessions()` queries `play_events` via `build_where_clause`, but queries `lyric_events le` (L201–254) and `search_events se` (L259–295) via `_build_date_where(f, alias)` (L321–337), which currently filters ONLY by period (`year`/`month`/`custom`) and completely ignores `profile_id` and `source_provider`. |
| `backend/app/analytics/duckdb_engine.py` | L23, L34–155 | `PARQUET_SCHEMA` (34 columns) and `export_parquet_snapshot()` omit V4 columns (`profile_id`, `incognito_mode`, `isrc`). `ensure_parquet_snapshot()` only checks file existence and does not detect stale V3 Parquet schemas missing `profile_id`. |

---

## 2. Cross-File Schema & Filter Contract (Alignment with Explorer 1)

`backend/app/profiles.py` and the 3 analytics files rely on these exact tables/columns defined by M1 in `backend/app/db.py` and `backend/app/filters.py` (per `PROJECT.md:12,138` and `survey_explorer_backend/handoff.md:128-140`):

1. **Tables in `db.py` (`SCHEMA_SQL` + `_run_v4_migrations`):**
   - `profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT DEFAULT 'standard', merged_profile_ids_json TEXT DEFAULT '[]', is_active INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` — default row `id=1`, `name='Profil Principal'`, `kind='standard'`, `merged_profile_ids_json='[]'`, `is_active=1`.
   - `profile_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL, source_provider TEXT NOT NULL, filename TEXT, file_sha256 TEXT, imported_at TEXT NOT NULL, events_count INTEGER DEFAULT 0, unique_tracks INTEGER DEFAULT 0, min_date TEXT, max_date TEXT, metadata_json TEXT DEFAULT '{}', FOREIGN KEY (profile_id) REFERENCES profiles(id))`
   - `profile_merged_exclusions (merged_profile_id INTEGER NOT NULL, play_event_id INTEGER NOT NULL, reason TEXT, PRIMARY KEY (merged_profile_id, play_event_id))`
   - `recording_isrcs (track_key TEXT NOT NULL, isrc TEXT NOT NULL, source TEXT, PRIMARY KEY (track_key, isrc), FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key))`
2. **Additive columns in `db.py`:**
   - `play_events`: `profile_id INTEGER DEFAULT 1`, `incognito_mode INTEGER DEFAULT 0`, `reason_start TEXT`, `skipped INTEGER`, `isrc TEXT`.
   - `lyric_events`, `search_events`, `favorites`: `profile_id INTEGER DEFAULT 1`.
3. **`FilterParams` & `build_where_clause` in `filters.py`:**
   - Adds `source_provider: str | None = None` and `profile_id: int | None = None`.
   - When `profile_id` is a `standard` profile: filters `COALESCE({pe_alias}.profile_id, 1) = ?`.
   - When `profile_id` is a `merged` profile with `member_ids`: filters `COALESCE({pe_alias}.profile_id, 1) IN (...)` AND `NOT EXISTS (SELECT 1 FROM profile_merged_exclusions pme WHERE pme.merged_profile_id = ? AND pme.play_event_id = {pe_alias}.id)` (or `1=0` if `member_ids` is empty).
   - When `source_provider` is set: filters `COALESCE({pe_alias}.source_provider, 'apple_rgpd_zip') = ?`.
4. **Zero Circular Imports Guarantee:**
   - `profiles.py` imports ONLY `db`, `normalize`, and `continuum.reconciler` (`PROVIDER_PRIORITY`, `canonical_key_for`).
   - `filters.py`, `overview.py`, `behavior.py`, `duckdb_engine.py` do **NOT** import `profiles.py`.

---

## 3. Concrete Blueprint for `backend/app/profiles.py`

### 3.1 Module Constants & Mappings

```python
from __future__ import annotations

import json
import re
import sqlite3
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .continuum.reconciler import DEFAULT_DEDUP_WINDOW_SEC, PROVIDER_PRIORITY, canonical_key_for
from .db import db_session
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

_PROVIDER_PLATFORM_MAP: dict[str, str] = {
    "apple_rgpd_zip": "apple_music",
    "apple_music": "apple_music",
    "musickit_web": "apple_music",
    "spotify_extended": "spotify",
    "spotify_account": "spotify",
    "spotify_rgpd": "spotify",
    "spotify": "spotify",
    "youtube_music": "youtube_music",
    "youtube_takeout": "youtube_music",
    "youtube_iframe": "youtube_music",
    "youtube": "youtube_music",
    "deezer_rgpd": "deezer",
    "deezer": "deezer",
    "tidal_csv": "tidal",
    "tidal_rgpd": "tidal",
    "tidal": "tidal",
}

_SKIP_CAPABLE_PROVIDERS: tuple[str, ...] = (
    "apple_rgpd_zip",
    "apple_music",
    "spotify_extended",
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
    "spotify_rgpd",
)

_ISRC_CLEAN_RE = re.compile(r"[^A-Za-z0-9]")
```

### 3.2 Request Schema & Low-Level Helpers

```python
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


def _provider_to_platform(source_provider: str | None) -> str:
    sp = (source_provider or "apple_rgpd_zip").strip().lower()
    return _PROVIDER_PLATFORM_MAP.get(sp, sp)


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
        INSERT OR IGNORE INTO profiles (id, name, kind, merged_profile_ids_json, is_active, created_at, updated_at)
        VALUES (?, ?, 'standard', '[]', 1, ?, ?)
        """,
        (DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, now, now),
    )
    active_row = conn.execute("SELECT id FROM profiles WHERE is_active = 1 ORDER BY id ASC LIMIT 1").fetchone()
    if not active_row:
        conn.execute("UPDATE profiles SET is_active = 1, updated_at = ? WHERE id = ?", (now, DEFAULT_PROFILE_ID))
        return DEFAULT_PROFILE_ID
    return int(active_row["id"])


def resolve_profile_scope(conn: sqlite3.Connection, profile_id: int | None) -> tuple[int, str, list[int]]:
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
```

### 3.3 Cross-Platform Deduplication Engine (`recompute_merged_exclusions`)

Exact design handling **all 3 match rules**, **exact 4-level winner tie-breaker**, **same-profile repeat preservation**, and **transitive / multi-match chains within ±180s**:

```python
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
        same_artist = (a.artist_gk == b.artist_gk) or (similarity_score(a.artist_name, b.artist_name) >= 0.85)
        if same_artist and similarity_score(a.song_name, b.song_name) >= 0.85:
            return "similarity"
    return None
```

**Sliding-Window Algorithm (`recompute_merged_exclusions`):**

```python
def recompute_merged_exclusions(conn: sqlite3.Connection, merged_profile_id: int) -> dict[str, int]:
    """Recompute cross-platform deduplication exclusions for a merged profile.

    Algorithm (Active-Survivors Chronological Sliding Window, +-180s):
    - Loads `recording_isrcs` into a dict `track_key -> set[normalized_isrc]`.
    - Streams all `play_events` belonging to `member_ids` ordered by `started_epoch ASC, id ASC`.
    - Maintains a `deque[_MergeEvent]` of currently-kept (non-excluded) events within `[cur.started_epoch - 180, cur.started_epoch]`.
    - For each incoming event `cur`:
        1. Evict stale survivors where `cur.started_epoch - ev.started_epoch > 180`.
        2. Find ALL matching active survivors in the window across distinct member profiles.
        3. If no matches: append `cur` to active window.
        4. If ANY matching survivor outranks `cur` (`_winner_rank(ev) > _winner_rank(cur)`):
           exclude `cur` (using the highest-ranked matching survivor's match reason) and do NOT add `cur` to window.
        5. Otherwise (`cur` strictly outranks ALL matching survivors):
           exclude every matched survivor, remove them from the active window, and append `cur`.

    Guarantees:
    - Transitive chains A (~t0) <-> B (~t0+150) <-> C (~t0+300) never keep an already-excluded event or double-exclude.
    - Multi-match bridge events exclude ALL dominated survivors cleanly.
    - Same-profile consecutive repeats are preserved intact.
    - Deterministic & idempotent (`DELETE` + `executemany` inside caller transaction).
    """
    row = conn.execute(
        "SELECT id, kind, merged_profile_ids_json FROM profiles WHERE id = ?",
        (merged_profile_id,),
    ).fetchone()
    conn.execute("DELETE FROM profile_merged_exclusions WHERE merged_profile_id = ?", (merged_profile_id,))
    if not row or row["kind"] != "merged":
        return {"checked": 0, "excluded": 0, "kept": 0}

    member_ids = _parse_merged_ids(row["merged_profile_ids_json"])
    if len(member_ids) < 2:
        # 0 or 1 member profile -> zero cross-profile duplicates possible
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
        prio = int(r["source_priority"]) if r["source_priority"] is not None else V4_PROVIDER_PRIORITY.get(sp, 50)
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
            # Highest-ranked survivor wins; exclude cur
            _, best_reason = max(stronger, key=lambda pair: _winner_rank(pair[0]))
            excluded[cur.id] = best_reason
        else:
            # cur beats ALL matched active survivors; exclude them and swap cur in
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
```

### 3.4 Reusable M2A Helpers (Exact Signatures)

```python
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
        row = conn.execute("SELECT id, kind FROM profiles WHERE id = ?", (profile_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Profil introuvable : {profile_id}")
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
    active = conn.execute("SELECT id, kind FROM profiles WHERE is_active = 1 LIMIT 1").fetchone()
    if active and active["kind"] == "standard":
        return int(active["id"])
    return DEFAULT_PROFILE_ID
```

### 3.5 Capabilities Matrix (`get_profile_capabilities`) — Exact SQL Rules & Truth Table

**Signature:**
```python
def get_profile_capabilities(
    profile_id: int | None = None,
    source_provider: str | None = None,
) -> dict[str, Any]:
```

**Exact SQL Queries:**
1. Resolve `(resolved_id, kind, member_ids) = resolve_profile_scope(conn, profile_id)`.
2. If `not member_ids`: return empty capabilities dict immediately (0 plays, all booleans `False`, `platforms=[]`, `source_providers=[]`, `estimated_duration_pct=0.0`).
3. Build scoped `pe_where, pe_params`:
   - `placeholders = ",".join("?" for _ in member_ids)`
   - `clauses = [f"COALESCE(pe.profile_id, 1) IN ({placeholders})"]`, `params = list(member_ids)`
   - If `kind == "merged"`:
     `clauses.append("NOT EXISTS (SELECT 1 FROM profile_merged_exclusions pme WHERE pme.merged_profile_id = ? AND pme.play_event_id = pe.id)")`
     `params.append(resolved_id)`
   - If `source_provider`:
     `clauses.append("COALESCE(pe.source_provider, 'apple_rgpd_zip') = ?")`
     `params.append(source_provider)`
   - `pe_where = " AND ".join(clauses)`
4. Query 1 — distinct `source_provider`s:
   ```sql
   SELECT DISTINCT COALESCE(pe.source_provider, 'apple_rgpd_zip') AS sp
   FROM play_events pe
   WHERE {pe_where}
   ```
   -> `source_providers = sorted(r["sp"] for r in rows if r["sp"])`
   -> `platforms = sorted({_provider_to_platform(sp) for sp in source_providers})`
5. Query 2 — single-pass aggregate over `play_events pe`:
   ```sql
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
   ```
   (Bind `*_SKIP_CAPABLE_PROVIDERS`, `*_NO_NATIVE_END_REASON_PROVIDERS`, `*_INCOGNITO_PROVIDERS`, `*pe_params` cleanly in order.)
6. Query 3 & 4 — `lyric_events` and `search_events`:
   - If `source_provider` is set AND `_provider_to_platform(source_provider) != "apple_music"`:
     `has_lyrics_events = False`, `has_search_events = False`.
   - Else:
     ```sql
     SELECT EXISTS(SELECT 1 FROM lyric_events WHERE COALESCE(profile_id, 1) IN ({placeholders}))
     SELECT EXISTS(SELECT 1 FROM search_events WHERE COALESCE(profile_id, 1) IN ({placeholders}))
     ```
7. Division-by-zero-safe final payload:
   ```python
   total_plays = int(agg["total_plays"] or 0)
   estimated_plays = int(agg["estimated_plays"] or 0)
   estimated_pct = round((estimated_plays / total_plays) * 100.0, 1) if total_plays > 0 else 0.0
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
   ```

**Verification Truth Table across all Profile Types:**

| Profile Scenario | `platforms` | `has_exact_duration` | `estimated_duration_pct` | `has_skips` | `has_end_reasons` | `has_lyrics_events` | `has_search_events` | `has_devices` | `has_audio_quality` | `has_incognito_flag` | `has_shuffle_flag` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Apple Music RGPD** | `["apple_music"]` | `True` | `0.0` | `True` | `True` | `True`* | `True`* | `True` | `True`* | `False` | `True`* |
| **Spotify Extended** | `["spotify"]` | `True` | `0.0` | `True` | `True` | `False` | `False` | `True` | `False` | `True` | `True` |
| **Spotify Account Data** | `["spotify"]` | `True` | `0.0` | `True` | `False` | `False` | `False` | `False` | `False` | `False` | `False` |
| **YouTube Music Takeout** | `["youtube_music"]` | `False` | `100.0` | `False` | `False` | `False` | `False` | `False` | `False` | `False` | `False` |
| **Deezer `.xlsx` (mixed `-1`)** | `["deezer"]` | `True` | `> 0.0` & `< 100.0` | `True` | `False` | `False` | `False` | `True` | `False` | `False` | `False` |
| **TIDAL `.csv` (track dur only)** | `["tidal"]` | `False` | `100.0` | `False` | `False` | `False` | `False` | `False` | `False` | `False` | `False` |
| **Merged (Apple + Spotify + YTM)** | `["apple_music", "spotify", "youtube_music"]` | `True` | `0.0 < pct < 100.0` | `True` | `True` | `True`* | `True`* | `True` | `True`* | `True` | `True` |
| **Empty Profile** | `[]` | `False` | `0.0` | `False` | `False` | `False` | `False` | `False` | `False` | `False` | `False` |

(*`True` when corresponding Apple Music rows exist in the DB; `False` if omitted.)

### 3.6 Exact HTTP Endpoints on `profiles_router`

| Method & Path | Status | Behavior, Validation & Response Shape |
| :--- | :---: | :--- |
| `GET /api/v4/profiles` | `200` | Calls `list_profiles()`. Ensures default profile `id=1`. Returns `{"active_profile_id": int, "profiles": [ProfileOut, ...]}`. Each `ProfileOut`: `{id, name, kind, merged_profile_ids, is_active, sources: [{id, source_provider, filename, imported_at, events_count, unique_tracks, min_date, max_date}], total_plays, created_at, updated_at}`. For `merged` profiles: `sources` aggregates member profiles' sources; `total_plays` counts `play_events` across `member_ids` excluding `profile_merged_exclusions`. |
| `POST /api/v4/profiles` | `201` | Body `ProfileCreateIn`. Validation -> `HTTP 400`: (1) empty/whitespace `name` or `len > 120`; (2) `kind not in ("standard", "merged")`; (3) if `kind == "merged"`: reject empty `merged_profile_ids`, reject duplicate IDs (`len(set(ids)) != len(ids)`), reject non-positive or non-existent IDs, reject any target profile with `kind == "merged"` (prevents self-merge, nested merge, and cycles by construction). Inserts row, runs `recompute_merged_exclusions(conn, new_id)` immediately if `merged`, commits atomically, returns `201` with serialized profile dict (plus `dedup_stats` when `merged`). |
| `POST /api/v4/profiles/{profile_id}/activate` | `200` | `404` if `profile_id` missing. Sets `is_active = 0` on all rows, `is_active = 1` + `updated_at` on `profile_id` inside one transaction. Returns `{"ok": True, "active_profile_id": profile_id, "profile": <serialized>}`. |
| `POST /api/v4/profiles/{profile_id}/recompute-merge` | `200` | `404` if `profile_id` missing; `400` if `kind != "merged"`. Calls `recompute_merged_exclusions(conn, profile_id)`, updates `updated_at`, returns `{"ok": True, "profile_id": profile_id, "checked": ..., "excluded": ..., "kept": ...}`. |
| `DELETE /api/v4/profiles/{profile_id}` | `200` | `400` if `profile_id == 1`; `404` if missing. Inside single atomic transaction: (1) delete `profile_merged_exclusions` where `merged_profile_id = profile_id` OR `play_event_id IN (SELECT id FROM play_events WHERE profile_id = ?)`; (2) delete `profile_sources`, `play_events`, `lyric_events`, `search_events`, `favorites` where `profile_id = ?`; (3) delete row from `profiles`; (4) for every remaining `merged` profile whose `merged_profile_ids` contains `profile_id`, strip `profile_id` from `merged_profile_ids_json`, update `updated_at`, and call `recompute_merged_exclusions(conn, mid)`; (5) if deleted profile was active, re-activate `id = 1`. Returns `{"ok": True, "deleted_profile_id": profile_id, "active_profile_id": active_id}`. |
| `GET /api/v4/profile/capabilities` | `200` | Query params `profile_id: int | None = Query(None)`, `source_provider: str | None = Query(None)`. `404` if explicit `profile_id` does not exist. Returns exact 12+ field capabilities JSON from §3.5. |

---

## 4. Exact Surgical Edits for Analytics & DuckDB

### 4.1 `backend/app/analytics/overview.py`

Only `get_filter_options` (`L8–83`) requires edits; all other functions (`get_overview`, `get_top_*`) already funnel through `build_where_clause(f, ...)`.

- **Signature (L8):** Change `def get_filter_options() -> dict[str, Any]:` to:
  ```python
  def get_filter_options(profile_id: int | None = None) -> dict[str, Any]:
  ```
- **Inside `with db_session() as conn:` (L9–71):**
  Compute scoped predicate once via `filters.py`:
  ```python
  pe_where, pe_params = build_where_clause(
      FilterParams(profile_id=profile_id),
      include_skip_filter=False,
  )
  ```
  (Note: because `artist`, `genre`, and `decade` are `None`, `pe_where` references ONLY `pe.*` and is safe on both `FROM play_events pe` and `FROM play_events pe JOIN tracks_catalog tc`!)
- **Update queries inside `get_filter_options`:**
  - `years` (L11): `SELECT DISTINCT pe.local_year FROM play_events pe WHERE {pe_where} ORDER BY pe.local_year DESC` with `pe_params`.
  - `months` (L12): `SELECT DISTINCT pe.local_month FROM play_events pe WHERE {pe_where} ORDER BY pe.local_month DESC` with `pe_params`.
  - `genres` (L14–27): add `AND {pe_where}` with `pe_params`.
  - `decades` (L28–38): if `profile_id is not None`, query `SELECT DISTINCT (tc.release_year / 10) * 10 AS dec FROM play_events pe JOIN tracks_catalog tc ON tc.track_key = pe.track_key WHERE {pe_where} AND tc.release_year IS NOT NULL AND tc.release_year >= 1940 ORDER BY dec DESC` with `pe_params`; else keep existing `tracks_catalog` query for 100% V1/V2/V3 compatibility.
  - `artists` (L39–52): add `AND {pe_where}` with `pe_params`.
  - `containers` (L53–58): `FROM play_events pe WHERE {pe_where} AND pe.container_type IS NOT NULL GROUP BY pe.container_type ORDER BY c DESC` with `pe_params`.
  - `features` (L59–64): `FROM play_events pe WHERE {pe_where} AND pe.feature_name IS NOT NULL GROUP BY pe.feature_name ORDER BY c DESC LIMIT 30` with `pe_params`.
  - `devices` (L65–70): `FROM play_events pe WHERE {pe_where} AND pe.device_label IS NOT NULL GROUP BY pe.device_label ORDER BY c DESC` with `pe_params`.
  - **Add `providers` (after L70):**
    ```python
    providers = [
        r[0]
        for r in conn.execute(
            f"""
            SELECT COALESCE(pe.source_provider, 'apple_rgpd_zip') AS sp, COUNT(*) AS c
            FROM play_events pe
            WHERE {pe_where}
            GROUP BY sp
            ORDER BY c DESC
            """,
            pe_params,
        )
    ]
    ```
- **Return dict (L72–83):** Keep all 10 existing keys untouched and add `"providers": providers`.

### 4.2 `backend/app/analytics/behavior.py`

1. **Imports (top of file):** Add `import json` and `import sqlite3`.
2. **`END_REASON_LABELS` (L8–18):** Add Spotify Extended end-reason mappings additively so Spotify profiles display clean French labels:
   ```python
   "trackdone": "Fin naturelle",
   "fwdbtn": "Skip suivant",
   "backbtn": "Retour arrière",
   "endplay": "Changement manuel",
   "logout": "Déconnexion",
   "remote": "Contrôle distant",
   "trackerror": "Erreur piste",
   "unexpected-exit": "App fermée",
   "unexpected-exit-while-paused": "App fermée (pause)",
   ```
3. **Call sites inside `get_behavior_and_obsessions` (L201 & L259):**
   - L201: `lyric_where, lyric_params = _build_date_where(f, "le", conn=conn)`
   - L259: `search_where, search_params = _build_date_where(f, "se", conn=conn)`
4. **`_build_date_where` (L321–337):**
   ```python
   def _build_date_where(
       f: FilterParams,
       alias: str,
       conn: sqlite3.Connection | None = None,
   ) -> tuple[str, list[Any]]:
       clauses = ["1=1"]
       params: list[Any] = []
       if f.period_mode == "year" and f.year is not None:
           clauses.append(f"{alias}.local_year = ?")
           params.append(f.year)
       elif f.period_mode == "month" and f.month:
           clauses.append(f"{alias}.local_month = ?")
           params.append(f.month)
       elif f.period_mode == "custom":
           if f.date_from:
               clauses.append(f"{alias}.local_date >= ?")
               params.append(f.date_from)
           if f.date_to:
               clauses.append(f"{alias}.local_date <= ?")
               params.append(f.date_to)

       # V4: lyric_events & search_events originate exclusively from Apple Music RGPD
       if f.source_provider and f.source_provider not in ("apple_rgpd_zip", "apple_music"):
           clauses.append("1=0")
           return " AND ".join(clauses), params

       # V4: profile_id scoping (handles both standard and merged profiles)
       if f.profile_id is not None:
           member_ids: list[int] = [int(f.profile_id)]
           if conn is not None:
               try:
                   prow = conn.execute(
                       "SELECT kind, merged_profile_ids_json FROM profiles WHERE id = ?",
                       (int(f.profile_id),),
                   ).fetchone()
                   if prow and prow["kind"] == "merged":
                       parsed = json.loads(prow["merged_profile_ids_json"] or "[]")
                       member_ids = [int(x) for x in parsed if isinstance(x, int) or str(x).isdigit()]
               except (sqlite3.OperationalError, ValueError, TypeError):
                   pass
           if not member_ids:
               clauses.append("1=0")
           elif len(member_ids) == 1:
               clauses.append(f"COALESCE({alias}.profile_id, 1) = ?")
               params.append(member_ids[0])
           else:
               ph = ",".join("?" for _ in member_ids)
               clauses.append(f"COALESCE({alias}.profile_id, 1) IN ({ph})")
               params.extend(member_ids)

       return " AND ".join(clauses), params
   ```
   **Why this matters:** Prevents Apple Music lyrics/searches from leaking into Spotify/YTM/Deezer/TIDAL profiles, while still showing Apple Music lyrics/searches when viewing a **merged** profile containing the Apple Music member!

### 4.3 `backend/app/analytics/duckdb_engine.py`

1. **`PARQUET_SCHEMA` (L34–71):** Append 3 additive V4 fields right after `("duration_is_estimated", pa.int8())`:
   ```python
   ("profile_id", pa.int64()),
   ("incognito_mode", pa.int8()),
   ("isrc", pa.string()),
   ```
2. **`export_parquet_snapshot()` SQL query (L81–122):** Append right after `COALESCE(pe.duration_is_estimated, 0) AS duration_is_estimated`:
   ```sql
   COALESCE(pe.profile_id, 1) AS profile_id,
   COALESCE(pe.incognito_mode, 0) AS incognito_mode,
   COALESCE(pe.isrc, '') AS isrc
   ```
   Also use `from .. import db as db_mod` (or read `db_mod.PARQUET_SNAPSHOT_PATH` when `snapshot_path is None`) so tests monkeypatching `db_mod.PARQUET_SNAPSHOT_PATH` automatically redirect snapshots cleanly!
3. **`ensure_parquet_snapshot()` (L152–155):** Upgrade check for stale V3 Parquet files on disk:
   ```python
   def ensure_parquet_snapshot() -> Path:
       target = db_mod.PARQUET_SNAPSHOT_PATH
       needs_export = not target.exists()
       if not needs_export:
           try:
               existing_cols = set(pq.read_schema(target).names)
               if "profile_id" not in existing_cols:
                   needs_export = True
           except Exception:
               needs_export = True
       if needs_export:
           export_parquet_snapshot(target)
       return target
   ```

---

## 5. Detailed Test Plan for `backend/tests/test_profiles_v4.py`

### 5.1 Isolation Fixture
- Pytest fixture `isolated_db(tmp_path, monkeypatch)`:
  - Points `db_mod.DB_PATH = tmp_path / "test_v4.sqlite"` and `db_mod.PARQUET_SNAPSHOT_PATH = tmp_path / "snap.parquet"`.
  - Calls `db_mod.init_db()`.
  - Builds a local `FastAPI()` mounting `profiles_router` with the exact `HTTPException` & `RequestValidationError` handlers from `main.py` (needed because M2E mounts `profiles_router` into `main.py` later).
  - Provides helper `insert_play(conn, *, profile_id, provider, song, artist, album, started_epoch, play_ms, media_ms, duration_is_estimated=0, source_priority=None, end_reason_type=None, device_label=None, audio_quality=None, shuffle_play=None, incognito_mode=0, skipped=None, is_skip_30s=0, isrc=None, recording_isrc=None)`.

### 5.2 Unit Tests
1. **Profile CRUD & Activation (`GET/POST/DELETE /api/v4/profiles`, `/activate`, `/recompute-merge`):**
   - Fresh DB has default profile `id=1` (`kind="standard"`, `is_active=True`).
   - `POST /api/v4/profiles` creates standard profile -> HTTP `201`, `is_active=False`.
   - Validation rejects empty/whitespace name (`400`), invalid `kind` (`400`), empty `merged_profile_ids` (`400`), duplicate IDs `[1, 1]` (`400`), non-existent ID `[1, 999]` (`400`), and merging an existing merged profile (`400`).
   - `POST /api/v4/profiles/{id}/activate` enforces single active profile invariant; `404` on missing ID.
   - `POST /api/v4/profiles/{id}/recompute-merge` returns `404` on missing ID, `400` on standard profile, `200` with `{checked, excluded, kept}` on merged profile.
   - `DELETE /api/v4/profiles/1` returns `400`.
   - `DELETE /api/v4/profiles/999` returns `404`.
   - `DELETE` on active non-default profile re-activates `id=1`, deletes its `play_events`, `lyric_events`, `search_events`, `favorites`, `profile_sources`, removes its ID from any merged profile's `merged_profile_ids_json`, and recomputes that merged profile's exclusions cleanly.
2. **Cross-Platform Deduplication (`recompute_merged_exclusions`):**
   - **ISRC match** (hyphenated `FR-Z03-99-00123` on `play_events.isrc` vs `FRZ039900123` in `recording_isrcs` N-to-M table) even when titles differ (`"One More Time"` vs `"One More Time (2024 Radio Cut)"`) within `±180s` -> higher priority wins.
   - **`canonical_key_for` match** (accents + remaster + feat stripped, e.g. `"Déjà Vu (Remastered)"` vs `"Deja Vu"`).
   - **`similarity_score >= 0.85` match** (same artist + high token/substring title match, e.g. `"Bohemian Rhapsody"` vs `"Bohemian Rhapsody Live"` -> `0.88`).
   - **Exact ±180s boundary:** `delta == 180` -> deduplicated; `delta == 181` -> BOTH kept.
   - **Same-profile repeat preservation:** two identical plays 120s apart inside Profile 1 are BOTH kept in a merged `[1, 2]` view.
   - **4-level winner tie-breaker:**
     1. Higher `source_priority` wins (`100 > 95 > 60`).
     2. Equal priority -> `duration_is_estimated == 0` beats `1`.
     3. Equal priority & estimation -> longer `play_duration_ms` wins.
     4. All equal -> lowest `id` wins.
   - **Transitive / chain duplicates:** `A (t=1000, prio=60, P1)` <-> `B (t=1150, prio=95, P2)` <-> `C (t=1300, prio=100, P3)` -> ONLY `C` kept, `A` and `B` excluded, zero double-exclusions.
   - **M2A helpers:** `record_profile_source()` persists source metadata and appears in `GET /api/v4/profiles`; `refresh_all_merged_profiles_containing()` updates exclusions after new events land in a member profile.
3. **Capabilities Matrix (`GET /api/v4/profile/capabilities`):**
   - Empty profile -> `platforms=[]`, `estimated_duration_pct=0.0`, all booleans `False`, HTTP `200` (no ZeroDivisionError).
   - Non-existent `profile_id=999` -> HTTP `404`.
   - Individual profile verification for Apple Music, Spotify Extended, Spotify Account Data, YouTube Music (`has_exact_duration=False`, `estimated_duration_pct=100.0`), Deezer mixed (`-1` imputed + exact -> accurate percentage), and TIDAL CSV.
   - Merged profile (Apple + Spotify Extended + YTM) -> union of capabilities, accurate `estimated_duration_pct` computed strictly on deduplicated plays (excluded YTM duplicates do NOT inflate `estimated_duration_pct`!).
   - `?source_provider=spotify_extended` on merged profile -> `has_lyrics_events=False`, `has_search_events=False`, `platforms=["spotify"]`.
4. **Analytics & DuckDB Integration:**
   - `get_filter_options()` returns `"providers"` list and scopes all filter lists cleanly when `profile_id` is passed (standard & merged).
   - `get_overview(FilterParams(profile_id=merged_id))` counts deduplicated plays (no double-counting!) and respects `source_provider`.
   - `get_behavior_and_obsessions(FilterParams(profile_id=spotify_id))` returns `0` lyrics and `0` searches even when Profile 1 (Apple) has lyrics & searches; merged `[apple_id, spotify_id]` sees Apple's lyrics & searches; `FilterParams(profile_id=merged_id, source_provider="spotify_extended")` returns `0` lyrics & `0` searches.
   - `export_parquet_snapshot()` writes `profile_id`, `incognito_mode`, `isrc` columns verified via `pyarrow.parquet.read_schema()` and `query_parquet("SELECT DISTINCT profile_id FROM {parquet}")`.
   - `ensure_parquet_snapshot()` automatically re-exports when an old V3 Parquet file without `profile_id` is on disk.

### 5.3 Hypothesis Property-Based Tests
1. **`test_prop_merge_dedup_invariants`:** Generate random lists of `(profile_id in {1,2,3}, started_epoch in [0..600], track_idx in {0,1,2}, priority in {50,60,95,100}, estimated in {0,1}, play_ms in [1000..300000])`:
   - Invariant 1 (Conservation): `stats["kept"] + stats["excluded"] == len(events)`.
   - Invariant 2 (Zero Cross-Profile Duplicates): For every pair `(a, b)` of kept events with `a.profile_id != b.profile_id` and `a.track_idx == b.track_idx`, `abs(a.started_epoch - b.started_epoch) > 180`.
   - Invariant 3 (Same-Profile Preservation): If all events share a single `profile_id`, `excluded == 0`.
   - Invariant 4 (Idempotence): Running `recompute_merged_exclusions` twice produces identical excluded ID sets.
2. **`test_prop_capabilities_bounds_and_safety`:** Generate arbitrary counts of exact vs estimated plays (`0..30` each) across random providers:
   - Never raises `ZeroDivisionError` or 5xx.
   - `0.0 <= cap["estimated_duration_pct"] <= 100.0`.
   - `cap["has_exact_duration"] == (exact_count > 0)`.
   - When `total == 0`, `cap["platforms"] == []` and `cap["estimated_duration_pct"] == 0.0`.

---

## 6. Verification Checklist for M1 Worker

After implementing `profiles.py`, `overview.py`, `behavior.py`, `duckdb_engine.py`, and `test_profiles_v4.py`:
1. Run `backend/.venv/bin/pytest backend/tests/test_profiles_v4.py -v` -> 100% PASS.
2. Run full non-regression suite: `backend/.venv/bin/pytest -v` -> `test_properties.py`, `test_openapi_fuzz.py`, and `test_profiles_v4.py` ALL PASS (with `app.version == "3.0.0"` intact).
3. Verify zero circular imports via `backend/.venv/bin/python -c "import backend.app.profiles, backend.app.filters, backend.app.analytics.overview, backend.app.analytics.behavior, backend.app.analytics.duckdb_engine; print('OK')"`.
