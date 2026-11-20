"""M1 Comprehensive Unit & Hypothesis Property Tests for AMDataWrap V4 Foundation.

Covers:
1. Fresh & V3-upgraded idempotent SQLite migrations (`db.py`: 7 V4 tables, additive columns,
   profile-scoped unique indexes, default profile seed, active profile preservation across restarts).
2. Global V4 filters (`filters.py`: `source_provider` aliases/raw/comma/all/unknown,
   `profile_id` standard/merged/empty/corrupt/missing, `exclude_incognito`).
3. Multi-profile CRUD, validation, activation & deletion (`/api/v4/profiles*`).
4. Cross-platform fusion deduplication (`recompute_merged_exclusions`: ISRC N-to-M,
   `canonical_key_for`, `similarity >= 0.85`, exact ±180s boundary, 4-level winner tie-breaker,
   transitive chains, same-profile repeat preservation, M2A helpers).
5. Dynamic Capabilities Matrix (`GET /api/v4/profile/capabilities`) across all 5 platforms,
   merged profiles, `source_provider` filters, and empty profiles.
6. Downstream analytics & DuckDB Parquet integration (`overview.py`, `behavior.py`, `duckdb_engine.py`).
7. Hypothesis property-based invariants for fusion deduplication and capabilities bounds.
"""

from __future__ import annotations

import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from backend.app import db as db_mod
from backend.app.analytics import behavior as behavior_mod
from backend.app.analytics import duckdb_engine
from backend.app.analytics import overview as overview_mod
from backend.app.continuum.reconciler import canonical_key_for
from backend.app.filters import (
    FilterParams,
    build_where_clause,
    canonical_platform_for,
    expand_source_providers,
)
from backend.app.normalize import clean_group_key, make_track_key, normalize_basic
from backend.app.profiles import (
    get_or_create_standard_profile,
    get_profile_capabilities,
    profiles_router,
    recompute_merged_exclusions,
    record_profile_source,
    refresh_all_merged_profiles_containing,
)
from backend.app.schemas import ErrorResponse


def _build_v4_test_app() -> FastAPI:
    app = FastAPI(title="AMDataWrap V4 Profiles Test")

    @app.exception_handler(HTTPException)
    async def http_exc_handler(_request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                code=f"HTTP_{exc.status_code}",
                message=str(exc.detail),
                detail=exc.detail,
            ).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exc_handler(_request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(
                code="VALIDATION_ERROR",
                message="Paramètres de requête invalides.",
                detail=exc.errors(),
            ).model_dump(),
        )

    app.include_router(profiles_router)
    return app


