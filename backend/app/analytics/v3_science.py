"""AMDataWrap V3 Musicological Data-Science, Audio DNA, Atlas, Iceberg, Games & FTS5 Search."""

from __future__ import annotations

import hashlib
import json
import math
import random
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import ruptures as rpt

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql
from ..jobs.worker import COUNTRY_CENTROIDS, CURATED_ARTIST_GEO
from ..nlp.sentiment import analyze_lyrics_sentiment
from .duckdb_engine import ensure_parquet_snapshot, query_parquet

# ---------------------------------------------------------------------------
# Camelot Wheel Constants (1A..12A Minor inner ring, 1B..12B Major outer ring)
# ---------------------------------------------------------------------------
KEY_TO_CAMELOT: dict[tuple[str, str], str] = {
    ("Ab", "minor"): "1A", ("G#", "minor"): "1A", ("B", "major"): "1B",
    ("Eb", "minor"): "2A", ("D#", "minor"): "2A", ("F#", "major"): "2B", ("Gb", "major"): "2B",
    ("Bb", "minor"): "3A", ("A#", "minor"): "3A", ("Db", "major"): "3B", ("C#", "major"): "3B",
    ("F", "minor"): "4A", ("Ab", "major"): "4B", ("G#", "major"): "4B",
    ("C", "minor"): "5A", ("Eb", "major"): "5B", ("D#", "major"): "5B",
    ("G", "minor"): "6A", ("Bb", "major"): "6B", ("A#", "major"): "6B",
    ("D", "minor"): "7A", ("F", "major"): "7B",
    ("A", "minor"): "8A", ("C", "major"): "8B",
    ("E", "minor"): "9A", ("G", "major"): "9B",
    ("B", "minor"): "10A", ("D", "major"): "10B",
    ("F#", "minor"): "11A", ("Gb", "minor"): "11A", ("A", "major"): "11B",
    ("Db", "minor"): "12A", ("C#", "minor"): "12A", ("E", "major"): "12B",
}

CAMELOT_TO_KEY: dict[str, tuple[str, str]] = {
    "1A": ("Ab", "minor"), "1B": ("B", "major"),
    "2A": ("Eb", "minor"), "2B": ("F#", "major"),
    "3A": ("Bb", "minor"), "3B": ("Db", "major"),
    "4A": ("F", "minor"), "4B": ("Ab", "major"),
    "5A": ("C", "minor"), "5B": ("Eb", "major"),
    "6A": ("G", "minor"), "6B": ("Bb", "major"),
    "7A": ("D", "minor"), "7B": ("F", "major"),
    "8A": ("A", "minor"), "8B": ("C", "major"),
    "9A": ("E", "minor"), "9B": ("G", "major"),
    "10A": ("B", "minor"), "10B": ("D", "major"),
    "11A": ("F#", "minor"), "11B": ("A", "major"),
    "12A": ("C#", "minor"), "12B": ("E", "major"),
}

ALL_CAMELOT_CODES = [f"{n}{l}" for n in range(1, 13) for l in ("A", "B")]

# Calibrated acoustical priors by genre (used ONLY when Essentia.js WASM hasn't scanned a track yet)
_GENRE_AUDIO_PRIORS: dict[str, tuple[float, float, float, float]] = {
    # genre_lower_substring: (bpm, energy, danceability, valence)
    "hip-hop": (96.0, 0.72, 0.78, 0.46),
    "rap": (96.0, 0.74, 0.76, 0.44),
    "electronic": (124.0, 0.80, 0.78, 0.56),
    "dance": (124.0, 0.82, 0.83, 0.68),
    "house": (124.0, 0.79, 0.84, 0.64),
    "pop": (116.0, 0.68, 0.73, 0.64),
    "rock": (122.0, 0.78, 0.52, 0.50),
    "metal": (134.0, 0.90, 0.40, 0.34),
    "alternative": (114.0, 0.62, 0.56, 0.46),
    "indie": (112.0, 0.56, 0.58, 0.50),
    "r&b": (92.0, 0.54, 0.68, 0.52),
    "soul": (94.0, 0.55, 0.65, 0.58),
    "jazz": (104.0, 0.42, 0.54, 0.56),
    "classical": (84.0, 0.28, 0.24, 0.48),
    "soundtrack": (96.0, 0.46, 0.32, 0.44),
    "french": (110.0, 0.58, 0.66, 0.54),
    "chanson": (100.0, 0.48, 0.54, 0.52),
    "ambient": (78.0, 0.24, 0.28, 0.45),
    "lo-fi": (82.0, 0.34, 0.60, 0.48),
    "afro": (108.0, 0.74, 0.84, 0.72),
    "reggae": (88.0, 0.56, 0.76, 0.70),
    "latin": (102.0, 0.76, 0.84, 0.72),
    "k-pop": (122.0, 0.80, 0.78, 0.68),
    "anime": (132.0, 0.78, 0.64, 0.60),
}


def camelot_compatible_codes(code: str) -> list[tuple[str, str]]:
    """Return list of `(compatible_camelot, transition_type)` for harmonic mixing."""
    if not code or len(code) < 2:
        return []
    letter = code[-1].upper()
    try:
        num = int(code[:-1])
    except ValueError:
        return []
    if letter not in ("A", "B") or not (1 <= num <= 12):
        return []
    prev_num = 12 if num == 1 else num - 1
    next_num = 1 if num == 12 else num + 1
    boost_num = ((num + 1) % 12) + 1  # +2 energy boost
    other = "B" if letter == "A" else "A"
    return [
        (f"{num}{letter}", "Même tonalité"),
        (f"{next_num}{letter}", "+1 Adjacent"),
        (f"{prev_num}{letter}", "-1 Adjacent"),
        (f"{num}{other}", "Relatif Maj/Min"),
        (f"{boost_num}{letter}", "Energy Boost +2"),
    ]


def to_camelot(musical_key: str | None, musical_mode: str | None) -> str | None:
    if not musical_key:
        return None
    k = musical_key.strip().capitalize()
    if len(k) > 1 and k[1] in ("#", "b"):
        k = k[0].upper() + k[1]
    m = (musical_mode or "minor").strip().lower()
    m = "major" if m.startswith("maj") else "minor"
    return KEY_TO_CAMELOT.get((k, m))


