import sqlite3
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import AsyncIterator

import aiosqlite

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "amdatawrap.sqlite"
PARQUET_SNAPSHOT_PATH = DATA_DIR / "analytics_snapshot.parquet"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA cache_size=-64000;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    return conn


@contextmanager
def db_session():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@asynccontextmanager
async def async_db_session() -> AsyncIterator[aiosqlite.Connection]:
    """Async SQLite WAL session (Phase 0) preventing event-loop blocking during live syncs."""
    conn = await aiosqlite.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = aiosqlite.Row
    try:
        await conn.execute("PRAGMA journal_mode=WAL;")
        await conn.execute("PRAGMA synchronous=NORMAL;")
        await conn.execute("PRAGMA busy_timeout=30000;")
        await conn.execute("PRAGMA cache_size=-64000;")
        await conn.execute("PRAGMA temp_store=MEMORY;")
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
    finally:
        await conn.close()


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS import_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    zip_filename TEXT,
    zip_sha256 TEXT,
    imported_at TEXT,
    total_raw_rows INTEGER DEFAULT 0,
    total_play_events INTEGER DEFAULT 0,
    total_lyric_events INTEGER DEFAULT 0,
    total_search_events INTEGER DEFAULT 0,
    unique_tracks INTEGER DEFAULT 0,
    pass1_artist_pct REAL DEFAULT 0.0,
    pass1_genre_year_pct REAL DEFAULT 0.0,
    min_date TEXT,
    max_date TEXT
);

CREATE TABLE IF NOT EXISTS tracks_catalog (
    track_key TEXT PRIMARY KEY,
    song_name TEXT NOT NULL,
    song_norm TEXT NOT NULL,
    song_group_key TEXT NOT NULL,
    album_name TEXT NOT NULL,
    album_norm TEXT NOT NULL,
    album_group_key TEXT NOT NULL,
    artist_name TEXT,
    artist_norm TEXT,
    artist_group_key TEXT,
    itunes_track_id TEXT,
    genre TEXT,
    release_year INTEGER,
    release_date TEXT,
    artwork_url TEXT,
    preview_url TEXT,
    total_plays INTEGER DEFAULT 0,
    total_ms INTEGER DEFAULT 0,
    first_played_local TEXT,
    enrichment_status TEXT DEFAULT 'local_only',
    enrichment_source TEXT,
    enriched_at TEXT,
    duration_ms INTEGER DEFAULT 0,
    mbid_recording TEXT,
    mbid_artist TEXT,
    mbid_release_group TEXT,
    back_cover_url TEXT
);

CREATE TABLE IF NOT EXISTS play_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT,
    track_key TEXT NOT NULL,
    started_at_utc TEXT NOT NULL,
    started_at_local TEXT NOT NULL,
    started_epoch INTEGER NOT NULL,
    local_date TEXT NOT NULL,
    local_year INTEGER NOT NULL,
    local_month TEXT NOT NULL,
    local_month_num INTEGER NOT NULL,
    local_season TEXT NOT NULL,
    local_dow INTEGER NOT NULL,
    local_hour INTEGER NOT NULL,
    utc_offset_sec INTEGER DEFAULT 3600,
    play_duration_ms INTEGER NOT NULL,
    media_duration_ms INTEGER NOT NULL,
    completion_ratio REAL NOT NULL,
    end_reason_type TEXT,
    is_valid_lastfm INTEGER NOT NULL,
    is_skip_30s INTEGER NOT NULL,
    container_type TEXT,
    container_origin_type TEXT,
    playlist_name TEXT,
    feature_name TEXT,
    device_label TEXT,
    device_os TEXT,
    source_type TEXT,
    offline INTEGER DEFAULT 0,
    auto_play TEXT,
    shuffle_play TEXT,
    repeat_play TEXT,
    audio_quality TEXT,
    playback_format TEXT,
    session_id INTEGER NOT NULL,
    source_provider TEXT DEFAULT 'apple_rgpd_zip',
    source_priority INTEGER DEFAULT 100,
    source_event_id TEXT,
    canonical_track_key TEXT,
    duration_is_estimated INTEGER DEFAULT 0,
    dedup_fingerprint TEXT,
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS lyric_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_key TEXT NOT NULL,
    started_at_utc TEXT NOT NULL,
    started_at_local TEXT NOT NULL,
    local_date TEXT NOT NULL,
    local_year INTEGER NOT NULL,
    local_month TEXT NOT NULL,
    display_type TEXT,
    display_language TEXT,
    translation_displayed INTEGER DEFAULT 0,
    pronunciation_displayed INTEGER DEFAULT 0,
    device_label TEXT,
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS search_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    query_norm TEXT NOT NULL,
    searched_at_utc TEXT NOT NULL,
    searched_at_local TEXT NOT NULL,
    local_date TEXT NOT NULL,
    local_year INTEGER NOT NULL,
    local_month TEXT NOT NULL,
    device_os TEXT
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    favorite_type TEXT,
    item_reference TEXT,
    item_description TEXT,
    last_modified TEXT,
    preference TEXT
);