def _insert_play(
    conn: sqlite3.Connection,
    *,
    profile_id: int = 1,
    provider: str = "apple_rgpd_zip",
    song: str = "One More Time",
    artist: str = "Daft Punk",
    album: str = "Discovery",
    genre: str = "Electronic",
    release_year: int = 2001,
    started_epoch: int = 1760000000,
    play_ms: int = 210_000,
    media_ms: int = 320_000,
    duration_is_estimated: int = 0,
    source_priority: int | None = None,
    end_reason_type: str | None = "NATURAL_END_OF_TRACK",
    device_label: str | None = None,
    audio_quality: str | None = None,
    shuffle_play: str | None = None,
    incognito_mode: int = 0,
    skipped: int | None = None,
    is_skip_30s: int = 0,
    is_valid_lastfm: int = 1,
    isrc: str | None = None,
    recording_isrc: str | None = None,
    source_event_id: str | None = None,
    dedup_fingerprint: str | None = None,
) -> int:
    track_key = make_track_key(song, album)
    conn.execute(
        """
        INSERT OR IGNORE INTO tracks_catalog (
            track_key, song_name, song_norm, song_group_key,
            album_name, album_norm, album_group_key,
            artist_name, artist_norm, artist_group_key,
            genre, release_year, total_plays, total_ms, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            track_key,
            song,
            normalize_basic(song),
            clean_group_key(song),
            album,
            normalize_basic(album),
            clean_group_key(album),
            artist,
            normalize_basic(artist),
            clean_group_key(artist, strip_feat=True),
            genre,
            release_year,
            play_ms,
            media_ms,
        ),
    )
    if recording_isrc:
        conn.execute(
            "INSERT OR IGNORE INTO recording_isrcs (track_key, isrc, source) VALUES (?, ?, 'test')",
            (track_key, recording_isrc),
        )
    dt = datetime.fromtimestamp(started_epoch, tz=timezone.utc)
    iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    local_date = dt.strftime("%Y-%m-%d")
    local_month = dt.strftime("%Y-%m")
    ratio = round(play_ms / media_ms, 4) if media_ms > 0 else 1.0
    cur = conn.execute(
        """
        INSERT INTO play_events (
            track_key, started_at_utc, started_at_local, started_epoch,
            local_date, local_year, local_month, local_month_num, local_season,
            local_dow, local_hour, play_duration_ms, media_duration_ms,
            completion_ratio, end_reason_type, is_valid_lastfm, is_skip_30s,
            device_label, shuffle_play, audio_quality, session_id,
            source_provider, source_priority, source_event_id, canonical_track_key,
            duration_is_estimated, dedup_fingerprint,
            profile_id, incognito_mode, skipped, isrc
        ) VALUES (
            ?, ?, ?, ?,
            ?, ?, ?, ?, 'Automne',
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, 1,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?
        )
        """,
        (
            track_key,
            iso,
            iso,
            started_epoch,
            local_date,
            dt.year,
            local_month,
            dt.month,
            dt.weekday(),
            dt.hour,
            play_ms,
            media_ms,
            ratio,
            end_reason_type,
            is_valid_lastfm,
            is_skip_30s,
            device_label,
            shuffle_play,
            audio_quality,
            provider,
            source_priority,
            source_event_id,
            canonical_key_for(song, artist),
            duration_is_estimated,
            dedup_fingerprint,
            profile_id,
            incognito_mode,
            skipped,
            isrc,
        ),
    )
    return int(cur.lastrowid)


@pytest.fixture()
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_v4.sqlite"
    parquet_file = tmp_path / "analytics_snapshot.parquet"
    monkeypatch.setattr(db_mod, "DB_PATH", db_file)
    monkeypatch.setattr(db_mod, "PARQUET_SNAPSHOT_PATH", parquet_file)
    db_mod.init_db()
    client = TestClient(_build_v4_test_app())
    return {
        "db_path": db_file,
        "parquet_path": parquet_file,
        "client": client,
    }


# ---------------------------------------------------------------------------
# 1. Database Schema & V3->V4 Upgrade Migrations
# ---------------------------------------------------------------------------


def test_v4_fresh_init_idempotent(isolated_db):
    # Running init_db() twice must remain 100% idempotent
    db_mod.init_db()
    with db_mod.db_session() as conn:
        tables = {
            r["name"]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        for required in (
            "profiles",
            "profile_sources",
            "profile_merged_exclusions",
            "recording_isrcs",
            "platform_track_mappings",
            "vinyl_editions",
            "api_metadata_cache",
        ):
            assert required in tables

        pe_cols = {
            r["name"] for r in conn.execute("PRAGMA table_info(play_events)").fetchall()
        }
        for col in ("profile_id", "incognito_mode", "reason_start", "skipped", "isrc"):
            assert col in pe_cols
        for tbl in ("lyric_events", "search_events", "favorites"):
            cols = {
                r["name"] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()
            }
            assert "profile_id" in cols

        prof = conn.execute("SELECT * FROM profiles WHERE id = 1").fetchone()
        assert prof is not None
        assert prof["name"] == "Profil Principal"
        assert prof["kind"] == "standard"
        assert prof["is_active"] == 1
        assert prof["created_at"].endswith("Z")
        assert prof["updated_at"].endswith("Z")

        sync_provs = {
            r["provider"]: r["enabled"]
            for r in conn.execute("SELECT provider, enabled FROM sync_providers_config").fetchall()
        }
        assert sync_provs["web_scrobbler"] == 1
        assert sync_provs["os_media"] == 0
        assert sync_provs["extension_bridge"] == 0


def test_v4_migration_preserves_active_profile_across_restart(isolated_db):
    client: TestClient = isolated_db["client"]
    resp = client.post("/api/v4/profiles", json={"name": "Mon Spotify", "kind": "standard"})
    assert resp.status_code == 201
    p2_id = resp.json()["id"]
    act = client.post(f"/api/v4/profiles/{p2_id}/activate")
    assert act.status_code == 200

    # Simulate backend restart invoking init_db() / _run_v4_migrations()
    db_mod.init_db()
    with db_mod.db_session() as conn:
        active = conn.execute("SELECT id FROM profiles WHERE is_active = 1").fetchall()
        assert [r["id"] for r in active] == [p2_id]


def test_v3_to_v4_upgrade_and_cross_profile_unique_indexes(tmp_path: Path):
    """Simulate upgrading a pre-existing V3 SQLite DB that lacks V4 columns & tables."""
    v3_db = tmp_path / "legacy_v3.sqlite"
    conn = sqlite3.connect(str(v3_db))
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE import_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            zip_filename TEXT, zip_sha256 TEXT, imported_at TEXT,
            total_raw_rows INTEGER DEFAULT 0, total_play_events INTEGER DEFAULT 0,
            total_lyric_events INTEGER DEFAULT 0, total_search_events INTEGER DEFAULT 0,
            unique_tracks INTEGER DEFAULT 0, pass1_artist_pct REAL DEFAULT 0.0,
            pass1_genre_year_pct REAL DEFAULT 0.0, min_date TEXT, max_date TEXT
        );
        CREATE TABLE tracks_catalog (
            track_key TEXT PRIMARY KEY, song_name TEXT NOT NULL, song_norm TEXT NOT NULL,
            song_group_key TEXT NOT NULL, album_name TEXT NOT NULL, album_norm TEXT NOT NULL,
            album_group_key TEXT NOT NULL, artist_name TEXT, artist_norm TEXT,
            artist_group_key TEXT, itunes_track_id TEXT, genre TEXT, release_year INTEGER,
            release_date TEXT, artwork_url TEXT, preview_url TEXT, total_plays INTEGER DEFAULT 0,
            total_ms INTEGER DEFAULT 0, first_played_local TEXT,
            enrichment_status TEXT DEFAULT 'local_only', enrichment_source TEXT, enriched_at TEXT
        );
        CREATE TABLE play_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, track_key TEXT NOT NULL,
            started_at_utc TEXT NOT NULL, started_at_local TEXT NOT NULL, started_epoch INTEGER NOT NULL,
            local_date TEXT NOT NULL, local_year INTEGER NOT NULL, local_month TEXT NOT NULL,
            local_month_num INTEGER NOT NULL, local_season TEXT NOT NULL, local_dow INTEGER NOT NULL,
            local_hour INTEGER NOT NULL, utc_offset_sec INTEGER DEFAULT 3600,
            play_duration_ms INTEGER NOT NULL, media_duration_ms INTEGER NOT NULL,
            completion_ratio REAL NOT NULL, end_reason_type TEXT, is_valid_lastfm INTEGER NOT NULL,
            is_skip_30s INTEGER NOT NULL, container_type TEXT, container_origin_type TEXT,
            playlist_name TEXT, feature_name TEXT, device_label TEXT, device_os TEXT,
            source_type TEXT, offline INTEGER DEFAULT 0, auto_play TEXT, shuffle_play TEXT,
            repeat_play TEXT, audio_quality TEXT, playback_format TEXT, session_id INTEGER NOT NULL,
            source_provider TEXT DEFAULT 'apple_rgpd_zip', source_priority INTEGER DEFAULT 100,
            source_event_id TEXT, canonical_track_key TEXT, duration_is_estimated INTEGER DEFAULT 0,
            dedup_fingerprint TEXT
        );
        CREATE TABLE lyric_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, track_key TEXT NOT NULL,
            started_at_utc TEXT NOT NULL, started_at_local TEXT NOT NULL,
            local_date TEXT NOT NULL, local_year INTEGER NOT NULL, local_month TEXT NOT NULL,
            display_type TEXT, display_language TEXT, translation_displayed INTEGER DEFAULT 0,
            pronunciation_displayed INTEGER DEFAULT 0, device_label TEXT
        );
        CREATE TABLE search_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, query_norm TEXT NOT NULL,
            searched_at_utc TEXT NOT NULL, searched_at_local TEXT NOT NULL,
            local_date TEXT NOT NULL, local_year INTEGER NOT NULL, local_month TEXT NOT NULL,
            device_os TEXT
        );
        CREATE TABLE favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT, favorite_type TEXT, item_reference TEXT,
            item_description TEXT, last_modified TEXT, preference TEXT
        );
        CREATE UNIQUE INDEX idx_pe_provider_event_uniq
            ON play_events(source_provider, source_event_id) WHERE source_event_id IS NOT NULL;
        CREATE UNIQUE INDEX idx_pe_dedup_fp_uniq
            ON play_events(dedup_fingerprint) WHERE dedup_fingerprint IS NOT NULL;
        """
    )
    conn.execute(
        """
        INSERT INTO import_meta (id, zip_filename, zip_sha256, imported_at, total_play_events, unique_tracks, min_date, max_date)
        VALUES (1, 'Apple Media Services information.zip', 'abc123', '2026-01-10T10:00:00Z', 1, 1, '2025-10-01', '2025-10-01')
        """
    )
    conn.execute(
        """
        INSERT INTO tracks_catalog (track_key, song_name, song_norm, song_group_key, album_name, album_norm, album_group_key, artist_name, artist_norm, artist_group_key)
        VALUES ('tk1', 'Around the World', 'around the world', 'around the world', 'Homework', 'homework', 'homework', 'Daft Punk', 'daft punk', 'daft punk')
        """
    )
    conn.execute(
        """
        INSERT INTO play_events (
            track_key, started_at_utc, started_at_local, started_epoch,
            local_date, local_year, local_month, local_month_num, local_season,
            local_dow, local_hour, play_duration_ms, media_duration_ms,
            completion_ratio, is_valid_lastfm, is_skip_30s, session_id,
            source_provider, source_event_id, dedup_fingerprint
        ) VALUES (
            'tk1', '2025-10-01T12:00:00Z', '2025-10-01T14:00:00', 1759320000,
            '2025-10-01', 2025, '2025-10', 10, 'Automne', 2, 14,
            240000, 240000, 1.0, 1, 0, 1, 'apple_rgpd_zip', 'evt:1', 'fp:1'
        )
        """
    )
    conn.commit()

    # Now execute full V4 upgrade sequence (must NOT raise OperationalError: no such column)
    conn.executescript(db_mod.SCHEMA_SQL)
    db_mod._run_v3_migrations(conn)
    db_mod._run_v4_migrations(conn)
    conn.commit()

    # Existing row gets profile_id = 1 and incognito_mode = 0
    row = conn.execute("SELECT profile_id, incognito_mode FROM play_events").fetchone()
    assert row["profile_id"] == 1
    assert row["incognito_mode"] == 0

    # profile_sources backfilled from import_meta
    src = conn.execute("SELECT * FROM profile_sources WHERE profile_id = 1").fetchone()
    assert src is not None
    assert src["source_provider"] == "apple_rgpd_zip"
    assert src["filename"] == "Apple Media Services information.zip"
    assert src["events_count"] == 1

    # Cross-profile uniqueness: inserting same (source_provider, source_event_id) & dedup_fingerprint into profile 2 succeeds
    conn.execute(
        """
        INSERT INTO play_events (
            track_key, started_at_utc, started_at_local, started_epoch,
            local_date, local_year, local_month, local_month_num, local_season,
            local_dow, local_hour, play_duration_ms, media_duration_ms,
            completion_ratio, is_valid_lastfm, is_skip_30s, session_id,
            source_provider, source_event_id, dedup_fingerprint, profile_id
        ) VALUES (
            'tk1', '2025-10-01T12:00:00Z', '2025-10-01T14:00:00', 1759320000,
            '2025-10-01', 2025, '2025-10', 10, 'Automne', 2, 14,
            240000, 240000, 1.0, 1, 0, 1, 'apple_rgpd_zip', 'evt:1', 'fp:1', 2
        )
        """
    )
    assert conn.execute("SELECT COUNT(*) FROM play_events").fetchone()[0] == 2

    # Same-profile duplicate STILL enforces IntegrityError
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """
            INSERT INTO play_events (
                track_key, started_at_utc, started_at_local, started_epoch,
                local_date, local_year, local_month, local_month_num, local_season,
                local_dow, local_hour, play_duration_ms, media_duration_ms,
                completion_ratio, is_valid_lastfm, is_skip_30s, session_id,
                source_provider, source_event_id, dedup_fingerprint, profile_id
            ) VALUES (
                'tk1', '2025-10-01T12:00:00Z', '2025-10-01T14:00:00', 1759320000,
                '2025-10-01', 2025, '2025-10', 10, 'Automne', 2, 14,
                240000, 240000, 1.0, 1, 0, 1, 'apple_rgpd_zip', 'evt:1', 'fp:1', 1
            )
            """
        )
    conn.close()


