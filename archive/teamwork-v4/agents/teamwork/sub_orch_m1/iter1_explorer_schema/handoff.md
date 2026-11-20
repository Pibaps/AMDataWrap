# M1 Implementation Blueprint — Schema, Environment & Global Filters

**Author:** Explorer 1 (Read-Only Codebase Explorer)  
**Target Milestone:** M1 — Backend V4 Foundation, Env & Profiles/Capabilities  
**Scope:** `backend/requirements.txt`, `backend/.venv/`, `backend/app/db.py`, `backend/app/filters.py` (plus exact integration touchpoints for `backend/app/analytics/behavior.py`, `overview.py`, `duckdb_engine.py`, and regression compatibility with `backend/tests/test_properties.py` & `backend/tests/test_openapi_fuzz.py`).  
**Status:** Read-only audit complete; zero repository files modified.

---

## 1. Environment & `backend/requirements.txt`

### 1.1 Verified VM Environment Facts
- Python: `/usr/bin/python3` (`3.11.2`), SQLite `3.40.1` with **FTS5** (`ENABLE_FTS5`) and built-in **JSON1** (`json_each`, `json_valid`) verified live.
- Package manager: `uv 0.13.8` at `/usr/local/bin/uv` (user-space, no `sudo`/`apt`).
- System `/usr/lib/python3/dist-packages` has outdated `fastapi 0.92.0` / `pydantic 1.10.4` (incompatible with Pydantic v2 `model_dump()`). All backend execution and `pytest` runs MUST use `backend/.venv/bin/python` / `backend/.venv/bin/pytest`.
- `.gitignore:15` already ignores `backend/.venv/`, and `pytest.ini` sets `pythonpath = .`, `testpaths = backend/tests`.

### 1.2 Exact `backend/requirements.txt` Content
Preserve all 12 existing dependencies unchanged and append the 5 V4 dependencies:

```text
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
httpx>=0.27.0
python-multipart>=0.0.12
aiosqlite>=0.20.0
duckdb>=1.1.0
pyarrow>=18.0.0
numpy>=2.0.0
ruptures>=1.1.9
pytest>=8.3.0
hypothesis>=6.115.0
schemathesis>=3.38.0
openpyxl>=3.1.0
ytmusicapi>=1.9.0
Pillow>=10.0.0
segno>=1.6.0
dbus-next>=0.2.3; sys_platform == "linux"
```

**Rationale per addition:**
- `openpyxl>=3.1.0`: Streaming `read_only=True` `.xlsx` parser for Deezer RGPD (M2A).
- `ytmusicapi>=1.9.0`: Unauthenticated `YTMusic().search(..., filter="songs")` `videoId` resolver (M2D).
- `Pillow>=10.0.0`: WebP/JPEG/PNG resizing for `/api/artwork-proxy?w=512&fmt=webp` (M2E/M5).
- `segno>=1.6.0`: Pure-Python SVG/data-URI QR code generator for mobile ListenBrainz/LAN setup (M2C/M2E).
- `dbus-next>=0.2.3; sys_platform == "linux"`: Pure-Python asyncio MPRIS2 D-Bus client (zero C/`libdbus` deps; skipped cleanly on Windows/macOS via PEP 508 marker).
- Note: `uvicorn[standard]>=0.32.0` already installs `websockets` for FastAPI WebSocket endpoints (`/ws/now-playing`, `/ws/bridge`) and `TestClient.websocket_connect`.

### 1.3 Exact `uv` Bootstrap & Baseline Verification Commands
Run from `/home/antigravity/Pibaps/AMDataWrap`:

```bash
uv venv backend/.venv --python python3
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
backend/.venv/bin/python -c "import fastapi, pydantic, websockets, openpyxl, ytmusicapi, PIL, segno, dbus_next, duckdb, pyarrow, ruptures, pytest, hypothesis, schemathesis; from PIL import features; assert features.check('webp'); print('ENV OK | pydantic:', pydantic.__version__)"
backend/.venv/bin/pytest -v
```

---

## 2. Database Schema & Migrations (`backend/app/db.py`)

