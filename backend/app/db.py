import sqlite3
from pathlib import Path
from contextlib import contextmanager

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "amdatawrap.sqlite"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
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
    enriched_at TEXT
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
"""


def init_db():
    with db_session() as conn:
        conn.executescript(SCHEMA_SQL)