# ---------------------------------------------------------------------------
# 2. Global Filter Matrix (`backend/app/filters.py`)
# ---------------------------------------------------------------------------


def test_filters_provider_aliases_and_incognito(isolated_db):
    assert expand_source_providers(None) == []
    assert expand_source_providers("") == []
    assert expand_source_providers("all") == []
    assert "spotify_extended" in expand_source_providers("spotify")
    assert expand_source_providers("spotify_extended") == ["spotify_extended"]
    assert expand_source_providers("nonexistent_prov") == ["nonexistent_prov"]
    assert canonical_platform_for("apple_rgpd_zip") == "apple_music"
    assert canonical_platform_for("spotify_extended") == "spotify"
    assert canonical_platform_for("youtube_takeout") == "youtube_music"
    assert canonical_platform_for("deezer_rgpd") == "deezer"
    assert canonical_platform_for("tidal_csv") == "tidal"

    client: TestClient = isolated_db["client"]
    p2 = client.post("/api/v4/profiles", json={"name": "Spotify"}).json()["id"]
    p3 = client.post("/api/v4/profiles", json={"name": "YTM"}).json()["id"]

    with db_mod.db_session() as conn:
        _insert_play(conn, profile_id=1, provider="apple_rgpd_zip", song="A", started_epoch=1760000000)
        _insert_play(conn, profile_id=p2, provider="spotify_extended", song="B", started_epoch=1760001000, incognito_mode=0)
        _insert_play(conn, profile_id=p2, provider="spotify_extended", song="C", started_epoch=1760002000, incognito_mode=1)
        _insert_play(conn, profile_id=p3, provider="youtube_takeout", song="D", started_epoch=1760003000, duration_is_estimated=1)

        def count_for(f: FilterParams) -> int:
            w, params = build_where_clause(f, include_skip_filter=False)
            return conn.execute(
                f"SELECT COUNT(*) FROM play_events pe JOIN tracks_catalog tc ON tc.track_key = pe.track_key WHERE {w}",
                params,
            ).fetchone()[0]

        # Default FilterParams matches all plays across profiles (V1/V2/V3 parity)
        assert count_for(FilterParams()) == 4
        assert count_for(FilterParams(source_provider="all")) == 4
        assert count_for(FilterParams(source_provider="apple_music")) == 1
        assert count_for(FilterParams(source_provider="spotify")) == 2
        assert count_for(FilterParams(source_provider="spotify_extended")) == 2
        assert count_for(FilterParams(source_provider="youtube_music")) == 1
        assert count_for(FilterParams(source_provider="apple_music,spotify")) == 3
        assert count_for(FilterParams(source_provider="unknown_platform")) == 0
        assert count_for(FilterParams(exclude_incognito=True)) == 3
        assert count_for(FilterParams(source_provider="spotify", exclude_incognito=True)) == 1


