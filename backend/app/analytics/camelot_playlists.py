"""Camelot harmonic wheel, Audio DNA priors, Russell Emotional Compass & Smart Playlists."""

from __future__ import annotations

import hashlib
import json
import math
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql
from ..nlp.sentiment import analyze_lyrics_sentiment

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

_GENRE_AUDIO_PRIORS: dict[str, tuple[float, float, float, float]] = {
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
    boost_num = ((num + 1) % 12) + 1
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
        from .eras_pelt import get_musical_eras_pelt

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