CREATE TABLE IF NOT EXISTS enrichment_cache (
    cache_key TEXT PRIMARY KEY,
    artist_name TEXT,
    album_name TEXT,
    genre TEXT,
    release_year INTEGER,
    release_date TEXT,
    artwork_url TEXT,
    preview_url TEXT,
    itunes_track_id TEXT,
    source TEXT,
    status TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS external_cache (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ===========================================================================
-- V3 Continuum Tables (Phase 0, 1, 2, 3, 4)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS sync_providers_config (
    provider TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    username TEXT,
    token TEXT,
    api_key TEXT,
    extra_json TEXT DEFAULT '{}',
    last_sync_at TEXT,
    last_cursor_ts INTEGER DEFAULT 0,
    last_status TEXT DEFAULT 'idle',
    last_error TEXT,
    total_synced INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS now_playing_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT,
    song_name TEXT,
    artist_name TEXT,
    album_name TEXT,
    artwork_url TEXT,
    started_at_utc TEXT,
    duration_ms INTEGER DEFAULT 0,
    position_ms INTEGER DEFAULT 0,
    is_playing INTEGER DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    target_key TEXT NOT NULL,
    payload_json TEXT DEFAULT '{}',
    priority INTEGER DEFAULT 50,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    next_run_at REAL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(job_type, target_key)
);

CREATE TABLE IF NOT EXISTS track_audio_dna (
    track_key TEXT PRIMARY KEY,
    bpm REAL,
    musical_key TEXT,
    musical_mode TEXT,
    camelot_code TEXT,
    key_confidence REAL DEFAULT 0.0,
    energy REAL,
    danceability REAL,
    loudness_db REAL,
    valence_audio REAL,
    dynamic_complexity REAL,
    spectral_centroid REAL,
    chroma_json TEXT,
    mfcc_json TEXT,
    source TEXT DEFAULT 'estimated',
    analyzed_at TEXT NOT NULL,
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS track_lyrics_sentiment (
    track_key TEXT PRIMARY KEY,
    valence REAL NOT NULL,
    arousal_text REAL NOT NULL,
    polarity_label TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    lang TEXT DEFAULT 'unknown',
    excerpt TEXT,
    model_source TEXT DEFAULT 'lexicon_fr_en',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (track_key) REFERENCES tracks_catalog(track_key)
);

CREATE TABLE IF NOT EXISTS artist_musicbrainz (
    artist_group_key TEXT PRIMARY KEY,
    artist_name TEXT NOT NULL,
    mbid TEXT,
    country_iso TEXT,
    country_name TEXT,
    area_name TEXT,
    begin_area TEXT,
    lat REAL,
    lng REAL,
    artist_type TEXT,
    active_begin TEXT,
    active_end TEXT,
    wikidata_id TEXT,
    lb_listen_count INTEGER,
    lb_user_count INTEGER,
    obscurity_score REAL,
    related_artists_json TEXT DEFAULT '[]',
    discogs_styles_json TEXT DEFAULT '[]',
    source TEXT DEFAULT 'pending',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist_setlists (
    artist_group_key TEXT PRIMARY KEY,
    mbid TEXT,
    setlists_json TEXT DEFAULT '[]',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists_saved (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT,
    tracks_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- ===========================================================================
-- SQLite FTS5 Virtual Tables (Phase 0: unicode61 accent-insensitive + trigram)
-- ===========================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
    track_key UNINDEXED,
    song_name,
    artist_name,
    album_name,
    genre,
    tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts_trigram USING fts5(
    track_key UNINDEXED,
    song_name,
    artist_name,
    album_name,
    tokenize='trigram'
);

CREATE VIRTUAL TABLE IF NOT EXISTS lyrics_fts USING fts5(
    track_key UNINDEXED,
    song_name,
    artist_name,
    lyrics_text,
    tokenize='unicode61 remove_diacritics 2'
);

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_pe_started_local ON play_events(started_at_local);
CREATE INDEX IF NOT EXISTS idx_pe_local_date ON play_events(local_date);
CREATE INDEX IF NOT EXISTS idx_pe_local_year ON play_events(local_year);
CREATE INDEX IF NOT EXISTS idx_pe_local_month ON play_events(local_month);
CREATE INDEX IF NOT EXISTS idx_pe_track_key ON play_events(track_key);
CREATE INDEX IF NOT EXISTS idx_pe_session_id ON play_events(session_id);
CREATE INDEX IF NOT EXISTS idx_pe_device ON play_events(device_label);
CREATE INDEX IF NOT EXISTS idx_pe_container ON play_events(container_type);
CREATE INDEX IF NOT EXISTS idx_pe_offline ON play_events(offline);
CREATE INDEX IF NOT EXISTS idx_pe_lastfm ON play_events(is_valid_lastfm);
CREATE INDEX IF NOT EXISTS idx_pe_epoch ON play_events(started_epoch);

CREATE INDEX IF NOT EXISTS idx_tc_artist_group ON tracks_catalog(artist_group_key);
CREATE INDEX IF NOT EXISTS idx_tc_album_group ON tracks_catalog(album_group_key);
CREATE INDEX IF NOT EXISTS idx_tc_genre ON tracks_catalog(genre);
CREATE INDEX IF NOT EXISTS idx_tc_release_year ON tracks_catalog(release_year);
CREATE INDEX IF NOT EXISTS idx_tc_enrichment ON tracks_catalog(enrichment_status, total_plays DESC);

CREATE INDEX IF NOT EXISTS idx_le_track ON lyric_events(track_key);
CREATE INDEX IF NOT EXISTS idx_le_date ON lyric_events(local_date);

CREATE INDEX IF NOT EXISTS idx_se_date ON search_events(local_date);
CREATE INDEX IF NOT EXISTS idx_se_norm ON search_events(query_norm);

CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON background_jobs(status, priority DESC, next_run_at ASC);
"""


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, col_def: str):
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")


def _run_v3_migrations(conn: sqlite3.Connection):
    """Non-breaking additive migrations for existing V1/V2 SQLite databases."""
    # play_events Continuum columns
    _ensure_column(conn, "play_events", "source_provider", "TEXT DEFAULT 'apple_rgpd_zip'")
    _ensure_column(conn, "play_events", "source_priority", "INTEGER DEFAULT 100")
    _ensure_column(conn, "play_events", "source_event_id", "TEXT")
    _ensure_column(conn, "play_events", "canonical_track_key", "TEXT")
    _ensure_column(conn, "play_events", "duration_is_estimated", "INTEGER DEFAULT 0")
    _ensure_column(conn, "play_events", "dedup_fingerprint", "TEXT")

    # tracks_catalog V3 metadata columns
    _ensure_column(conn, "tracks_catalog", "duration_ms", "INTEGER DEFAULT 0")
    _ensure_column(conn, "tracks_catalog", "mbid_recording", "TEXT")
    _ensure_column(conn, "tracks_catalog", "mbid_artist", "TEXT")
    _ensure_column(conn, "tracks_catalog", "mbid_release_group", "TEXT")
    _ensure_column(conn, "tracks_catalog", "back_cover_url", "TEXT")

    # Continuum indexes (after ensuring columns exist)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pe_source_provider ON play_events(source_provider)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pe_canonical_epoch ON play_events(canonical_track_key, started_epoch)"
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_provider_event_uniq
        ON play_events(source_provider, source_event_id)
        WHERE source_event_id IS NOT NULL
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_dedup_fp_uniq
        ON play_events(dedup_fingerprint)
        WHERE dedup_fingerprint IS NOT NULL
        """
    )

    # Seed default sync_providers_config rows
    for prov in ("listenbrainz", "lastfm", "local_smtc", "local_receiver", "discogs", "setlistfm"):
        default_enabled = 1 if prov == "local_receiver" else 0
        conn.execute(
            """
            INSERT OR IGNORE INTO sync_providers_config (provider, enabled, last_status)
            VALUES (?, ?, 'idle')
            """,
            (prov, default_enabled),
        )


def rebuild_fts_indexes(conn: sqlite3.Connection):
    """Synchronize unicode61 + trigram FTS5 indexes with tracks_catalog."""
    conn.execute("DELETE FROM tracks_fts")
    conn.execute("DELETE FROM tracks_fts_trigram")
    conn.execute(
        """
        INSERT INTO tracks_fts (track_key, song_name, artist_name, album_name, genre)
        SELECT
            track_key,
            COALESCE(song_name, ''),
            COALESCE(artist_name, ''),
            COALESCE(album_name, ''),
            COALESCE(genre, '')
        FROM tracks_catalog
        """
    )
    conn.execute(
        """
        INSERT INTO tracks_fts_trigram (track_key, song_name, artist_name, album_name)
        SELECT
            track_key,
            COALESCE(song_name, ''),
            COALESCE(artist_name, ''),
            COALESCE(album_name, '')
        FROM tracks_catalog
        """
    )


def upsert_track_fts(conn: sqlite3.Connection, track_key: str):
    row = conn.execute(
        """
        SELECT track_key, COALESCE(song_name,'') AS s, COALESCE(artist_name,'') AS a,
               COALESCE(album_name,'') AS al, COALESCE(genre,'') AS g
        FROM tracks_catalog WHERE track_key = ?
        """,
        (track_key,),
    ).fetchone()
    if not row:
        return
    conn.execute("DELETE FROM tracks_fts WHERE track_key = ?", (track_key,))
    conn.execute("DELETE FROM tracks_fts_trigram WHERE track_key = ?", (track_key,))
    conn.execute(
        "INSERT INTO tracks_fts (track_key, song_name, artist_name, album_name, genre) VALUES (?, ?, ?, ?, ?)",
        (row["track_key"], row["s"], row["a"], row["al"], row["g"]),
    )
    conn.execute(
        "INSERT INTO tracks_fts_trigram (track_key, song_name, artist_name, album_name) VALUES (?, ?, ?, ?)",
        (row["track_key"], row["s"], row["a"], row["al"]),
    )


def upsert_lyrics_fts(
    conn: sqlite3.Connection,
    track_key: str,
    song_name: str,
    artist_name: str,
    lyrics_text: str,
):
    conn.execute("DELETE FROM lyrics_fts WHERE track_key = ?", (track_key,))
    if lyrics_text:
        conn.execute(
            "INSERT INTO lyrics_fts (track_key, song_name, artist_name, lyrics_text) VALUES (?, ?, ?, ?)",
            (track_key, song_name or "", artist_name or "", lyrics_text),
        )


def init_db():
    with db_session() as conn:
        conn.executescript(SCHEMA_SQL)
        _run_v3_migrations(conn)
        # Ensure FTS5 is populated if tracks_catalog already has rows
        tc_count = conn.execute("SELECT COUNT(*) FROM tracks_catalog").fetchone()[0]
        fts_count = conn.execute("SELECT COUNT(*) FROM tracks_fts").fetchone()[0]
        if tc_count > 0 and fts_count == 0:
            rebuild_fts_indexes(conn)
