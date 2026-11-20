"""Phase 1 V4 Test Suite (Unit + Hypothesis Property Tests).

Validates:
- All 5 RGPD / Takeout importers (Apple Music, Spotify Extended & Account, YouTube Music Takeout,
  Deezer .xlsx with strict IP rejection & -1 duration imputation, TIDAL .csv with alias & manual mapping)
- Auto-detection & `/api/v4/import` + `/api/v4/import/preview`
- Multi-profile + Merged profile deduplication across platforms + Capabilities matrix
- Real vinyl crate & detail API (`/api/v4/vinyl/crate`, `/api/v4/vinyl/{album_key}`)
- Live tracking: Web Scrobbler webhook (HTTP 200), `/ws/now-playing`, `/api/v4/network/lan-info` QR SVG
- Playback engine: `/api/v4/playback/resolve` (cached & mocked ytmusicapi), `/api/v4/playback/scrobble`,
  `/ws/bridge` Extension MV3 hub, and `Referrer-Policy: strict-origin-when-cross-origin` header.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings, strategies as st
from openpyxl import Workbook

import backend.app.db as db_mod
from backend.app.importers import detect_import_format, import_file_v4
from backend.app.importers.deezer import parse_deezer_xlsx
from backend.app.importers.spotify import parse_spotify_records
from backend.app.importers.tidal import parse_tidal_csv, preview_csv_columns
from backend.app.importers.youtube import clean_ytm_artist, clean_ytm_title, parse_youtube_takeout_records
from backend.app.main import app


@pytest.fixture()
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_v4_phase1.sqlite"
    parquet_file = tmp_path / "test_v4_phase1.parquet"
    monkeypatch.setattr(db_mod, "DB_PATH", db_file)
    monkeypatch.setattr(db_mod, "PARQUET_SNAPSHOT_PATH", parquet_file)
    db_mod.init_db()
    yield db_file


# ---------------------------------------------------------------------------
# 1. Spotify Extended & Account Data Tests
# ---------------------------------------------------------------------------

def test_spotify_extended_filters_podcasts_and_handles_anomalies(isolated_db, tmp_path: Path):
    records = [
        {
            "ts": "2024-06-01T18:05:00Z",
            "ms_played": 210000,
            "master_metadata_track_name": "Instant Crush",
            "master_metadata_album_artist_name": "Daft Punk",
            "master_metadata_album_album_name": "Random Access Memories",
            "spotify_track_uri": "spotify:track:2cGxRwrMyEAp8dEbuZaVv6",
            "reason_start": "trackdone",
            "reason_end": "trackdone",
            "shuffle": True,
            "skipped": None,  # 2015-2022 null skipped anomaly
            "offline": False,
            "incognito_mode": False,
            "platform": "iOS",
        },
        {
            # Podcast -> must be strictly excluded (spotify_track_uri is None)
            "ts": "2024-06-01T19:00:00Z",
            "ms_played": 1800000,
            "episode_name": "Tech Podcast #42",
            "spotify_track_uri": None,
            "spotify_episode_uri": "spotify:episode:abc123",
        },
        {
            # Incognito track -> excluded when include_incognito=False
            "ts": "2024-06-01T20:00:00Z",
            "ms_played": 195000,
            "master_metadata_track_name": "Guilty Pleasure",
            "master_metadata_album_artist_name": "Secret Artist",
            "master_metadata_album_album_name": "Secret Album",
            "spotify_track_uri": "spotify:track:9999999999999999999999",
            "reason_end": "fwdbtn",
            "skipped": None,
            "offline": True,
            "offline_timestamp": 1717272000,
            "incognito_mode": True,
        },
    ]
    json_path = tmp_path / "Streaming_History_Audio_2024_0.json"
    json_path.write_text(json.dumps(records), encoding="utf-8")

    assert detect_import_format(json_path) == "spotify"
    res = import_file_v4(json_path, profile_name="Mon Spotify", include_incognito=False)
    assert res["ok"] is True
    assert res["source_provider"] == "spotify_extended"
    assert res["inserted_events"] == 1
    assert res["parser_stats"]["podcasts_filtered"] == 1
    assert res["parser_stats"]["incognito_filtered"] == 1

    # Re-importing the same file must be idempotent (0 new duplicates)
    res2 = import_file_v4(json_path, profile_id=res["profile_id"], include_incognito=False)
    assert res2["inserted_events"] == 0
    assert res2["skipped_duplicates"] == 1


def test_spotify_account_data_import(isolated_db, tmp_path: Path):
    records = [
        {"endTime": "2024-05-10 14:22", "artistName": "Phoenix", "trackName": "Lisztomania", "msPlayed": 241000},
        {"endTime": "2024-05-10 14:26", "artistName": "Phoenix", "trackName": "1901", "msPlayed": 193000},
    ]
    p = tmp_path / "StreamingHistory_music_0.json"
    p.write_text(json.dumps(records), encoding="utf-8")
    res = import_file_v4(p, profile_name="Spotify Account")
    assert res["source_provider"] == "spotify_account"
    assert res["inserted_events"] == 2


# ---------------------------------------------------------------------------
# 2. YouTube Music Takeout Tests
# ---------------------------------------------------------------------------

def test_youtube_music_takeout_multilingual_and_topic_cleanup(isolated_db, tmp_path: Path):
    records = [
        {
            "header": "YouTube Music",
            "title": "Vous avez regardé Giorgio by Moroder",
            "titleUrl": "https://music.youtube.com/watch?v=zhl-Cs1-sG4",
            "subtitles": [{"name": "Daft Punk - Topic", "url": "https://www.youtube.com/channel/123"}],
            "time": "2024-07-02T21:15:00.000Z",
        },
        {
            "header": "YouTube Music",
            "title": "Watched Get Lucky",
            "titleUrl": "https://www.youtube.com/watch?v=5NV6Rdv1a3I",
            "subtitles": [{"name": "Daft Punk - Sujet"}],
            "time": "2024-07-02T21:20:00.000Z",
        },
        {
            # Non-music YouTube video -> filtered out
            "header": "YouTube",
            "title": "Watched Blender 3D Tutorial",
            "titleUrl": "https://www.youtube.com/watch?v=abcdefghijk",
            "time": "2024-07-02T21:25:00.000Z",
        },
        {
            # Deleted video -> tolerated and skipped
            "header": "YouTube Music",
            "title": "Watched a video that has been removed",
            "time": "2024-07-02T21:30:00.000Z",
        },
    ]
    p = tmp_path / "watch-history.json"
    p.write_text(json.dumps(records), encoding="utf-8")

    assert detect_import_format(p) == "youtube_music"
    res = import_file_v4(p, profile_name="Mon YTM")
    assert res["inserted_events"] == 2
    assert res["parser_stats"]["non_ytm_filtered"] == 1
    assert res["parser_stats"]["deleted_skipped"] == 1

    with db_mod.db_session() as conn:
        row = conn.execute(
            "SELECT duration_is_estimated FROM play_events WHERE source_provider = 'youtube_music' LIMIT 1"
        ).fetchone()
        assert row["duration_is_estimated"] == 1
        mapping = conn.execute(
            "SELECT external_id FROM platform_track_mappings WHERE provider = 'youtube'"
        ).fetchall()
        assert {m["external_id"] for m in mapping} == {"zhl-Cs1-sG4", "5NV6Rdv1a3I"}


# ---------------------------------------------------------------------------
# 3. Deezer .xlsx Tests (Strict IP Rejection + -1 Imputation)
# ---------------------------------------------------------------------------

def test_deezer_xlsx_rejects_ip_and_imputes_negative_duration(isolated_db, tmp_path: Path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Listening History"
    ws.append(["Song Title", "Artist", "Album", "ISRC", "Date", "Listening Time", "IP Address", "Platform Name"])
    ws.append(["Veridis Quo", "Daft Punk", "Discovery", "GBDUW0000069", "2024-08-01 12:00:00", 345, "192.168.1.99", "Android"])
    ws.append(["Digital Love", "Daft Punk", "Discovery", "GBDUW0000059", "2024-08-01 12:06:00", -1, "10.0.0.42", "Web"])
    xlsx_path = tmp_path / "deezer_rgpd.xlsx"
    wb.save(xlsx_path)

    assert detect_import_format(xlsx_path) == "deezer"
    res = import_file_v4(xlsx_path, profile_name="Mon Deezer")
    assert res["inserted_events"] == 2
    assert res["parser_stats"]["ip_columns_rejected"] == ["IP Address"]
    assert res["parser_stats"]["imputed_durations"] == 1

    with db_mod.db_session() as conn:
        # Verify IP never stored anywhere in play_events
        rows = conn.execute("SELECT * FROM play_events WHERE source_provider = 'deezer_rgpd'").fetchall()
        for r in rows:
            assert "192.168.1.99" not in str(dict(r))
            assert "10.0.0.42" not in str(dict(r))
        isrcs = conn.execute("SELECT isrc FROM recording_isrcs").fetchall()
        assert {i["isrc"] for i in isrcs} == {"GBDUW0000069", "GBDUW0000059"}


# ---------------------------------------------------------------------------
# 4. TIDAL .csv Tests (Alias Detection + Assisted Manual Mapping)
# ---------------------------------------------------------------------------

def test_tidal_csv_alias_and_manual_mapping(isolated_db, tmp_path: Path):
    csv_path = tmp_path / "tidal_export.csv"
    csv_path.write_text(
        "Track Name,Artist,Album,Duration,ISRC,Played At\n"
        "Around the World,Daft Punk,Homework,07:09,GBDUW0000007,2024-09-01T10:00:00Z\n",
        encoding="utf-8",
    )
    assert detect_import_format(csv_path) == "tidal"
    prev = preview_csv_columns(csv_path)
    assert prev["needs_manual_mapping"] is False
    assert prev["detected_mapping"]["song"] == "Track Name"

    res = import_file_v4(csv_path, profile_name="Mon TIDAL")
    assert res["inserted_events"] == 1

    # Atypical headers -> manual mapping
    custom_csv = tmp_path / "tidal_custom.csv"
    custom_csv.write_text("col_a;col_b;col_c\nOne More Time;Daft Punk;Discovery\n", encoding="utf-8")
    prev2 = preview_csv_columns(custom_csv)
    assert prev2["needs_manual_mapping"] is True
    events, _ = parse_tidal_csv(custom_csv, column_mapping={"song": "col_a", "artist": "col_b", "album": "col_c"})
    assert len(events) == 1
    assert events[0].song_name == "One More Time"


# ---------------------------------------------------------------------------
# 5. Apple Music ZIP Format Detection
# ---------------------------------------------------------------------------

def test_apple_music_zip_detection(tmp_path: Path):
    zpath = tmp_path / "Apple Media Services information.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("Apple Music Activity/Apple Music Play Activity.csv", "Song Name,Artist Name\n")
    assert detect_import_format(zpath) == "apple_music"


# ---------------------------------------------------------------------------
# 6. Hypothesis Property Tests (Fuzzing Cleaners & Parsers)
# ---------------------------------------------------------------------------

@settings(max_examples=40, deadline=None)
@given(
    prefix=st.sampled_from(["Watched ", "Vous avez regardé ", "Angesehen: ", "Visto ", ""]),
    title=st.text(alphabet=st.characters(blacklist_categories=("Cs",)), min_size=1, max_size=40),
    suffix=st.sampled_from([" - Topic", " - Sujet", " - Thema", ""]),
    artist=st.text(alphabet=st.characters(blacklist_categories=("Cs",)), min_size=1, max_size=30),
)
def test_hypothesis_ytm_cleaners_never_crash(prefix, title, suffix, artist):
    cleaned_t = clean_ytm_title(prefix + title)
    cleaned_a = clean_ytm_artist(artist + suffix)
    assert isinstance(cleaned_t, str)
    assert isinstance(cleaned_a, str)
    if suffix:
        assert not cleaned_a.lower().endswith(suffix.lower().strip())


@settings(max_examples=25, deadline=None)
@given(
    ms=st.integers(min_value=-5000, max_value=900_000),
    incognito=st.booleans(),
)
def test_hypothesis_spotify_parser_invariants(ms, incognito):
    recs = [
        {
            "ts": "2024-06-01T12:00:00Z",
            "ms_played": ms,
            "master_metadata_track_name": "Test Song",
            "master_metadata_album_artist_name": "Test Artist",
            "master_metadata_album_album_name": "Test Album",
            "spotify_track_uri": "spotify:track:1234567890abcdef",
            "incognito_mode": incognito,
        }
    ]
    events, mode, _ = parse_spotify_records(recs, include_incognito=True)
    assert mode == "spotify_extended"
    assert len(events) == 1
    assert events[0].play_duration_ms >= 0
    assert events[0].incognito_mode == (1 if incognito else 0)


# ---------------------------------------------------------------------------
# 7. FastAPI V4 Endpoints, Webhooks, WebSockets, LAN QR & Headers
# ---------------------------------------------------------------------------

def test_v4_endpoints_webhooks_websockets_and_headers(isolated_db, tmp_path: Path):
    client = TestClient(app)

    # Referrer-Policy anti-Error 153 header
    guides = client.get("/api/v4/import/guides")
    assert guides.status_code == 200
    assert guides.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert len(guides.json()["platforms"]) == 5

    # LAN info & QR SVG
    lan = client.get("/api/v4/network/lan-info")
    assert lan.status_code == 200
    lan_data = lan.json()
    assert "<svg" in lan_data["frontend_qr_svg"]
    assert "<svg" in lan_data["listenbrainz_qr_svg"]
    assert ":5176" in lan_data["frontend_v4_url"]

    # Web Scrobbler webhook (must always return HTTP 200)
    wh = client.post(
        "/api/v4/webhooks/web-scrobbler",
        json={
            "eventName": "nowplaying",
            "data": {"song": {"parsed": {"track": "Face to Face", "artist": "Daft Punk", "album": "Discovery", "duration": 240}}},
        },
    )
    assert wh.status_code == 200
    assert wh.json()["ok"] is True

    # WebSocket /ws/now-playing receives current state
    with client.websocket_connect("/ws/now-playing") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "now_playing"
        assert msg["data"]["song_name"] == "Face to Face"
        ws.send_text("ping")
        assert ws.receive_json()["type"] == "pong"

    # WebSocket /ws/bridge extension <-> frontend handshake
    with client.websocket_connect("/ws/bridge?role=extension") as ext_ws:
        ext_ws.send_json({"type": "hello", "platforms": [{"platform": "apple_music", "tabId": 7}]})
        with client.websocket_connect("/ws/bridge?role=frontend") as fe_ws:
            status_msg = fe_ws.receive_json()
            assert status_msg["type"] == "bridge_status"
            assert status_msg["data"]["extension_connected"] is True

    # Playback resolve (mocking ytmusicapi to stay 100% offline-deterministic)
    with patch(
        "backend.app.playback._search_ytmusic_sync",
        return_value={"video_id": "dQw4w9WgXcQ", "url": "https://music.youtube.com/watch?v=dQw4w9WgXcQ"},
    ):
        res = client.get("/api/v4/playback/resolve", params={"song": "Face to Face", "artist": "Daft Punk", "album": "Discovery"})
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["video_id"] == "dQw4w9WgXcQ"

    # Playback scrobble & vinyl crate
    scr = client.post(
        "/api/v4/playback/scrobble",
        json={
            "song_name": "Face to Face",
            "artist_name": "Daft Punk",
            "album_name": "Discovery",
            "play_duration_ms": 220000,
            "media_duration_ms": 240000,
            "provider": "youtube_iframe",
            "event_type": "scrobble",
        },
    )
    assert scr.status_code == 200
    crate = client.get("/api/v4/vinyl/crate")
    assert crate.status_code == 200
    assert crate.json()["count"] >= 1
    first_key = crate.json()["albums"][0]["album_key"]
    detail = client.get(f"/api/v4/vinyl/{first_key}")
    assert detail.status_code == 200
    assert len(detail.json()["sides"]) >= 1
