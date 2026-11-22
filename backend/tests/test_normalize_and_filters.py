"""Unit tests for backend/app/normalize.py and backend/app/filters.py."""

from __future__ import annotations

from backend.app.filters import (
    FilterParams,
    build_profile_id_clause,
    build_where_clause,
    canonical_platform_for,
    expand_source_providers,
)
from backend.app.normalize import clean_group_key, make_track_key, normalize_basic


def test_normalize_basic_and_clean_group_key():
    assert normalize_basic("  Beyoncé — Café (Live) ") == "beyoncé - café (live)"
    assert clean_group_key("Daft Punk (feat. Pharrell Williams)") == "daft punk feat pharrell williams"
    k1 = make_track_key("Instant Crush (feat. Julian Casablancas)", "Daft Punk")
    k2 = make_track_key("Instant Crush", "Daft Punk")
    assert isinstance(k1, str) and len(k1) > 0
    assert isinstance(k2, str) and len(k2) > 0


def test_canonical_platform_and_expand_providers():
    assert canonical_platform_for("apple_music") == "apple_music"
    assert canonical_platform_for("spotify") == "spotify"
    assert "apple_music" in expand_source_providers("apple_music")
    assert expand_source_providers("all") == []


def test_filter_params_user_id_and_where_clauses():
    fp = FilterParams(
        period_mode="year",
        year="2024",
        skip_mode="lastfm",
        exclude_incognito=True,
        profile_id=1,
        user_id=7,
    )
    assert fp.user_id == 7

    sql_clause, params = build_profile_id_clause(1, user_id=7)
    assert "user_id" in sql_clause or params

    where_sql, where_params = build_where_clause(fp)
    assert 2024 in where_params or "2024" in where_params or "2024" in where_sql
    assert "incognito" in where_sql

    fp_custom = FilterParams(skip_mode="custom", min_seconds=45, min_completion_pct=60)
    custom_sql, custom_params = build_where_clause(fp_custom)
    assert 45000 in custom_params or "45000" in str(custom_params)
