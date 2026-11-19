import math
from datetime import datetime
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause


def _weighted_median(pairs: list[tuple[int, int]]) -> int | None:
    if not pairs:
        return None
    pairs_sorted = sorted(pairs, key=lambda x: x[0])
    total_w = sum(w for _, w in pairs_sorted)
    if total_w <= 0:
        return None
    half = total_w / 2.0
    acc = 0.0
    for val, w in pairs_sorted:
        acc += w
        if acc >= half:
            return val
    return pairs_sorted[-1][0]


def get_persona_and_eras(f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)
    current_year = datetime.now().year

    with db_session() as conn:
        # 1. Release year distribution (weighted by listening time)
        year_rows = conn.execute(
            f"""
            SELECT
                tc.release_year AS year,
                SUM(pe.play_duration_ms) AS total_ms,
                COUNT(*) AS plays
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.release_year IS NOT NULL AND tc.release_year BETWEEN 1920 AND ?
            GROUP BY tc.release_year
            ORDER BY tc.release_year ASC
            """,
            [*params, current_year + 1],
        ).fetchall()

        total_dated_ms = sum(r["total_ms"] for r in year_rows)
        total_dated_plays = sum(r["plays"] for r in year_rows)

        weighted_mean_year = None
        weighted_median_year = None
        listening_age = None
        heart_decade = None

        eras = {
            "Classiques (< 1990)": 0,
            "Rétro (1990–2009)": 0,
            "Récents (2010–2021)": 0,
            "Nouveautés (2022+)": 0,
        }
        decade_map: dict[int, dict[str, int]] = {}

        if total_dated_ms > 0:
            weighted_mean_year = round(
                sum(r["year"] * r["total_ms"] for r in year_rows) / total_dated_ms, 1
            )
            weighted_median_year = _weighted_median([(r["year"], r["total_ms"]) for r in year_rows])
            # Transparent Listening Age formula:
            # Musical tastes crystallize around age 18–20.
            # Listening Age = 19 + (current_year - weighted_median_year)
            # Clamped reasonably between 15 and 85.
            if weighted_median_year is not None:
                raw_age = 19 + (current_year - weighted_median_year)
                listening_age = max(15, min(85, int(round(raw_age))))

            for r in year_rows:
                y = r["year"]
                ms = r["total_ms"]
                p = r["plays"]
                dec = (y // 10) * 10
                if dec not in decade_map:
                    decade_map[dec] = {"decade": dec, "label": f"{dec}s", "total_ms": 0, "plays": 0}
                decade_map[dec]["total_ms"] += ms
                decade_map[dec]["plays"] += p

                if y < 1990:
                    eras["Classiques (< 1990)"] += ms
                elif y <= 2009:
                    eras["Rétro (1990–2009)"] += ms
                elif y <= 2021:
                    eras["Récents (2010–2021)"] += ms
                else:
                    eras["Nouveautés (2022+)"] += ms

            if decade_map:
                best_dec = max(decade_map.values(), key=lambda d: d["total_ms"])
                heart_decade = best_dec["label"]

        era_breakdown = [
            {
                "label": k,
                "total_ms": v,
                "share_pct": round((v / total_dated_ms * 100), 1) if total_dated_ms else 0.0,
            }
            for k, v in eras.items()
        ]
        decades_list = sorted(decade_map.values(), key=lambda d: d["decade"])
        for d in decades_list:
            d["share_pct"] = round((d["total_ms"] / total_dated_ms * 100), 1) if total_dated_ms else 0.0

        # 2. Behavioral signals for 6 Radial Scores & Archetype
        base_stats = conn.execute(
            f"""
            SELECT
                COUNT(*) AS plays,
                COALESCE(SUM(pe.play_duration_ms), 0) AS total_ms,
                AVG(pe.completion_ratio) AS avg_completion,
                SUM(CASE WHEN pe.local_hour >= 22 OR pe.local_hour < 5 THEN pe.play_duration_ms ELSE 0 END) AS night_ms,
                SUM(CASE WHEN pe.container_type = 'ALBUM' THEN pe.play_duration_ms ELSE 0 END) AS album_ms,
                COUNT(DISTINCT pe.track_key) AS unique_tracks,
                COUNT(DISTINCT tc.artist_group_key) AS unique_artists
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            """,
            params,
        ).fetchone()

        raw_skip_row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS all_ev,
                SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS skips_30s
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_all}
            """,
            params_all,
        ).fetchone()

        # Artist distribution for Fidelity & Shannon Entropy
        artist_dist = conn.execute(
            f"""
            SELECT tc.artist_group_key, SUM(pe.play_duration_ms) AS ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key IS NOT NULL
            GROUP BY tc.artist_group_key
            ORDER BY ms DESC
            """,
            params,
        ).fetchall()

        # Consecutive loops count
        seq_rows = conn.execute(
            f"""
            SELECT pe.track_key, pe.session_id
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            ORDER BY pe.started_epoch ASC
            """,
            params,
        ).fetchall()

    total_ms = base_stats["total_ms"] or 1
    plays = base_stats["plays"] or 0
    unique_tracks = base_stats["unique_tracks"] or 1
    all_ev = raw_skip_row["all_ev"] or 1
    skip_rate = (raw_skip_row["skips_30s"] or 0) / all_ev

    # Score 1: Fidélité (Top 10 artists share of listening time)
    top10_ms = sum(r["ms"] for r in artist_dist[:10])
    total_art_ms = sum(r["ms"] for r in artist_dist) or 1
    top10_share = top10_ms / total_art_ms
    score_fidelite = min(100, int(round(top10_share * 145)))

    # Score 2: Diversité / Entropie (Normalized Shannon entropy of artists)
    n_artists = len(artist_dist)
    if n_artists > 1:
        entropy = -sum((r["ms"] / total_art_ms) * math.log(r["ms"] / total_art_ms) for r in artist_dist if r["ms"] > 0)
        max_entropy = math.log(n_artists)
        norm_entropy = entropy / max_entropy if max_entropy > 0 else 0
    else:
        norm_entropy = 0.0
    score_diversite = min(100, int(round(norm_entropy * 115)))

    # Score 3: Endurance / Taux de complétion
    avg_comp = base_stats["avg_completion"] or 0.0
    score_endurance = min(100, max(0, int(round((avg_comp * 0.7 + (1.0 - skip_rate) * 0.3) * 100))))

    # Score 4: Noctambulisme (share between 22h and 5h; 35%+ is very nocturnal -> 100)
    night_share = (base_stats["night_ms"] or 0) / total_ms
    score_noctambulisme = min(100, int(round(night_share * 260)))

    # Score 5: Nostalgie (share of listening on tracks released > 10 years ago)
    old_ms = sum(r["total_ms"] for r in year_rows if r["year"] <= current_year - 10)
    old_share = (old_ms / total_dated_ms) if total_dated_ms else 0.0
    score_nostalgie = min(100, int(round(old_share * 125)))

    # Score 6: Boucles (back-to-back repeats + plays-per-track intensity)
    consecutive_repeats = 0
    for i in range(1, len(seq_rows)):
        if seq_rows[i]["track_key"] == seq_rows[i - 1]["track_key"] and seq_rows[i]["session_id"] == seq_rows[i - 1]["session_id"]:
            consecutive_repeats += 1
    loop_rate = consecutive_repeats / max(plays, 1)
    plays_per_track = plays / unique_tracks
    score_boucles = min(100, int(round(loop_rate * 450 + min(40, plays_per_track * 6))))

    album_share = (base_stats["album_ms"] or 0) / total_ms

    radial_scores = [
        {"axis": "Fidélité", "score": score_fidelite, "detail": f"{round(top10_share * 100, 1)}% sur le Top 10 artistes"},
        {"axis": "Diversité", "score": score_diversite, "detail": f"{n_artists} artistes uniques"},
        {"axis": "Endurance", "score": score_endurance, "detail": f"{round(avg_comp * 100, 1)}% de complétion moyenne"},
        {"axis": "Noctambulisme", "score": score_noctambulisme, "detail": f"{round(night_share * 100, 1)}% écouté entre 22h et 5h"},
        {"axis": "Nostalgie", "score": score_nostalgie, "detail": f"{round(old_share * 100, 1)}% de titres de plus de 10 ans"},
        {"axis": "Boucles", "score": score_boucles, "detail": f"{consecutive_repeats} écoutes consécutives en boucle"},
    ]

    # Derive Music Persona Archetype from real dominant behavioral traits
    archetype = _pick_archetype(
        score_fidelite=score_fidelite,
        score_diversite=score_diversite,
        score_endurance=score_endurance,
        score_noctambulisme=score_noctambulisme,
        score_nostalgie=score_nostalgie,
        score_boucles=score_boucles,
        skip_rate=skip_rate,
        album_share=album_share,
        top10_share=top10_share,
        night_share=night_share,
        old_share=old_share,
        consecutive_repeats=consecutive_repeats,
        n_artists=n_artists,
    )

    return {
        "listening_age": {
            "age": listening_age,
            "weighted_median_year": weighted_median_year,
            "weighted_mean_year": weighted_mean_year,
            "heart_decade": heart_decade,
            "dated_coverage_pct": round((total_dated_ms / total_ms * 100), 1) if total_ms else 0.0,
            "dated_plays": total_dated_plays,
            "formula_explanation": (
                f"Calculé à partir de l'année de sortie médiane pondérée par votre temps d'écoute "
                f"({weighted_median_year or 'N/A'}), ancrée sur l'âge de cristallisation musicale (~19 ans) : "
                f"19 + ({current_year} − {weighted_median_year or current_year})."
            ),
            "eras": era_breakdown,
            "decades": decades_list,
            "years": [dict(r) for r in year_rows],
        },
        "persona": {
            **archetype,
            "radial_scores": radial_scores,
        },
    }


def _pick_archetype(**m) -> dict[str, Any]:
    candidates = [
        (
            m["score_noctambulisme"] * 1.05,
            {
                "id": "noctambule",
                "title": "Le Noctambule",
                "tagline": "Quand la ville s'endort, tes écouteurs s'allument.",
                "description": (
                    f"{round(m['night_share'] * 100, 1)}% de ton temps d'écoute se déroule entre 22h et 5h du matin. "
                    "Tu transformes la nuit en salle de concert privée, privilégiant l'immersion tardive."
                ),
                "accent": "#818cf8",
            },
        ),
        (
            m["score_boucles"] * 1.02 + (15 if m["consecutive_repeats"] >= 150 else 0),
            {
                "id": "monomaniaque",
                "title": "Le Monomaniaque Passionné",
                "tagline": "Quand un titre te touche, tu l'uses jusqu'à la corde.",
                "description": (
                    f"Avec {m['consecutive_repeats']} écoutes en boucle consécutives et {round(m['top10_share'] * 100, 1)}% "
                    "de ton temps concentré sur ton Top 10, tu vis tes coups de cœur par phases intenses."
                ),
                "accent": "#f43f5e",
            },
        ),
        (
            m["score_diversite"] * 1.0 + (10 if m["n_artists"] >= 400 else 0),
            {
                "id": "explorateur",
                "title": "L'Explorateur Sonore",
                "tagline": "Toujours un nouvel horizon dans la file d'attente.",
                "description": (
                    f"{m['n_artists']} artistes uniques parcourus avec une forte entropie musicale. "
                    "Tu navigues librement d'un univers à l'autre sans jamais t'enfermer."
                ),
                "accent": "#2dd4bf",
            },
        ),
        (
            m["score_nostalgie"] * 1.02,
            {
                "id": "voyageur_temporel",
                "title": "Le Voyageur Temporel",
                "tagline": "Les meilleurs disques traversent les décennies.",
                "description": (
                    f"{round(m['old_share'] * 100, 1)}% de ton écoute est dédiée à des morceaux sortis il y a plus de 10 ans. "
                    "Tu cultives un catalogue intemporel où les classiques règnent."
                ),
                "accent": "#f59e0b",
            },
        ),
        (
            m["score_endurance"] * 0.95 + m["album_share"] * 60,
            {
                "id": "archiviste",
                "title": "L'Archiviste d'Albums",
                "tagline": "Chaque piste mérite d'aller jusqu'à la dernière note.",
                "description": (
                    f"Un taux d'endurance de {m['score_endurance']}/100 et une écoute attentive qui respecte le rythme des œuvres."
                ),
                "accent": "#a855f7",
            },
        ),
        (
            (m["skip_rate"] * 180) if m["skip_rate"] > 0.35 else 0,
            {
                "id": "zappeur",
                "title": "Le Zappeur Exigeant",
                "tagline": "Tu sais en 15 secondes si un morceau mérite ton moment.",
                "description": (
                    f"Avec {round(m['skip_rate'] * 100, 1)}% de skips rapides, tu sculptes ta file d'attente au millimètre "
                    "jusqu'à trouver exactement la bonne vibe."
                ),
                "accent": "#fb7185",
            },
        ),
    ]
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]
