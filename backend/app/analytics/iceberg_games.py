"""Music Iceberg, Blind-Test Quiz, Collector Atelier & SQLite FTS5 Search."""

from __future__ import annotations

import hashlib
import random
from collections import defaultdict
from datetime import datetime
import math
import unicodedata
from difflib import SequenceMatcher
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


def _fold_text(text: str | None) -> str:
    """Lowercase + strip accents and punctuation for fault-tolerant matching."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(text))
    ascii_ish = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in ascii_ish)
    return " ".join(cleaned.split())


def _bounded_levenshtein(a: str, b: str, max_dist: int = 2) -> int:
    """Fast Damerau-Levenshtein distance capped at max_dist + 1."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > max_dist:
        return max_dist + 1
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    prev2 = prev[:]
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        row_min = cur[0]
        ca = a[i - 1]
        for j in range(1, lb + 1):
            cb = b[j - 1]
            cost = 0 if ca == cb else 1
            d = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                d = min(d, prev2[j - 2] + 1)
            cur[j] = d
            if d < row_min:
                row_min = d
        if row_min > max_dist:
            return max_dist + 1
        prev2 = prev
        prev = cur
    return prev[lb]


def _score_text_match(q_fold: str, q_tokens: list[str], candidate: str) -> float:
    """Score a candidate field against a folded query with typo tolerance."""
    c_fold = _fold_text(candidate)
    if not c_fold or not q_fold:
        return 0.0
    if c_fold == q_fold:
        return 1.0
    if c_fold.startswith(q_fold):
        return 0.94
    if q_fold in c_fold:
        return 0.86

    c_tokens = c_fold.split()
    if not c_tokens or not q_tokens:
        return 0.0

    matched = 0.0
    for qt in q_tokens:
        best_t = 0.0
        max_d = 1 if len(qt) <= 4 else 2
        for ct in c_tokens:
            if ct == qt:
                best_t = 1.0
                break
            if ct.startswith(qt) or qt.startswith(ct):
                best_t = max(best_t, 0.88)
                continue
            dist = _bounded_levenshtein(qt, ct, max_dist=max_d)
            if dist <= max_d:
                best_t = max(best_t, 0.84 - 0.14 * dist)
            elif len(qt) >= 4 and len(ct) >= 4:
                seq_r = SequenceMatcher(None, qt, ct).ratio()
                if seq_r >= 0.72:
                    best_t = max(best_t, seq_r * 0.82)
        matched += best_t

    token_avg = matched / len(q_tokens)
    whole_r = SequenceMatcher(None, q_fold, c_fold).ratio()
    return max(token_avg, whole_r * 0.92)