def test_filters_profile_id_standard_merged_and_edge_cases(isolated_db):
    client: TestClient = isolated_db["client"]
    p2 = client.post("/api/v4/profiles", json={"name": "P2"}).json()["id"]

    with db_mod.db_session() as conn:
        _insert_play(conn, profile_id=1, provider="apple_rgpd_zip", song="One More Time", started_epoch=1760000000, source_priority=100)
        _insert_play(conn, profile_id=p2, provider="spotify_extended", song="One More Time", started_epoch=1760000060, source_priority=95)
        _insert_play(conn, profile_id=p2, provider="spotify_extended", song="Harder Better", started_epoch=1760005000, source_priority=95)

    merged = client.post(
        "/api/v4/profiles",
        json={"name": "Fusion", "kind": "merged", "merged_profile_ids": [1, p2]},
    ).json()
    mid = merged["id"]

    with db_mod.db_session() as conn:
        # Insert an empty merged profile and a corrupt JSON merged profile directly to test SQL resilience
        cur_empty = conn.execute(
            "INSERT INTO profiles (name, kind, merged_profile_ids_json, is_active, created_at, updated_at) VALUES ('EmptyM', 'merged', '[]', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        empty_mid = int(cur_empty.lastrowid)
        cur_corrupt = conn.execute(
            "INSERT INTO profiles (name, kind, merged_profile_ids_json, is_active, created_at, updated_at) VALUES ('CorruptM', 'merged', 'not-valid-json', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        corrupt_mid = int(cur_corrupt.lastrowid)

        def count_prof(pid: int | None) -> int:
            w, params = build_where_clause(FilterParams(profile_id=pid), include_skip_filter=False)
            return conn.execute(f"SELECT COUNT(*) FROM play_events pe WHERE {w}", params).fetchone()[0]

        assert count_prof(1) == 1
        assert count_prof(p2) == 2
        assert count_prof(mid) == 2  # 3 total - 1 deduplicated cross-profile play
        assert count_prof(empty_mid) == 0
        assert count_prof(corrupt_mid) == 0
        assert count_prof(99999) == 0
        assert count_prof(0) == 0
        assert count_prof(-1) == 0


# ---------------------------------------------------------------------------
# 3. Profile CRUD, Validation, Activation & Deletion
# ---------------------------------------------------------------------------


def test_profiles_crud_validation_activation_and_deletion(isolated_db):
    client: TestClient = isolated_db["client"]

    # Initial state: default profile id=1
    res = client.get("/api/v4/profiles")
    assert res.status_code == 200
    body = res.json()
    assert body["active_profile_id"] == 1
    assert len(body["profiles"]) == 1
    assert body["profiles"][0]["id"] == 1
    assert body["profiles"][0]["kind"] == "standard"
    assert body["profiles"][0]["is_active"] is True

    # Create standard profiles -> 201, is_active=False
    p2_resp = client.post("/api/v4/profiles", json={"name": "Mon Spotify", "kind": "standard"})
    assert p2_resp.status_code == 201
    p2 = p2_resp.json()
    assert p2["is_active"] is False
    assert p2["kind"] == "standard"

    p3 = client.post("/api/v4/profiles", json={"name": "Mon YTM"}).json()

    # Validation errors -> HTTP 400
    assert client.post("/api/v4/profiles", json={"name": "   "}).status_code == 400
    assert client.post("/api/v4/profiles", json={"name": "x" * 121}).status_code == 400
    assert client.post("/api/v4/profiles", json={"name": "Bad", "kind": "invalid"}).status_code == 400
    assert client.post("/api/v4/profiles", json={"name": "M0", "kind": "merged", "merged_profile_ids": []}).status_code == 400
    assert client.post("/api/v4/profiles", json={"name": "MDup", "kind": "merged", "merged_profile_ids": [1, 1]}).status_code == 400
    assert client.post("/api/v4/profiles", json={"name": "MNeg", "kind": "merged", "merged_profile_ids": [0]}).status_code == 400
    assert client.post("/api/v4/profiles", json={"name": "MMiss", "kind": "merged", "merged_profile_ids": [1, 999]}).status_code == 400

    # Create merged profile [1, p2, p3]
    m_resp = client.post(
        "/api/v4/profiles",
        json={"name": "Tout-en-un", "kind": "merged", "merged_profile_ids": [1, p2["id"], p3["id"]]},
    )
    assert m_resp.status_code == 201
    mid = m_resp.json()["id"]
    assert m_resp.json()["merged_profile_ids"] == [1, p2["id"], p3["id"]]

    # Cannot merge an existing merged profile (prevents cycles / nested merges)
    assert (
        client.post(
            "/api/v4/profiles",
            json={"name": "Nested", "kind": "merged", "merged_profile_ids": [1, mid]},
        ).status_code
        == 400
    )

    # Activate p2 -> single active profile invariant
    assert client.post("/api/v4/profiles/999/activate").status_code == 404
    act = client.post(f"/api/v4/profiles/{p2['id']}/activate")
    assert act.status_code == 200
    assert act.json()["active_profile_id"] == p2["id"]
    listed = client.get("/api/v4/profiles").json()
    assert listed["active_profile_id"] == p2["id"]
    assert sum(1 for p in listed["profiles"] if p["is_active"]) == 1

    # Recompute-merge endpoint validation
    assert client.post("/api/v4/profiles/999/recompute-merge").status_code == 404
    assert client.post(f"/api/v4/profiles/{p2['id']}/recompute-merge").status_code == 400
    rec = client.post(f"/api/v4/profiles/{mid}/recompute-merge")
    assert rec.status_code == 200
    assert rec.json()["ok"] is True

    # Delete guardrails: cannot delete default profile 1; 404 on missing
    assert client.delete("/api/v4/profiles/1").status_code == 400
    assert client.delete("/api/v4/profiles/999").status_code == 404

    # Populate p2 with plays, lyrics, searches, favorites, and profile_sources before deleting it
    with db_mod.db_session() as conn:
        _insert_play(conn, profile_id=1, provider="apple_rgpd_zip", song="Shared", started_epoch=1760000000, source_priority=100)
        _insert_play(conn, profile_id=p2["id"], provider="spotify_extended", song="Shared", started_epoch=1760000030, source_priority=95)
        record_profile_source(conn, p2["id"], source_provider="spotify_extended", filename="sp.json", events_count=1, unique_tracks=1)
        conn.execute(
            "INSERT INTO lyric_events (track_key, started_at_utc, started_at_local, local_date, local_year, local_month, profile_id) VALUES (?, '2025-10-01T00:00:00Z', '2025-10-01T00:00:00', '2025-10-01', 2025, '2025-10', ?)",
            (make_track_key("Shared", "Discovery"), p2["id"]),
        )
        conn.execute(
            "INSERT INTO search_events (query, query_norm, searched_at_utc, searched_at_local, local_date, local_year, local_month, profile_id) VALUES ('daft', 'daft', '2025-10-01T00:00:00Z', '2025-10-01T00:00:00', '2025-10-01', 2025, '2025-10', ?)",
            (p2["id"],),
        )
        conn.execute(
            "INSERT INTO favorites (favorite_type, item_reference, profile_id) VALUES ('track', 'ref', ?)",
            (p2["id"],),
        )
        recompute_merged_exclusions(conn, mid)

    # Delete active profile p2 -> re-activates id=1, wipes p2 data, strips p2 from merged profile
    del_resp = client.delete(f"/api/v4/profiles/{p2['id']}")
    assert del_resp.status_code == 200
    assert del_resp.json()["active_profile_id"] == 1

    with db_mod.db_session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM play_events WHERE profile_id = ?", (p2["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM lyric_events WHERE profile_id = ?", (p2["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM search_events WHERE profile_id = ?", (p2["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM favorites WHERE profile_id = ?", (p2["id"],)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM profile_sources WHERE profile_id = ?", (p2["id"],)).fetchone()[0] == 0

    # Also test deleting p3 so merged profile drops to single member [1], and a merged profile of [p4] dropping to []
    client.delete(f"/api/v4/profiles/{p3['id']}")
    profiles_now = {p["id"]: p for p in client.get("/api/v4/profiles").json()["profiles"]}
    assert profiles_now[mid]["merged_profile_ids"] == [1]
    assert profiles_now[mid]["total_plays"] == 1

    p4 = client.post("/api/v4/profiles", json={"name": "Temp"}).json()["id"]
    m_single = client.post(
        "/api/v4/profiles",
        json={"name": "SingleMerged", "kind": "merged", "merged_profile_ids": [p4]},
    ).json()["id"]
    assert client.delete(f"/api/v4/profiles/{p4}").status_code == 200
    profiles_after = {p["id"]: p for p in client.get("/api/v4/profiles").json()["profiles"]}
    assert profiles_after[m_single]["merged_profile_ids"] == []
    assert profiles_after[m_single]["total_plays"] == 0
    assert profiles_after[m_single]["sources"] == []


# ---------------------------------------------------------------------------
# 4. Cross-Platform Fusion Deduplication Engine
# ---------------------------------------------------------------------------


def test_merge_dedup_isrc_canonical_similarity_and_boundaries(isolated_db):
    client: TestClient = isolated_db["client"]
    p2 = client.post("/api/v4/profiles", json={"name": "Spotify"}).json()["id"]

    with db_mod.db_session() as conn:
        # Case A: ISRC match across hyphenated play_events.isrc and N-to-M recording_isrcs with different titles
        e_isrc_win = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="One More Time",
            artist="Daft Punk", started_epoch=1760000000, source_priority=100,
            isrc="FR-Z03-99-00123",
        )
        e_isrc_lose = _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Totally Different Radio Cut",
            artist="Daft Punk", started_epoch=1760000100, source_priority=95,
            recording_isrc="FRZ039900123",
        )

        # Case B: canonical_key_for match (accents + remaster stripped)
        e_canon_win = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Déjà Vu (Remastered 2024)",
            artist="Olivia Rodrigo", started_epoch=1760002000, source_priority=100,
        )
        e_canon_lose = _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Deja Vu",
            artist="Olivia Rodrigo", started_epoch=1760002050, source_priority=95,
        )

        # Case C: similarity_score >= 0.85 match (substring = 0.88)
        e_sim_win = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Bohemian Rhapsody",
            artist="Queen", started_epoch=1760004000, source_priority=100,
        )
        e_sim_lose = _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Bohemian Rhapsody Live",
            artist="Queen", started_epoch=1760004040, source_priority=95,
        )

        # Case D: Exact ±180s boundary (180 -> deduplicated; 181 -> both kept)
        e_b180_win = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Boundary 180",
            artist="Artist X", started_epoch=1760006000, source_priority=100,
        )
        e_b180_lose = _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Boundary 180",
            artist="Artist X", started_epoch=1760006180, source_priority=95,
        )
        e_b181_a = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Boundary 181",
            artist="Artist Y", started_epoch=1760008000, source_priority=100,
        )
        e_b181_b = _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Boundary 181",
            artist="Artist Y", started_epoch=1760008181, source_priority=95,
        )

        # Case E: Same-profile repeat within 120s must BOTH be kept
        e_rep_1 = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Loop Track",
            artist="Artist Z", started_epoch=1760010000, source_priority=100,
        )
        e_rep_2 = _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Loop Track",
            artist="Artist Z", started_epoch=1760010120, source_priority=100,
        )

    merged = client.post(
        "/api/v4/profiles",
        json={"name": "Fusion", "kind": "merged", "merged_profile_ids": [1, p2]},
    ).json()
    assert merged["dedup_stats"] == {"checked": 12, "excluded": 4, "kept": 8}

    with db_mod.db_session() as conn:
        excls = {
            r["play_event_id"]: r["reason"]
            for r in conn.execute(
                "SELECT play_event_id, reason FROM profile_merged_exclusions WHERE merged_profile_id = ?",
                (merged["id"],),
            ).fetchall()
        }
        assert excls == {
            e_isrc_lose: "isrc",
            e_canon_lose: "canonical_key",
            e_sim_lose: "similarity",
            e_b180_lose: "canonical_key",
        }
        for kept_id in (e_isrc_win, e_canon_win, e_sim_win, e_b180_win, e_b181_a, e_b181_b, e_rep_1, e_rep_2):
            assert kept_id not in excls


