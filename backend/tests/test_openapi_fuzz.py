"""Phase 0 OpenAPI Contract & Endpoint Fuzzing Tests (FastAPI TestClient + Schemathesis)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app


def test_openapi_schema_valid_and_v3_endpoints_present():
    schema = app.openapi()
    assert schema["info"]["version"] == "3.0.0"
    paths = schema["paths"]
    for required in (
        "/api/health",
        "/api/v3/search",
        "/api/v3/continuum/status",
        "/apis/listenbrainz/1/submit-listens",
        "/api/v3/analytics/eras",
        "/api/v3/analytics/compass",
        "/api/v3/analytics/camelot",
        "/api/v3/analytics/science",
        "/api/v3/analytics/atlas",
        "/api/v3/analytics/graph2d",
        "/api/v3/analytics/iceberg",
        "/api/v3/games/blind-test",
        "/api/v3/collector/atelier",
        "/api/v3/wrapped/scrollytelling",
    ):
        assert required in paths, f"Missing OpenAPI path: {required}"


def test_v3_core_endpoints_no_5xx():
    with TestClient(app) as client:
        endpoints = [
            "/api/health",
            "/api/filters",
            "/api/analytics/overview",
            "/api/v3/search?q=a",
            "/api/v3/continuum/status",
            "/api/v3/jobs/status",
            "/api/v3/analytics/eras",
            "/api/v3/analytics/compass?limit=50",
            "/api/v3/analytics/camelot",
            "/api/v3/analytics/science",
            "/api/v3/analytics/atlas?limit=50",
            "/api/v3/analytics/graph2d?limit=80",
            "/api/v3/analytics/iceberg?limit=60",
            "/api/v3/games/blind-test?rounds=5",
            "/api/v3/collector/atelier",
            "/api/v3/wrapped/scrollytelling",
            "/api/v3/playlists/export?kind=harmonic_mix&fmt=jspf",
            "/api/v3/playlists/export?kind=harmonic_mix&fmt=xspf",
            "/api/v3/playlists/export?kind=harmonic_mix&fmt=m3u8",
            "/apis/listenbrainz/1/validate-token",
        ]
        for ep in endpoints:
            resp = client.get(ep)
            assert resp.status_code == 200, f"GET {ep} returned {resp.status_code}: {resp.text[:300]}"

        # Verify normalized ErrorResponse on invalid request
        bad = client.post("/api/v3/continuum/providers/nonexistent", json={"enabled": True})
        assert bad.status_code == 400
        body = bad.json()
        assert body.get("error") is True
        assert body.get("code") == "HTTP_400"


def test_schemathesis_get_endpoints_smoke():
    import schemathesis

    schema = schemathesis.openapi.from_asgi("/openapi.json", app)
    with TestClient(app) as client:
        for path in ("/api/v3/search", "/api/v3/analytics/camelot", "/api/v3/analytics/iceberg", "/api/v3/analytics/atlas"):
            op = schema[path]["GET"]
            case = op.Case(query={"limit": 30} if path != "/api/v3/search" else {"q": "test", "limit": 10})
            resp = client.request(case.method, case.formatted_path, params=case.query)
            assert resp.status_code < 500


def test_v3_frontend_contract_keys():
    """Verify exact nested response contracts consumed by V3 frontend pages."""
    with TestClient(app) as client:
        ov = client.get("/api/analytics/overview").json()
        assert "plays" in ov["kpis"]
        assert "daily_avg_ms" in ov["kpis"]
        assert "avg_completion_pct" in ov["kpis"]
        assert "skip_rate_30s_pct" in ov["kpis"]
        assert "total_sessions" in ov["kpis"]
        assert "longest_streak" in ov["records"] and "days" in ov["records"]["longest_streak"]
        assert "devices" in ov["breakdowns"]
        if ov["top_artists"]:
            assert "artist_group_key" in ov["top_artists"][0]
            assert "primary_genre" in ov["top_artists"][0]
        if ov["top_albums"]:
            assert "album_group_key" in ov["top_albums"][0]

        ch = client.get("/api/analytics/chronobiology").json()
        assert "matrix" in ch and "heatmap" in ch

        pe = client.get("/api/analytics/persona").json()
        assert "age" in pe["listening_age"]
        assert "weighted_median_year" in pe["listening_age"]
        assert "heart_decade" in pe["listening_age"]
        assert "title" in pe["persona"] and "radial_scores" in pe["persona"]
        if pe["persona"]["radial_scores"]:
            assert "score" in pe["persona"]["radial_scores"][0]

        bh = client.get("/api/analytics/behavior").json()
        assert "phases" in bh
        assert "top_looped" in bh["loops"]
        assert "top_queries" in bh["searches"]

        sc = client.get("/api/v3/wrapped/scrollytelling").json()
        assert "kpis" in sc["wrapped"] and "plays" in sc["wrapped"]["kpis"]
        assert "summary_card" in sc["wrapped"] and "top_artists" in sc["wrapped"]["summary_card"]