def search_suggestions(query: str, limit: int = 8) -> dict[str, Any]:
    """Fast auto-completion across artists, albums, tracks, and genres."""
    q_fold = _fold_text(query)
    q_tokens = q_fold.split()
    suggestions: list[dict[str, Any]] = []

    with db_session() as conn:
        if not q_fold:
            # Top popular artists & tracks when focused with empty query
            for r in conn.execute(
                """
                SELECT artist_name, MAX(artwork_url) AS artwork_url, SUM(total_plays) AS plays
                FROM tracks_catalog
                WHERE artist_name IS NOT NULL AND artist_name != ''
                GROUP BY artist_group_key
                ORDER BY plays DESC
                LIMIT ?
                """,
                (max(2, limit // 2),),
            ).fetchall():
                suggestions.append({
                    "kind": "artist",
                    "label": r["artist_name"],
                    "sublabel": "Artiste",
                    "query": r["artist_name"],
                    "artwork_url": r["artwork_url"],
                    "plays": int(r["plays"] or 0),
                })
            for r in conn.execute(
                """
                SELECT song_name, COALESCE(artist_name, 'Inconnu') AS artist_name, artwork_url, total_plays
                FROM tracks_catalog
                ORDER BY total_plays DESC
                LIMIT ?
                """,
                (max(2, limit - len(suggestions)),),
            ).fetchall():
                suggestions.append({
                    "kind": "track",
                    "label": r["song_name"],
                    "sublabel": r["artist_name"],
                    "query": r["song_name"],
                    "artwork_url": r["artwork_url"],
                    "plays": int(r["total_plays"] or 0),
                })
            return {"query": query, "suggestions": suggestions[:limit]}

        scored: list[tuple[float, dict[str, Any]]] = []

        # Artists
        for r in conn.execute(
            """
            SELECT artist_name, MAX(artwork_url) AS artwork_url, SUM(total_plays) AS plays
            FROM tracks_catalog
            WHERE artist_name IS NOT NULL AND artist_name != ''
            GROUP BY artist_group_key
            """
        ).fetchall():
            sc = _score_text_match(q_fold, q_tokens, r["artist_name"])
            if sc >= 0.56:
                plays = int(r["plays"] or 0)
                rank_sc = sc * 100.0 + math.log1p(plays) * 3.0 + 4.0
                scored.append((rank_sc, {
                    "kind": "artist",
                    "label": r["artist_name"],
                    "sublabel": "Artiste",
                    "query": r["artist_name"],
                    "artwork_url": r["artwork_url"],
                    "plays": plays,
                }))

        # Albums
        for r in conn.execute(
            """
            SELECT album_name, COALESCE(MAX(artist_name), 'Inconnu') AS artist_name,
                   MAX(artwork_url) AS artwork_url, SUM(total_plays) AS plays
            FROM tracks_catalog
            WHERE album_name IS NOT NULL AND album_name != '' AND LOWER(album_name) != 'single / inconnu'
            GROUP BY album_group_key
            """
        ).fetchall():
            sc = _score_text_match(q_fold, q_tokens, r["album_name"])
            if sc >= 0.58:
                plays = int(r["plays"] or 0)
                rank_sc = sc * 100.0 + math.log1p(plays) * 2.5 + 2.0
                scored.append((rank_sc, {
                    "kind": "album",
                    "label": r["album_name"],
                    "sublabel": f"Album · {r['artist_name']}",
                    "query": r["album_name"],
                    "artwork_url": r["artwork_url"],
                    "plays": plays,
                }))

        # Tracks (top 2000 by plays for sub-10ms autocomplete)
        for r in conn.execute(
            """
            SELECT song_name, COALESCE(artist_name, 'Inconnu') AS artist_name, artwork_url, total_plays
            FROM tracks_catalog
            ORDER BY total_plays DESC
            LIMIT 2500
            """
        ).fetchall():
            sc = _score_text_match(q_fold, q_tokens, r["song_name"])
            if sc >= 0.60:
                plays = int(r["total_plays"] or 0)
                rank_sc = sc * 100.0 + math.log1p(plays) * 2.0
                scored.append((rank_sc, {
                    "kind": "track",
                    "label": r["song_name"],
                    "sublabel": r["artist_name"],
                    "query": r["song_name"],
                    "artwork_url": r["artwork_url"],
                    "plays": plays,
                }))

        # Genres
        for r in conn.execute(
            """
            SELECT genre, SUM(total_plays) AS plays
            FROM tracks_catalog
            WHERE genre IS NOT NULL AND genre != '' AND genre != 'Inconnu'
            GROUP BY genre
            """
        ).fetchall():
            sc = _score_text_match(q_fold, q_tokens, r["genre"])
            if sc >= 0.65:
                plays = int(r["plays"] or 0)
                scored.append((sc * 90.0 + math.log1p(plays), {
                    "kind": "genre",
                    "label": r["genre"],
                    "sublabel": "Genre",
                    "query": r["genre"],
                    "artwork_url": None,
                    "plays": plays,
                }))

    scored.sort(key=lambda x: x[0], reverse=True)
    seen_sug: set[tuple[str, str]] = set()
    for _, item in scored:
        key = (item["kind"], item["label"].lower())
        if key not in seen_sug:
            seen_sug.add(key)
            suggestions.append(item)
            if len(suggestions) >= limit:
                break

    return {"query": query, "suggestions": suggestions}


def fts5_search(
    query: str,
    limit: int = 25,
    *,
    scope: str = "all",
    genre: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    min_plays: int = 0,
    sort: str = "relevance",
) -> dict[str, Any]:
    q = (query or "").strip()
    q_fold = _fold_text(q)
    q_tokens = q_fold.split()

    with db_session() as conn:
        facet_genres = [
            r[0]
            for r in conn.execute(
                """
                SELECT genre FROM tracks_catalog
                WHERE genre IS NOT NULL AND genre != '' AND genre != 'Inconnu'
                GROUP BY genre
                ORDER BY SUM(total_plays) DESC
                LIMIT 25
                """
            ).fetchall()
        ]
        yr_row = conn.execute(
            "SELECT MIN(release_year) AS min_y, MAX(release_year) AS max_y FROM tracks_catalog WHERE release_year > 1900"
        ).fetchone()
        facets = {
            "genres": facet_genres,
            "year_min": int(yr_row["min_y"]) if yr_row and yr_row["min_y"] else None,
            "year_max": int(yr_row["max_y"]) if yr_row and yr_row["max_y"] else None,
        }

        if not q_tokens:
            return {
                "query": q,
                "total": 0,
                "tracks": [],
                "lyrics_matches": [],
                "artists": [],
                "albums": [],
                "did_you_mean": None,
                "facets": facets,
            }

        fts_and = " ".join(f'"{t}"*' for t in q_tokens[:6])
        fts_or = " OR ".join(f'"{t}"*' for t in q_tokens[:6])
        candidates: dict[str, dict[str, Any]] = {}

        def _add_candidate(row_dict: dict[str, Any], source: str, base_bonus: float) -> None:
            tk = row_dict["track_key"]
            if tk in candidates:
                return
            s_song = _score_text_match(q_fold, q_tokens, row_dict.get("song_name"))
            s_art = _score_text_match(q_fold, q_tokens, row_dict.get("artist_name"))
            s_alb = _score_text_match(q_fold, q_tokens, row_dict.get("album_name"))
            s_gen = _score_text_match(q_fold, q_tokens, row_dict.get("genre"))
            field_max = max(s_song, s_art * 0.96, s_alb * 0.94, s_gen * 0.85)
            plays = int(row_dict.get("total_plays") or 0)
            score = round(field_max * 100.0 + base_bonus + math.log1p(plays) * 3.5, 2)
            candidates[tk] = {
                **row_dict,
                "match_source": source,
                "snippet": None,
                "score": score,
            }

        # 1. Fast FTS5 unicode61 (AND, then relaxed OR if needed)
        for expr, bonus in ((fts_and, 18.0), (fts_or, 6.0)):
            if not expr:
                continue
            try:
                rows = conn.execute(
                    """
                    SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                           tc.album_name, tc.album_group_key, tc.artist_group_key,
                           tc.genre, tc.release_year, tc.artwork_url, tc.preview_url,
                           tc.total_plays, tc.total_ms
                    FROM tracks_fts fts
                    JOIN tracks_catalog tc ON tc.track_key = fts.track_key
                    WHERE tracks_fts MATCH ?
                    ORDER BY bm25(tracks_fts), tc.total_plays DESC
                    LIMIT ?
                    """,
                    (expr, max(limit * 3, 80)),
                ).fetchall()
                for r in rows:
                    _add_candidate(dict(r), "fts5_unicode61", bonus)
            except Exception:
                pass
            if len(candidates) >= limit:
                break

        # 2. Trigram substring search
        if len(candidates) < limit and len(q) >= 3:
            try:
                tri_q = '"' + q.replace('"', "") + '"'
                rows = conn.execute(
                    """
                    SELECT tc.track_key, tc.song_name, COALESCE(tc.artist_name, 'Inconnu') AS artist_name,
                           tc.album_name, tc.album_group_key, tc.artist_group_key,
                           tc.genre, tc.release_year, tc.artwork_url, tc.preview_url,
                           tc.total_plays, tc.total_ms
                    FROM tracks_fts_trigram fts
                    JOIN tracks_catalog tc ON tc.track_key = fts.track_key
                    WHERE tracks_fts_trigram MATCH ?
                    ORDER BY tc.total_plays DESC
                    LIMIT ?
                    """,
                    (tri_q, max(limit * 2, 50)),
                ).fetchall()
                for r in rows:
                    _add_candidate(dict(r), "fts5_trigram", 10.0)
            except Exception:
                pass

        # 3. Typo-tolerant Fuzzy fallback (fautes d'orthographe / inversées / manquantes)
        if len(candidates) < limit:
            rows = conn.execute(
                """
                SELECT track_key, song_name, COALESCE(artist_name, 'Inconnu') AS artist_name,
                       album_name, album_group_key, artist_group_key,
                       genre, release_year, artwork_url, preview_url,
                       total_plays, total_ms
                FROM tracks_catalog
                ORDER BY total_plays DESC
                LIMIT 4000
                """
            ).fetchall()
            for r in rows:
                tk = r["track_key"]
                if tk in candidates:
                    continue
                s_song = _score_text_match(q_fold, q_tokens, r["song_name"])
                s_art = _score_text_match(q_fold, q_tokens, r["artist_name"])
                s_alb = _score_text_match(q_fold, q_tokens, r["album_name"])
                best_f = max(s_song, s_art * 0.96, s_alb * 0.94)
                if best_f >= 0.56:
                    _add_candidate(dict(r), "fuzzy_typo", 0.0)

        # Apply search filters
        filtered_tracks: list[dict[str, Any]] = []
        g_filter = (genre or "").strip().lower()
        for item in candidates.values():
            if g_filter and g_filter != "all" and (item.get("genre") or "").lower() != g_filter:
                continue
            yr = item.get("release_year")
            if year_from is not None and (yr is None or int(yr) < year_from):
                continue
            if year_to is not None and (yr is None or int(yr) > year_to):
                continue
            if min_plays > 0 and int(item.get("total_plays") or 0) < min_plays:
                continue
            filtered_tracks.append(item)

        if sort == "plays":
            filtered_tracks.sort(key=lambda x: (int(x.get("total_plays") or 0), x.get("score", 0.0)), reverse=True)
        elif sort == "duration":
            filtered_tracks.sort(key=lambda x: (int(x.get("total_ms") or 0), x.get("score", 0.0)), reverse=True)
        else:
            filtered_tracks.sort(key=lambda x: (x.get("score", 0.0), int(x.get("total_plays") or 0)), reverse=True)

        tracks = filtered_tracks[:limit] if scope in ("all", "tracks") else []

        # Aggregate matching Artists & Albums for multi-entity search
        artists: list[dict[str, Any]] = []
        albums: list[dict[str, Any]] = []
        if scope in ("all", "artists"):
            art_map: dict[str, dict[str, Any]] = {}
            for t in filtered_tracks:
                ak = t.get("artist_group_key") or (t.get("artist_name") or "").lower()
                if not ak:
                    continue
                sc_a = _score_text_match(q_fold, q_tokens, t.get("artist_name"))
                if scope == "all" and sc_a < 0.58:
                    continue
                cur = art_map.get(ak)
                if not cur:
                    art_map[ak] = {
                        "artist_group_key": ak,
                        "artist_name": t.get("artist_name"),
                        "artwork_url": t.get("artwork_url"),
                        "plays": int(t.get("total_plays") or 0),
                        "total_ms": int(t.get("total_ms") or 0),
                        "track_count": 1,
                        "_score": sc_a,
                    }
                else:
                    cur["plays"] += int(t.get("total_plays") or 0)
                    cur["total_ms"] += int(t.get("total_ms") or 0)
                    cur["track_count"] += 1
            artists = sorted(art_map.values(), key=lambda a: (a["_score"], a["plays"]), reverse=True)[:10]
            for a in artists:
                a.pop("_score", None)

        if scope in ("all", "albums"):
            alb_map: dict[str, dict[str, Any]] = {}
            for t in filtered_tracks:
                alb_name = t.get("album_name") or ""
                if not alb_name or alb_name.lower() == "single / inconnu":
                    continue
                ak = t.get("album_group_key") or alb_name.lower()
                sc_al = _score_text_match(q_fold, q_tokens, alb_name)
                sc_ar = _score_text_match(q_fold, q_tokens, t.get("artist_name"))
                if scope == "all" and max(sc_al, sc_ar) < 0.58:
                    continue
                cur = alb_map.get(ak)
                if not cur:
                    alb_map[ak] = {
                        "album_group_key": ak,
                        "album_name": alb_name,
                        "artist_name": t.get("artist_name"),
                        "release_year": t.get("release_year"),
                        "artwork_url": t.get("artwork_url"),
                        "plays": int(t.get("total_plays") or 0),
                        "total_ms": int(t.get("total_ms") or 0),
                        "track_count": 1,
                        "_score": max(sc_al, sc_ar * 0.9),
                    }
                else:
                    cur["plays"] += int(t.get("total_plays") or 0)
                    cur["total_ms"] += int(t.get("total_ms") or 0)
                    cur["track_count"] += 1
            albums = sorted(alb_map.values(), key=lambda a: (a["_score"], a["plays"]), reverse=True)[:10]
            for a in albums:
                a.pop("_score", None)

        # Lyrics FTS5
        lyrics_matches: list[dict[str, Any]] = []
        if scope in ("all", "lyrics"):
            for expr in (fts_and, fts_or):
                if not expr:
                    continue
                try:
                    lrows = conn.execute(
                        """
                        SELECT l.track_key, l.song_name, l.artist_name,
                               tc.album_name, tc.artwork_url, tc.preview_url,
                               snippet(lyrics_fts, 3, '[', ']', '…', 18) AS snippet
                        FROM lyrics_fts l
                        LEFT JOIN tracks_catalog tc ON tc.track_key = l.track_key
                        WHERE lyrics_fts MATCH ?
                        ORDER BY bm25(lyrics_fts)
                        LIMIT 15
                        """,
                        (expr,),
                    ).fetchall()
                    lyrics_matches = [dict(r) for r in lrows]
                    if lyrics_matches:
                        break
                except Exception:
                    pass

        # "Did you mean?" suggestion when only fuzzy matches were found
        did_you_mean: str | None = None
        if filtered_tracks and all(t["match_source"] == "fuzzy_typo" for t in filtered_tracks[:3]):
            top_t = filtered_tracks[0]
            candidates_dym = [top_t.get("artist_name"), top_t.get("album_name"), top_t.get("song_name")]
            best_dym = max(
                (c for c in candidates_dym if c),
                key=lambda c: _score_text_match(q_fold, q_tokens, c),
                default=None,
            )
            if best_dym and _fold_text(best_dym) != q_fold:
                did_you_mean = best_dym

    return {
        "query": q,
        "total": len(tracks) + len(artists) + len(albums) + len(lyrics_matches),
        "tracks": tracks,
        "lyrics_matches": lyrics_matches,
        "artists": artists,
        "albums": albums,
        "did_you_mean": did_you_mean,
        "facets": facets,
    }
