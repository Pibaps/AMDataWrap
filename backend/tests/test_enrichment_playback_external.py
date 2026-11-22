"""Unit tests for artwork cascade/cache, playback scoring & refresh, and external lyrics/BPM."""

from __future__ import annotations

import importlib
import io
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import backend.app.db as db_mod
from backend.app.config import settings
from backend.app.enrichment import enrichment_manager
from backend.app.main import app
from backend.app.playback import _search_ytmusic_sync

proxy_router_mod = importlib.import_module("backend.app.routers.proxy_router")


@pytest.fixture()
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_enrichment.sqlite"
    parquet_file = tmp_path / "test_enrichment.parquet"
    cache_dir = tmp_path / "artwork_cache"
    monkeypatch.setattr(db_mod, "DB_PATH", db_file)
    monkeypatch.setattr(db_mod, "PARQUET_SNAPSHOT_PATH", parquet_file)
    monkeypatch.setattr(proxy_router_mod, "settings", replace(settings, artwork_cache_dir=cache_dir))
    db_mod.init_db()
    return TestClient(app)


def _make_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(200, 120, 40)).save(buf, format="PNG")
    return buf.getvalue()


def test_artwork_proxy_disk_cache_and_etag(isolated_env: TestClient):
    fake_bytes = _make_png_bytes()
    with (
        patch("backend.app.routers.proxy_router.validate_proxy_url", side_effect=lambda u, *a, **kw: u),
        patch("backend.app.routers.proxy_router.safe_fetch_bytes", return_value=(fake_bytes, "image/png")) as mock_fetch,
    ):
        url = "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg"
        r1 = isolated_env.get(f"/api/artwork-proxy?url={url}&w=400&fmt=webp")
        assert r1.status_code == 200
        assert mock_fetch.call_count == 1
        etag = r1.headers.get("etag")
        assert etag

        # Second request served from disk cache (mock_fetch not called again)
        r2 = isolated_env.get(f"/api/artwork-proxy?url={url}&w=400&fmt=webp")
        assert r2.status_code == 200
        assert mock_fetch.call_count == 1

        # Conditional ETag -> 304
        r3 = isolated_env.get(f"/api/artwork-proxy?url={url}&w=400&fmt=webp", headers={"If-None-Match": etag})
        assert r3.status_code == 304


def test_cover_art_archive_fallback_and_repair_endpoint(isolated_env: TestClient):
    with db_mod.db_session() as conn:
        conn.execute(
            """
            INSERT INTO tracks_catalog (
                track_key, song_name, song_norm, song_group_key, artist_name, album_name, album_norm,
                artist_group_key, album_group_key, artwork_url
            )
            VALUES ('k1', 'Veridis Quo', 'veridis quo', 'veridis quo', 'Daft Punk', 'Discovery', 'discovery', 'daft punk', 'discovery', NULL)
            """
        )

    queued = enrichment_manager.queue_repair_missing()
    assert queued >= 1

    r = isolated_env.post("/api/v4/enrichment/repair")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_youtube_scoring_penalizes_karaoke_and_covers():
    fake_results = [
        {"videoId": "bad123", "title": "Instant Crush (Karaoke Cover Version)", "artists": [{"name": "Random"}], "resultType": "video"},
        {"videoId": "good456", "title": "Instant Crush", "artists": [{"name": "Daft Punk"}], "resultType": "song"},
    ]
    with patch("ytmusicapi.YTMusic") as mock_ytm:
        mock_ytm.return_value.search.return_value = fake_results
        res = _search_ytmusic_sync("Daft Punk Instant Crush", "Instant Crush", "Daft Punk")
        assert res is not None
        assert res["video_id"] == "good456"


def test_playback_refresh_preview_and_external_lyrics_bpm(isolated_env: TestClient):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "results": [
            {
                "trackName": "Instant Crush",
                "artistName": "Daft Punk",
                "previewUrl": "https://audio-ssl.itunes.apple.com/fresh.m4a",
                "artworkUrl100": "https://is1-ssl.mzstatic.com/100x100bb.jpg",
            }
        ]
    }
    with patch("backend.app.playback.httpx.AsyncClient.get", new=AsyncMock(return_value=mock_resp)):
        r = isolated_env.get("/api/v4/playback/refresh-preview?song=Instant+Crush&artist=Daft+Punk")
        assert r.status_code == 200
        assert r.json()["preview_url"] == "https://audio-ssl.itunes.apple.com/fresh.m4a"

    lyr_resp = MagicMock()
    lyr_resp.status_code = 200
    lyr_resp.json.return_value = {"plainLyrics": "Hello world", "syncedLyrics": "[00:01.00] Hello world", "instrumental": False}
    with patch("backend.app.external.httpx.AsyncClient.get", new=AsyncMock(return_value=lyr_resp)):
        r_lyr = isolated_env.get("/api/external/lyrics?song=Instant+Crush&artist=Daft+Punk")
        assert r_lyr.status_code == 200
        assert r_lyr.json()["found"] is True

    bpm_resp = MagicMock()
    bpm_resp.status_code = 200
    bpm_resp.json.return_value = {"data": [{"id": 999}]}
    with patch("backend.app.external.httpx.AsyncClient.get", new=AsyncMock(return_value=bpm_resp)):
        r_bpm = isolated_env.get("/api/external/track-bpm?song=Instant+Crush&artist=Daft+Punk")
        assert r_bpm.status_code == 200