def _deterministic_prior_audio_dna(track_key: str, song_name: str, genre: str | None) -> dict[str, Any]:
    """Deterministic acoustical prior when Essentia.js WASM hasn't analyzed the 30s preview yet."""
    g_low = (genre or "").lower()
    bpm, energy, dance, val = 112.0, 0.60, 0.62, 0.52
    for substr, vals in _GENRE_AUDIO_PRIORS.items():
        if substr in g_low:
            bpm, energy, dance, val = vals
            break

    h = hashlib.md5(track_key.encode("utf-8")).digest()
    jitter_bpm = ((h[0] / 255.0) - 0.5) * 24.0
    jitter_e = ((h[1] / 255.0) - 0.5) * 0.26
    jitter_d = ((h[2] / 255.0) - 0.5) * 0.24
    jitter_v = ((h[3] / 255.0) - 0.5) * 0.28

    # Blend subtle title lexicon valence
    title_sent = analyze_lyrics_sentiment(song_name)
    val_blend = 0.7 * (val + jitter_v) + 0.3 * title_sent["valence"]

    cam_idx = h[4] % 24
    cam_code = ALL_CAMELOT_CODES[cam_idx]
    m_key, m_mode = CAMELOT_TO_KEY[cam_code]

    return {
        "bpm": round(max(62.0, min(185.0, bpm + jitter_bpm)), 1),
        "musical_key": m_key,
        "musical_mode": m_mode,
        "camelot_code": cam_code,
        "key_confidence": 0.42,
        "energy": round(max(0.08, min(0.96, energy + jitter_e)), 3),
        "danceability": round(max(0.10, min(0.96, dance + jitter_d)), 3),
        "loudness_db": round(-14.0 + (energy + jitter_e) * 9.0, 2),
        "valence_audio": round(max(0.06, min(0.95, val_blend)), 3),
        "source": "estimated",
    }