def test_merge_dedup_four_level_tie_breaker_transitive_and_m2a_helpers(isolated_db):
    client: TestClient = isolated_db["client"]
    p2 = client.post("/api/v4/profiles", json={"name": "P2"}).json()["id"]
    p3 = client.post("/api/v4/profiles", json={"name": "P3"}).json()["id"]

    with db_mod.db_session() as conn:
        # Tie-breaker Level 1: higher source_priority wins (100 > 60) even if arriving later
        t1_low = _insert_play(conn, profile_id=p2, provider="youtube_takeout", song="Tie1", started_epoch=1760000000, source_priority=60, play_ms=300_000)
        t1_high = _insert_play(conn, profile_id=1, provider="apple_rgpd_zip", song="Tie1", started_epoch=1760000050, source_priority=100, play_ms=180_000)

        # Tie-breaker Level 2: equal priority -> exact duration (0) beats estimated (1)
        t2_est = _insert_play(conn, profile_id=p2, provider="deezer_rgpd", song="Tie2", started_epoch=1760001000, source_priority=85, duration_is_estimated=1, play_ms=300_000)
        t2_exact = _insert_play(conn, profile_id=1, provider="tidal_csv", song="Tie2", started_epoch=1760001040, source_priority=85, duration_is_estimated=0, play_ms=180_000)

        # Tie-breaker Level 3: equal priority & estimation -> longer play_duration_ms wins
        t3_short = _insert_play(conn, profile_id=1, provider="deezer_rgpd", song="Tie3", started_epoch=1760002000, source_priority=85, duration_is_estimated=0, play_ms=150_000)
        t3_long = _insert_play(conn, profile_id=p2, provider="tidal_csv", song="Tie3", started_epoch=1760002030, source_priority=85, duration_is_estimated=0, play_ms=250_000)

        # Tie-breaker Level 4: all equal -> lowest play_events.id wins
        t4_first = _insert_play(conn, profile_id=1, provider="deezer_rgpd", song="Tie4", started_epoch=1760003000, source_priority=85, duration_is_estimated=0, play_ms=200_000)
        t4_second = _insert_play(conn, profile_id=p2, provider="tidal_csv", song="Tie4", started_epoch=1760003020, source_priority=85, duration_is_estimated=0, play_ms=200_000)

        # Transitive chain: A (t=4000, prio=60, P1) <-> B (t=4150, prio=95, P2) <-> C (t=4300, prio=100, P3)
        chain_a = _insert_play(conn, profile_id=1, provider="youtube_takeout", song="ChainSong", started_epoch=1760004000, source_priority=60)
        chain_b = _insert_play(conn, profile_id=p2, provider="spotify_extended", song="ChainSong", started_epoch=1760004150, source_priority=95)
        chain_c = _insert_play(conn, profile_id=p3, provider="apple_rgpd_zip", song="ChainSong", started_epoch=1760004300, source_priority=100)

    merged = client.post(
        "/api/v4/profiles",
        json={"name": "All3", "kind": "merged", "merged_profile_ids": [1, p2, p3]},
    ).json()
    mid = merged["id"]

    with db_mod.db_session() as conn:
        excluded_ids = {
            r["play_event_id"]
            for r in conn.execute(
                "SELECT play_event_id FROM profile_merged_exclusions WHERE merged_profile_id = ?",
                (mid,),
            ).fetchall()
        }
        assert excluded_ids == {t1_low, t2_est, t3_short, t4_second, chain_a, chain_b}
        for winner in (t1_high, t2_exact, t3_long, t4_first, chain_c):
            assert winner not in excluded_ids

        # Verify M2A helpers: record_profile_source, get_or_create_standard_profile, refresh_all_merged_profiles_containing
        created_id = get_or_create_standard_profile(conn, profile_name="Nouveau Deezer")
        assert created_id == get_or_create_standard_profile(conn, profile_name="nouveau deezer")
        with pytest.raises(HTTPException) as exc_info:
            get_or_create_standard_profile(conn, profile_id=mid)
        assert exc_info.value.status_code == 400

        src_id = record_profile_source(
            conn,
            p2,
            source_provider="spotify_extended",
            filename="Streaming_History_Audio_0.json",
            events_count=5,
            unique_tracks=4,
            min_date="2025-01-01",
            max_date="2025-10-01",
        )
        assert src_id > 0

        # Add a new duplicate into p3 and refresh merged profiles containing p3
        _insert_play(conn, profile_id=p3, provider="apple_rgpd_zip", song="Tie4", started_epoch=1760003010, source_priority=100, play_ms=200_000)
        refreshed = refresh_all_merged_profiles_containing(conn, p3)
        assert mid in refreshed
        assert refreshed[mid]["checked"] == 12
        assert refreshed[mid]["excluded"] == 7

    # Verify source appears on both p2 and merged profile via GET /api/v4/profiles
    profs = {p["id"]: p for p in client.get("/api/v4/profiles").json()["profiles"]}
    assert len(profs[p2]["sources"]) == 1
    assert profs[p2]["sources"][0]["filename"] == "Streaming_History_Audio_0.json"
    assert any(s["filename"] == "Streaming_History_Audio_0.json" for s in profs[mid]["sources"])


