from collections import Counter, defaultdict
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql


def get_sonic_galaxy(f: FilterParams, limit: int = 75) -> dict[str, Any]:
    """
    Build a 3D Sonic Constellation graph:
    - Nodes: Top artists with total_ms, plays, primary genre, weighted release year, artwork, preview_url
    - Edges: Real session co-occurrence links (artists frequently heard in the same listening session!)
    """
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    order_sql = metric_order_sql(f)

    with db_session() as conn:
        artist_rows = conn.execute(
            f"""
            SELECT
                tc.artist_group_key,
                MAX(tc.artist_name) AS artist_name,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                MAX(tc.genre) AS genre,
                CAST(ROUND(AVG(CASE WHEN tc.release_year IS NOT NULL THEN tc.release_year END)) AS INTEGER) AS avg_year,
                MAX(tc.artwork_url) AS artwork_url,
                MAX(tc.preview_url) AS preview_url,
                MAX(tc.song_name) AS sample_song
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY {order_sql}
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

        nodes = [dict(r) for r in artist_rows]
        node_keys = {n["artist_group_key"] for n in nodes}

        # Pick the best track preview & artwork for each artist (their #1 track!)
        if node_keys:
            placeholders = ",".join("?" for _ in node_keys)
            best_tracks = conn.execute(
                f"""
                SELECT
                    tc.artist_group_key, tc.song_name, tc.artwork_url, tc.preview_url,
                    SUM(pe.play_duration_ms) AS ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key IN ({placeholders})
                GROUP BY tc.artist_group_key, tc.track_key
                ORDER BY tc.artist_group_key, ms DESC
                """,
                [*params, *node_keys],
            ).fetchall()

            best_map: dict[str, dict[str, Any]] = {}
            for r in best_tracks:
                ak = r["artist_group_key"]
                if ak not in best_map:
                    best_map[ak] = dict(r)
                else:
                    if not best_map[ak]["artwork_url"] and r["artwork_url"]:
                        best_map[ak]["artwork_url"] = r["artwork_url"]
                    if not best_map[ak]["preview_url"] and r["preview_url"]:
                        best_map[ak]["preview_url"] = r["preview_url"]

            for idx, n in enumerate(nodes):
                n["rank"] = idx + 1
                bt = best_map.get(n["artist_group_key"])
                if bt:
                    n["artwork_url"] = bt["artwork_url"] or n["artwork_url"]
                    n["preview_url"] = bt["preview_url"] or n["preview_url"]
                    n["sample_song"] = bt["song_name"] or n["sample_song"]

        # Compute real session co-occurrence edges between these top artists
        edges = []
        if node_keys:
            placeholders = ",".join("?" for _ in node_keys)
            sess_rows = conn.execute(
                f"""
                SELECT DISTINCT pe.session_id, tc.artist_group_key
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key IN ({placeholders})
                """,
                [*params, *node_keys],
            ).fetchall()

            sess_artists: dict[int, list[str]] = defaultdict(list)
            for r in sess_rows:
                sess_artists[r["session_id"]].append(r["artist_group_key"])

            pair_counts: Counter = Counter()
            for arts in sess_artists.values():
                if len(arts) < 2 or len(arts) > 18:
                    continue
                arts_sorted = sorted(arts)
                for i in range(len(arts_sorted)):
                    for j in range(i + 1, len(arts_sorted)):
                        pair_counts[(arts_sorted[i], arts_sorted[j])] += 1

            for (a, b), w in pair_counts.most_common(120):
                if w >= 2:
                    edges.append({"source": a, "target": b, "weight": w})

    # Distinct genres list for color clustering
    genres = []
    seen_g = set()
    for n in nodes:
        g = n.get("genre") or "Autre"
        if g not in seen_g:
            seen_g.add(g)
            genres.append(g)

    return {"nodes": nodes, "edges": edges, "genres": genres}
