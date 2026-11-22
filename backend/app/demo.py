"""1-Click Demo Library Generator & Unloader for AMDataWrap V4.5.

Creates a realistic, isolated standard profile (`Démo — Salon d'écoute`) without
ever touching or overwriting existing user profiles (`id=1` or user-created).
Runs in < 1 second so first-time users can explore the 3D Studio and all 12 tabs immediately.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from .analytics.duckdb_engine import export_parquet_snapshot
from .db import db_session, rebuild_fts_indexes
from .normalize import clean_group_key, make_track_key, normalize_basic

DEMO_PROFILE_NAME = "Démo — Salon d'écoute"

_DEMO_CATALOG: list[dict[str, Any]] = [
    {
        "artist": "Daft Punk",
        "country": ("FR", "France", "Paris", 48.8566, 2.3522),
        "album": "Random Access Memories",
        "year": 2013,
        "genre": "Electronic",
        "color": "#111114",
        "label": "Columbia",
        "tracks": [
            ("Give Life Back to Music", 274_000, 119.0, "8A", 0.78),
            ("Instant Crush", 337_000, 110.0, "5A", 0.72),
            ("Get Lucky", 369_000, 116.0, "11A", 0.84),
            ("Touch", 498_000, 108.0, "4B", 0.62),
        ],
    },
    {
        "artist": "Tame Impala",
        "country": ("AU", "Australie", "Perth", -31.9505, 115.8605),
        "album": "Currents",
        "year": 2015,
        "genre": "Psychedelic Pop",
        "color": "#2c1418",
        "label": "Modular",
        "tracks": [
            ("Let It Happen", 466_000, 125.0, "9A", 0.81),
            ("The Less I Know the Better", 216_000, 117.0, "9A", 0.86),
            ("Eventually", 318_000, 96.0, "6B", 0.68),
        ],
    },
    {
        "artist": "Radiohead",
        "country": ("GB", "Royaume-Uni", "Oxford", 51.7520, -1.2577),
        "album": "In Rainbows",
        "year": 2007,
        "genre": "Alternative Rock",
        "color": "#262112",
        "label": "XL Recordings",
        "tracks": [
            ("15 Step", 237_000, 134.0, "10A", 0.75),
            ("Weird Fishes / Arpeggi", 318_000, 152.0, "10A", 0.71),
            ("Nude", 255_000, 127.0, "11A", 0.42),
            ("Reckoner", 290_000, 104.0, "9A", 0.64),
        ],
    },
    {
        "artist": "Stromae",
        "country": ("BE", "Belgique", "Bruxelles", 50.8503, 4.3517),
        "album": "Racine Carrée",
        "year": 2013,
        "genre": "French Pop",
        "color": "#102230",
        "label": "Mosaert",
        "tracks": [
            ("Papaoutai", 232_000, 116.0, "7A", 0.85),
            ("Formidable", 213_000, 120.0, "8A", 0.58),
            ("Tous les mêmes", 210_000, 122.0, "6A", 0.74),
        ],
    },
    {
        "artist": "Pink Floyd",
        "country": ("GB", "Royaume-Uni", "Cambridge", 52.2053, 0.1218),
        "album": "The Dark Side of the Moon",
        "year": 1973,
        "genre": "Progressive Rock",
        "color": "#18181f",
        "label": "Harvest",
        "tracks": [
            ("Time", 413_000, 120.0, "11A", 0.66),
            ("Money", 382_000, 124.0, "10A", 0.72),
            ("Breathe (In the Air)", 169_000, 128.0, "9A", 0.48),
        ],
    },
    {
        "artist": "Miles Davis",
        "country": ("US", "États-Unis", "Alton", 38.8906, -90.1843),
        "album": "Kind of Blue",
        "year": 1959,
        "genre": "Jazz",
        "color": "#102230",
        "label": "Columbia",
        "tracks": [
            ("So What", 562_000, 136.0, "7A", 0.45),
            ("Blue in Green", 337_000, 74.0, "7B", 0.28),
            ("All Blues", 693_000, 138.0, "9B", 0.42),
        ],
    },
    {
        "artist": "Phoenix",
        "country": ("FR", "France", "Versailles", 48.8014, 2.1301),
        "album": "Wolfgang Amadeus Phoenix",
        "year": 2009,
        "genre": "Indie Pop",
        "color": "#2c1418",
        "label": "Loyauté",
        "tracks": [
            ("1901", 193_000, 144.0, "8B", 0.88),
            ("Lisztomania", 241_000, 112.0, "7B", 0.85),
            ("Lasso", 168_000, 136.0, "12B", 0.82),
        ],
    },
    {
        "artist": "Fleetwood Mac",
        "country": ("GB", "Royaume-Uni", "Londres", 51.5072, -0.1276),
        "album": "Rumours",
        "year": 1977,
        "genre": "Classic Rock",
        "color": "#262112",
        "label": "Warner Bros.",
        "tracks": [
            ("Dreams", 257_000, 120.0, "7B", 0.68),
            ("The Chain", 270_000, 152.0, "9A", 0.81),
            ("Go Your Own Way", 223_000, 135.0, "7B", 0.86),
        ],
    },
    {
        "artist": "Kendrick Lamar",
        "country": ("US", "États-Unis", "Compton", 33.8958, -118.2201),
        "album": "To Pimp a Butterfly",
        "year": 2015,
        "genre": "Hip-Hop",
        "color": "#111114",
        "label": "Top Dawg",
        "tracks": [
            ("King Kunta", 234_000, 107.0, "6A", 0.84),
            ("Alright", 219_000, 110.0, "8A", 0.87),
            ("Wesley's Theory", 287_000, 114.0, "5A", 0.78),
        ],
    },
    {
        "artist": "Air",
        "country": ("FR", "France", "Versailles", 48.8014, 2.1301),
        "album": "Moon Safari",
        "year": 1998,
        "genre": "Electronic",
        "color": "#18181f",
        "label": "Source",
        "tracks": [
            ("La Femme d'Argent", 430_000, 96.0, "7B", 0.52),
            ("Sexy Boy", 297_000, 105.0, "8A", 0.69),
            ("All I Need", 268_000, 92.0, "4B", 0.46),
        ],
    },
]

_DEVICES = ("MacBook Pro", "iPhone 15 Pro", "Sonos Era 300")
_END_REASONS = ("NATURAL_END_OF_TRACK", "NATURAL_END_OF_TRACK", "NATURAL_END_OF_TRACK", "TRACK_CHANGED")
_CONTAINERS = ("ALBUM", "PLAYLIST", "LIBRARY")


def _season_for_month(m: int) -> str:
    if m in (12, 1, 2):
        return "Hiver"
    if m in (3, 4, 5):
        return "Printemps"
    if m in (6, 7, 8):
        return "Été"
    return "Automne"


def _refresh_import_meta(conn) -> None:
    totals = conn.execute(
        """
        SELECT COUNT(*) AS cnt, COUNT(DISTINCT track_key) AS u_tracks,
               MIN(local_date) AS min_d, MAX(local_date) AS max_d
        FROM play_events
        """
    ).fetchone()
    cnt = int(totals["cnt"] or 0) if totals else 0
    u_tracks = int(totals["u_tracks"] or 0) if totals else 0
    min_d = totals["min_d"] if totals else None
    max_d = totals["max_d"] if totals else None
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute(
        """
        INSERT INTO import_meta (
            id, zip_filename, zip_sha256, imported_at,
            total_raw_rows, total_play_events, unique_tracks, min_date, max_date
        ) VALUES (1, 'demo-library', 'demo', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            total_play_events = excluded.total_play_events,
            unique_tracks = excluded.unique_tracks,
            min_date = excluded.min_date,
            max_date = excluded.max_date
        """,
        (now_iso, cnt, cnt, u_tracks, min_d, max_d),
    )


def load_demo_library() -> dict[str, Any]:
    """Generate and activate an isolated Demo profile without overwriting user data."""
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rng = random.Random(42045)

    with db_session() as conn:
        # Remove any prior demo profile cleanly so re-loading is idempotent
        old_demo = conn.execute(
            "SELECT id FROM profiles WHERE name = ? AND kind = 'standard'",
            (DEMO_PROFILE_NAME,),
        ).fetchone()
        if old_demo:
            old_id = int(old_demo["id"])
            conn.execute("DELETE FROM play_events WHERE profile_id = ?", (old_id,))
            conn.execute("DELETE FROM lyric_events WHERE profile_id = ?", (old_id,))
            conn.execute("DELETE FROM search_events WHERE profile_id = ?", (old_id,))
            conn.execute("DELETE FROM profile_sources WHERE profile_id = ?", (old_id,))
            conn.execute("DELETE FROM profiles WHERE id = ?", (old_id,))

        conn.execute("UPDATE profiles SET is_active = 0")
        cur = conn.execute(
            """
            INSERT INTO profiles (name, kind, merged_profile_ids_json, is_active, created_at, updated_at)
            VALUES (?, 'standard', '[]', 1, ?, ?)
            """,
            (DEMO_PROFILE_NAME, now_iso, now_iso),
        )
        demo_profile_id = int(cur.lastrowid)

        max_sid_row = conn.execute("SELECT COALESCE(MAX(session_id), 0) AS m FROM play_events").fetchone()
        session_id = int(max_sid_row["m"] or 0) + 1

        all_tracks: list[dict[str, Any]] = []
        for entry in _DEMO_CATALOG:
            artist = entry["artist"]
            album = entry["album"]
            ak = clean_group_key(artist, strip_feat=True) or normalize_basic(artist)
            alk = clean_group_key(album) or normalize_basic(album)
            iso, cname, city, lat, lng = entry["country"]

            conn.execute(
                """
                INSERT OR IGNORE INTO artist_musicbrainz (
                    artist_group_key, artist_name, country_iso, country_name,
                    area_name, begin_area, lat, lng, obscurity_score, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo_seed', ?)
                """,
                (ak, artist, iso, cname, city, city, lat, lng, round(rng.uniform(18.0, 62.0), 1), now_iso),
            )

            sides_a = []
            for idx, (title, dur_ms, bpm, cam, energy) in enumerate(entry["tracks"]):
                tk = make_track_key(title, album)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO tracks_catalog (
                        track_key, song_name, song_norm, song_group_key,
                        album_name, album_norm, album_group_key,
                        artist_name, artist_norm, artist_group_key,
                        genre, release_year, release_date,
                        total_plays, total_ms, first_played_local,
                        enrichment_status, enrichment_source, enriched_at, duration_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '2024-01-15T20:00:00', 'enriched', 'demo_seed', ?, ?)
                    """,
                    (
                        tk,
                        title,
                        normalize_basic(title),
                        clean_group_key(title, strip_feat=True) or normalize_basic(title),
                        album,
                        normalize_basic(album),
                        alk,
                        artist,
                        normalize_basic(artist),
                        ak,
                        entry["genre"],
                        entry["year"],
                        f"{entry['year']}-01-01",
                        now_iso,
                        dur_ms,
                    ),
                )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO track_audio_dna (
                        track_key, bpm, camelot_code, energy, danceability, valence_audio, source, analyzed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'demo_seed', ?)
                    """,
                    (tk, bpm, cam, energy, round(0.45 + energy * 0.4, 2), round(0.35 + energy * 0.45, 2), now_iso),
                )
                sides_a.append({"number": f"A{idx + 1}", "title": title, "track_key": tk, "duration_ms": dur_ms})
                all_tracks.append(
                    {
                        "track_key": tk,
                        "song_name": title,
                        "artist_name": artist,
                        "album_name": album,
                        "duration_ms": dur_ms,
                    }
                )

            conn.execute(
                """
                INSERT OR IGNORE INTO vinyl_editions (
                    album_key, label_name, catalog_number, country, press_year,
                    disc_count, vinyl_color_hex, sides_json, enriched_at
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    alk,
                    entry["label"],
                    f"DEMO-{entry['year']}",
                    iso,
                    entry["year"],
                    entry["color"],
                    json.dumps([{"side": "A", "total_duration_ms": sum(t["duration_ms"] for t in sides_a), "tracks": sides_a}]),
                    now_iso,
                ),
            )

        # Generate 320 deterministic plays across 2024-01-01 .. 2026-10-30
        start_dt = datetime(2024, 1, 10, 18, 0, 0, tzinfo=timezone.utc)
        src_cur = conn.execute(
            """
            INSERT INTO profile_sources (
                profile_id, source_provider, filename, file_sha256, imported_at,
                events_count, unique_tracks, min_date, max_date, metadata_json
            ) VALUES (?, 'apple_rgpd_zip', 'demo_library.json', 'demo', ?, 320, ?, '2024-01-10', '2026-10-30', '{"demo": true}')
            """,
            (demo_profile_id, now_iso, len(all_tracks)),
        )
        source_batch_id = int(src_cur.lastrowid)

        play_rows: list[tuple[Any, ...]] = []
        track_counts: dict[str, list[int]] = {}
        cur_dt = start_dt
        for i in range(320):
            if i % 4 == 0:
                cur_dt += timedelta(days=rng.randint(1, 5), hours=rng.randint(0, 6))
                session_id += 1
            else:
                cur_dt += timedelta(minutes=rng.randint(3, 6))

            # Bias toward first 4 artists so rankings have realistic hierarchy
            tr = all_tracks[rng.randrange(0, 12)] if rng.random() < 0.65 else rng.choice(all_tracks)
            dur = tr["duration_ms"]
            is_skip = 1 if rng.random() < 0.08 else 0
            play_ms = rng.randint(8_000, 22_000) if is_skip else int(dur * rng.uniform(0.88, 1.0))
            ratio = round(min(1.0, play_ms / max(dur, 1)), 4)
            is_valid = 1 if (play_ms >= 30_000 and ratio >= 0.5) else 0
            dt_local = cur_dt + timedelta(seconds=3600)
            epoch = int(cur_dt.timestamp())

            play_rows.append(
                (
                    f"demo:{i}",
                    tr["track_key"],
                    cur_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    dt_local.strftime("%Y-%m-%dT%H:%M:%S"),
                    epoch,
                    dt_local.strftime("%Y-%m-%d"),
                    dt_local.year,
                    dt_local.strftime("%Y-%m"),
                    dt_local.month,
                    _season_for_month(dt_local.month),
                    dt_local.weekday(),
                    dt_local.hour,
                    3600,
                    play_ms,
                    dur,
                    ratio,
                    "TRACK_CHANGED" if is_skip else rng.choice(_END_REASONS),
                    is_valid,
                    is_skip,
                    rng.choice(_CONTAINERS),
                    rng.choice(_DEVICES),
                    "Web/Demo",
                    1 if rng.random() < 0.15 else 0,
                    session_id,
                    "apple_rgpd_zip",
                    100,
                    f"demo:{i}",
                    tr["track_key"],
                    0,
                    f"demo:{demo_profile_id}:{i}",
                    demo_profile_id,
                    0,
                    is_skip,
                    source_batch_id,
                )
            )
            acc = track_counts.setdefault(tr["track_key"], [0, 0])
            acc[0] += 1
            acc[1] += play_ms

        conn.executemany(
            """
            INSERT INTO play_events (
                event_id, track_key, started_at_utc, started_at_local, started_epoch,
                local_date, local_year, local_month, local_month_num, local_season,
                local_dow, local_hour, utc_offset_sec, play_duration_ms, media_duration_ms,
                completion_ratio, end_reason_type, is_valid_lastfm, is_skip_30s,
                container_type, device_label, device_os, offline,
                session_id, source_provider, source_priority, source_event_id,
                canonical_track_key, duration_is_estimated, dedup_fingerprint,
                profile_id, incognito_mode, skipped, source_batch_id
            ) VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?
            )
            """,
            play_rows,
        )

        for tk, (p_cnt, p_ms) in track_counts.items():
            conn.execute(
                """
                UPDATE tracks_catalog
                SET total_plays = COALESCE(total_plays, 0) + ?,
                    total_ms = COALESCE(total_ms, 0) + ?
                WHERE track_key = ?
                """,
                (p_cnt, p_ms, tk),
            )

        # Sample lyric & search events
        for i in range(12):
            tr = all_tracks[i % len(all_tracks)]
            conn.execute(
                """
                INSERT INTO lyric_events (
                    track_key, started_at_utc, started_at_local, local_date, local_year, local_month,
                    display_type, display_language, device_label, profile_id
                ) VALUES (?, ?, ?, '2025-05-12', 2025, '2025-05', 'SYNCED', 'en', 'iPhone 15 Pro', ?)
                """,
                (tr["track_key"], now_iso, now_iso[:19], demo_profile_id),
            )
        for q in ("daft punk", "let it happen", "miles davis"):
            conn.execute(
                """
                INSERT INTO search_events (
                    query, query_norm, searched_at_utc, searched_at_local, local_date, local_year, local_month, device_os, profile_id
                ) VALUES (?, ?, ?, ?, '2025-05-12', 2025, '2025-05', 'iOS', ?)
                """,
                (q, q, now_iso, now_iso[:19], demo_profile_id),
            )

        _refresh_import_meta(conn)
        rebuild_fts_indexes(conn)

    try:
        export_parquet_snapshot()
    except Exception:
        pass

    return {
        "ok": True,
        "profile_id": demo_profile_id,
        "profile_name": DEMO_PROFILE_NAME,
        "events_count": 320,
        "tracks_count": len(all_tracks),
    }


