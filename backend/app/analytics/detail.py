import csv
import io
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql


def get_artist_detail(artist_key: str, f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        summary = conn.execute(
            f"""
            SELECT
                MAX(tc.artist_name) AS artist_name,
                MAX(tc.genre) AS genre,
                MAX(tc.artwork_url) AS artwork_url,
                COUNT(*) AS plays,
                COALESCE(SUM(pe.play_duration_ms), 0) AS total_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                COUNT(DISTINCT tc.album_group_key) AS unique_albums,
                COUNT(DISTINCT pe.local_date) AS active_days,
                AVG(pe.completion_ratio) AS avg_completion,
                MIN(pe.local_date) AS first_discovered,
                MAX(pe.local_date) AS last_played
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key = ?
            """,
            [*params, artist_key],
        ).fetchone()

        raw_skip = conn.execute(
            f"""
            SELECT COUNT(*) AS raw_plays, SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS skips
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_all} AND tc.artist_group_key = ?
            """,
            [*params_all, artist_key],
        ).fetchone()

        monthly = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT pe.local_month AS month, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key = ?
                GROUP BY pe.local_month
                ORDER BY pe.local_month ASC
                """,
                [*params, artist_key],
            )
        ]

        best_day = conn.execute(
            f"""
            SELECT pe.local_date AS date, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key = ?
            GROUP BY pe.local_date
            ORDER BY total_ms DESC, plays DESC
            LIMIT 1
            """,
            [*params, artist_key],
        ).fetchone()

        top_tracks = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    tc.track_key, tc.song_name, tc.album_name, tc.album_group_key,
                    tc.artwork_url, tc.preview_url, tc.release_year,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms,
                    ROUND(AVG(pe.completion_ratio) * 100, 1) AS avg_completion_pct
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key = ?
                GROUP BY tc.track_key
                ORDER BY {order_sql}
                LIMIT 20
                """,
                [*params, artist_key],
            )
        ]

        top_albums = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    tc.album_group_key, MAX(tc.album_name) AS album_name,
                    MAX(tc.artwork_url) AS artwork_url, MAX(tc.release_year) AS release_year,
                    COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key = ?
                GROUP BY tc.album_group_key
                ORDER BY {order_sql}
                LIMIT 10
                """,
                [*params, artist_key],
            )
        ]

    raw_p = (raw_skip["raw_plays"] or 1) if raw_skip else 1
    skip_pct = round(((raw_skip["skips"] or 0) / raw_p) * 100, 1) if raw_skip else 0.0

    return {
        "artist_group_key": artist_key,
        "summary": {
            **(dict(summary) if summary else {}),
            "avg_completion_pct": round(((summary["avg_completion"] or 0) * 100), 1) if summary else 0.0,
            "skip_rate_pct": skip_pct,
        },
        "best_day": dict(best_day) if best_day else None,
        "monthly": monthly,
        "top_tracks": top_tracks,
        "top_albums": top_albums,
    }


def get_album_detail(album_key: str, f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        summary = conn.execute(
            f"""
            SELECT
                MAX(tc.album_name) AS album_name,
                MAX(tc.artist_name) AS artist_name,
                MAX(tc.artist_group_key) AS artist_group_key,
                MAX(tc.genre) AS genre,
                MAX(tc.release_year) AS release_year,
                MAX(tc.artwork_url) AS artwork_url,
                COUNT(*) AS plays,
                COALESCE(SUM(pe.play_duration_ms), 0) AS total_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                AVG(pe.completion_ratio) AS avg_completion,
                MIN(pe.local_date) AS first_discovered,
                MAX(pe.local_date) AS last_played
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.album_group_key = ?
            """,
            [*params, album_key],
        ).fetchone()

        raw_skip = conn.execute(
            f"""
            SELECT COUNT(*) AS raw_plays, SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS skips
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_all} AND tc.album_group_key = ?
            """,
            [*params_all, album_key],
        ).fetchone()

        tracks = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    tc.track_key, tc.song_name, tc.artist_name, tc.artwork_url, tc.preview_url,
                    COUNT(*) AS plays,
                    SUM(pe.play_duration_ms) AS total_ms,
                    ROUND(AVG(pe.completion_ratio) * 100, 1) AS avg_completion_pct
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.album_group_key = ?
                GROUP BY tc.track_key
                ORDER BY {order_sql}
                """,
                [*params, album_key],
            )
        ]

        monthly = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT pe.local_month AS month, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.album_group_key = ?
                GROUP BY pe.local_month
                ORDER BY pe.local_month ASC
                """,
                [*params, album_key],
            )
        ]

    raw_p = (raw_skip["raw_plays"] or 1) if raw_skip else 1
    skip_pct = round(((raw_skip["skips"] or 0) / raw_p) * 100, 1) if raw_skip else 0.0

    return {
        "album_group_key": album_key,
        "summary": {
            **(dict(summary) if summary else {}),
            "avg_completion_pct": round(((summary["avg_completion"] or 0) * 100), 1) if summary else 0.0,
            "skip_rate_pct": skip_pct,
        },
        "tracks": tracks,
        "monthly": monthly,
    }


def get_day_detail(target_date: str, f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    with db_session() as conn:
        events = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    pe.id, pe.started_at_local, pe.play_duration_ms, pe.media_duration_ms,
                    pe.completion_ratio, pe.end_reason_type, pe.device_label, pe.container_type,
                    pe.playlist_name, pe.session_id,
                    tc.track_key, tc.song_name, tc.album_name, tc.artist_name,
                    tc.artist_group_key, tc.artwork_url, tc.preview_url
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND pe.local_date = ?
                ORDER BY pe.started_epoch ASC
                """,
                [*params, target_date],
            )
        ]

    total_ms = sum(e["play_duration_ms"] for e in events)
    return {
        "date": target_date,
        "plays": len(events),
        "total_ms": total_ms,
        "events": events,
    }