# ---------------------------------------------------------------------------
# 5. Dynamic Capabilities Matrix (`GET /api/v4/profile/capabilities`)
# ---------------------------------------------------------------------------


def test_capabilities_matrix_all_platforms_and_merged(isolated_db):
    client: TestClient = isolated_db["client"]

    # Empty profile -> all booleans False, estimated_duration_pct = 0.0, HTTP 200
    empty_cap = client.get("/api/v4/profile/capabilities?profile_id=1")
    assert empty_cap.status_code == 200
    ec = empty_cap.json()
    assert ec["profile_id"] == 1
    assert ec["platforms"] == []
    assert ec["estimated_duration_pct"] == 0.0
    for key in (
        "has_exact_duration", "has_skips", "has_end_reasons", "has_lyrics_events",
        "has_search_events", "has_devices", "has_audio_quality", "has_incognito_flag", "has_shuffle_flag",
    ):
        assert ec[key] is False

    # Missing profile -> 404
    assert client.get("/api/v4/profile/capabilities?profile_id=999").status_code == 404

    p_sp_ext = client.post("/api/v4/profiles", json={"name": "Spotify Extended"}).json()["id"]
    p_sp_acc = client.post("/api/v4/profiles", json={"name": "Spotify Account"}).json()["id"]
    p_ytm = client.post("/api/v4/profiles", json={"name": "YouTube Music"}).json()["id"]
    p_dz = client.post("/api/v4/profiles", json={"name": "Deezer"}).json()["id"]
    p_tidal = client.post("/api/v4/profiles", json={"name": "TIDAL"}).json()["id"]

    with db_mod.db_session() as conn:
        # Profile 1: Apple Music RGPD
        _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Shared Track",
            started_epoch=1760000000, source_priority=100, play_ms=210_000,
            end_reason_type="NATURAL_END_OF_TRACK", device_label="iPhone 15",
            audio_quality="LOSSLESS", shuffle_play="SHUFFLE_OFF",
        )
        conn.execute(
            "INSERT INTO lyric_events (track_key, started_at_utc, started_at_local, local_date, local_year, local_month, profile_id) VALUES (?, '2025-10-01T00:00:00Z', '2025-10-01T00:00:00', '2025-10-01', 2025, '2025-10', 1)",
            (make_track_key("Shared Track", "Discovery"),),
        )
        conn.execute(
            "INSERT INTO search_events (query, query_norm, searched_at_utc, searched_at_local, local_date, local_year, local_month, profile_id) VALUES ('daft', 'daft', '2025-10-01T00:00:00Z', '2025-10-01T00:00:00', '2025-10-01', 2025, '2025-10', 1)"
        )

        # Spotify Extended
        _insert_play(
            conn, profile_id=p_sp_ext, provider="spotify_extended", song="Spotify Track",
            started_epoch=1760002000, source_priority=95, play_ms=190_000,
            end_reason_type="trackdone", device_label="macOS",
            shuffle_play="TRUE", incognito_mode=0, skipped=0,
        )

        # Spotify Account Data
        _insert_play(
            conn, profile_id=p_sp_acc, provider="spotify_account", song="Account Track",
            started_epoch=1760003000, source_priority=90, play_ms=180_000,
            end_reason_type="NATURAL_END_OF_TRACK", device_label="Inconnu",
        )

        # YouTube Music Takeout: 1 duplicate of Apple Shared Track + 1 unique YTM play
        _insert_play(
            conn, profile_id=p_ytm, provider="youtube_takeout", song="Shared Track",
            started_epoch=1760000030, source_priority=60, play_ms=210_000,
            duration_is_estimated=1, end_reason_type="NATURAL_END_OF_TRACK",
        )
        _insert_play(
            conn, profile_id=p_ytm, provider="youtube_takeout", song="YTM Unique",
            started_epoch=1760004000, source_priority=60, play_ms=210_000,
            duration_is_estimated=1, end_reason_type="NATURAL_END_OF_TRACK",
        )

        # Deezer mixed (1 exact, 1 imputed from -1)
        _insert_play(
            conn, profile_id=p_dz, provider="deezer_rgpd", song="Deezer Exact",
            started_epoch=1760005000, source_priority=85, play_ms=200_000,
            duration_is_estimated=0, device_label="Android", end_reason_type="NATURAL_END_OF_TRACK",
        )
        _insert_play(
            conn, profile_id=p_dz, provider="deezer_rgpd", song="Deezer Imputed",
            started_epoch=1760006000, source_priority=85, play_ms=180_000,
            duration_is_estimated=1, device_label="Web", end_reason_type="NATURAL_END_OF_TRACK",
        )

        # TIDAL CSV (estimated track duration only)
        _insert_play(
            conn, profile_id=p_tidal, provider="tidal_csv", song="Tidal Track",
            started_epoch=1760007000, source_priority=85, play_ms=220_000,
            duration_is_estimated=1, end_reason_type="NATURAL_END_OF_TRACK",
        )

    # Apple Music
    c_am = client.get("/api/v4/profile/capabilities?profile_id=1").json()
    assert c_am["platforms"] == ["apple_music"]
    assert c_am["has_exact_duration"] is True
    assert c_am["estimated_duration_pct"] == 0.0
    assert c_am["has_skips"] is True
    assert c_am["has_end_reasons"] is True
    assert c_am["has_lyrics_events"] is True
    assert c_am["has_search_events"] is True
    assert c_am["has_devices"] is True
    assert c_am["has_audio_quality"] is True
    assert c_am["has_incognito_flag"] is False
    assert c_am["has_shuffle_flag"] is True

    # Spotify Extended
    c_sp = client.get(f"/api/v4/profile/capabilities?profile_id={p_sp_ext}").json()
    assert c_sp["platforms"] == ["spotify"]
    assert c_sp["has_exact_duration"] is True
    assert c_sp["has_skips"] is True
    assert c_sp["has_end_reasons"] is True
    assert c_sp["has_lyrics_events"] is False
    assert c_sp["has_search_events"] is False
    assert c_sp["has_devices"] is True
    assert c_sp["has_audio_quality"] is False
    assert c_sp["has_incognito_flag"] is True
    assert c_sp["has_shuffle_flag"] is True

    # Spotify Account Data
    c_spa = client.get(f"/api/v4/profile/capabilities?profile_id={p_sp_acc}").json()
    assert c_spa["platforms"] == ["spotify"]
    assert c_spa["has_exact_duration"] is True
    assert c_spa["has_skips"] is True
    assert c_spa["has_end_reasons"] is False
    assert c_spa["has_devices"] is False
    assert c_spa["has_incognito_flag"] is False
    assert c_spa["has_shuffle_flag"] is False

    # YouTube Music
    c_ytm = client.get(f"/api/v4/profile/capabilities?profile_id={p_ytm}").json()
    assert c_ytm["platforms"] == ["youtube_music"]
    assert c_ytm["has_exact_duration"] is False
    assert c_ytm["estimated_duration_pct"] == 100.0
    assert c_ytm["has_skips"] is False
    assert c_ytm["has_end_reasons"] is False

    # Deezer mixed
    c_dz = client.get(f"/api/v4/profile/capabilities?profile_id={p_dz}").json()
    assert c_dz["platforms"] == ["deezer"]
    assert c_dz["has_exact_duration"] is True
    assert c_dz["estimated_duration_pct"] == 50.0
    assert c_dz["has_skips"] is True
    assert c_dz["has_devices"] is True
    assert c_dz["has_end_reasons"] is False

    # TIDAL CSV
    c_td = client.get(f"/api/v4/profile/capabilities?profile_id={p_tidal}").json()
    assert c_td["platforms"] == ["tidal"]
    assert c_td["has_exact_duration"] is False
    assert c_td["estimated_duration_pct"] == 100.0
    assert c_td["has_skips"] is False
    assert c_td["has_end_reasons"] is False

    # Merged profile (Apple + Spotify Extended + YTM):
    # 4 raw plays -> 1 YTM duplicate excluded -> 3 deduplicated plays (1 Apple, 1 Spotify, 1 YTM) -> 33.3% estimated!
    m_id = client.post(
        "/api/v4/profiles",
        json={"name": "MergedAll", "kind": "merged", "merged_profile_ids": [1, p_sp_ext, p_ytm]},
    ).json()["id"]
    c_m = client.get(f"/api/v4/profile/capabilities?profile_id={m_id}").json()
    assert c_m["platforms"] == ["apple_music", "spotify", "youtube_music"]
    assert c_m["total_plays"] == 3
    assert c_m["estimated_duration_pct"] == 33.3
    assert c_m["has_lyrics_events"] is True
    assert c_m["has_search_events"] is True
    assert c_m["has_incognito_flag"] is True

    # Filtered by source_provider (both alias 'spotify' and raw 'spotify_extended') on merged profile
    for sp_query in ("spotify", "spotify_extended"):
        c_msp = client.get(
            f"/api/v4/profile/capabilities?profile_id={m_id}&source_provider={sp_query}"
        ).json()
        assert c_msp["platforms"] == ["spotify"]
        assert c_msp["total_plays"] == 1
        assert c_msp["has_lyrics_events"] is False
        assert c_msp["has_search_events"] is False

    c_mam = client.get(
        f"/api/v4/profile/capabilities?profile_id={m_id}&source_provider=apple_music"
    ).json()
    assert c_mam["platforms"] == ["apple_music"]
    assert c_mam["has_lyrics_events"] is True
    assert c_mam["has_search_events"] is True