def upsert_track_audio_dna(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist Essentia.js WASM (or Deezer/AcousticBrainz) Audio DNA vector into SQLite."""
    tkey = payload["track_key"]
    cam = payload.get("camelot_code") or to_camelot(payload.get("musical_key"), payload.get("musical_mode"))
    m_key = payload.get("musical_key")
    m_mode = payload.get("musical_mode")
    if cam and (not m_key or not m_mode) and cam in CAMELOT_TO_KEY:
        m_key, m_mode = CAMELOT_TO_KEY[cam]
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO track_audio_dna (
                track_key, bpm, musical_key, musical_mode, camelot_code, key_confidence,
                energy, danceability, loudness_db, valence_audio, dynamic_complexity,
                spectral_centroid, chroma_json, mfcc_json, source, analyzed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tkey,
                payload.get("bpm"),
                m_key,
                m_mode,
                cam,
                payload.get("key_confidence", 0.0),
                payload.get("energy"),
                payload.get("danceability"),
                payload.get("loudness_db"),
                payload.get("valence_audio"),
                payload.get("dynamic_complexity"),
                payload.get("spectral_centroid"),
                json.dumps(payload.get("chroma")) if payload.get("chroma") is not None else None,
                json.dumps(payload.get("mfcc")) if payload.get("mfcc") is not None else None,
                payload.get("source", "essentia_wasm"),
                now_iso,
            ),
        )
    return {"ok": True, "track_key": tkey, "camelot_code": cam, "source": payload.get("source", "essentia_wasm")}


# ---------------------------------------------------------------------------
# Pure Mathematical Metrics Helpers (also directly property-tested via Hypothesis!)
# ---------------------------------------------------------------------------
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
    cum = 0.0
    weighted = 0.0
    for i, v in enumerate(vals, start=1):
        cum += v
        weighted += (2 * i - k - 1) * v
    gini = max(0.0, min(1.0, weighted / (k * total)))
    d_eff = max(1, int(math.floor(k * (1.0 - gini))))

    # Sample up to 25 points for Lorenz curve
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


# ---------------------------------------------------------------------------
# 1. PELT Musical Eras (Change-Point Detection with ruptures RBF + BIC)
# ---------------------------------------------------------------------------
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

    # Group by ISO week (YYYY-Www)
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

    # Build multivariate weekly matrix X: [top_genres shares..., median_bpm_norm, mean_energy, entropy_norm]
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
    n, p = X.shape

    # Standardize columns safely for RBF kernel
    stds = X.std(axis=0)
    stds[stds < 1e-6] = 1.0
    X_std = (X - X.mean(axis=0)) / stds

    bkps: list[int] = [n]
    if n >= 8:
        # Calibrate PELT RBF penalty (RBF cost is bounded in [0, 2n], so BIC scale is ~0.35*ln(n))
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

        # Lift score: era_share / global_share (minimum 3 plays in segment)
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

    # Ridgeline matrix for 3D Ridgeline Topography (top 8 genres across weeks)
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


# ---------------------------------------------------------------------------
# 2. Russell Circumplex Emotional Compass + Audio DNA Coverage
# ---------------------------------------------------------------------------
def get_emotional_compass(f: FilterParams, limit: int = 250) -> dict[str, Any]:
    where, params = build_where_clause(f)
    order = metric_order_sql(f)
    with db_session() as conn:
        top_rows = conn.execute(
            f"""
            SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                   tc.album_name, tc.genre, tc.artwork_url, tc.preview_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   dna.bpm, dna.camelot_code, dna.energy, dna.danceability,
                   dna.valence_audio, dna.loudness_db, dna.source AS dna_source,
                   sent.valence AS lyrics_valence, sent.arousal_text, sent.polarity_label,
                   sent.lang AS lyrics_lang, sent.model_source AS sentiment_source
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN track_audio_dna dna ON dna.track_key = tc.track_key
            LEFT JOIN track_lyrics_sentiment sent ON sent.track_key = tc.track_key
            WHERE {where}
            GROUP BY tc.track_key
            ORDER BY {order}
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()

        hourly_rows = conn.execute(
            f"""
            SELECT pe.local_hour, pe.local_season, pe.play_duration_ms, tc.track_key,
                   tc.song_name, tc.genre,
                   dna.energy, dna.valence_audio, sent.valence AS lyrics_valence, sent.arousal_text
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN track_audio_dna dna ON dna.track_key = tc.track_key
            LEFT JOIN track_lyrics_sentiment sent ON sent.track_key = tc.track_key
            WHERE {where}
            """,
            params,
        ).fetchall()

        wasm_count = conn.execute("SELECT COUNT(*) FROM track_audio_dna WHERE source = 'essentia_wasm'").fetchone()[0]
        sent_count = conn.execute("SELECT COUNT(*) FROM track_lyrics_sentiment").fetchone()[0]
        total_tracks = conn.execute("SELECT COUNT(*) FROM tracks_catalog").fetchone()[0]

    points = []
    quadrants = Counter({"euphoric": 0, "intense": 0, "melancholic": 0, "serene": 0})
    for r in top_rows:
        if r["dna_source"]:
            bpm = float(r["bpm"] or 110.0)
            energy = float(r["energy"] if r["energy"] is not None else 0.55)
            dance = float(r["danceability"] if r["danceability"] is not None else 0.58)
            val_audio = float(r["valence_audio"] if r["valence_audio"] is not None else 0.50)
            cam = r["camelot_code"] or "8A"
            src = r["dna_source"]
        else:
            p_dna = _deterministic_prior_audio_dna(r["track_key"], r["song_name"], r["genre"])
            bpm = p_dna["bpm"]
            energy = p_dna["energy"]
            dance = p_dna["danceability"]
            val_audio = p_dna["valence_audio"]
            cam = p_dna["camelot_code"]
            src = "estimated"

        # Blend audio valence with local NLP lyrics valence (60% lyrics if available, 40% audio)
        if r["lyrics_valence"] is not None:
            valence = round(0.4 * val_audio + 0.6 * float(r["lyrics_valence"]), 3)
            arousal = round(0.75 * energy + 0.25 * float(r["arousal_text"] or energy), 3)
        else:
            valence = round(val_audio, 3)
            arousal = round(energy, 3)

        if valence >= 0.5 and arousal >= 0.5:
            q = "euphoric"
        elif valence < 0.5 and arousal >= 0.5:
            q = "intense"
        elif valence < 0.5 and arousal < 0.5:
            q = "melancholic"
        else:
            q = "serene"
        quadrants[q] += int(r["plays"] or 1)

        points.append(
            {
                "track_key": r["track_key"],
                "song_name": r["song_name"],
                "artist_name": r["artist_name"],
                "album_name": r["album_name"],
                "genre": r["genre"] or "Inconnu",
                "artwork_url": r["artwork_url"],
                "preview_url": r["preview_url"],
                "plays": int(r["plays"]),
                "hours": round(int(r["total_ms"] or 0) / 3_600_000.0, 2),
                "valence": valence,
                "arousal": arousal,
                "bpm": bpm,
                "danceability": dance,
                "camelot_code": cam,
                "quadrant": q,
                "dna_source": src,
                "has_lyrics_sentiment": r["lyrics_valence"] is not None,
            }
        )

    # Diurnal 24h & Seasonal affective trajectories
    hour_acc: dict[int, list[float]] = {h: [0.0, 0.0, 0.0] for h in range(24)}
    season_acc: dict[str, list[float]] = {s: [0.0, 0.0, 0.0] for s in ("Hiver", "Printemps", "Été", "Automne")}
    prior_cache: dict[str, tuple[float, float]] = {}

    for r in hourly_rows:
        tk = r["track_key"]
        if r["energy"] is not None and r["valence_audio"] is not None:
            e = float(r["energy"])
            v = float(r["valence_audio"])
        else:
            if tk not in prior_cache:
                pd = _deterministic_prior_audio_dna(tk, r["song_name"], r["genre"])
                prior_cache[tk] = (pd["energy"], pd["valence_audio"])
            e, v = prior_cache[tk]
        if r["lyrics_valence"] is not None:
            v = 0.4 * v + 0.6 * float(r["lyrics_valence"])
        w = max(float(r["play_duration_ms"] or 1), 1.0)
        h = int(r["local_hour"])
        hour_acc[h][0] += v * w
        hour_acc[h][1] += e * w
        hour_acc[h][2] += w
        s = r["local_season"]
        if s in season_acc:
            season_acc[s][0] += v * w
            season_acc[s][1] += e * w
            season_acc[s][2] += w

    diurnal = [
        {
            "hour": h,
            "valence": round(hour_acc[h][0] / hour_acc[h][2], 3) if hour_acc[h][2] > 0 else 0.5,
            "arousal": round(hour_acc[h][1] / hour_acc[h][2], 3) if hour_acc[h][2] > 0 else 0.5,
            "hours": round(hour_acc[h][2] / 3_600_000.0, 2),
        }
        for h in range(24)
    ]
    seasonal = [
        {
            "season": s,
            "valence": round(season_acc[s][0] / season_acc[s][2], 3) if season_acc[s][2] > 0 else 0.5,
            "arousal": round(season_acc[s][1] / season_acc[s][2], 3) if season_acc[s][2] > 0 else 0.5,
            "hours": round(season_acc[s][2] / 3_600_000.0, 2),
        }
        for s in ("Hiver", "Printemps", "Été", "Automne")
    ]

    q_total = sum(quadrants.values()) or 1
    return {
        "coverage": {
            "essentia_wasm_tracks": wasm_count,
            "lyrics_sentiment_tracks": sent_count,
            "total_catalog_tracks": total_tracks,
        },
        "quadrants": [
            {"id": "euphoric", "label": "Euphorique & Énergique", "pct": round(100 * quadrants["euphoric"] / q_total, 1)},
            {"id": "intense", "label": "Intense & Sombre", "pct": round(100 * quadrants["intense"] / q_total, 1)},
            {"id": "melancholic", "label": "Mélancolique & Introspectif", "pct": round(100 * quadrants["melancholic"] / q_total, 1)},
            {"id": "serene", "label": "Serein & Lumineux", "pct": round(100 * quadrants["serene"] / q_total, 1)},
        ],
        "points": points,
        "diurnal_trajectory": diurnal,
        "seasonal_trajectory": seasonal,
    }


# ---------------------------------------------------------------------------
# 3. Camelot Wheel + Harmonic Mix & Smart Playlist Generator (JSPF / XSPF / M3U8)
# ---------------------------------------------------------------------------
def get_camelot_wheel(f: FilterParams) -> dict[str, Any]:
    where, params = build_where_clause(f)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                   tc.album_name, tc.genre, tc.artwork_url, tc.preview_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   dna.bpm, dna.camelot_code, dna.energy, dna.source AS dna_source
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN track_audio_dna dna ON dna.track_key = tc.track_key
            WHERE {where}
            GROUP BY tc.track_key
            ORDER BY total_ms DESC
            """,
            params,
        ).fetchall()

    buckets: dict[str, dict[str, Any]] = {
        code: {
            "code": code,
            "number": int(code[:-1]),
            "ring": code[-1],
            "musical_key": f"{CAMELOT_TO_KEY[code][0]} {'Maj' if CAMELOT_TO_KEY[code][1] == 'major' else 'Min'}",
            "plays": 0,
            "total_ms": 0,
            "tracks_count": 0,
            "top_tracks": [],
        }
        for code in ALL_CAMELOT_CODES
    }

    for r in rows:
        if r["camelot_code"] in buckets:
            code = r["camelot_code"]
            bpm = float(r["bpm"] or 110.0)
            energy = float(r["energy"] or 0.55)
            src = r["dna_source"] or "essentia_wasm"
        else:
            p_dna = _deterministic_prior_audio_dna(r["track_key"], r["song_name"], r["genre"])
            code = p_dna["camelot_code"]
            bpm = p_dna["bpm"]
            energy = p_dna["energy"]
            src = "estimated"
        b = buckets[code]
        b["plays"] += int(r["plays"])
        b["total_ms"] += int(r["total_ms"] or 0)
        b["tracks_count"] += 1
        if len(b["top_tracks"]) < 8:
            b["top_tracks"].append(
                {
                    "track_key": r["track_key"],
                    "song_name": r["song_name"],
                    "artist_name": r["artist_name"],
                    "album_name": r["album_name"],
                    "artwork_url": r["artwork_url"],
                    "preview_url": r["preview_url"],
                    "plays": int(r["plays"]),
                    "bpm": bpm,
                    "energy": energy,
                    "camelot_code": code,
                    "dna_source": src,
                }
            )

    cells = []
    for code in ALL_CAMELOT_CODES:
        b = buckets[code]
        b["hours"] = round(b["total_ms"] / 3_600_000.0, 2)
        cells.append(b)
    dominant = max(cells, key=lambda c: c["total_ms"]) if cells else None
    return {"cells": cells, "dominant": dominant}


def build_smart_playlist(
    f: FilterParams,
    *,
    kind: str = "harmonic_mix",
    seed_track_key: str | None = None,
    era_index: int | None = None,
    limit: int = 20,
    custom_name: str | None = None,
) -> dict[str, Any]:
    where, params = build_where_clause(f)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                   tc.album_name, tc.genre, tc.artwork_url, tc.preview_url, tc.mbid_recording,
                   COUNT(*) AS plays,
                   SUM(pe.play_duration_ms) AS total_ms,
                   SUM(pe.is_skip_30s) AS skips,
                   MAX(pe.local_date) AS last_played,
                   dna.bpm, dna.camelot_code, dna.energy, dna.danceability, dna.source AS dna_source
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN track_audio_dna dna ON dna.track_key = tc.track_key
            WHERE {where}
            GROUP BY tc.track_key
            ORDER BY total_ms DESC
            LIMIT 600
            """,
            params,
        ).fetchall()

    pool = []
    for r in rows:
        if r["camelot_code"]:
            cam, bpm, energy = r["camelot_code"], float(r["bpm"] or 110.0), float(r["energy"] or 0.55)
        else:
            pd = _deterministic_prior_audio_dna(r["track_key"], r["song_name"], r["genre"])
            cam, bpm, energy = pd["camelot_code"], pd["bpm"], pd["energy"]
        pool.append(
            {
                "track_key": r["track_key"],
                "song_name": r["song_name"],
                "artist_name": r["artist_name"],
                "album_name": r["album_name"],
                "genre": r["genre"] or "Inconnu",
                "artwork_url": r["artwork_url"],
                "preview_url": r["preview_url"],
                "mbid_recording": r["mbid_recording"],
                "plays": int(r["plays"]),
                "skips": int(r["skips"] or 0),
                "last_played": r["last_played"],
                "bpm": bpm,
                "camelot_code": cam,
                "energy": energy,
                "transition_reason": "Graine",
            }
        )

    if not pool:
        return {"name": custom_name or "Playlist vide", "kind": kind, "tracks": []}

    selected: list[dict[str, Any]] = []
    if kind == "forgotten_gems":
        max_date = max(t["last_played"] for t in pool if t["last_played"])
        cutoff = (datetime.strptime(max_date, "%Y-%m-%d") - timedelta(days=60)).strftime("%Y-%m-%d")
        cands = [t for t in pool if t["last_played"] <= cutoff and t["plays"] >= 3]
        cands.sort(key=lambda t: t["plays"], reverse=True)
        for t in cands[:limit]:
            t["transition_reason"] = f"Non écouté depuis {t['last_played']}"
            selected.append(t)
        name = custom_name or "Perles Oubliées (> 60 jours)"
    elif kind == "zero_skip":
        cands = [t for t in pool if t["plays"] >= 5 and t["skips"] == 0]
        cands.sort(key=lambda t: t["plays"], reverse=True)
        for t in cands[:limit]:
            t["transition_reason"] = f"0 skip sur {t['plays']} écoutes"
            selected.append(t)
        name = custom_name or "Zéro Skip — Les Intouchables"
    elif kind == "era_soundtrack":
        eras_data = get_musical_eras_pelt(f)
        eras = eras_data.get("eras") or []
        idx = era_index if (era_index is not None and 0 <= era_index < len(eras)) else 0
        if eras:
            era = eras[idx]
            era_artists = {a["artist_name"].lower() for a in era.get("signature_artists", []) + era.get("top_artists", [])}
            cands = [t for t in pool if t["artist_name"].lower() in era_artists]
            for t in cands[:limit]:
                t["transition_reason"] = f"Signature de {era['title']}"
                selected.append(t)
            name = custom_name or f"Bande-son · {era['title']}"
        else:
            selected = pool[:limit]
            name = custom_name or "Bande-son de l'Ère"
    else:
        # Harmonic Mix Generator (Camelot compatible + BPM proximity)
        seed = next((t for t in pool if t["track_key"] == seed_track_key), pool[0])
        selected = [dict(seed, transition_reason="Titre graine")]
        used = {seed["track_key"]}
        curr = seed
        while len(selected) < limit:
            compat = dict(camelot_compatible_codes(curr["camelot_code"]))
            best = None
            best_score = -1e9
            for cand in pool:
                if cand["track_key"] in used:
                    continue
                reason = compat.get(cand["camelot_code"])
                if not reason:
                    continue
                bpm_diff = abs(cand["bpm"] - curr["bpm"])
                # Also accept half/double time
                bpm_diff = min(bpm_diff, abs(cand["bpm"] * 2 - curr["bpm"]), abs(cand["bpm"] / 2 - curr["bpm"]))
                artist_pen = -12.0 if cand["artist_name"] == curr["artist_name"] else 0.0
                score = 20.0 - bpm_diff * 0.9 - abs(cand["energy"] - curr["energy"]) * 12.0 + math.log1p(cand["plays"]) * 2.5 + artist_pen
                if score > best_score:
                    best_score = score
                    best = (cand, reason)
            if not best:
                break
            nxt_track, reason = best
            selected.append(dict(nxt_track, transition_reason=f"{curr['camelot_code']} → {nxt_track['camelot_code']} ({reason})"))
            used.add(nxt_track["track_key"])
            curr = nxt_track
        name = custom_name or f"Mix Harmonique · {seed['song_name']} ({seed['camelot_code']})"

    return {"name": name, "kind": kind, "tracks": selected}


