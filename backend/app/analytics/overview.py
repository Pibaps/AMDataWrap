from datetime import date, timedelta
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql


def get_filter_options(
    profile_id: int | None = None,
    source_provider: str | None = None,
) -> dict[str, Any]:
    pe_where, pe_params = build_where_clause(
        FilterParams(profile_id=profile_id, source_provider=source_provider),
        include_skip_filter=False,
    )
    with db_session() as conn:
        meta = conn.execute("SELECT * FROM import_meta WHERE id = 1").fetchone()
        years = [
            r[0]
            for r in conn.execute(
                f"SELECT DISTINCT pe.local_year FROM play_events pe WHERE {pe_where} ORDER BY pe.local_year DESC",
                pe_params,
            )
        ]
        months = [
            r[0]
            for r in conn.execute(
                f"SELECT DISTINCT pe.local_month FROM play_events pe WHERE {pe_where} ORDER BY pe.local_month DESC",
                pe_params,
            )
        ]
        seasons = ["Hiver", "Printemps", "Été", "Automne"]
        genres = [
            r[0]
            for r in conn.execute(
                f"""
                SELECT tc.genre, SUM(pe.play_duration_ms) AS ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE tc.genre IS NOT NULL AND tc.genre != '' AND {pe_where}
                GROUP BY tc.genre
                ORDER BY ms DESC
                LIMIT 60
                """,
                pe_params,
            )
        ]
        if profile_id is not None:
            decades = [
                r[0]
                for r in conn.execute(
                    f"""
                    SELECT DISTINCT (tc.release_year / 10) * 10 AS dec
                    FROM play_events pe
                    JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                    WHERE {pe_where} AND tc.release_year IS NOT NULL AND tc.release_year >= 1940
                    ORDER BY dec DESC
                    """,
                    pe_params,
                )
            ]
        else:
            decades = [
                r[0]
                for r in conn.execute(
                    """
                    SELECT DISTINCT (release_year / 10) * 10 AS dec
                    FROM tracks_catalog
                    WHERE release_year IS NOT NULL AND release_year >= 1940
                    ORDER BY dec DESC
                    """
                )
            ]
        artists = [
            {"key": r["artist_group_key"], "name": r["artist_name"]}
            for r in conn.execute(
                f"""
                SELECT tc.artist_group_key, MAX(tc.artist_name) AS artist_name, SUM(pe.play_duration_ms) AS ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE tc.artist_group_key IS NOT NULL AND tc.artist_group_key != '' AND {pe_where}
                GROUP BY tc.artist_group_key
                ORDER BY ms DESC
                LIMIT 250
                """,
                pe_params,
            )
        ]
        containers = [
            r[0]
            for r in conn.execute(
                f"SELECT pe.container_type, COUNT(*) AS c FROM play_events pe WHERE {pe_where} AND pe.container_type IS NOT NULL GROUP BY pe.container_type ORDER BY c DESC",
                pe_params,
            )
        ]
        features = [
            r[0]
            for r in conn.execute(
                f"SELECT pe.feature_name, COUNT(*) AS c FROM play_events pe WHERE {pe_where} AND pe.feature_name IS NOT NULL GROUP BY pe.feature_name ORDER BY c DESC LIMIT 30",
                pe_params,
            )
        ]
        devices = [
            r[0]
            for r in conn.execute(
                f"SELECT pe.device_label, COUNT(*) AS c FROM play_events pe WHERE {pe_where} AND pe.device_label IS NOT NULL GROUP BY pe.device_label ORDER BY c DESC",
                pe_params,
            )
        ]
        providers = [
            r[0]
            for r in conn.execute(
                f"""
                SELECT COALESCE(pe.source_provider, 'apple_rgpd_zip') AS sp, COUNT(*) AS c
                FROM play_events pe
                WHERE {pe_where}
                GROUP BY sp
                ORDER BY c DESC
                """,
                pe_params,
            )
            if r[0] not in ("extension_bridge", "preview_audio", "youtube_iframe")
        ]

    return {
        "meta": dict(meta) if meta else None,
        "years": years,
        "months": months,
        "seasons": seasons,
        "genres": genres,
        "decades": decades,
        "artists": artists,
        "containers": containers,
        "features": features,
        "devices": devices,
        "providers": providers,
    }


