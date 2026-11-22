"""Music Iceberg, Blind-Test Quiz, Collector Atelier & SQLite FTS5 Search."""

from __future__ import annotations

import hashlib
import random
from collections import defaultdict
from datetime import datetime
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql
from ..jobs.worker import CURATED_ARTIST_GEO

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
    for r in rows:
        ak = r["artist_key"]
        if r["obscurity_score"] is not None:
            obs = float(r["obscurity_score"])
            src = r["mb_source"] or "listenbrainz"
        elif ak in CURATED_ARTIST_GEO:
            obs = round(100.0 - CURATED_ARTIST_GEO[ak][4], 1)
            src = "curated_seed"
        else:
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

    with_prev = [t for t in track_list if t.get("preview_url")]
    audio_pool = with_prev if len(with_prev) >= 6 else track_list

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
                        "Compare ton temps cumulé réel sur la période sélectionnée.",
                    ],
                    "correct_id": winner["artist_key"],
                    "correct_label": f"{winner['artist_name']} ({round(winner['total_ms']/3_600_000, 1)} h vs {round((b if winner==a else a)['total_ms']/3_600_000, 1)} h)",
                    "options": [
                        {"id": a["artist_key"], "label": a["artist_name"], "sub": "Candidat A", "artwork_url": a.get("artwork_url")},
                        {"id": b["artist_key"], "label": b["artist_name"], "sub": "Candidat B", "artwork_url": b.get("artwork_url")},
                    ],
                }
            )

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


def _hsl_hex_for_key(key: str) -> str:
    h = hashlib.md5(key.encode("utf-8")).digest()
    hue = (h[0] / 255.0) * 360.0
    sat = 0.42 + (h[1] / 255.0) * 0.22
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


def fts5_search(query: str, limit: int = 25) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"query": "", "total": 0, "tracks": [], "lyrics_matches": []}

    tokens = [t for t in "".join(ch if ch.isalnum() else " " for ch in q).split() if t]
    if not tokens:
        return {"query": q, "total": 0, "tracks": [], "lyrics_matches": []}

    fts_expr = " ".join(f'"{t}"*' for t in tokens[:6])
    tracks: list[dict[str, Any]] = []
    seen: set[str] = set()
    lyrics_matches: list[dict[str, Any]] = []

    with db_session() as conn:
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