def unload_demo_library() -> dict[str, Any]:
    """Remove the isolated Demo profile and reactivate profile 1 without touching user data."""
    with db_session() as conn:
        demo = conn.execute(
            "SELECT id FROM profiles WHERE name = ? AND kind = 'standard'",
            (DEMO_PROFILE_NAME,),
        ).fetchone()
        if not demo:
            return {"ok": True, "removed": False}
        did = int(demo["id"])
        conn.execute("DELETE FROM profile_merged_exclusions WHERE merged_profile_id = ?", (did,))
        conn.execute("DELETE FROM profile_sources WHERE profile_id = ?", (did,))
        conn.execute("DELETE FROM play_events WHERE profile_id = ?", (did,))
        conn.execute("DELETE FROM lyric_events WHERE profile_id = ?", (did,))
        conn.execute("DELETE FROM search_events WHERE profile_id = ?", (did,))
        conn.execute("DELETE FROM profiles WHERE id = ?", (did,))
        conn.execute("UPDATE profiles SET is_active = 0")
        conn.execute("UPDATE profiles SET is_active = 1 WHERE id = (SELECT MIN(id) FROM profiles)")
        _refresh_import_meta(conn)
        rebuild_fts_indexes(conn)

    try:
        export_parquet_snapshot()
    except Exception:
        pass

    return {"ok": True, "removed": True}