def _compute_longest_streak(dates_sorted: list[str]) -> dict[str, Any]:
    if not dates_sorted:
        return {"days": 0, "start": None, "end": None}
    best_len = 1
    best_start = dates_sorted[0]
    best_end = dates_sorted[0]
    cur_len = 1
    cur_start = dates_sorted[0]
    prev_d = date.fromisoformat(dates_sorted[0])

    for ds in dates_sorted[1:]:
        d = date.fromisoformat(ds)
        if d == prev_d + timedelta(days=1):
            cur_len += 1
        else:
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
                best_end = prev_d.isoformat()
            cur_len = 1
            cur_start = ds
        prev_d = d

    if cur_len > best_len:
        best_len = cur_len
        best_start = cur_start
        best_end = prev_d.isoformat()

    return {"days": best_len, "start": best_start, "end": best_end}


def get_overview(f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        kpi = conn.execute(
            f"""
            SELECT
                COUNT(*) AS plays,
                COALESCE(SUM(pe.play_duration_ms), 0) AS total_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                COUNT(DISTINCT tc.album_group_key) AS unique_albums,
                COUNT(DISTINCT tc.artist_group_key) AS unique_artists,
                COUNT(DISTINCT pe.local_date) AS active_days,
                COUNT(DISTINCT pe.session_id) AS total_sessions,
                AVG(pe.completion_ratio) AS avg_completion,
                MIN(pe.local_date) AS min_date,
                MAX(pe.local_date) AS max_date
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            """,
            params,
        ).fetchone()

        skip_stats = conn.execute(
            f"""
            SELECT
                COUNT(*) AS all_events,
                SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS skips_30s,
                SUM(CASE WHEN pe.is_valid_lastfm = 0 THEN 1 ELSE 0 END) AS skips_lastfm,
                SUM(CASE WHEN pe.offline = 1 THEN 1 ELSE 0 END) AS offline_plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_all}
            """,
            params_all,
        ).fetchone()

        # Active dates for longest streak
        active_dates = [
            r[0]
            for r in conn.execute(
                f"""
                SELECT DISTINCT pe.local_date
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql}
                ORDER BY pe.local_date ASC
                """,
                params,
            )
        ]
        streak = _compute_longest_streak(active_dates)

        # Record day
        rec_day_row = conn.execute(
            f"""
            SELECT pe.local_date, SUM(pe.play_duration_ms) AS total_ms, COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            GROUP BY pe.local_date
            ORDER BY {order_sql}
            LIMIT 1
            """,
            params,
        ).fetchone()

        record_day = None
        if rec_day_row:
            top_day_artist = conn.execute(
                f"""
                SELECT COALESCE(MAX(tc.artist_name), 'Inconnu') AS artist_name, SUM(pe.play_duration_ms) AS ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND pe.local_date = ?
                GROUP BY tc.artist_group_key
                ORDER BY ms DESC
                LIMIT 1
                """,
                [*params, rec_day_row["local_date"]],
            ).fetchone()
            record_day = {
                "date": rec_day_row["local_date"],
                "total_ms": rec_day_row["total_ms"],
                "plays": rec_day_row["plays"],
                "top_artist": top_day_artist["artist_name"] if top_day_artist else None,
            }

        # Longest session
        long_sess_row = conn.execute(
            f"""
            SELECT
                pe.session_id,
                MIN(pe.started_at_local) AS start_local,
                MAX(pe.started_at_local) AS end_local,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            GROUP BY pe.session_id
            ORDER BY total_ms DESC
            LIMIT 1
            """,
            params,
        ).fetchone()

        longest_session = dict(long_sess_row) if long_sess_row else None

        # Breakdowns: devices, containers, audio quality, playlists
        devices = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT pe.device_label AS label, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql}
                GROUP BY pe.device_label
                ORDER BY {order_sql}
                """,
                params,
            )
        ]

        containers = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT pe.container_type AS label, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql}
                GROUP BY pe.container_type
                ORDER BY {order_sql}
                """,
                params,
            )
        ]

        top_playlists = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT pe.playlist_name AS name, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND pe.playlist_name IS NOT NULL AND pe.playlist_name != ''
                GROUP BY pe.playlist_name
                ORDER BY {order_sql}
                LIMIT 8
                """,
                params,
            )
        ]

        audio_quality = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT COALESCE(pe.audio_quality, 'NON_SPECIFIE') AS label, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND pe.audio_quality IS NOT NULL
                GROUP BY pe.audio_quality
                ORDER BY total_ms DESC
                """,
                params,
            )
        ]

    total_ms = kpi["total_ms"] or 0
    active_days = kpi["active_days"] or 0
    all_events = skip_stats["all_events"] or 0

    # Top 5 preview for overview + #1 artwork for ambient mesh gradient
    top_artists = get_top_artists(f, limit=5)["items"]
    top_tracks = get_top_tracks(f, limit=5)["items"]
    top_albums = get_top_albums(f, limit=5)["items"]
    top_genres = get_top_genres(f, limit=6)["items"]

    return {
        "kpis": {
            "plays": kpi["plays"] or 0,
            "total_ms": total_ms,
            "total_hours": round(total_ms / 3_600_000, 1),
            "total_days": round(total_ms / 86_400_000, 2),
            "unique_tracks": kpi["unique_tracks"] or 0,
            "unique_albums": kpi["unique_albums"] or 0,
            "unique_artists": kpi["unique_artists"] or 0,
            "active_days": active_days,
            "daily_avg_ms": int(total_ms / active_days) if active_days else 0,
            "total_sessions": kpi["total_sessions"] or 0,
            "avg_completion_pct": round((kpi["avg_completion"] or 0) * 100, 1),
            "skip_rate_30s_pct": round(((skip_stats["skips_30s"] or 0) / all_events * 100), 1) if all_events else 0.0,
            "skip_rate_lastfm_pct": round(((skip_stats["skips_lastfm"] or 0) / all_events * 100), 1) if all_events else 0.0,
            "offline_plays": skip_stats["offline_plays"] or 0,
            "min_date": kpi["min_date"],
            "max_date": kpi["max_date"],
        },
        "records": {
            "longest_streak": streak,
            "record_day": record_day,
            "longest_session": longest_session,
        },
        "top_artists": top_artists,
        "top_tracks": top_tracks,
        "top_albums": top_albums,
        "top_genres": top_genres,
        "breakdowns": {
            "devices": devices,
            "containers": containers,
            "playlists": top_playlists,
            "audio_quality": audio_quality,
        },
    }


