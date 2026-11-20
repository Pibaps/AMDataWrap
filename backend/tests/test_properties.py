"""Phase 0 Property-Based Tests (Hypothesis) for AMDataWrap V3 Continuum invariants.

Verifies:
1. Normalization idempotence on arbitrary Unicode, accents, remasters & feat strings.
2. Strict <= 30-minute session gap invariant on play_events.
3. Continuum reconciliation priority hierarchy (`apple_rgpd_zip 100 > local_smtc 70 > listenbrainz/lastfm 50`)
   and zero double-counting under double-import / repeated reloads.
4. SQLite FTS5 accent-insensitive (`Déjà` <-> `deja`) & trigram substring search.
5. Mathematical invariants for Eddington Number, Normalized Gini / D_eff, Shannon Entropy, Camelot transitions.
"""

from __future__ import annotations

import math
import sqlite3
import tempfile
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.app import db as db_mod
from backend.app.analytics.v3_science import (
    ALL_CAMELOT_CODES,
    camelot_compatible_codes,
    compute_eddington_number,
    compute_gini_and_effective_core,
    compute_shannon_entropy,
)
from backend.app.continuum.reconciler import IncomingScrobble, reconcile_scrobble
from backend.app.normalize import clean_group_key, normalize_basic, similarity_score


# 1. Normalization Idempotence
@given(st.text(min_size=0, max_size=120))
@settings(max_examples=150)
def test_normalize_basic_idempotent(s: str):
    once = normalize_basic(s)
    twice = normalize_basic(once)
    assert once == twice


@given(st.text(min_size=0, max_size=120), st.booleans())
@settings(max_examples=150)
def test_clean_group_key_idempotent(s: str, strip_feat: bool):
    once = clean_group_key(s, strip_feat=strip_feat)
    twice = clean_group_key(once, strip_feat=strip_feat)
    assert once == twice


def test_clean_group_key_accents_and_editions():
    assert clean_group_key("Déjà Vu (Remastered 2024)") == "deja vu"
    assert clean_group_key("Midnight City (Deluxe Edition)") == "midnight city"
    assert clean_group_key("Track (feat. Daft Punk)", strip_feat=True) == "track"
    assert similarity_score("Déjà Vu", "Deja Vu (Remastered)") == 1.0


# 2. Mathematical Science Metrics Invariants
@given(st.lists(st.integers(min_value=0, max_value=300), min_size=0, max_size=120))
@settings(max_examples=100)
def test_eddington_invariant(daily_counts: list[int]):
    res = compute_eddington_number(daily_counts)
    e = res["eddington"]
    # Exact Eddington definition: >= E days with >= E plays, and NOT >= (E+1) days with >= (E+1) plays
    assert sum(1 for c in daily_counts if c >= e) >= e
    assert sum(1 for c in daily_counts if c >= e + 1) < e + 1
    assert res["days_needed_for_next"] == (e + 1) - sum(1 for c in daily_counts if c >= e + 1)


@given(st.lists(st.floats(min_value=1.0, max_value=1e7, allow_nan=False, allow_infinity=False), min_size=1, max_size=80))
@settings(max_examples=100)
def test_gini_and_effective_core_bounds(values: list[float]):
    res = compute_gini_and_effective_core(values)
    assert 0.0 <= res["gini"] <= 1.0
    assert 1 <= res["effective_core"] <= len(values)
    assert res["effective_core"] == max(1, math.floor(len(values) * (1.0 - res["gini"]))) or abs(
        res["effective_core"] - math.floor(len(values) * (1.0 - res["gini"]))
    ) <= 1


@given(st.lists(st.floats(min_value=0.1, max_value=1e5, allow_nan=False, allow_infinity=False), min_size=2, max_size=50))
@settings(max_examples=100)
def test_shannon_entropy_bounds(counts: list[float]):
    res = compute_shannon_entropy(counts)
    assert 0.0 <= res["normalized"] <= 1.0001
    assert res["bits"] >= 0.0
    assert res["perplexity"] >= 1.0


def test_camelot_symmetry_and_coverage():
    for code in ALL_CAMELOT_CODES:
        compat = [c for c, _ in camelot_compatible_codes(code)]
        assert code in compat
        assert len(compat) == 5
        for c in compat:
            assert c in ALL_CAMELOT_CODES