def format_playlist_export(playlist: dict[str, Any], fmt: str) -> tuple[str, str, str]:
    """Export playlist to JSPF (JSON), XSPF (XML), or M3U8. Returns `(content, media_type, filename)`."""
    title = playlist.get("name") or "AMDataWrap Playlist"
    tracks = playlist.get("tracks") or []
    safe_slug = "".join(c if c.isalnum() else "_" for c in title)[:40].strip("_") or "playlist"

    if fmt == "m3u8":
        lines = ["#EXTM3U", f"#PLAYLIST:{title}"]
        for t in tracks:
            lines.append(f"#EXTINF:-1,{t.get('artist_name', '')} - {t.get('song_name', '')}")
            lines.append(t.get("preview_url") or f"{t.get('artist_name', '')} - {t.get('song_name', '')}.m4a")
        return "\n".join(lines) + "\n", "application/vnd.apple.mpegurl; charset=utf-8", f"{safe_slug}.m3u8"

    if fmt == "xspf":
        root = ET.Element("playlist", version="1", xmlns="http://xspf.org/ns/0/")
        ET.SubElement(root, "title").text = title
        ET.SubElement(root, "creator").text = "AMDataWrap V3 Continuum"
        tlist = ET.SubElement(root, "trackList")
        for t in tracks:
            tr = ET.SubElement(tlist, "track")
            ET.SubElement(tr, "title").text = str(t.get("song_name") or "")
            ET.SubElement(tr, "creator").text = str(t.get("artist_name") or "")
            ET.SubElement(tr, "album").text = str(t.get("album_name") or "")
            if t.get("transition_reason"):
                ET.SubElement(tr, "annotation").text = str(t["transition_reason"])
        xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")
        return xml_str, "application/xspf+xml; charset=utf-8", f"{safe_slug}.xspf"

    # Default: JSPF
    jspf = {
        "playlist": {
            "title": title,
            "creator": "AMDataWrap V3 Continuum",
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "track": [
                {
                    "title": t.get("song_name") or "",
                    "creator": t.get("artist_name") or "",
                    "album": t.get("album_name") or "",
                    "annotation": t.get("transition_reason") or "",
                }
                for t in tracks
            ],
        }
    }
    return json.dumps(jspf, ensure_ascii=False, indent=2), "application/json; charset=utf-8", f"{safe_slug}.jspf"