def get_top_artists(f: FilterParams, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        rows = conn.execute(
            f"""
            WITH filtered AS (
                SELECT
                    tc.artist_group_key,
                    MAX(tc.artist_name) AS artist_name,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms,
                    COUNT(DISTINCT pe.track_key) AS unique_tracks,
                    COUNT(DISTINCT tc.album_group_key) AS unique_albums,
                    AVG(pe.completion_ratio) AS avg_completion,
                    MIN(pe.local_date) AS first_discovered,
                    MAX(tc.genre) AS primary_genre,
                    (
                        SELECT tc2.artwork_url
                        FROM tracks_catalog tc2
                        WHERE tc2.artist_group_key = tc.artist_group_key
                          AND tc2.artwork_url IS NOT NULL AND tc2.artwork_url != ''
                        ORDER BY tc2.total_plays DESC, tc2.song_name ASC
                        LIMIT 1
                    ) AS artwork_url
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
                GROUP BY tc.artist_group_key
            ),
            all_ev AS (
                SELECT
                    tc.artist_group_key,
                    COUNT(*) AS raw_plays,
                    SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS raw_skips
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_all} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
                GROUP BY tc.artist_group_key
            )
            SELECT
                f.*,
                COALESCE(a.raw_plays, f.plays) AS raw_plays,
                COALESCE(a.raw_skips, 0) AS raw_skips
            FROM filtered f
            LEFT JOIN all_ev a ON a.artist_group_key = f.artist_group_key
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, *params_all, limit, offset],
        ).fetchall()

        total_count = conn.execute(
            f"""
            SELECT COUNT(DISTINCT tc.artist_group_key)
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            """,
            params,
        ).fetchone()[0]

        # Best artwork per artist (from their most-played track with artwork)
        items = []
        for idx, r in enumerate(rows):
            d = dict(r)
            raw_p = d["raw_plays"] or 1
            d["rank"] = offset + idx + 1
            d["skip_rate_pct"] = round((d["raw_skips"] / raw_p) * 100, 1)
            d["avg_completion_pct"] = round((d["avg_completion"] or 0) * 100, 1)
            items.append(d)

    return {"total": total_count, "items": items}


def get_top_albums(f: FilterParams, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        rows = conn.execute(
            f"""
            WITH filtered AS (
                SELECT
                    tc.album_group_key,
                    MAX(tc.album_name) AS album_name,
                    MAX(tc.artist_name) AS artist_name,
                    MAX(tc.artist_group_key) AS artist_group_key,
                    MAX(tc.release_year) AS release_year,
                    MAX(tc.genre) AS genre,
                    (
                        SELECT tc2.artwork_url
                        FROM tracks_catalog tc2
                        WHERE tc2.album_group_key = tc.album_group_key
                          AND tc2.artwork_url IS NOT NULL AND tc2.artwork_url != ''
                        GROUP BY tc2.artwork_url
                        ORDER BY (COUNT(*) >= 2) DESC, SUM(tc2.total_plays) DESC, COUNT(*) DESC
                        LIMIT 1
                    ) AS artwork_url,
                    MAX(tc.preview_url) AS preview_url,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms,
                    COUNT(DISTINCT pe.track_key) AS unique_tracks,
                    AVG(pe.completion_ratio) AS avg_completion,
                    MIN(pe.local_date) AS first_discovered
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.album_group_key IS NOT NULL AND tc.album_group_key != ''
                GROUP BY tc.album_group_key
            ),
            all_ev AS (
                SELECT
                    tc.album_group_key,
                    COUNT(*) AS raw_plays,
                    SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS raw_skips
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_all} AND tc.album_group_key IS NOT NULL AND tc.album_group_key != ''
                GROUP BY tc.album_group_key
            )
            SELECT
                f.*,
                COALESCE(a.raw_plays, f.plays) AS raw_plays,
                COALESCE(a.raw_skips, 0) AS raw_skips
            FROM filtered f
            LEFT JOIN all_ev a ON a.album_group_key = f.album_group_key
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, *params_all, limit, offset],
        ).fetchall()

        total_count = conn.execute(
            f"""
            SELECT COUNT(DISTINCT tc.album_group_key)
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.album_group_key IS NOT NULL AND tc.album_group_key != ''
            """,
            params,
        ).fetchone()[0]

    items = []
    for idx, r in enumerate(rows):
        d = dict(r)
        raw_p = d["raw_plays"] or 1
        d["rank"] = offset + idx + 1
        d["skip_rate_pct"] = round((d["raw_skips"] / raw_p) * 100, 1)
        d["avg_completion_pct"] = round((d["avg_completion"] or 0) * 100, 1)
        items.append(d)

    return {"total": total_count, "items": items}


