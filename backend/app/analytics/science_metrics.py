"""Information-theory metrics (Eddington, Gini/Lorenz, Shannon Entropy, Survival & Co-occurrence Graph)."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql
from .duckdb_engine import ensure_parquet_snapshot, query_parquet


def compute_eddington_number(daily_counts: list[int]) -> dict[str, Any]:
    """Largest integer E such that at least E days had at least E plays."""
    if not daily_counts:
        return {"eddington": 0, "next_target": 1, "days_at_next": 0, "days_needed_for_next": 1}
    desc = sorted((int(c) for c in daily_counts if c > 0), reverse=True)
    e = 0
    for idx, cnt in enumerate(desc, start=1):
        if cnt >= idx:
            e = idx
        else:
            break
    nxt = e + 1
    days_at_next = sum(1 for c in desc if c >= nxt)
    return {
        "eddington": e,
        "next_target": nxt,
        "days_at_next": days_at_next,
        "days_needed_for_next": max(0, nxt - days_at_next),
    }


def compute_gini_and_effective_core(values: list[float]) -> dict[str, Any]:
    """Normalized Gini coefficient G in [0, 1] and Effective Core D_eff = floor(K * (1 - G))."""
    vals = sorted(float(v) for v in values if v > 0)
    k = len(vals)
    if k == 0:
        return {"k": 0, "gini": 0.0, "effective_core": 0, "lorenz": []}
    if k == 1:
        return {"k": 1, "gini": 0.0, "effective_core": 1, "lorenz": [{"p": 0.0, "l": 0.0}, {"p": 1.0, "l": 1.0}]}
    total = sum(vals)
    weighted = 0.0
    for i, v in enumerate(vals, start=1):
        weighted += (2 * i - k - 1) * v
    gini = max(0.0, min(1.0, weighted / (k * total)))
    d_eff = max(1, int(math.floor(k * (1.0 - gini))))

    lorenz = [{"p": 0.0, "l": 0.0}]
    running = 0.0
    step = max(1, k // 24)
    for i, v in enumerate(vals, start=1):
        running += v
        if i % step == 0 or i == k:
            lorenz.append({"p": round(i / k, 4), "l": round(running / total, 4)})
    return {
        "k": k,
        "gini": round(gini, 4),
        "effective_core": d_eff,
        "lorenz": lorenz,
    }


def compute_shannon_entropy(counts: list[float]) -> dict[str, float]:
    """Shannon entropy H in bits and normalized H_norm in [0, 1]."""
    vals = [float(c) for c in counts if c > 0]
    total = sum(vals)
    k = len(vals)
    if k <= 1 or total <= 0:
        return {"bits": 0.0, "normalized": 0.0, "perplexity": float(k)}
    h = -sum((v / total) * math.log2(v / total) for v in vals)
    max_h = math.log2(k)
    return {
        "bits": round(h, 4),
        "normalized": round(h / max_h, 4) if max_h > 0 else 0.0,
        "perplexity": round(2.0 ** h, 2),
    }


def get_science_metrics(f: FilterParams) -> dict[str, Any]:
    where, params = build_where_clause(f)
    with db_session() as conn:
        daily_rows = conn.execute(
            f"""
            SELECT pe.local_date, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where}
            GROUP BY pe.local_date
            """,
            params,
        ).fetchall()

        artist_rows = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   MAX(tc.genre) AS genre, MAX(tc.artwork_url) AS artwork_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   MIN(pe.local_date) AS first_date, MAX(pe.local_date) AS last_date,
                   COUNT(DISTINCT pe.local_month) AS active_months
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY total_ms DESC
            """,
            params,
        ).fetchall()

        track_ms_rows = conn.execute(
            f"""
            SELECT SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where}
            GROUP BY tc.track_key
            """,
            params,
        ).fetchall()

        device_artist_rows = conn.execute(
            f"""
            SELECT COALESCE(pe.device_label, 'Inconnu') AS device, tc.artist_group_key,
                   SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where}
            GROUP BY device, tc.artist_group_key
            """,
            params,
        ).fetchall()

        artist_month_rows = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, pe.local_month, COUNT(*) AS plays,
                   SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key, pe.local_month
            ORDER BY pe.local_month ASC
            """,
            params,
        ).fetchall()

        seq_rows = conn.execute(
            f"""
            SELECT pe.session_id, tc.artist_group_key AS artist_key,
                   MAX(tc.artist_name) OVER (PARTITION BY tc.artist_group_key) AS artist_name,
                   COALESCE(tc.genre, 'Autre') AS genre
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            ORDER BY pe.session_id ASC, pe.started_epoch ASC, pe.id ASC
            """,
            params,
        ).fetchall()

    daily_plays = [int(r["plays"]) for r in daily_rows]
    edd = compute_eddington_number(daily_plays)
    gini_artists = compute_gini_and_effective_core([float(r["total_ms"]) for r in artist_rows])
    gini_tracks = compute_gini_and_effective_core([float(r["total_ms"]) for r in track_ms_rows])
    overall_entropy = compute_shannon_entropy([float(r["total_ms"]) for r in artist_rows])

    dev_map: dict[str, list[float]] = defaultdict(list)
    dev_ms: Counter = Counter()
    for r in device_artist_rows:
        dev_map[r["device"]].append(float(r["total_ms"]))
        dev_ms[r["device"]] += int(r["total_ms"] or 0)
    entropy_by_device = []
    for dev, vals in dev_map.items():
        if dev_ms[dev] < 600_000:
            continue
        ent = compute_shannon_entropy(vals)
        entropy_by_device.append(
            {
                "device": dev,
                "hours": round(dev_ms[dev] / 3_600_000.0, 2),
                "unique_artists": len(vals),
                "entropy_bits": ent["bits"],
                "entropy_norm": ent["normalized"],
                "style": "Explorateur" if ent["normalized"] >= 0.72 else ("Équilibré" if ent["normalized"] >= 0.55 else "Routine"),
            }
        )
    entropy_by_device.sort(key=lambda x: x["hours"], reverse=True)

    months_by_artist: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for r in artist_month_rows:
        months_by_artist[r["artist_key"]].append((r["local_month"], int(r["total_ms"] or 0)))

    survival_artists = []
    class_counts = Counter({"Classique": 0, "Comète": 0, "Combustion Lente": 0, "Résurrection": 0})
    retention_by_age: dict[int, list[int]] = defaultdict(list)

    for r in artist_rows[:80]:
        ak = r["artist_key"]
        m_series = months_by_artist.get(ak) or []
        if not m_series or int(r["plays"]) < 5:
            continue
        first_dt = datetime.strptime(r["first_date"], "%Y-%m-%d")
        last_dt = datetime.strptime(r["last_date"], "%Y-%m-%d")
        span_days = max(1, (last_dt - first_dt).days)
        total_a_ms = sum(ms for _, ms in m_series) or 1

        cum = 0
        half_month = m_series[0][0]
        peak_month, peak_ms = max(m_series, key=lambda x: x[1])
        for m_str, ms in m_series:
            cum += ms
            if cum >= total_a_ms * 0.5:
                half_month = m_str
                break
        half_dt = datetime.strptime(half_month + "-15", "%Y-%m-%d")
        half_life_days = max(7, (half_dt - first_dt).days)

        month_ordinals = [int(m[:4]) * 12 + int(m[5:7]) for m, _ in m_series]
        max_gap_months = max((month_ordinals[i] - month_ordinals[i - 1] for i in range(1, len(month_ordinals))), default=0)

        peak_share = peak_ms / total_a_ms
        if max_gap_months >= 3 and len(m_series) >= 3:
            archetype = "Résurrection"
        elif peak_share >= 0.62 and span_days <= 75:
            archetype = "Comète"
        elif r["active_months"] >= 5 or span_days >= 180:
            archetype = "Classique"
        else:
            archetype = "Combustion Lente"

        class_counts[archetype] += 1
        span_months = max(1, int(round(span_days / 30.0)))
        for age_m in range(1, 13):
            retention_by_age[age_m].append(1 if span_months >= age_m else 0)

        survival_artists.append(
            {
                "artist_key": ak,
                "artist_name": r["artist_name"],
                "artwork_url": r["artwork_url"],
                "archetype": archetype,
                "plays": int(r["plays"]),
                "hours": round(int(r["total_ms"] or 0) / 3_600_000.0, 2),
                "span_days": span_days,
                "half_life_days": half_life_days,
                "active_months": int(r["active_months"]),
                "peak_month": peak_month,
                "peak_share_pct": round(peak_share * 100.0, 1),
                "first_date": r["first_date"],
                "last_date": r["last_date"],
            }
        )

    survival_curve = [
        {
            "month_age": m,
            "retention_pct": round(100.0 * sum(retention_by_age[m]) / max(len(retention_by_age[m]), 1), 1),
        }
        for m in range(1, 13)
        if retention_by_age[m]
    ]

    transitions: Counter = Counter()
    neighbor_genres: dict[str, set[str]] = defaultdict(set)
    artist_names_map: dict[str, str] = {}
    artist_genre_map: dict[str, str] = {}
    prev_sess = None
    prev_artist = None

    for r in seq_rows:
        ak = r["artist_key"]
        artist_names_map[ak] = r["artist_name"] or ak
        artist_genre_map[ak] = r["genre"] or "Autre"
        if prev_sess == r["session_id"] and prev_artist and prev_artist != ak:
            transitions[(prev_artist, ak)] += 1
            neighbor_genres[prev_artist].add(artist_genre_map[ak])
            neighbor_genres[ak].add(artist_genre_map.get(prev_artist, "Autre"))
        prev_sess = r["session_id"]
        prev_artist = ak

    cross_degree: Counter = Counter()
    for (a, b), cnt in transitions.items():
        if artist_genre_map.get(a) != artist_genre_map.get(b):
            cross_degree[a] += cnt
            cross_degree[b] += cnt

    bridge_artists = []
    for ak, cross_cnt in cross_degree.most_common(15):
        n_genres = sorted(g for g in neighbor_genres[ak] if g != "Autre")
        bridge_artists.append(
            {
                "artist_key": ak,
                "artist_name": artist_names_map.get(ak, ak),
                "primary_genre": artist_genre_map.get(ak, "Autre"),
                "cross_transitions": cross_cnt,
                "connected_genres": n_genres[:6],
                "bridge_score": round(cross_cnt * math.log1p(len(n_genres)), 1),
            }
        )
    bridge_artists.sort(key=lambda x: x["bridge_score"], reverse=True)

    top_transitions = [
        {
            "from_key": a,
            "from_name": artist_names_map.get(a, a),
            "to_key": b,
            "to_name": artist_names_map.get(b, b),
            "count": cnt,
        }
        for (a, b), cnt in transitions.most_common(18)
    ]

    duck_rows = 0
    try:
        ensure_parquet_snapshot()
        res = query_parquet("SELECT COUNT(*) AS c FROM {parquet}")
        duck_rows = int(res[0]["c"]) if res else 0
    except Exception:
        duck_rows = 0

    return {
        "duckdb_parquet_rows": duck_rows,
        "eddington": edd,
        "gini_artists": gini_artists,
        "gini_tracks": gini_tracks,
        "shannon_entropy": overall_entropy,
        "entropy_by_device": entropy_by_device[:10],
        "survival": {
            "counts": dict(class_counts),
            "curve": survival_curve,
            "artists": survival_artists[:40],
        },
        "bridge_artists": bridge_artists[:12],
        "top_transitions": top_transitions,
    }


def get_cooccurrence_graph_2d(f: FilterParams, limit: int = 320) -> dict[str, Any]:
    where, params = build_where_clause(f)
    order = metric_order_sql(f)
    with db_session() as conn:
        artists = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   MAX(tc.genre) AS genre, MAX(tc.artwork_url) AS artwork_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY {order}
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()

        top_keys = {r["artist_key"] for r in artists}
        if not top_keys:
            return {"nodes": [], "edges": [], "genres": []}

        sess_rows = conn.execute(
            f"""
            SELECT pe.session_id, tc.artist_group_key AS artist_key
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY pe.session_id, tc.artist_group_key
            """,
            params,
        ).fetchall()

    sess_map: dict[int, list[str]] = defaultdict(list)
    for r in sess_rows:
        if r["artist_key"] in top_keys:
            sess_map[int(r["session_id"])].append(r["artist_key"])

    edge_weights: Counter = Counter()
    for _, akeys in sess_map.items():
        if len(akeys) < 2 or len(akeys) > 25:
            continue
        uniq = sorted(set(akeys))
        for i in range(len(uniq)):
            for j in range(i + 1, len(uniq)):
                edge_weights[(uniq[i], uniq[j])] += 1

    genre_palette = [
        "#6B9BD2", "#D49A5A", "#6EB89B", "#C97A8A", "#9E87C9",
        "#C4B45A", "#5BA8B5", "#C98566", "#88A86E", "#A688B0",
    ]
    genre_counts = Counter(r["genre"] or "Autre" for r in artists)
    top_genres = [g for g, _ in genre_counts.most_common(10)]
    genre_color = {g: genre_palette[i % len(genre_palette)] for i, g in enumerate(top_genres)}

    max_ms = max((int(r["total_ms"] or 1) for r in artists), default=1)
    nodes = []
    for idx, r in enumerate(artists):
        g = r["genre"] or "Autre"
        g_idx = top_genres.index(g) if g in top_genres else len(top_genres)
        angle = (g_idx / max(len(top_genres), 1)) * 2 * math.pi + (idx * 0.37)
        rad = 1.5 + math.sqrt(idx + 1) * 1.15
        nodes.append(
            {
                "id": r["artist_key"],
                "label": r["artist_name"],
                "genre": g,
                "color": genre_color.get(g, "#8A8D98"),
                "size": round(4.0 + 18.0 * math.sqrt(int(r["total_ms"] or 1) / max_ms), 2),
                "x": round(math.cos(angle) * rad, 3),
                "y": round(math.sin(angle) * rad, 3),
                "plays": int(r["plays"]),
                "hours": round(int(r["total_ms"] or 0) / 3_600_000.0, 2),
                "artwork_url": r["artwork_url"],
            }
        )

    edges = [
        {"source": a, "target": b, "weight": w}
        for (a, b), w in edge_weights.most_common(1200)
        if w >= 2
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "genres": [{"name": g, "color": genre_color[g], "count": genre_counts[g]} for g in top_genres],
    }