# ---------------------------------------------------------------------------
# 4. Rigorous Listener Science Metrics (Eddington, Gini/D_eff, Entropy, Survival, Bridges)
#    Powered by Read-Only Parquet/DuckDB when unfiltered, or SQLite filtered seamlessly!
# ---------------------------------------------------------------------------
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

    # 1. Eddington Number
    daily_plays = [int(r["plays"]) for r in daily_rows]
    edd = compute_eddington_number(daily_plays)

    # 2. Gini & Effective Core D_eff = floor(K * (1 - G))
    gini_artists = compute_gini_and_effective_core([float(r["total_ms"]) for r in artist_rows])
    gini_tracks = compute_gini_and_effective_core([float(r["total_ms"]) for r in track_ms_rows])

    # 3. Shannon Entropy (overall & per device)
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

    # 4. Survival & Half-Life Curves (Comètes, Classiques, Combustions Lentes, Résurrections)
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

        # Half-life in days from first listen until 50% of cumulative ms reached
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

        # Detect long gap (>= 2 consecutive missing months between active months -> Résurrection)
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

    # 5. Sequential Session Transitions (A -> B) & Bridge Artists
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

    # Bridge score = cross-genre transition count * number of distinct neighboring genres
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

    # Parquet/DuckDB status verification (strictly read-only against immutable snapshot!)
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


# ---------------------------------------------------------------------------
# 5. World Atlas of Origins (MapLibre GL + Deck.gl MapLibreOverlay)
# ---------------------------------------------------------------------------
def get_world_atlas(f: FilterParams, limit: int = 150) -> dict[str, Any]:
    where, params = build_where_clause(f)
    order = metric_order_sql(f)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   MAX(tc.genre) AS genre, MAX(tc.artwork_url) AS artwork_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   mb.mbid, mb.country_iso, mb.country_name, mb.area_name, mb.begin_area,
                   mb.lat, mb.lng, mb.source AS geo_source
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN artist_musicbrainz mb ON mb.artist_group_key = tc.artist_group_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY {order}
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()

    # Home anchor (France — listener location inferred from French timezone/Apple Music locale)
    home = {"label": "France (Vous)", "lat": 48.8566, "lng": 2.3522}
    nodes = []
    country_stats: dict[str, dict[str, Any]] = {}

    for r in rows:
        ak = r["artist_key"]
        lat, lng = r["lat"], r["lng"]
        iso = r["country_iso"]
        city = r["begin_area"] or r["area_name"]
        cname = r["country_name"]
        src = r["geo_source"]

        if lat is None or lng is None:
            if ak in CURATED_ARTIST_GEO:
                iso, city, lat, lng, _ = CURATED_ARTIST_GEO[ak]
                cname = COUNTRY_CENTROIDS.get(iso, (iso, lat, lng))[0]
                src = "curated_seed"
            else:
                # Genre-based macro fallback only if unmapped (clearly tagged 'inferred_genre')
                g = (r["genre"] or "").lower()
                if "french" in g or "chanson" in g or "variété" in g:
                    iso = "FR"
                elif "k-pop" in g:
                    iso = "KR"
                elif "j-pop" in g or "anime" in g:
                    iso = "JP"
                elif "latin" in g or "reggaeton" in g:
                    iso = "PR"
                elif "afro" in g:
                    iso = "NG"
                elif "brit" in g:
                    iso = "GB"
                else:
                    continue
                cname, lat, lng = COUNTRY_CENTROIDS[iso]
                city = cname
                src = "inferred_genre"

        # Add tiny deterministic jitter (+-0.35 deg) so artists from the same city don't overlap identically
        h = hashlib.md5(ak.encode("utf-8")).digest()
        j_lat = ((h[0] / 255.0) - 0.5) * 0.5
        j_lng = ((h[1] / 255.0) - 0.5) * 0.5

        hours = round(int(r["total_ms"] or 0) / 3_600_000.0, 2)
        nodes.append(
            {
                "artist_key": ak,
                "artist_name": r["artist_name"],
                "genre": r["genre"] or "Autre",
                "artwork_url": r["artwork_url"],
                "mbid": r["mbid"],
                "country_iso": iso,
                "country_name": cname or iso,
                "city": city or cname or "",
                "lat": round(float(lat) + j_lat, 4),
                "lng": round(float(lng) + j_lng, 4),
                "plays": int(r["plays"]),
                "hours": hours,
                "total_ms": int(r["total_ms"] or 0),
                "geo_source": src,
            }
        )
        if iso:
            if iso not in country_stats:
                country_stats[iso] = {
                    "country_iso": iso,
                    "country_name": cname or iso,
                    "artists": 0,
                    "plays": 0,
                    "hours": 0.0,
                }
            country_stats[iso]["artists"] += 1
            country_stats[iso]["plays"] += int(r["plays"])
            country_stats[iso]["hours"] = round(country_stats[iso]["hours"] + hours, 2)

    countries = sorted(country_stats.values(), key=lambda c: c["hours"], reverse=True)
    return {
        "home": home,
        "nodes": nodes,
        "countries": countries,
        "mapped_count": len(nodes),
        "total_considered": len(rows),
    }


