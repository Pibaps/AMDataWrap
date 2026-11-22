"""PELT Musical Eras change-point detection (ruptures RBF + BIC)."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

import numpy as np
import ruptures as rpt

from ..db import db_session
from ..filters import FilterParams, build_where_clause
from .camelot_playlists import _deterministic_prior_audio_dna
from .science_metrics import compute_shannon_entropy


def get_musical_eras_pelt(f: FilterParams) -> dict[str, Any]:
    where, params = build_where_clause(f)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT pe.local_date, pe.play_duration_ms, pe.track_key,
                   COALESCE(tc.genre, 'Autre') AS genre,
                   COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                   COALESCE(tc.artist_group_key, 'inconnu') AS artist_key,
                   tc.artwork_url,
                   tc.song_name,
                   dna.bpm, dna.energy
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN track_audio_dna dna ON dna.track_key = tc.track_key
            WHERE {where}
            ORDER BY pe.started_epoch ASC
            """,
            params,
        ).fetchall()

    if not rows:
        return {"eras": [], "weekly_series": [], "ridgeline": {"weeks": [], "series": []}, "change_points": []}

    week_buckets: dict[str, list[Any]] = defaultdict(list)
    global_artist_ms: Counter = Counter()
    global_genre_ms: Counter = Counter()
    total_ms_all = 0

    for r in rows:
        dt = datetime.strptime(r["local_date"], "%Y-%m-%d")
        iso_y, iso_w, _ = dt.isocalendar()
        wkey = f"{iso_y}-W{iso_w:02d}"
        week_buckets[wkey].append(r)
        ms = int(r["play_duration_ms"] or 0)
        global_artist_ms[r["artist_key"]] += ms
        global_genre_ms[r["genre"]] += ms
        total_ms_all += ms

    weeks = sorted(week_buckets.keys())
    top_genres = [g for g, _ in global_genre_ms.most_common(6)]
    artist_display: dict[str, str] = {}
    artist_art: dict[str, str | None] = {}
    for r in rows:
        ak = r["artist_key"]
        if ak not in artist_display:
            artist_display[ak] = r["artist_name"]
        if r["artwork_url"] and not artist_art.get(ak):
            artist_art[ak] = r["artwork_url"]

    X_rows = []
    weekly_series = []
    for w in weeks:
        items = week_buckets[w]
        w_ms = sum(int(i["play_duration_ms"] or 0) for i in items) or 1
        g_counts: Counter = Counter()
        a_counts: Counter = Counter()
        bpms = []
        energies = []
        for i in items:
            ms = int(i["play_duration_ms"] or 0)
            g_counts[i["genre"]] += ms
            a_counts[i["artist_key"]] += ms
            if i["bpm"] is not None and i["energy"] is not None:
                bpms.append(float(i["bpm"]))
                energies.append(float(i["energy"]))
            else:
                prior = _deterministic_prior_audio_dna(i["track_key"], i["song_name"], i["genre"])
                bpms.append(prior["bpm"])
                energies.append(prior["energy"])

        ent = compute_shannon_entropy(list(a_counts.values()))
        med_bpm = float(np.median(bpms)) if bpms else 110.0
        avg_e = float(np.mean(energies)) if energies else 0.55

        vec = [g_counts[g] / w_ms for g in top_genres] + [
            (med_bpm - 60.0) / 120.0,
            avg_e,
            ent["normalized"],
        ]
        X_rows.append(vec)
        top_a_key = a_counts.most_common(1)[0][0] if a_counts else ""
        weekly_series.append(
            {
                "week": w,
                "start_date": min(i["local_date"] for i in items),
                "end_date": max(i["local_date"] for i in items),
                "plays": len(items),
                "hours": round(w_ms / 3_600_000.0, 2),
                "median_bpm": round(med_bpm, 1),
                "avg_energy": round(avg_e, 3),
                "entropy_bits": ent["bits"],
                "entropy_norm": ent["normalized"],
                "top_genre": g_counts.most_common(1)[0][0] if g_counts else "Autre",
                "top_artist": artist_display.get(top_a_key, ""),
            }
        )

    X = np.array(X_rows, dtype=float)
    n, _ = X.shape

    stds = X.std(axis=0)
    stds[stds < 1e-6] = 1.0
    X_std = (X - X.mean(axis=0)) / stds

    bkps: list[int] = [n]
    if n >= 8:
        try:
            algo = rpt.Pelt(model="rbf", min_size=4, jump=1).fit(X_std)
            base_pen = max(0.8, 0.35 * math.log(n))
            cand = algo.predict(pen=base_pen)
            for factor in (0.65, 0.45, 0.3):
                if len(cand) < 3 and n >= 16:
                    cand = algo.predict(pen=base_pen * factor)
            if len(cand) > 8:
                cand = algo.predict(pen=base_pen * 1.7)
            bkps = cand
        except Exception:
            bkps = [n]

    eras = []
    start_idx = 0
    for era_idx, end_idx in enumerate(bkps):
        seg_weeks = weeks[start_idx:end_idx]
        if not seg_weeks:
            continue
        seg_items = [item for w in seg_weeks for item in week_buckets[w]]
        seg_ms = sum(int(i["play_duration_ms"] or 0) for i in seg_items) or 1
        seg_artists: Counter = Counter()
        seg_genres: Counter = Counter()
        for i in seg_items:
            ms = int(i["play_duration_ms"] or 0)
            seg_artists[i["artist_key"]] += ms
            seg_genres[i["genre"]] += ms

        seg_artist_plays = Counter(i["artist_key"] for i in seg_items)
        lift_ranked = []
        for ak, ams in seg_artists.items():
            if seg_artist_plays[ak] < 3 and len(seg_items) >= 20:
                continue
            era_share = ams / seg_ms
            glob_share = max(global_artist_ms[ak] / max(total_ms_all, 1), 1e-5)
            lift = era_share / glob_share
            lift_ranked.append(
                {
                    "artist_key": ak,
                    "artist_name": artist_display.get(ak, ak),
                    "artwork_url": artist_art.get(ak),
                    "hours": round(ams / 3_600_000.0, 2),
                    "plays": seg_artist_plays[ak],
                    "share_pct": round(era_share * 100.0, 1),
                    "lift": round(lift, 2),
                }
            )
        lift_ranked.sort(key=lambda x: (x["lift"] * math.log1p(x["plays"])), reverse=True)
        top_by_ms = [
            {
                "artist_key": ak,
                "artist_name": artist_display.get(ak, ak),
                "artwork_url": artist_art.get(ak),
                "hours": round(ams / 3_600_000.0, 2),
                "plays": seg_artist_plays[ak],
            }
            for ak, ams in seg_artists.most_common(5)
        ]

        sig_artists = lift_ranked[:3] if lift_ranked else top_by_ms[:3]
        dom_genre = seg_genres.most_common(1)[0][0] if seg_genres else "Mixte"
        era_title = f"Ère {sig_artists[0]['artist_name']}" if sig_artists else f"Chapitre {era_idx + 1}"
        if len(sig_artists) >= 2:
            era_title = f"{sig_artists[0]['artist_name']} & {sig_artists[1]['artist_name']}"

        seg_w_stats = weekly_series[start_idx:end_idx]
        eras.append(
            {
                "index": era_idx,
                "title": era_title,
                "dominant_genre": dom_genre,
                "start_week": seg_weeks[0],
                "end_week": seg_weeks[-1],
                "start_date": seg_w_stats[0]["start_date"],
                "end_date": seg_w_stats[-1]["end_date"],
                "weeks_count": len(seg_weeks),
                "plays": len(seg_items),
                "hours": round(seg_ms / 3_600_000.0, 2),
                "avg_bpm": round(float(np.mean([w["median_bpm"] for w in seg_w_stats])), 1),
                "avg_energy": round(float(np.mean([w["avg_energy"] for w in seg_w_stats])), 3),
                "avg_entropy": round(float(np.mean([w["entropy_bits"] for w in seg_w_stats])), 2),
                "signature_artists": sig_artists[:5],
                "top_artists": top_by_ms,
                "artwork_url": (sig_artists[0].get("artwork_url") if sig_artists else None),
            }
        )
        start_idx = end_idx

    ridge_genres = [g for g, _ in global_genre_ms.most_common(8)]
    ridge_series = []
    for g in ridge_genres:
        vals = []
        for w in weeks:
            ms_g = sum(int(i["play_duration_ms"] or 0) for i in week_buckets[w] if i["genre"] == g)
            vals.append(round(ms_g / 3_600_000.0, 3))
        ridge_series.append({"name": g, "values": vals})

    return {
        "algorithm": "PELT (ruptures, noyau RBF, pénalité BIC)",
        "eras": eras,
        "change_points": [weeks[b - 1] for b in bkps[:-1] if 0 < b <= len(weeks)],
        "weekly_series": weekly_series,
        "ridgeline": {"weeks": weeks, "series": ridge_series},
    }
