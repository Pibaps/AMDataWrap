"""Integration tests for all analytics, search, sessions, history & detail endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.app.db as db_mod
from backend.app.demo import load_demo_library
from backend.app.main import app


@pytest.fixture()
def demo_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_analytics_all.sqlite"
    parquet_file = tmp_path / "test_analytics_all.parquet"
    monkeypatch.setattr(db_mod, "DB_PATH", db_file)
    monkeypatch.setattr(db_mod, "PARQUET_SNAPSHOT_PATH", parquet_file)
    db_mod.init_db()
    load_demo_library()
    return TestClient(app)


def test_all_analytics_endpoints_return_200_with_demo_data(demo_client: TestClient):
    endpoints = [
        "/api/health",
        "/api/filters",
        "/api/analytics/overview",
        "/api/analytics/tops/artists?limit=10",
        "/api/analytics/tops/albums?limit=10",
        "/api/analytics/tops/tracks?limit=10",
        "/api/analytics/tops/genres?limit=10",
        "/api/analytics/chronobiology",
        "/api/analytics/persona",
        "/api/analytics/behavior",
        "/api/analytics/wrapped",
        "/api/analytics/galaxy",
        "/api/v3/analytics/science",
        "/api/v3/analytics/eras",
        "/api/v3/analytics/compass",
        "/api/v3/analytics/camelot",
        "/api/v3/analytics/atlas",
        "/api/v3/analytics/iceberg",
        "/api/sessions?limit=10",
        "/api/history?limit=20",
    ]
    for url in endpoints:
        resp = demo_client.get(url)
        assert resp.status_code == 200, f"{url} returned {resp.status_code}: {resp.text}"

    # CSV export
    csv_resp = demo_client.get("/api/history/export.csv")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers.get("content-type", "")
    assert "Titre,Artiste,Album" in csv_resp.text

    # FTS5 search
    search_resp = demo_client.get("/api/v3/search?q=Daft")
    assert search_resp.status_code == 200

    # Detail artist / album / day
    tops = demo_client.get("/api/analytics/tops/artists?limit=1").json()
    if tops["items"]:
        akey = tops["items"][0]["artist_group_key"]
        assert demo_client.get(f"/api/detail/artist/{akey}").status_code == 200

    albums = demo_client.get("/api/analytics/tops/albums?limit=1").json()
    if albums["items"]:
        alkey = albums["items"][0]["album_group_key"]
        assert demo_client.get(f"/api/detail/album/{alkey}").status_code == 200

    chrono = demo_client.get("/api/analytics/chronobiology").json()
    if chrono["heatmap"]:
        day = chrono["heatmap"][0]["date"]
        assert demo_client.get(f"/api/detail/day/{day}").status_code == 200