def get_top_tracks(f: FilterParams, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        rows = conn.execute(
            f"""
            WITH filtered AS (
                SELECT
                    tc.track_key,
                    tc.song_name,
                    tc.album_name,
                    tc.album_group_key,
                    tc.artist_name,
                    tc.artist_group_key,
                    tc.genre,
                    tc.release_year,
                    tc.artwork_url,
                    tc.preview_url,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms,
                    AVG(pe.completion_ratio) AS avg_completion,
                    MIN(pe.local_date) AS first_discovered
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql}
                GROUP BY tc.track_key
            ),
            all_ev AS (
                SELECT
                    pe.track_key,
                    COUNT(*) AS raw_plays,
                    SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS raw_skips
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_all}
                GROUP BY pe.track_key
            )
            SELECT
                f.*,
                COALESCE(a.raw_plays, f.plays) AS raw_plays,
                COALESCE(a.raw_skips, 0) AS raw_skips
            FROM filtered f
            LEFT JOIN all_ev a ON a.track_key = f.track_key
            ORDER BY {order_sql}
            LIMIT ? OFFSET ?
            """,
            [*params, *params_all, limit, offset],
        ).fetchall()

        total_count = conn.execute(
            f"""
            SELECT COUNT(DISTINCT pe.track_key)
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            """,
            params,
        ).fetchone()[0]

    items = []
    for idx, r in enumerate(rows):
        d = dict(r)
        raw_p = d["raw_plays"] or 1
        d["rank"] = offset + idx + 1
        d["skip_rate_pct"] = round((d["raw_skips"] / raw_p) * 100, 1)
        d["avg_completion_pct"] = round((d["avg_completion"] or 0) * 100, 1)
        items.append(d)

    return {"total": total_count, "items": items}


def get_top_genres(f: FilterParams, limit: int = 30) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT
                COALESCE(tc.genre, 'Non classé') AS genre,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(DISTINCT tc.artist_group_key) AS unique_artists,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                AVG(pe.completion_ratio) AS avg_completion
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.genre IS NOT NULL AND tc.genre != ''
            GROUP BY tc.genre
            ORDER BY {order_sql}
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

    total_metric = sum(r["plays"] if f.metric == "plays" else r["total_ms"] for r in rows) or 1
    items = []
    for idx, r in enumerate(rows):
        d = dict(r)
        val = d["plays"] if f.metric == "plays" else d["total_ms"]
        d["rank"] = idx + 1
        d["share_pct"] = round((val / total_metric) * 100, 1)
        d["avg_completion_pct"] = round((d["avg_completion"] or 0) * 100, 1)
        items.append(d)

    return {"items": items}