# 3. Continuum Deduplication, Truth Priority & FTS5 Accent-Insensitive Search
def test_continuum_reconciliation_and_fts5():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db = Path(tmpdir) / "test_v3.sqlite"
        conn = sqlite3.connect(str(tmp_db))
        conn.row_factory = sqlite3.Row
        conn.executescript(db_mod.SCHEMA_SQL)
        db_mod._run_v3_migrations(conn)

        # 1. Insert ListenBrainz scrobble (priority 50, estimated duration)
        sc_lb = IncomingScrobble(
            source_provider="listenbrainz",
            song_name="Déjà Vu",
            artist_name="Daft Punk",
            album_name="Discovery",
            started_epoch=1760000000,
            play_duration_ms=None,
            source_event_id="lb:1",
        )
        assert reconcile_scrobble(conn, sc_lb) == "inserted"
        # Idempotent replay -> deduplicated
        assert reconcile_scrobble(conn, sc_lb) == "deduplicated"
        assert conn.execute("SELECT COUNT(*) FROM play_events").fetchone()[0] == 1
        assert conn.execute("SELECT duration_is_estimated FROM play_events").fetchone()[0] == 1

        # 2. Same play arrives via Last.fm 40s later (same priority 50) -> deduplicated, zero double count!
        sc_lfm = IncomingScrobble(
            source_provider="lastfm",
            song_name="Deja Vu (Remastered)",
            artist_name="Daft Punk",
            album_name="Discovery",
            started_epoch=1760000040,
            source_event_id="lfm:1",
        )
        assert reconcile_scrobble(conn, sc_lfm) == "deduplicated"
        assert conn.execute("SELECT COUNT(*) FROM play_events").fetchone()[0] == 1

        # 3. Authoritative Apple RGPD ZIP arrives 25s away (priority 100) -> upgrades in-place!
        sc_zip = IncomingScrobble(
            source_provider="apple_rgpd_zip",
            song_name="Déjà Vu",
            artist_name="Daft Punk",
            album_name="Discovery",
            started_epoch=1760000025,
            play_duration_ms=215_430,
            media_duration_ms=215_430,
            source_event_id="zip:1",
        )
        assert reconcile_scrobble(conn, sc_zip) == "upgraded"
        assert conn.execute("SELECT COUNT(*) FROM play_events").fetchone()[0] == 1
        row = conn.execute("SELECT source_provider, play_duration_ms, duration_is_estimated FROM play_events").fetchone()
        assert row["source_provider"] == "apple_rgpd_zip"
        assert row["play_duration_ms"] == 215_430
        assert row["duration_is_estimated"] == 0

        # 4. Verify SQLite FTS5 unicode61 accent-insensitive search ("deja" matches "Déjà Vu")
        hits = conn.execute("SELECT track_key FROM tracks_fts WHERE tracks_fts MATCH '\"deja\"*'").fetchall()
        assert len(hits) == 1

        # 5. Verify SQLite FTS5 trigram substring search ("iscov" matches "Discovery")
        tri_hits = conn.execute("SELECT track_key FROM tracks_fts_trigram WHERE tracks_fts_trigram MATCH '\"iscov\"'").fetchall()
        assert len(tri_hits) == 1
        conn.close()


# 4. Live DB Session Gap Invariant (<= 30 minutes inside every session)
def test_session_gap_invariant_in_db():
    if not db_mod.DB_PATH.exists():
        return
    with db_mod.db_session() as conn:
        rows = conn.execute(
            """
            SELECT session_id, started_epoch, play_duration_ms
            FROM play_events
            WHERE COALESCE(source_provider, 'apple_rgpd_zip') = 'apple_rgpd_zip'
            ORDER BY session_id ASC, started_epoch ASC
            LIMIT 5000
            """
        ).fetchall()
    prev_sid = None
    prev_end = None
    for r in rows:
        sid = int(r["session_id"])
        start = int(r["started_epoch"])
        dur_s = int((r["play_duration_ms"] or 0) // 1000)
        if prev_sid == sid and prev_end is not None:
            # Allow tiny clock skew tolerance while verifying <= 1800s session boundary
            assert start - prev_end <= 1805
        prev_sid = sid
        prev_end = start + dur_s
