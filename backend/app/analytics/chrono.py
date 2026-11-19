from collections import defaultdict
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause


DOW_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]


def get_chronobiology(f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    use_plays = f.metric == "plays"

    with db_session() as conn:
        # 1. GitHub-style daily heatmap
        daily_rows = conn.execute(
            f"""
            SELECT
                pe.local_date AS date,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            GROUP BY pe.local_date
            ORDER BY pe.local_date ASC
            """,
            params,
        ).fetchall()

        heatmap = [dict(r) for r in daily_rows]

        # 2. Hour x Day-of-week matrix (7 x 24)
        matrix_rows = conn.execute(
            f"""
            SELECT
                pe.local_dow AS dow,
                pe.local_hour AS hour,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            GROUP BY pe.local_dow, pe.local_hour
            """,
            params,
        ).fetchall()

        matrix = [
            {
                "dow": r["dow"],
                "dow_label": DOW_LABELS[r["dow"]],
                "hour": r["hour"],
                "plays": r["plays"],
                "total_ms": r["total_ms"],
                "value": r["plays"] if use_plays else round(r["total_ms"] / 60000, 1),
            }
            for r in matrix_rows
        ]

        # Time-of-day slots
        slots = {"Matin (6h–12h)": 0, "Journée (12h–18h)": 0, "Soirée (18h–23h)": 0, "Nuit (23h–6h)": 0}
        hourly_totals = [0] * 24
        for r in matrix_rows:
            val = r["plays"] if use_plays else r["total_ms"]
            h = r["hour"]
            hourly_totals[h] += val
            if 6 <= h < 12:
                slots["Matin (6h–12h)"] += val
            elif 12 <= h < 18:
                slots["Journée (12h–18h)"] += val
            elif 18 <= h < 23:
                slots["Soirée (18h–23h)"] += val
            else:
                slots["Nuit (23h–6h)"] += val

        total_slot_val = sum(slots.values()) or 1
        time_slots = [
            {
                "label": k,
                "value": v if use_plays else round(v / 3_600_000, 1),
                "share_pct": round(v / total_slot_val * 100, 1),
            }
            for k, v in slots.items()
        ]
        peak_hour = max(range(24), key=lambda h: hourly_totals[h]) if any(hourly_totals) else 0

        # 3. Monthly volume trend
        monthly_rows = conn.execute(
            f"""
            SELECT
                pe.local_month AS month,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(DISTINCT tc.artist_group_key) AS unique_artists,
                COUNT(DISTINCT pe.track_key) AS unique_tracks
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            GROUP BY pe.local_month
            ORDER BY pe.local_month ASC
            """,
            params,
        ).fetchall()
        monthly_trend = [dict(r) for r in monthly_rows]
        months = [r["month"] for r in monthly_rows]

        # 4. Top 10 Artists evolution month-by-month (for Streamgraph / Bump Chart)
        top10_artists = conn.execute(
            f"""
            SELECT
                tc.artist_group_key,
                MAX(tc.artist_name) AS artist_name,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY {"plays DESC" if use_plays else "total_ms DESC"}
            LIMIT 10
            """,
            params,
        ).fetchall()

        artist_keys = [r["artist_group_key"] for r in top10_artists]
        artist_names = {r["artist_group_key"]: r["artist_name"] for r in top10_artists}
        artist_series = []
        if artist_keys and months:
            placeholders = ",".join("?" for _ in artist_keys)
            ev_rows = conn.execute(
                f"""
                SELECT
                    pe.local_month AS month,
                    tc.artist_group_key,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key IN ({placeholders})
                GROUP BY pe.local_month, tc.artist_group_key
                """,
                [*params, *artist_keys],
            ).fetchall()
            grid: dict[str, dict[str, float]] = defaultdict(dict)
            for r in ev_rows:
                val = r["plays"] if use_plays else round(r["total_ms"] / 60000, 1)
                grid[r["artist_group_key"]][r["month"]] = val

            for ak in artist_keys:
                artist_series.append(
                    {
                        "key": ak,
                        "name": artist_names[ak],
                        "values": [grid[ak].get(m, 0) for m in months],
                    }
                )

        # 5. Top 8 Genres evolution month-by-month
        top8_genres = conn.execute(
            f"""
            SELECT tc.genre, SUM(pe.play_duration_ms) AS total_ms, COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.genre IS NOT NULL AND tc.genre != ''
            GROUP BY tc.genre
            ORDER BY {"plays DESC" if use_plays else "total_ms DESC"}
            LIMIT 8
            """,
            params,
        ).fetchall()
        genre_names = [r["genre"] for r in top8_genres]
        genre_series = []
        if genre_names and months:
            placeholders = ",".join("?" for _ in genre_names)
            gev_rows = conn.execute(
                f"""
                SELECT
                    pe.local_month AS month,
                    tc.genre,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.genre IN ({placeholders})
                GROUP BY pe.local_month, tc.genre
                """,
                [*params, *genre_names],
            ).fetchall()
            ggrid: dict[str, dict[str, float]] = defaultdict(dict)
            for r in gev_rows:
                val = r["plays"] if use_plays else round(r["total_ms"] / 60000, 1)
                ggrid[r["genre"]][r["month"]] = val

            for gn in genre_names:
                genre_series.append(
                    {
                        "name": gn,
                        "values": [ggrid[gn].get(m, 0) for m in months],
                    }
                )

    return {
        "heatmap": heatmap,
        "matrix": matrix,
        "time_slots": time_slots,
        "peak_hour": peak_hour,
        "monthly_trend": monthly_trend,
        "evolution": {
            "months": months,
            "artists": artist_series,
            "genres": genre_series,
        },
    }