# ---------------------------------------------------------------------------
# 6. High-Density 2D Co-occurrence Graph (Sigma.js + Graphology)
# ---------------------------------------------------------------------------
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

    # Desaturated APCA-safe genre palette
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
        # Deterministic sector + spiral initial coords (Sigma renders cleanly even before ForceAtlas2)
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


# ---------------------------------------------------------------------------
# 7. Music Iceberg (8 Depth Strata)
# ---------------------------------------------------------------------------
ICEBERG_TIERS = [
    (1, "Surface · Mainstream", "Artistes mondiaux incontournables", 0, 14),
    (2, "Soleil · Grand Public", "Stars internationales & classiques", 14, 26),
    (3, "Lagon · Reconnu", "Scène majeure & têtes d'affiche", 26, 38),
    (4, "Crépuscule · Culte", "Références de niche & esthètes", 38, 52),
    (5, "Fosse · Alternatif", "Curations pointues & indépendants", 52, 65),
    (6, "Minuit · Underground", "Trésors peu connus du grand public", 65, 78),
    (7, "Hadale · Confidentiel", "Micro-scènes & découvertes rares", 78, 90),
    (8, "Abysse · Ultra-Rare", "Pépites secrètes & obscurité pure", 90, 101),
]


def get_music_iceberg(f: FilterParams, limit: int = 120) -> dict[str, Any]:
    where, params = build_where_clause(f)
    order = metric_order_sql(f)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   MAX(tc.genre) AS genre, MAX(tc.artwork_url) AS artwork_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   mb.obscurity_score, mb.lb_user_count, mb.source AS mb_source
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN artist_musicbrainz mb ON mb.artist_group_key = tc.artist_group_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY {order}
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()

    tiers: list[dict[str, Any]] = [
        {"level": lvl, "name": name, "subtitle": sub, "artists": []}
        for lvl, name, sub, _, _ in ICEBERG_TIERS
    ]
    obscurities = []
    for idx, r in enumerate(rows):
        ak = r["artist_key"]
        if r["obscurity_score"] is not None:
            obs = float(r["obscurity_score"])
            src = r["mb_source"] or "listenbrainz"
        elif ak in CURATED_ARTIST_GEO:
            obs = round(100.0 - CURATED_ARTIST_GEO[ak][4], 1)
            src = "curated_seed"
        else:
            # Deterministic local rarity proxy spread across deeper tiers
            h = hashlib.md5(ak.encode("utf-8")).digest()
            obs = round(38.0 + (h[0] / 255.0) * 58.0, 1)
            src = "local_rarity"
        obscurities.append(obs)
        item = {
            "artist_key": ak,
            "artist_name": r["artist_name"],
            "genre": r["genre"] or "Autre",
            "artwork_url": r["artwork_url"],
            "plays": int(r["plays"]),
            "hours": round(int(r["total_ms"] or 0) / 3_600_000.0, 2),
            "obscurity_score": obs,
            "lb_user_count": r["lb_user_count"],
            "source": src,
        }
        placed = False
        for t_idx, (_, _, _, lo, hi) in enumerate(ICEBERG_TIERS):
            if lo <= obs < hi:
                tiers[t_idx]["artists"].append(item)
                placed = True
                break
        if not placed:
            tiers[-1]["artists"].append(item)

    avg_obs = round(sum(obscurities) / max(len(obscurities), 1), 1)
    return {
        "obscurity_index": avg_obs,
        "verdict": (
            "Explorateur des Abysses" if avg_obs >= 65
            else "Diggeur Éclectique" if avg_obs >= 45
            else "Mélomane Pop & Culte"
        ),
        "tiers": tiers,
    }