# ---------------------------------------------------------------------------
# 6. Analytics (`overview.py`, `behavior.py`) & DuckDB Parquet Integration
# ---------------------------------------------------------------------------


def test_overview_behavior_and_duckdb_v4_integration(isolated_db):
    client: TestClient = isolated_db["client"]
    p2 = client.post("/api/v4/profiles", json={"name": "Spotify"}).json()["id"]

    with db_mod.db_session() as conn:
        _insert_play(
            conn, profile_id=1, provider="apple_rgpd_zip", song="Shared Song",
            artist="Daft Punk", genre="Electronic", release_year=2001,
            started_epoch=1760000000, source_priority=100, end_reason_type="NATURAL_END_OF_TRACK",
            device_label="iPhone",
        )
        conn.execute(
            "INSERT INTO lyric_events (track_key, started_at_utc, started_at_local, local_date, local_year, local_month, profile_id) VALUES (?, '2025-10-01T00:00:00Z', '2025-10-01T00:00:00', '2025-10-01', 2025, '2025-10', 1)",
            (make_track_key("Shared Song", "Discovery"),),
        )
        conn.execute(
            "INSERT INTO search_events (query, query_norm, searched_at_utc, searched_at_local, local_date, local_year, local_month, profile_id) VALUES ('daft punk', 'daft punk', '2025-10-01T00:00:00Z', '2025-10-01T00:00:00', '2025-10-01', 2025, '2025-10', 1)"
        )

        # Duplicate on Spotify within 60s + unique Spotify play with incognito & ISRC
        _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Shared Song",
            artist="Daft Punk", genre="Electronic", release_year=2001,
            started_epoch=1760000060, source_priority=95, end_reason_type="trackdone",
            device_label="macOS",
        )
        _insert_play(
            conn, profile_id=p2, provider="spotify_extended", song="Secret Track",
            artist="Justice", genre="Electro", release_year=2007,
            started_epoch=1760005000, source_priority=95, end_reason_type="fwdbtn",
            device_label="macOS", incognito_mode=1, isrc="FRZ030700001",
        )

    mid = client.post(
        "/api/v4/profiles",
        json={"name": "Merged", "kind": "merged", "merged_profile_ids": [1, p2]},
    ).json()["id"]

    # overview.get_filter_options()
    opts_all = overview_mod.get_filter_options()
    assert "providers" in opts_all
    assert set(opts_all["providers"]) == {"apple_rgpd_zip", "spotify_extended"}

    opts_p1 = overview_mod.get_filter_options(profile_id=1)
    assert opts_p1["providers"] == ["apple_rgpd_zip"]
    assert opts_p1["devices"] == ["iPhone"]

    opts_p2 = overview_mod.get_filter_options(profile_id=p2)
    assert opts_p2["providers"] == ["spotify_extended"]
    assert opts_p2["devices"] == ["macOS"]

    # overview.get_overview() deduplicates merged plays (2 plays, NOT 3!)
    ov_merged = overview_mod.get_overview(FilterParams(profile_id=mid, skip_mode="all"))
    assert ov_merged["kpis"]["plays"] == 2
    ov_merged_no_incog = overview_mod.get_overview(
        FilterParams(profile_id=mid, skip_mode="all", exclude_incognito=True)
    )
    assert ov_merged_no_incog["kpis"]["plays"] == 1

    # behavior.get_behavior_and_obsessions() isolates lyrics & searches cleanly
    beh_sp = behavior_mod.get_behavior_and_obsessions(FilterParams(profile_id=p2, skip_mode="all"))
    assert beh_sp["lyrics"]["total_views"] == 0
    assert beh_sp["searches"]["total_searches"] == 0
    labels = {e["code"]: e["label"] for e in beh_sp["end_reasons"]}
    assert labels["trackdone"] == "Fin naturelle"
    assert labels["fwdbtn"] == "Skip suivant"

    beh_merged = behavior_mod.get_behavior_and_obsessions(FilterParams(profile_id=mid, skip_mode="all"))
    assert beh_merged["lyrics"]["total_views"] == 1
    assert beh_merged["searches"]["total_searches"] == 1

    beh_merged_sp_alias = behavior_mod.get_behavior_and_obsessions(
        FilterParams(profile_id=mid, source_provider="spotify", skip_mode="all")
    )
    assert beh_merged_sp_alias["lyrics"]["total_views"] == 0
    assert beh_merged_sp_alias["searches"]["total_searches"] == 0

    beh_merged_sp_raw = behavior_mod.get_behavior_and_obsessions(
        FilterParams(profile_id=mid, source_provider="spotify_extended", skip_mode="all")
    )
    assert beh_merged_sp_raw["lyrics"]["total_views"] == 0
    assert beh_merged_sp_raw["searches"]["total_searches"] == 0

    # duckdb_engine: export includes profile_id, incognito_mode, isrc
    meta = duckdb_engine.export_parquet_snapshot()
    assert meta["rows"] == 3
    schema_names = set(pq.read_schema(isolated_db["parquet_path"]).names)
    assert {"profile_id", "incognito_mode", "isrc"}.issubset(schema_names)

    q_rows = duckdb_engine.query_parquet(
        "SELECT DISTINCT profile_id FROM {parquet} ORDER BY profile_id ASC"
    )
    assert [r["profile_id"] for r in q_rows] == [1, p2]
    isrc_rows = duckdb_engine.query_parquet(
        "SELECT isrc FROM {parquet} WHERE incognito_mode = 1"
    )
    assert [r["isrc"] for r in isrc_rows] == ["FRZ030700001"]

    # Stale V3 Parquet without profile_id triggers automatic re-export in ensure_parquet_snapshot()
    stale_table = pa.table({"id": pa.array([1], type=pa.int64())})
    pq.write_table(stale_table, isolated_db["parquet_path"])
    assert "profile_id" not in set(pq.read_schema(isolated_db["parquet_path"]).names)

    duckdb_engine.ensure_parquet_snapshot()
    refreshed_cols = set(pq.read_schema(isolated_db["parquet_path"]).names)
    assert {"profile_id", "incognito_mode", "isrc"}.issubset(refreshed_cols)