### 2.1 Critical Regression Guardrails Discovered
1. **`test_properties.py:105-106` executes `SCHEMA_SQL` + `_run_v3_migrations(conn)` WITHOUT calling `init_db()` or `_run_v4_migrations(conn)`:**
   - Therefore, all 7 new V4 tables AND all new V4 columns on existing tables (`play_events`, `lyric_events`, `search_events`, `favorites`) MUST appear in `SCHEMA_SQL` (for fresh/test DBs) AND be ensured additively in `_run_v4_migrations(conn)` (for upgrading pre-existing V1/V2/V3 SQLite DBs).
2. **CRITICAL UPGRADE HAZARD — Indexes on additive columns MUST NOT be placed inside `SCHEMA_SQL`:**
   - On an existing V3 SQLite DB, `init_db()` runs `conn.executescript(SCHEMA_SQL)` BEFORE `_run_v4_migrations(conn)`. `CREATE TABLE IF NOT EXISTS play_events (...)` is a no-op when `play_events` already exists without `profile_id`/`isrc`/`incognito_mode`.
   - If `CREATE INDEX IF NOT EXISTS idx_pe_profile_id ON play_events(profile_id)` were placed in `SCHEMA_SQL`, upgrading a V3 DB would raise `sqlite3.OperationalError: no such column: profile_id`!
   - **Rule (matching V3's exact pattern at `db.py:409-429`):**
     - Indexes on **new V4 tables** (`profiles`, `profile_sources`, `profile_merged_exclusions`, `recording_isrcs`, `platform_track_mappings`, `vinyl_editions`, `api_metadata_cache`) MAY live in `SCHEMA_SQL` (and harmlessly repeat with `IF NOT EXISTS` in `_run_v4_migrations`).
     - Indexes on **V4 additive columns of pre-existing tables** (`play_events`, `lyric_events`, `search_events`, `favorites`) MUST ONLY be created in `_run_v4_migrations(conn)` **after** `_ensure_column(...)`.
3. **Cross-profile UNIQUE index collision on `play_events` (`db.py:416-429`):**
   - V3 created `idx_pe_provider_event_uniq ON play_events(source_provider, source_event_id)` and `idx_pe_dedup_fp_uniq ON play_events(dedup_fingerprint)` globally.
   - If a user imports the same archive into Profile 1 and Profile 2 separately, those global unique indexes would raise `sqlite3.IntegrityError` unless scoped by `profile_id`!
   - **Solution:** Inside `_run_v4_migrations(conn)`, inspect `PRAGMA index_info(...)` for both indexes. If `profile_id` is not in the index columns, `DROP INDEX IF EXISTS` and recreate them as:
     - `ON play_events(profile_id, source_provider, source_event_id) WHERE source_event_id IS NOT NULL`
     - `ON play_events(profile_id, dedup_fingerprint) WHERE dedup_fingerprint IS NOT NULL`
   - Preserves 100% V3 uniqueness within `profile_id = 1` AND prevents cross-profile collisions cleanly!
4. **All existing `INSERT` statements use explicit column lists:**
   - Verified via grep across `backend/app/ingestion.py` (`L693, L732, L744, L755`) and `backend/app/continuum/reconciler.py` (`L363`). Adding nullable / `DEFAULT`-backed columns breaks zero existing `INSERT`s.
5. **Do NOT put a hard `FOREIGN KEY (profile_id) REFERENCES profiles(id)` on `play_events` / `lyric_events` / `search_events` / `favorites`:**
   - Keeps `test_properties.py` (which does not seed `profiles`) safe even if `PRAGMA foreign_keys = ON` is ever enabled. Keep `FOREIGN KEY ... ON DELETE CASCADE` on `profile_sources` and `profile_merged_exclusions`.
6. **Missing import in current `backend/app/db.py`:**
   - Current imports (`db.py:1-6`) do NOT include `datetime`. Add:
     ```python
     from datetime import datetime, timezone
     ```

### 2.2 Exact Additive Columns in `SCHEMA_SQL` (Lines 106–185 of `backend/app/db.py`)

Add to `play_events` (right after `dedup_fingerprint TEXT,` at line 146):
```sql
    profile_id INTEGER DEFAULT 1,
    incognito_mode INTEGER DEFAULT 0,
    reason_start TEXT,
    skipped INTEGER,
    isrc TEXT,
```

Add to `lyric_events` (right after `device_label TEXT,` at line 162):
```sql
    profile_id INTEGER DEFAULT 1,
```

Add to `search_events` (right after `device_os TEXT` at line 175 — add comma):
```sql
    device_os TEXT,
    profile_id INTEGER DEFAULT 1
```

Add to `favorites` (right after `preference TEXT` at line 184 — add comma):
```sql
    preference TEXT,
    profile_id INTEGER DEFAULT 1
```

### 2.3 Exact DDL for All 7 V4 Tables & New-Table Indexes in `SCHEMA_SQL`

Insert right after `playlists_saved` (around line 328, before the FTS5 section):

```sql
-- ===========================================================================
-- V4 Multi-Platform, Profiles, ISRC N-to-M, Vinyl Editions & TTL Cache Tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'merged')),
    merged_profile_ids_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    source_provider TEXT NOT NULL,
    filename TEXT,
    file_sha256 TEXT,
    imported_at TEXT NOT NULL,
    events_count INTEGER DEFAULT 0,
    unique_tracks INTEGER DEFAULT 0,
    min_date TEXT,
    max_date TEXT,
    metadata_json TEXT DEFAULT '{}',
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_merged_exclusions (
    merged_profile_id INTEGER NOT NULL,
    play_event_id INTEGER NOT NULL,
    reason TEXT,
    kept_play_event_id INTEGER,
    PRIMARY KEY (merged_profile_id, play_event_id),
    FOREIGN KEY (merged_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recording_isrcs (
    track_key TEXT NOT NULL,
    isrc TEXT NOT NULL,
    source TEXT DEFAULT 'unknown',
    created_at TEXT,
    PRIMARY KEY (track_key, isrc),
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS platform_track_mappings (
    track_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url TEXT,
    resolved_at TEXT NOT NULL,
    PRIMARY KEY (track_key, provider, external_id),
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS vinyl_editions (
    album_key TEXT PRIMARY KEY,
    mbid_release_group TEXT,
    mbid_vinyl_release TEXT,
    label_name TEXT,
    catalog_number TEXT,
    country TEXT,
    press_year INTEGER,
    disc_count INTEGER DEFAULT 1,
    vinyl_color_hex TEXT,
    front_cover_url TEXT,
    back_cover_url TEXT,
    medium_label_url TEXT,
    sides_json TEXT DEFAULT '[]',
    enriched_at TEXT
);

CREATE TABLE IF NOT EXISTS api_metadata_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
```

And append these **new-table-only** indexes to the index block at the end of `SCHEMA_SQL` (after line 382):

```sql
CREATE INDEX IF NOT EXISTS idx_ps_profile_id ON profile_sources(profile_id);
CREATE INDEX IF NOT EXISTS idx_ps_provider ON profile_sources(source_provider);
CREATE INDEX IF NOT EXISTS idx_pme_merged_id ON profile_merged_exclusions(merged_profile_id);
CREATE INDEX IF NOT EXISTS idx_rec_isrc ON recording_isrcs(isrc);
CREATE INDEX IF NOT EXISTS idx_ptm_provider_ext ON platform_track_mappings(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_ptm_track_provider ON platform_track_mappings(track_key, provider);
CREATE INDEX IF NOT EXISTS idx_ve_mbid_rg ON vinyl_editions(mbid_release_group);
CREATE INDEX IF NOT EXISTS idx_amc_expires ON api_metadata_cache(expires_at);
```

### 2.4 Exact `_run_v4_migrations(conn)` & `init_db()` Implementation

```python
def _index_columns(conn: sqlite3.Connection, index_name: str) -> list[str]:
    return [r["name"] for r in conn.execute(f"PRAGMA index_info({index_name})").fetchall()]


def _run_v4_migrations(conn: sqlite3.Connection):
    """Non-breaking additive V4 migrations (idempotent on fresh and V1/V2/V3 DBs)."""
    # 1. Additive columns on existing V1/V2/V3 tables
    _ensure_column(conn, "play_events", "profile_id", "INTEGER DEFAULT 1")
    _ensure_column(conn, "play_events", "incognito_mode", "INTEGER DEFAULT 0")
    _ensure_column(conn, "play_events", "reason_start", "TEXT")
    _ensure_column(conn, "play_events", "skipped", "INTEGER")
    _ensure_column(conn, "play_events", "isrc", "TEXT")

    _ensure_column(conn, "lyric_events", "profile_id", "INTEGER DEFAULT 1")
    _ensure_column(conn, "search_events", "profile_id", "INTEGER DEFAULT 1")
    _ensure_column(conn, "favorites", "profile_id", "INTEGER DEFAULT 1")

    # 2. Backfill NULLs on upgraded V1/V2/V3 rows
    conn.execute("UPDATE play_events SET profile_id = 1 WHERE profile_id IS NULL")
    conn.execute("UPDATE play_events SET incognito_mode = 0 WHERE incognito_mode IS NULL")
    conn.execute("UPDATE lyric_events SET profile_id = 1 WHERE profile_id IS NULL")
    conn.execute("UPDATE search_events SET profile_id = 1 WHERE profile_id IS NULL")
    conn.execute("UPDATE favorites SET profile_id = 1 WHERE profile_id IS NULL")

    # 3. Indexes on V4 additive columns (ONLY created after _ensure_column)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pe_profile_id ON play_events(profile_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pe_profile_epoch ON play_events(profile_id, started_epoch)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pe_isrc ON play_events(isrc) WHERE isrc IS NOT NULL"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pe_incognito ON play_events(incognito_mode)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_le_profile_id ON lyric_events(profile_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_se_profile_id ON search_events(profile_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_fav_profile_id ON favorites(profile_id)")

    # 4. Upgrade V3 unique partial indexes to be profile-scoped (prevents cross-profile IntegrityError)
    if "profile_id" not in _index_columns(conn, "idx_pe_provider_event_uniq"):
        conn.execute("DROP INDEX IF EXISTS idx_pe_provider_event_uniq")
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_provider_event_uniq
            ON play_events(profile_id, source_provider, source_event_id)
            WHERE source_event_id IS NOT NULL
            """
        )

    if "profile_id" not in _index_columns(conn, "idx_pe_dedup_fp_uniq"):
        conn.execute("DROP INDEX IF EXISTS idx_pe_dedup_fp_uniq")
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_dedup_fp_uniq
            ON play_events(profile_id, dedup_fingerprint)
            WHERE dedup_fingerprint IS NOT NULL
            """
        )

    # 5. Seed default Profile id=1 with UTC timestamps (preserving user's active profile across restarts)
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        """
        INSERT OR IGNORE INTO profiles (
            id, name, kind, merged_profile_ids_json, is_active, created_at, updated_at
        ) VALUES (1, 'Profil Principal', 'standard', '[]', 1, ?, ?)
        """,
        (now_utc, now_utc),
    )
    active_cnt = conn.execute("SELECT COUNT(*) FROM profiles WHERE is_active = 1").fetchone()[0]
    if active_cnt == 0:
        conn.execute(
            "UPDATE profiles SET is_active = 1 WHERE id = (SELECT MIN(id) FROM profiles)"
        )

    # 6. Backfill profile_sources for upgraded V3 DBs that already imported an Apple Music archive
    existing_sources = conn.execute(
        "SELECT COUNT(*) FROM profile_sources WHERE profile_id = 1"
    ).fetchone()[0]
    if existing_sources == 0:
        meta = conn.execute(
            "SELECT * FROM import_meta WHERE id = 1 AND COALESCE(total_play_events, 0) > 0"
        ).fetchone()
        if meta:
            conn.execute(
                """
                INSERT INTO profile_sources (
                    profile_id, source_provider, filename, file_sha256, imported_at,
                    events_count, unique_tracks, min_date, max_date, metadata_json
                ) VALUES (1, 'apple_rgpd_zip', ?, ?, ?, ?, ?, ?, ?, '{}')
                """,
                (
                    meta["zip_filename"],
                    meta["zip_sha256"],
                    meta["imported_at"] or now_utc,
                    int(meta["total_play_events"] or 0),
                    int(meta["unique_tracks"] or 0),
                    meta["min_date"],
                    meta["max_date"],
                ),
            )

    # 7. Seed V4 sync_providers_config rows
    for prov in ("web_scrobbler", "os_media", "extension_bridge"):
        default_enabled = 1 if prov == "web_scrobbler" else 0
        conn.execute(
            """
            INSERT OR IGNORE INTO sync_providers_config (provider, enabled, last_status)
            VALUES (?, ?, 'idle')
            """,
            (prov, default_enabled),
        )
```

Update `init_db()` (`db.py:510-519`):
```python
def init_db():
    with db_session() as conn:
        conn.executescript(SCHEMA_SQL)
        _run_v3_migrations(conn)
        _run_v4_migrations(conn)
        # Ensure FTS5 is populated if tracks_catalog already has rows
        tc_count = conn.execute("SELECT COUNT(*) FROM tracks_catalog").fetchone()[0]
        fts_count = conn.execute("SELECT COUNT(*) FROM tracks_fts").fetchone()[0]
        if tc_count > 0 and fts_count == 0:
            rebuild_fts_indexes(conn)
```

---

## 3. Global Multi-Platform & Multi-Profile Filters (`backend/app/filters.py`)

### 3.1 Caller Inventory Verified Across `backend/app/`
Grep confirmed **25 callers** of `build_where_clause()` across **8 modules**:
- `analytics/overview.py` (5), `analytics/chrono.py` (1), `analytics/persona.py` (1), `analytics/behavior.py` (1 + `_build_date_where`), `analytics/detail.py` (5), `analytics/galaxy.py` (1), `analytics/wrapped.py` (1), `analytics/v3_science.py` (10).
- **Zero callers pass `conn` to `build_where_clause()`.**
- **Decision:** Keep the exact signature `build_where_clause(f, *, include_skip_filter=True, pe_alias="pe", tc_alias="tc") -> tuple[str, list[Any]]` unchanged and resolve BOTH `standard` and `merged` profiles in **pure SQL** using SQLite 3.40.1's built-in `json_each()` + `json_valid()`!

### 3.2 Verified Pure-SQL Profile Clause & Query Plan
Verified live on system Python 3.11 / SQLite 3.40.1:

```sql
(
    COALESCE({alias}.profile_id, 1) IN (
        SELECT p.id FROM profiles p
        WHERE p.id = ? AND p.kind = 'standard'
        UNION
        SELECT CAST(je.value AS INTEGER)
        FROM profiles p,
             json_each(CASE WHEN json_valid(p.merged_profile_ids_json) THEN p.merged_profile_ids_json ELSE '[]' END) je
        WHERE p.id = ? AND p.kind = 'merged'
    )
    AND NOT EXISTS (
        SELECT 1 FROM profile_merged_exclusions pme
        WHERE pme.merged_profile_id = ? AND pme.play_event_id = {alias}.id
    )
)
```

**Verified Behavior on All 6 Edge Cases:**
1. `profile_id = None` (default): **No clause emitted** → 100% V1/V2/V3 identical SQL.
2. Standard profile (`id=1`, `kind='standard'`): Matches `COALESCE(pe.profile_id, 1) = 1`; `profile_merged_exclusions` probe returns empty instantly via PK index.
3. Merged profile (`id=3`, `kind='merged'`, `[1, 2]`): Matches profiles `1` and `2`, excluding every `play_event_id` present in `profile_merged_exclusions` for `merged_profile_id = 3`.
4. Empty merged profile (`kind='merged'`, `'[]'`): `UNION` returns empty set → `IN ()` is FALSE → returns **0 rows** cleanly (HTTP 200).
5. Corrupt JSON in `merged_profile_ids_json`: `CASE WHEN json_valid(...)` falls back to `'[]'` → returns **0 rows** cleanly (zero `OperationalError`).
6. Non-existent `profile_id` (e.g., `99999`, `0`, `-1`): Both `SELECT`s return 0 rows → returns **0 rows** cleanly (HTTP 200).

**Verified `EXPLAIN QUERY PLAN`:**
- `LIST SUBQUERY 2` materialized ONCE per query via `INTEGER PRIMARY KEY (rowid=?)`.
- `SEARCH pme USING COVERING INDEX sqlite_autoindex_profile_merged_exclusions_1 (merged_profile_id=? AND play_event_id=?)` — O(log N) covering PK index lookup.

### 3.3 Exact `source_provider` Alias & Platform Mapping

Define as single source of truth in `backend/app/filters.py` (reused by `profiles.py`, `behavior.py`, `overview.py`):

```python
SOURCE_PROVIDER_ALIASES: dict[str, tuple[str, ...]] = {
    "apple_music": ("apple_rgpd_zip", "apple_music", "musickit_web"),
    "apple": ("apple_rgpd_zip", "apple_music", "musickit_web"),
    "spotify": ("spotify_extended", "spotify_account", "spotify_rgpd", "spotify_web", "spotify"),
    "youtube_music": ("youtube_takeout", "youtube_music", "youtube_iframe", "youtube_web"),
    "youtube": ("youtube_takeout", "youtube_music", "youtube_iframe", "youtube_web"),
    "deezer": ("deezer_rgpd", "deezer"),
    "tidal": ("tidal_csv", "tidal_rgpd", "tidal"),
    "live": (
        "local_smtc",
        "os_media",
        "web_scrobbler",
        "extension_bridge",
        "local_receiver",
        "listenbrainz",
        "lastfm",
        "youtube_iframe",
        "preview_audio",
    ),
}

PROVIDER_TO_PLATFORM: dict[str, str] = {
    "apple_rgpd_zip": "apple_music",
    "apple_music": "apple_music",
    "musickit_web": "apple_music",
    "spotify_extended": "spotify",
    "spotify_account": "spotify",
    "spotify_rgpd": "spotify",
    "spotify_web": "spotify",
    "spotify": "spotify",
    "youtube_takeout": "youtube_music",
    "youtube_music": "youtube_music",
    "youtube_iframe": "youtube_music",
    "youtube_web": "youtube_music",
    "deezer_rgpd": "deezer",
    "deezer": "deezer",
    "tidal_csv": "tidal",
    "tidal_rgpd": "tidal",
    "tidal": "tidal",
    "local_smtc": "os_media",
    "os_media": "os_media",
    "web_scrobbler": "web_scrobbler",
    "extension_bridge": "extension_bridge",
    "local_receiver": "listenbrainz",
    "listenbrainz": "listenbrainz",
    "lastfm": "lastfm",
    "preview_audio": "preview_audio",
}


def canonical_platform_for(source_provider: str | None) -> str:
    raw = (source_provider or "apple_rgpd_zip").strip().lower()
    return PROVIDER_TO_PLATFORM.get(raw, raw or "apple_music")


def expand_source_providers(raw: str | None) -> list[str]:
    """Expand alias(es) or comma-separated raw provider tokens into exact SQL values.

    Returns [] when unfiltered (None, '', or 'all').
    """
    if not raw:
        return []
    tokens = [t.strip().lower() for t in raw.split(",") if t.strip()]
    if not tokens or "all" in tokens:
        return []
    expanded: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        values = SOURCE_PROVIDER_ALIASES.get(tok, (tok,))
        for v in values:
            if v not in seen:
                seen.add(v)
                expanded.append(v)
    return expanded
```

**Mapping Examples:**
- `source_provider=None` / `""` / `"all"` → `[]` (no filter)
- `source_provider="spotify"` → `["spotify_extended", "spotify_account", "spotify_rgpd", "spotify_web", "spotify"]`
- `source_provider="spotify_extended"` → `["spotify_extended"]` (exact raw match preserved!)
- `source_provider="apple_music,deezer"` → `["apple_rgpd_zip", "apple_music", "musickit_web", "deezer_rgpd", "deezer"]`
- `source_provider="unknown_foo"` → `["unknown_foo"]` (SQL returns 0 rows cleanly, HTTP 200)

### 3.4 Exact Additions to `FilterParams`, `get_filter_params`, `build_profile_id_clause`, and `build_where_clause`

1. **`FilterParams` fields (append after `offline: str | None = None`):**
   ```python
   # V4 Multi-platform & Multi-profile filters
   source_provider: str | None = None  # alias (apple_music, spotify, ...) or raw or comma-separated
   profile_id: int | None = None  # standard or merged profile id (None = legacy all-events)
   exclude_incognito: bool = False  # True excludes Spotify incognito_mode = 1 plays
   ```

2. **`get_filter_params(...)` parameters (append after `offline: str | None = Query(None)`):**
   ```python
   source_provider: str | None = Query(None),
   profile_id: int | None = Query(None),
   exclude_incognito: bool = Query(False),
   ```
   Pass `source_provider=source_provider or None`, `profile_id=profile_id`, `exclude_incognito=bool(exclude_incognito)` into `FilterParams(...)`.
   *(Note: omitting `ge=1` on `profile_id` matches `year`/`decade` style and ensures Schemathesis/edge inputs like `0` or `-1` return HTTP 200 empty datasets instead of 422.)*

3. **Reusable `build_profile_id_clause()` helper (used by `build_where_clause`, `behavior.py`, `overview.py`, `profiles.py`):**
   ```python
   def build_profile_id_clause(
       profile_id: int | None,
       alias: str = "pe",
       *,
       include_exclusions: bool = True,
   ) -> tuple[str | None, list[Any]]:
       """Return pure-SQL clause + params scoping a table to a standard or merged profile."""
       if profile_id is None:
           return None, []
       membership_sql = (
           f"COALESCE({alias}.profile_id, 1) IN ("
           "SELECT p.id FROM profiles p WHERE p.id = ? AND p.kind = 'standard' "
           "UNION "
           "SELECT CAST(je.value AS INTEGER) FROM profiles p, "
           "json_each(CASE WHEN json_valid(p.merged_profile_ids_json) THEN p.merged_profile_ids_json ELSE '[]' END) je "
           "WHERE p.id = ? AND p.kind = 'merged'"
           ")"
       )
       if not include_exclusions:
           return membership_sql, [profile_id, profile_id]
       full_sql = (
           f"({membership_sql} AND NOT EXISTS ("
           f"SELECT 1 FROM profile_merged_exclusions pme "
           f"WHERE pme.merged_profile_id = ? AND pme.play_event_id = {alias}.id"
           "))"
       )
       return full_sql, [profile_id, profile_id, profile_id]
   ```

4. **Append to `build_where_clause()` (right before `return " AND ".join(clauses), params`):**
   ```python
   # V4 Multi-platform source_provider filter
   providers = expand_source_providers(f.source_provider)
   if providers:
       placeholders = ", ".join("?" for _ in providers)
       clauses.append(f"COALESCE({pe_alias}.source_provider, 'apple_rgpd_zip') IN ({placeholders})")
       params.extend(providers)

   # V4 Multi-profile (standard + merged with dedup exclusions)
   prof_clause, prof_params = build_profile_id_clause(
       f.profile_id, pe_alias, include_exclusions=True
   )
   if prof_clause:
       clauses.append(prof_clause)
       params.extend(prof_params)

   # V4 Spotify incognito filter
   if f.exclude_incognito:
       clauses.append(f"COALESCE({pe_alias}.incognito_mode, 0) = 0")
   ```

---

## 4. Downstream Analytics Integration Touchpoints (Within M1 Ownership)

1. **`backend/app/analytics/behavior.py` (`_build_date_where`, lines 321–337):**
   - Import `build_profile_id_clause, expand_source_providers` from `..filters`.
   - Append `profile_id` filter with `include_exclusions=False` so `lyric_events` (`le`) and `search_events` (`se`) respect both standard and merged profiles without leaking across profiles.
   - If `providers := expand_source_providers(f.source_provider)` is non-empty and neither `"apple_rgpd_zip"` nor `"apple_music"` is in `providers`, append `"1=0"` so Spotify/YTM/Deezer/TIDAL filters return 0 Apple Music lyrics/searches.
2. **`backend/app/analytics/overview.py` (`get_filter_options`, lines 8–80):**
   - Accept optional `profile_id: int | None = None` (default `None` preserves existing `main.py:335` call `get_filter_options()`).
   - Scope `play_events` queries via `build_profile_id_clause(profile_id, "pe", include_exclusions=True)` when provided.
   - Return additive `"providers"` key (list of distinct `source_provider` values / canonical platforms present) alongside all existing keys (`meta`, `years`, `months`, `seasons`, `genres`, `decades`, `artists`, `containers`, `features`, `devices`).
3. **`backend/app/analytics/duckdb_engine.py` (`PARQUET_SCHEMA`, lines 34–71, and `export_parquet_snapshot`, lines 81–120):**
   - Add `("profile_id", pa.int64())` and `("incognito_mode", pa.int8())` to `PARQUET_SCHEMA`.
   - Select `COALESCE(pe.profile_id, 1) AS profile_id` and `COALESCE(pe.incognito_mode, 0) AS incognito_mode` in `export_parquet_snapshot()`.

---

## 5. Verification Steps for M1 Implementer & Tester

1. **Bootstrap & Existing Regression Gate:**
   - Run `uv venv` + `uv pip install` commands from §1.3.
   - Run `backend/.venv/bin/pytest backend/tests/test_properties.py backend/tests/test_openapi_fuzz.py -v` → **100% PASS** (confirming `version == "3.0.0"` untouched, `SCHEMA_SQL` + `_run_v3_migrations` untouched, zero 5xx on all 20 V3 endpoints).
2. **DB Migration Idempotency Tests (in `backend/tests/test_profiles_v4.py`):**
   - **Fresh DB:** Run `init_db()` twice → verify all 7 V4 tables exist, all additive columns exist, Profile `id=1` exists with `is_active=1` and UTC ISO-8601 timestamps, `sync_providers_config` has `web_scrobbler`, `os_media`, `extension_bridge`.
   - **Active profile preservation across restart:** Activate Profile `id=2`, run `_run_v4_migrations(conn)` again → verify Profile `id=2` remains active (NOT reset to `id=1`).
   - **V3-to-V4 Upgrade Simulation:** Create a temp SQLite DB with V3-only `play_events`/`lyric_events`/`search_events`/`favorites` (WITHOUT `profile_id`, `incognito_mode`, `reason_start`, `skipped`, `isrc`, and WITH old V3 global unique indexes + 1 row in `play_events` and `import_meta`), then run `SCHEMA_SQL` + `_run_v3_migrations(conn)` + `_run_v4_migrations(conn)` → verify ZERO `OperationalError: no such column`, existing row gets `profile_id = 1`, `profile_sources` backfilled from `import_meta`, and inserting the same `(source_provider, source_event_id)` into `profile_id = 2` succeeds without `IntegrityError`!
3. **Global Filter Matrix Tests (in `backend/tests/test_profiles_v4.py`):**
   - Verify `FilterParams()` default (`profile_id=None`, `source_provider=None`, `exclude_incognito=False`) matches all plays across profiles (V1/V2/V3 parity).
   - Verify `source_provider` aliases (`"apple_music"`, `"spotify"`, `"youtube_music"`, `"deezer"`, `"tidal"`, `"apple_music,spotify"`, `"all"`, raw `"spotify_extended"`, unknown `"nonexistent"`).
   - Verify `profile_id` for: standard profile `1`, standard profile `2`, merged profile `[1, 2]` with `profile_merged_exclusions`, empty merged profile `[]`, corrupt JSON merged profile, and non-existent profile `99999`.
   - Verify `exclude_incognito=True` filters out `incognito_mode = 1` plays while `exclude_incognito=False` includes them.
   - Verify `behavior.py` `_build_date_where` isolates `lyric_events` & `search_events` by `profile_id` and `source_provider`.
