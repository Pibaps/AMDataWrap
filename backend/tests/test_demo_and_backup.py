"""Unit tests for Demo Mode, Granular Source Delete, and Portable Backup Export/Restore."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.app.db as db_mod
from backend.app.main import app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "test_demo_backup.sqlite"
    parquet_file = tmp_path / "test_demo_backup.parquet"
    monkeypatch.setattr(db_mod, "DB_PATH", db_file)
    monkeypatch.setattr(db_mod, "PARQUET_SNAPSHOT_PATH", parquet_file)
    db_mod.init_db()
    return TestClient(app)


def test_demo_load_and_unload_roundtrip(client: TestClient):
    r_load = client.post("/api/v4/demo/load")
    assert r_load.status_code == 200
    body = r_load.json()
    assert body["ok"] is True
    assert body["events_count"] > 100
    profile_id = body["profile_id"]

    # Export portable backup (.amdw.json.gz)
    r_exp = client.get(f"/api/v4/profiles/{profile_id}/export")
    assert r_exp.status_code == 200
    assert r_exp.headers.get("content-type") in ("application/gzip", "application/octet-stream")
    gz_bytes = r_exp.content
    assert len(gz_bytes) > 100

    # Import portable backup into a restored profile
    r_imp = client.post(
        "/api/v4/profiles/import-backup",
        files={"file": ("backup.amdw.json.gz", gz_bytes, "application/gzip")},
    )
    assert r_imp.status_code == 200
    imp_body = r_imp.json()
    assert imp_body["ok"] is True
    assert imp_body["restored_events"] == body["events_count"]

    # Unload demo profile
    r_unload = client.post("/api/v4/demo/unload")
    assert r_unload.status_code == 200
    assert r_unload.json()["ok"] is True


def test_granular_source_deletion(client: TestClient):
    # Load demo to get a populated profile + source
    r_load = client.post("/api/v4/demo/load")
    assert r_load.status_code == 200
    profile_id = r_load.json()["profile_id"]

    profs = client.get("/api/v4/profiles").json()["profiles"]
    demo_prof = next(p for p in profs if p["id"] == profile_id)
    assert len(demo_prof["sources"]) >= 1
    src_id = demo_prof["sources"][0]["id"]

    r_del = client.delete(f"/api/v4/profiles/{profile_id}/sources/{src_id}")
    assert r_del.status_code == 200
    assert r_del.json()["deleted_events"] > 0