def get_sessions(f: FilterParams, limit: int = 60, offset: int = 0, sort: str = "recent") -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    order_clause = "total_ms DESC" if sort == "longest" else ("plays DESC" if sort == "most_plays" else "start_local DESC")

    with db_session() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(DISTINCT pe.session_id)
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            """,
            params,
        ).fetchone()[0]

        sess_rows = conn.execute(
            f"""
            SELECT
                pe.session_id,
                MIN(pe.started_at_local) AS start_local,
                MAX(pe.started_at_local) AS end_local,
                MIN(pe.local_date) AS local_date,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                COUNT(DISTINCT tc.artist_group_key) AS unique_artists,
                MAX(pe.device_label) AS device_label,
                MAX(pe.container_type) AS container_type,
                MAX(pe.playlist_name) AS playlist_name
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            GROUP BY pe.session_id
            ORDER BY {order_clause}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

        sessions = []
        for s in sess_rows:
            d = dict(s)
            # Fetch first 6 tracks preview for timeline card
            preview_tracks = [
                dict(r)
                for r in conn.execute(
                    f"""
                    SELECT
                        pe.started_at_local, pe.play_duration_ms, pe.completion_ratio,
                        tc.song_name, tc.artist_name, tc.album_name, tc.artwork_url, tc.preview_url
                    FROM play_events pe
                    JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                    WHERE {where_sql} AND pe.session_id = ?
                    ORDER BY pe.started_epoch ASC
                    LIMIT 12
                    """,
                    [*params, d["session_id"]],
                )
            ]
            d["tracks"] = preview_tracks
            sessions.append(d)

    return {"total": total, "items": sessions}


def get_history(
    f: FilterParams,
    *,
    search: str | None = None,
    sort_by: str = "started_at_local",
    sort_dir: str = "desc",
    limit: int = 200,
    offset: int = 0,
) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    if search:
        like = f"%{search.strip().lower()}%"
        where_sql += " AND (LOWER(tc.song_name) LIKE ? OR LOWER(COALESCE(tc.artist_name, '')) LIKE ? OR LOWER(tc.album_name) LIKE ?)"
        params.extend([like, like, like])

    allowed_sort = {
        "started_at_local": "pe.started_epoch",
        "play_duration_ms": "pe.play_duration_ms",
        "completion_ratio": "pe.completion_ratio",
        "song_name": "tc.song_name",
        "artist_name": "tc.artist_name",
    }
    col = allowed_sort.get(sort_by, "pe.started_epoch")
    direction = "ASC" if sort_dir.lower() == "asc" else "DESC"

    with db_session() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            """,
            params,
        ).fetchone()[0]

        rows = conn.execute(
            f"""
            SELECT
                pe.id, pe.started_at_local, pe.local_date, pe.play_duration_ms,
                pe.media_duration_ms, pe.completion_ratio, pe.end_reason_type,
                pe.device_label, pe.container_type, pe.playlist_name, pe.offline,
                pe.audio_quality, pe.session_id,
                tc.track_key, tc.song_name, tc.album_name, tc.album_group_key,
                tc.artist_name, tc.artist_group_key, tc.genre, tc.release_year,
                tc.artwork_url, tc.preview_url
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            ORDER BY {col} {direction}
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

    return {"total": total, "items": [dict(r) for r in rows]}


def export_history_csv(f: FilterParams, search: str | None = None) -> str:
    data = get_history(f, search=search, limit=100000, offset=0)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Date locale",
            "Titre",
            "Artiste",
            "Album",
            "Genre",
            "Année",
            "Durée écoutée (s)",
            "Durée titre (s)",
            "Complétion (%)",
            "Fin de lecture",
            "Appareil",
            "Source",
            "Playlist",
            "Hors-ligne",
        ]
    )
    for r in data["items"]:
        writer.writerow(
            [
                r["started_at_local"],
                r["song_name"],
                r["artist_name"] or "",
                r["album_name"],
                r["genre"] or "",
                r["release_year"] or "",
                round((r["play_duration_ms"] or 0) / 1000, 1),
                round((r["media_duration_ms"] or 0) / 1000, 1),
                round((r["completion_ratio"] or 0) * 100, 1),
                r["end_reason_type"],
                r["device_label"],
                r["container_type"],
                r["playlist_name"] or "",
                "Oui" if r["offline"] else "Non",
            ]
        )
    return buf.getvalue()