# ---------------------------------------------------------------------------
# 8. Personal Blind-Test Quiz Generator (Inspiration Bandle)
# ---------------------------------------------------------------------------
def get_blind_test_quiz(f: FilterParams, rounds: int = 8, seed: int | None = None) -> dict[str, Any]:
    rng = random.Random(seed if seed is not None else int(datetime.now().timestamp()))
    where, params = build_where_clause(f)
    with db_session() as conn:
        tracks = conn.execute(
            f"""
            SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                   tc.album_name, tc.genre, tc.release_year, tc.artwork_url, tc.preview_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where}
            GROUP BY tc.track_key
            HAVING plays >= 3
            ORDER BY total_ms DESC
            LIMIT 120
            """,
            params,
        ).fetchall()

        artists = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   MAX(tc.artwork_url) AS artwork_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            HAVING plays >= 5
            ORDER BY total_ms DESC
            LIMIT 60
            """,
            params,
        ).fetchall()

        artist_peaks = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   pe.local_month, COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL
            GROUP BY tc.artist_group_key, pe.local_month
            """,
            params,
        ).fetchall()

    questions: list[dict[str, Any]] = []
    track_list = [dict(r) for r in tracks]
    artist_list = [dict(r) for r in artists]

    # Prefer tracks with preview_url first for audio blind-test rounds
    with_prev = [t for t in track_list if t.get("preview_url")]
    audio_pool = with_prev if len(with_prev) >= 6 else track_list

    # Round type 1: Track recognition (1s / 3s / 6s preview + progressive clues)
    if len(audio_pool) >= 4:
        chosen = rng.sample(audio_pool[:40], min(4, len(audio_pool[:40])))
        for t in chosen:
            distractors = [x for x in track_list if x["track_key"] != t["track_key"]]
            opts = [t] + rng.sample(distractors, min(3, len(distractors)))
            rng.shuffle(opts)
            questions.append(
                {
                    "id": f"track:{t['track_key']}",
                    "mode": "track_guess",
                    "prompt": "Quel est ce titre de ton historique ?",
                    "preview_url": t.get("preview_url"),
                    "clues": [
                        f"Genre : {t.get('genre') or 'Inconnu'}",
                        f"Année : {t.get('release_year') or '?'} · Album : {t.get('album_name') or '?'}",
                        f"Tu l'as écouté {t['plays']} fois ({round(t['total_ms']/60000, 1)} min)",
                    ],
                    "artwork_url": t.get("artwork_url"),
                    "correct_id": t["track_key"],
                    "correct_label": f"{t['song_name']} — {t['artist_name']}",
                    "options": [
                        {"id": o["track_key"], "label": o["song_name"], "sub": o["artist_name"]}
                        for o in opts
                    ],
                }
            )

    # Round type 2: Artist Listening Duel
    if len(artist_list) >= 4:
        for _ in range(min(2, rounds)):
            a, b = rng.sample(artist_list[:35], 2)
            if abs(a["total_ms"] - b["total_ms"]) < 60_000:
                continue
            winner = a if a["total_ms"] >= b["total_ms"] else b
            questions.append(
                {
                    "id": f"duel:{a['artist_key']}:{b['artist_key']}",
                    "mode": "artist_duel",
                    "prompt": "Lequel de ces deux artistes as-tu le plus écouté ?",
                    "clues": [
                        f"Compare ton temps cumulé réel sur la période sélectionnée.",
                    ],
                    "correct_id": winner["artist_key"],
                    "correct_label": f"{winner['artist_name']} ({round(winner['total_ms']/3_600_000, 1)} h vs {round((b if winner==a else a)['total_ms']/3_600_000, 1)} h)",
                    "options": [
                        {"id": a["artist_key"], "label": a["artist_name"], "sub": f"Candidat A", "artwork_url": a.get("artwork_url")},
                        {"id": b["artist_key"], "label": b["artist_name"], "sub": f"Candidat B", "artwork_url": b.get("artwork_url")},
                    ],
                }
            )

    # Round type 3: Obsession Peak Month
    by_artist_month: dict[str, list[tuple[str, int, str]]] = defaultdict(list)
    all_months = sorted({r["local_month"] for r in artist_peaks})
    for r in artist_peaks:
        by_artist_month[r["artist_key"]].append((r["local_month"], int(r["plays"]), r["artist_name"]))
    peak_cands = [
        (ak, max(vals, key=lambda v: v[1]))
        for ak, vals in by_artist_month.items()
        if len(vals) >= 2 and max(vals, key=lambda v: v[1])[1] >= 8
    ]
    if peak_cands and len(all_months) >= 4:
        for ak, (peak_m, peak_p, aname) in rng.sample(peak_cands[:25], min(2, len(peak_cands[:25]))):
            other_m = [m for m in all_months if m != peak_m]
            m_opts = [peak_m] + rng.sample(other_m, min(3, len(other_m)))
            m_opts.sort()
            questions.append(
                {
                    "id": f"peak:{ak}",
                    "mode": "peak_month",
                    "prompt": f"Quel mois correspond à ton plus gros pic d'obsession pour {aname} ?",
                    "clues": [f"Tu as lancé {peak_p} écoutes durant ce mois record."],
                    "correct_id": peak_m,
                    "correct_label": f"{peak_m} ({peak_p} écoutes)",
                    "options": [{"id": m, "label": m, "sub": "Mois"} for m in m_opts],
                }
            )

    rng.shuffle(questions)
    return {"total_rounds": len(questions[:rounds]), "questions": questions[:rounds]}


# ---------------------------------------------------------------------------
# 9. Collector Atelier (Album Quilt, Annual Pixel Grid, 3-Day Festival Poster)
# ---------------------------------------------------------------------------
def _hsl_hex_for_key(key: str) -> str:
    h = hashlib.md5(key.encode("utf-8")).digest()
    hue = (h[0] / 255.0) * 360.0
    sat = 0.42 + (h[1] / 255.0) * 0.22  # APCA-safe desaturated hue
    lit = 0.46 + (h[2] / 255.0) * 0.16
    c = (1 - abs(2 * lit - 1)) * sat
    x = c * (1 - abs((hue / 60.0) % 2 - 1))
    m = lit - c / 2
    if hue < 60:
        r, g, b = c, x, 0
    elif hue < 120:
        r, g, b = x, c, 0
    elif hue < 180:
        r, g, b = 0, c, x
    elif hue < 240:
        r, g, b = 0, x, c
    elif hue < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return "#{:02x}{:02x}{:02x}".format(int((r + m) * 255), int((g + m) * 255), int((b + m) * 255))