# ---------------------------------------------------------------------------
# 7. Hypothesis Property-Based Tests
# ---------------------------------------------------------------------------


@given(
    st.lists(
        st.tuples(
            st.sampled_from([1, 2, 3]),  # profile_id
            st.integers(min_value=0, max_value=600),  # epoch offset
            st.sampled_from([0, 1, 2]),  # track_idx
            st.sampled_from([50, 60, 95, 100]),  # priority
            st.sampled_from([0, 1]),  # duration_is_estimated
            st.integers(min_value=1000, max_value=300_000),  # play_ms
        ),
        min_size=0,
        max_size=25,
    )
)
@settings(max_examples=60, deadline=None)
def test_prop_merge_dedup_invariants(events):
    with tempfile.TemporaryDirectory() as tmpdir:
        conn = sqlite3.connect(str(Path(tmpdir) / "prop.sqlite"))
        conn.row_factory = sqlite3.Row
        conn.executescript(db_mod.SCHEMA_SQL)
        db_mod._run_v3_migrations(conn)
        db_mod._run_v4_migrations(conn)

        now = "2026-01-01T00:00:00Z"
        conn.execute(
            "INSERT INTO profiles (id, name, kind, merged_profile_ids_json, is_active, created_at, updated_at) VALUES (2, 'P2', 'standard', '[]', 0, ?, ?)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO profiles (id, name, kind, merged_profile_ids_json, is_active, created_at, updated_at) VALUES (3, 'P3', 'standard', '[]', 0, ?, ?)",
            (now, now),
        )
        conn.execute(
            "INSERT INTO profiles (id, name, kind, merged_profile_ids_json, is_active, created_at, updated_at) VALUES (4, 'Merged', 'merged', '[1, 2, 3]', 0, ?, ?)",
            (now, now),
        )

        tracks = [("Alpha Song", "Alpha Artist"), ("Beta Song", "Beta Artist"), ("Gamma Song", "Gamma Artist")]
        inserted: list[tuple[int, int, int, int]] = []  # (event_id, profile_id, epoch, track_idx)
        base_epoch = 1760000000
        for pid, offset, tidx, prio, est, play_ms in events:
            song, artist = tracks[tidx]
            eid = _insert_play(
                conn,
                profile_id=pid,
                provider="apple_rgpd_zip" if pid == 1 else ("spotify_extended" if pid == 2 else "youtube_takeout"),
                song=song,
                artist=artist,
                started_epoch=base_epoch + offset,
                play_ms=play_ms,
                duration_is_estimated=est,
                source_priority=prio,
            )
            inserted.append((eid, pid, base_epoch + offset, tidx))

        stats1 = recompute_merged_exclusions(conn, 4)
        excl1 = {
            r["play_event_id"]
            for r in conn.execute("SELECT play_event_id FROM profile_merged_exclusions WHERE merged_profile_id = 4").fetchall()
        }

        # Invariant 1 (Conservation)
        assert stats1["checked"] == len(events)
        assert stats1["kept"] + stats1["excluded"] == len(events)
        assert stats1["excluded"] == len(excl1)

        # Invariant 2 (Zero Cross-Profile Duplicates within ±180s)
        kept = [item for item in inserted if item[0] not in excl1]
        for i in range(len(kept)):
            for j in range(i + 1, len(kept)):
                _, pid_a, ep_a, tidx_a = kept[i]
                _, pid_b, ep_b, tidx_b = kept[j]
                if pid_a != pid_b and tidx_a == tidx_b:
                    assert abs(ep_a - ep_b) > 180

        # Invariant 3 (Same-Profile Preservation)
        distinct_profiles = {e[0] for e in events}
        if len(distinct_profiles) <= 1:
            assert stats1["excluded"] == 0

        # Invariant 4 (Idempotence)
        stats2 = recompute_merged_exclusions(conn, 4)
        excl2 = {
            r["play_event_id"]
            for r in conn.execute("SELECT play_event_id FROM profile_merged_exclusions WHERE merged_profile_id = 4").fetchall()
        }
        assert stats1 == stats2
        assert excl1 == excl2
        conn.close()


@given(
    st.integers(min_value=0, max_value=20),
    st.integers(min_value=0, max_value=20),
    st.sampled_from(["apple_rgpd_zip", "spotify_extended", "spotify_account", "youtube_takeout", "deezer_rgpd", "tidal_csv"]),
)
@settings(max_examples=40, deadline=None)
def test_prop_capabilities_bounds_and_safety(exact_count: int, estimated_count: int, provider: str):
    with tempfile.TemporaryDirectory() as tmpdir:
        old_db_path = db_mod.DB_PATH
        try:
            db_mod.DB_PATH = Path(tmpdir) / "cap_prop.sqlite"
            db_mod.init_db()
            with db_mod.db_session() as conn:
                base = 1760000000
                idx = 0
                for _ in range(exact_count):
                    _insert_play(
                        conn,
                        profile_id=1,
                        provider=provider,
                        song=f"Exact {idx}",
                        started_epoch=base + idx * 300,
                        play_ms=180_000,
                        duration_is_estimated=0,
                    )
                    idx += 1
                for _ in range(estimated_count):
                    _insert_play(
                        conn,
                        profile_id=1,
                        provider=provider,
                        song=f"Est {idx}",
                        started_epoch=base + idx * 300,
                        play_ms=210_000,
                        duration_is_estimated=1,
                    )
                    idx += 1

            cap = get_profile_capabilities(profile_id=1)
            total = exact_count + estimated_count
            assert 0.0 <= cap["estimated_duration_pct"] <= 100.0
            assert cap["total_plays"] == total
            assert cap["has_exact_duration"] == (exact_count > 0)
            if total == 0:
                assert cap["platforms"] == []
                assert cap["estimated_duration_pct"] == 0.0
            else:
                assert cap["platforms"] == [canonical_platform_for(provider)]
        finally:
            db_mod.DB_PATH = old_db_path
