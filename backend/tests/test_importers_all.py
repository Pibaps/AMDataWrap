"""Unit tests covering all 5 RGPD/Takeout importers and batch tracking."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from openpyxl import Workbook

import backend.app.db as db_mod
from backend.app.importers import detect_import_format, import_file_v4


@pytest.fixture()
def isolated_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_importers_all.sqlite"
    parquet_file = tmp_path / "test_importers_all.parquet"
    monkeypatch.setattr(db_mod, "DB_PATH", db_file)
    monkeypatch.setattr(db_mod, "PARQUET_SNAPSHOT_PATH", parquet_file)
    db_mod.init_db()
    yield db_file


def test_import_apple_music_csv_and_dedup(isolated_db: Path, tmp_path: Path):
    import zipfile

    zip_path = tmp_path / "apple_music_export.zip"
    csv_body = (
        "Event Type,Media Type,Feature Name,Song Name,Artist Name,Album Name,Event Start Timestamp,Event End Timestamp,Play Duration Milliseconds,Media Duration In Milliseconds,End Reason Type,Genre\n"
        "PLAY_END,AUDIO,Library,Veridis Quo,Daft Punk,Discovery,2024-05-01T20:00:00Z,2024-05-01T20:05:45Z,345000,345000,NATURAL_END_OF_TRACK,Electronic\n"
        "PLAY_END,AUDIO,Library,Digital Love,Daft Punk,Discovery,2024-05-01T20:06:00Z,2024-05-01T20:10:58Z,298000,298000,NATURAL_END_OF_TRACK,Electronic\n"
    )
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("Apple Music Play Activity.csv", csv_body)

    assert detect_import_format(zip_path) == "apple_music"

    res1 = import_file_v4(zip_path, profile_name="AM Profile")
    assert res1["inserted_events"] == 2
    assert res1["detected_platform"] == "apple_music"

    # Re-importing the exact same file keeps DB play_events deduplicated at 2
    import_file_v4(zip_path, profile_name="AM Profile")

    with db_mod.db_session() as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM play_events").fetchone()
        assert row["c"] == 2


def test_import_spotify_youtube_deezer_tidal(isolated_db: Path, tmp_path: Path):
    # Spotify Extended JSON
    sp_path = tmp_path / "Streaming_History_Audio_2024.json"
    sp_path.write_text(
        json.dumps([
            {
                "ts": "2024-06-01T19:00:00Z",
                "ms_played": 205000,
                "master_metadata_track_name": "Starboy",
                "master_metadata_album_artist_name": "The Weeknd",
                "master_metadata_album_album_name": "Starboy",
                "spotify_track_uri": "spotify:track:7MXVkk9YMctZqd1Srtv4MB",
                "reason_end": "trackdone",
                "incognito_mode": False,
            }
        ]),
        encoding="utf-8",
    )
    res_sp = import_file_v4(sp_path, profile_name="Multi")
    assert res_sp["detected_platform"] == "spotify"
    assert res_sp["inserted_events"] == 1

    # YouTube Music Takeout JSON
    yt_path = tmp_path / "watch-history.json"
    yt_path.write_text(
        json.dumps([
            {
                "header": "YouTube Music",
                "title": "Watched Midnight City",
                "subtitles": [{"name": "M83 - Topic"}],
                "time": "2024-06-02T21:15:00Z",
            }
        ]),
        encoding="utf-8",
    )
    res_yt = import_file_v4(yt_path, profile_name="Multi")
    assert res_yt["detected_platform"] == "youtube_music"
    assert res_yt["inserted_events"] == 1

    # Deezer XLSX
    dz_path = tmp_path / "deezer_listeningHistory.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "listeningHistory"
    ws.append(["Song Title", "Artist", "Album", "Date", "Listening Time"])
    ws.append(["Genesis", "Justice", "Cross", "2024-06-03 18:00:00", 229])
    wb.save(dz_path)
    res_dz = import_file_v4(dz_path, profile_name="Multi")
    assert res_dz["detected_platform"] == "deezer"
    assert res_dz["inserted_events"] == 1

    # TIDAL CSV
    td_path = tmp_path / "tidal_streams.csv"
    td_path.write_text(
        "Title,Artist,Album,Date,Duration\n"
        "Nightcall,Kavinsky,OutRun,2024-06-04T22:00:00Z,258\n",
        encoding="utf-8",
    )
    res_td = import_file_v4(td_path, profile_name="Multi")
    assert res_td["detected_platform"] == "tidal"
    assert res_td["inserted_events"] == 1