def get_collector_atelier(f: FilterParams) -> dict[str, Any]:
    where, params = build_where_clause(f)
    order = metric_order_sql(f)
    with db_session() as conn:
        albums = conn.execute(
            f"""
            SELECT tc.album_group_key AS album_key, MAX(tc.album_name) AS album_name,
                   MAX(COALESCE(tc.artist_name, 'Inconnu')) AS artist_name,
                   MAX(tc.artwork_url) AS artwork_url, MAX(tc.back_cover_url) AS back_cover_url,
                   MAX(tc.genre) AS genre, MAX(tc.release_year) AS release_year,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where} AND tc.album_group_key != ''
            GROUP BY tc.album_group_key
            ORDER BY {order}
            LIMIT 36
            """,
            params,
        ).fetchall()

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
            LIMIT 36
            """,
            params,
        ).fetchall()

        # Annual Pixel Grid: #1 album per calendar day (Last.fm Labs style)
        day_albums = conn.execute(
            f"""
            SELECT pe.local_date, tc.album_group_key AS album_key,
                   MAX(tc.album_name) AS album_name,
                   MAX(COALESCE(tc.artist_name, 'Inconnu')) AS artist_name,
                   MAX(tc.artwork_url) AS artwork_url,
                   SUM(pe.play_duration_ms) AS ms, COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where}
            GROUP BY pe.local_date, tc.album_group_key
            """,
            params,
        ).fetchall()

        summary = conn.execute(
            f"""
            SELECT COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   MIN(pe.local_date) AS min_date, MAX(pe.local_date) AS max_date
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where}
            """,
            params,
        ).fetchone()

    best_by_day: dict[str, dict[str, Any]] = {}
    for r in day_albums:
        d = r["local_date"]
        if d not in best_by_day or int(r["ms"] or 0) > best_by_day[d]["ms"]:
            best_by_day[d] = {
                "date": d,
                "album_key": r["album_key"],
                "album_name": r["album_name"],
                "artist_name": r["artist_name"],
                "artwork_url": r["artwork_url"],
                "color": _hsl_hex_for_key(r["album_key"] or r["album_name"]),
                "ms": int(r["ms"] or 0),
                "plays": int(r["plays"] or 0),
            }

    pixel_grid = sorted(best_by_day.values(), key=lambda x: x["date"])

    # 3-Day Festival Poster (Instafest style: Fri / Sat / Sun)
    a_list = [dict(r) for r in artists]
    days_meta = [
        {"day": "VENDREDI", "stage": "SCÈNE CONTINUUM", "artists": []},
        {"day": "SAMEDI", "stage": "GRANDE SCÈNE", "artists": []},
        {"day": "DIMANCHE", "stage": "SCÈNE CLÔTURE", "artists": []},
    ]
    for i, a in enumerate(a_list[:30]):
        days_meta[i % 3]["artists"].append(
            {
                "artist_key": a["artist_key"],
                "artist_name": a["artist_name"],
                "tier": 1 if i < 3 else (2 if i < 12 else 3),
                "hours": round(int(a["total_ms"] or 0) / 3_600_000.0, 1),
            }
        )

    quilt = [
        {
            "album_key": r["album_key"],
            "album_name": r["album_name"],
            "artist_name": r["artist_name"],
            "artwork_url": r["artwork_url"],
            "back_cover_url": r["back_cover_url"],
            "genre": r["genre"],
            "release_year": r["release_year"],
            "color": _hsl_hex_for_key(r["album_key"]),
            "plays": int(r["plays"]),
            "hours": round(int(r["total_ms"] or 0) / 3_600_000.0, 2),
        }
        for r in albums
    ]

    return {
        "total_plays": int(summary["plays"] or 0) if summary else 0,
        "total_hours": round(int(summary["total_ms"] or 0) / 3_600_000.0, 1) if summary else 0.0,
        "min_date": summary["min_date"] if summary else None,
        "max_date": summary["max_date"] if summary else None,
        "quilt": quilt,
        "pixel_grid": pixel_grid,
        "festival_days": days_meta,
    }


# ---------------------------------------------------------------------------
# 10. Instant SQLite FTS5 Search (unicode61 accent-insensitive + trigram + lyrics)
# ---------------------------------------------------------------------------
def fts5_search(query: str, limit: int = 25) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"query": "", "total": 0, "tracks": [], "lyrics_matches": []}

    # Sanitize FTS5 query tokens
    tokens = [t for t in "".join(ch if ch.isalnum() else " " for ch in q).split() if t]
    if not tokens:
        return {"query": q, "total": 0, "tracks": [], "lyrics_matches": []}

    fts_expr = " ".join(f'"{t}"*' for t in tokens[:6])
    tracks: list[dict[str, Any]] = []
    seen: set[str] = set()
    lyrics_matches: list[dict[str, Any]] = []

    with db_session() as conn:
        # 1. Primary unicode61 (accent-insensitive: "deja" finds "Déjà")
        try:
            rows = conn.execute(
                """
                SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                       tc.album_name, tc.genre, tc.release_year, tc.artwork_url, tc.preview_url,
                       tc.total_plays, tc.total_ms
                FROM tracks_fts fts
                JOIN tracks_catalog tc ON tc.track_key = fts.track_key
                WHERE tracks_fts MATCH ?
                ORDER BY bm25(tracks_fts), tc.total_plays DESC
                LIMIT ?
                """,
                (fts_expr, limit),
            ).fetchall()
            for r in rows:
                seen.add(r["track_key"])
                tracks.append({**dict(r), "match_source": "fts5_unicode61", "snippet": None})
        except Exception:
            pass

        # 2. Trigram fallback for arbitrary mid-word substrings (when len >= 3)
        if len(tracks) < limit and len(q) >= 3:
            try:
                tri_q = '"' + q.replace('"', "") + '"'
                rows = conn.execute(
                    """
                    SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                           tc.album_name, tc.genre, tc.release_year, tc.artwork_url, tc.preview_url,
                           tc.total_plays, tc.total_ms
                    FROM tracks_fts_trigram fts
                    JOIN tracks_catalog tc ON tc.track_key = fts.track_key
                    WHERE tracks_fts_trigram MATCH ?
                    ORDER BY tc.total_plays DESC
                    LIMIT ?
                    """,
                    (tri_q, limit),
                ).fetchall()
                for r in rows:
                    if r["track_key"] not in seen and len(tracks) < limit:
                        seen.add(r["track_key"])
                        tracks.append({**dict(r), "match_source": "fts5_trigram", "snippet": None})
            except Exception:
                pass

        # 3. Full-text search inside cached LRCLIB lyrics
        try:
            lrows = conn.execute(
                """
                SELECT track_key, song_name, artist_name,
                       snippet(lyrics_fts, 3, '[', ']', '…', 18) AS snippet
                FROM lyrics_fts
                WHERE lyrics_fts MATCH ?
                ORDER BY bm25(lyrics_fts)
                LIMIT 10
                """,
                (fts_expr,),
            ).fetchall()
            lyrics_matches = [dict(r) for r in lrows]
        except Exception:
            pass

    return {
        "query": q,
        "total": len(tracks) + len(lyrics_matches),
        "tracks": tracks,
        "lyrics_matches": lyrics_matches,
    }
