from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause

END_REASON_LABELS = {
    "NATURAL_END_OF_TRACK": "Fin naturelle",
    "TRACK_SKIPPED_FORWARDS": "Skip suivant",
    "PLAYBACK_MANUALLY_PAUSED": "Pause manuelle",
    "MANUALLY_SELECTED_PLAYBACK_OF_A_DIFF_ITEM": "Changement manuel",
    "SCRUB_BEGIN": "Avance / retour rapide",
    "TRACK_SKIPPED_BACKWARDS": "Retour arrière",
    "PLAYBACK_SUSPENDED": "Lecture suspendue",
    "FAILED_TO_LOAD": "Échec chargement",
    "EXITED_APPLICATION": "App fermée",
}


def get_behavior_and_obsessions(f: FilterParams) -> dict[str, Any]:
    where_sql, params = build_where_clause(f, include_skip_filter=True)
    where_all, params_all = build_where_clause(f, include_skip_filter=False)

    with db_session() as conn:
        # ------------------------------------------------------------------
        # 1. End Reason Type breakdown & Global Skip Stats (always on ALL events in period)
        # ------------------------------------------------------------------
        end_reasons = [
            {
                "code": r["end_reason_type"],
                "label": END_REASON_LABELS.get(r["end_reason_type"], r["end_reason_type"]),
                "count": r["cnt"],
                "total_ms": r["total_ms"],
            }
            for r in conn.execute(
                f"""
                SELECT pe.end_reason_type, COUNT(*) AS cnt, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_all}
                GROUP BY pe.end_reason_type
                ORDER BY cnt DESC
                """,
                params_all,
            )
        ]
        total_raw = sum(e["count"] for e in end_reasons) or 1
        for e in end_reasons:
            e["share_pct"] = round(e["count"] / total_raw * 100, 1)

        # ------------------------------------------------------------------
        # 2. "Les Intouchables" (lowest skip rate on >= 8 plays) vs "Les Mal-Aimés" (most skipped < 30s)
        # ------------------------------------------------------------------
        untouchables = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    tc.track_key, tc.song_name, tc.album_name, tc.artist_name,
                    tc.artist_group_key, tc.artwork_url, tc.preview_url,
                    COUNT(*) AS raw_plays,
                    SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS skips_30s,
                    ROUND(AVG(pe.completion_ratio) * 100, 1) AS avg_completion_pct,
                    SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_all}
                GROUP BY tc.track_key
                HAVING raw_plays >= 8
                ORDER BY (CAST(skips_30s AS REAL) / raw_plays) ASC, avg_completion_pct DESC, raw_plays DESC
                LIMIT 15
                """,
                params_all,
            )
        ]
        for u in untouchables:
            u["skip_rate_pct"] = round(u["skips_30s"] / u["raw_plays"] * 100, 1)

        most_skipped = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    tc.track_key, tc.song_name, tc.album_name, tc.artist_name,
                    tc.artist_group_key, tc.artwork_url, tc.preview_url,
                    COUNT(*) AS raw_plays,
                    SUM(CASE WHEN pe.is_skip_30s = 1 THEN 1 ELSE 0 END) AS skips_30s,
                    ROUND(AVG(pe.completion_ratio) * 100, 1) AS avg_completion_pct,
                    SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_all}
                GROUP BY tc.track_key
                HAVING skips_30s >= 3
                ORDER BY skips_30s DESC, (CAST(skips_30s AS REAL) / raw_plays) DESC
                LIMIT 15
                """,
                params_all,
            )
        ]
        for m in most_skipped:
            m["skip_rate_pct"] = round(m["skips_30s"] / m["raw_plays"] * 100, 1)

        # ------------------------------------------------------------------
        # 3. Écoutes en boucle (consecutive repeats in the same session)
        # ------------------------------------------------------------------
        seq = conn.execute(
            f"""
            SELECT
                pe.track_key, pe.session_id, pe.local_date, pe.started_at_local,
                tc.song_name, tc.album_name, tc.artist_name, tc.artist_group_key,
                tc.artwork_url, tc.preview_url
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql}
            ORDER BY pe.started_epoch ASC
            """,
            params,
        ).fetchall()

        loop_counts: Counter = Counter()
        max_streak_by_track: dict[str, dict[str, Any]] = {}
        track_meta_cache: dict[str, dict[str, Any]] = {}

        if seq:
            cur_key = seq[0]["track_key"]
            cur_sess = seq[0]["session_id"]
            cur_len = 1
            cur_date = seq[0]["local_date"]
            track_meta_cache[cur_key] = dict(seq[0])

            for r in seq[1:]:
                tk = r["track_key"]
                if tk not in track_meta_cache:
                    track_meta_cache[tk] = dict(r)
                if tk == cur_key and r["session_id"] == cur_sess:
                    cur_len += 1
                    loop_counts[tk] += 1
                else:
                    if cur_len >= 2:
                        prev_best = max_streak_by_track.get(cur_key)
                        if not prev_best or cur_len > prev_best["max_consecutive"]:
                            max_streak_by_track[cur_key] = {"max_consecutive": cur_len, "date": cur_date}
                    cur_key = tk
                    cur_sess = r["session_id"]
                    cur_len = 1
                    cur_date = r["local_date"]
            if cur_len >= 2:
                prev_best = max_streak_by_track.get(cur_key)
                if not prev_best or cur_len > prev_best["max_consecutive"]:
                    max_streak_by_track[cur_key] = {"max_consecutive": cur_len, "date": cur_date}

        top_looped = []
        for tk, extra_repeats in loop_counts.most_common(15):
            meta = track_meta_cache[tk]
            st = max_streak_by_track.get(tk, {"max_consecutive": 2, "date": meta["local_date"]})
            top_looped.append(
                {
                    "track_key": tk,
                    "song_name": meta["song_name"],
                    "album_name": meta["album_name"],
                    "artist_name": meta["artist_name"],
                    "artist_group_key": meta["artist_group_key"],
                    "artwork_url": meta["artwork_url"],
                    "preview_url": meta["preview_url"],
                    "loop_repeats": extra_repeats,
                    "max_consecutive": st["max_consecutive"],
                    "peak_date": st["date"],
                }
            )

        record_loop = max(top_looped, key=lambda x: (x["max_consecutive"], x["loop_repeats"])) if top_looped else None

        # ------------------------------------------------------------------
        # 4. Radar d'Obsessions & Phases (14-day sliding windows where an artist spikes)
        # ------------------------------------------------------------------
        daily_artist_rows = conn.execute(
            f"""
            SELECT
                pe.local_date,
                tc.artist_group_key,
                MAX(tc.artist_name) AS artist_name,
                MAX(tc.artwork_url) AS artwork_url,
                COUNT(*) AS plays,
                SUM(pe.play_duration_ms) AS total_ms
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE {where_sql} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY pe.local_date, tc.artist_group_key
            ORDER BY pe.local_date ASC
            """,
            params,
        ).fetchall()

        phases = _detect_obsession_phases(daily_artist_rows)

        # ------------------------------------------------------------------
        # 5. Analyse des Paroles (LYRIC_DISPLAY)
        # ------------------------------------------------------------------
        lyric_where, lyric_params = _build_date_where(f, "le")
        lyric_total = conn.execute(
            f"SELECT COUNT(*) FROM lyric_events le WHERE {lyric_where}", lyric_params
        ).fetchone()[0]

        lyric_types = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT COALESCE(le.display_type, 'UNKNOWN') AS type, COUNT(*) AS count
                FROM lyric_events le
                WHERE {lyric_where}
                GROUP BY le.display_type
                ORDER BY count DESC
                """,
                lyric_params,
            )
        ]

        lyric_langs = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT COALESCE(le.display_language, 'inconnue') AS lang, COUNT(*) AS count
                FROM lyric_events le
                WHERE {lyric_where} AND le.display_language IS NOT NULL
                GROUP BY le.display_language
                ORDER BY count DESC
                LIMIT 8
                """,
                lyric_params,
            )
        ]

        top_lyric_tracks = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    tc.track_key, tc.song_name, tc.album_name, tc.artist_name,
                    tc.artist_group_key, tc.artwork_url, tc.preview_url,
                    COUNT(*) AS lyric_views,
                    SUM(le.translation_displayed) AS translations,
                    MAX(le.display_language) AS lang
                FROM lyric_events le
                JOIN tracks_catalog tc ON tc.track_key = le.track_key
                WHERE {lyric_where}
                GROUP BY tc.track_key
                ORDER BY lyric_views DESC
                LIMIT 15
                """,
                lyric_params,
            )
        ]

        # ------------------------------------------------------------------
        # 6. Historique & Top Recherches (search_events from Click Activity)
        # ------------------------------------------------------------------
        search_where, search_params = _build_date_where(f, "se")
        search_total = conn.execute(
            f"SELECT COUNT(*) FROM search_events se WHERE {search_where}", search_params
        ).fetchone()[0]

        top_searches = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT
                    MAX(se.query) AS query,
                    COUNT(*) AS count,
                    MIN(se.local_date) AS first_date,
                    MAX(se.local_date) AS last_date
                FROM search_events se
                WHERE {search_where}
                GROUP BY se.query_norm
                ORDER BY count DESC, last_date DESC
                LIMIT 20
                """,
                search_params,
            )
        ]

        recent_searches = [
            dict(r)
            for r in conn.execute(
                f"""
                SELECT se.query, se.searched_at_local, se.local_date, se.device_os
                FROM search_events se
                WHERE {search_where}
                ORDER BY se.searched_at_local DESC
                LIMIT 25
                """,
                search_params,
            )
        ]

    return {
        "end_reasons": end_reasons,
        "untouchables": untouchables,
        "most_skipped": most_skipped,
        "loops": {
            "total_consecutive_repeats": sum(loop_counts.values()),
            "record_loop": record_loop,
            "top_looped": top_looped,
        },
        "phases": phases,
        "lyrics": {
            "total_views": lyric_total,
            "display_types": lyric_types,
            "languages": lyric_langs,
            "top_tracks": top_lyric_tracks,
        },
        "searches": {
            "total_searches": search_total,
            "top_queries": top_searches,
            "recent": recent_searches,
        },
    }


def _build_date_where(f: FilterParams, alias: str) -> tuple[str, list[Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if f.period_mode == "year" and f.year is not None:
        clauses.append(f"{alias}.local_year = ?")
        params.append(f.year)
    elif f.period_mode == "month" and f.month:
        clauses.append(f"{alias}.local_month = ?")
        params.append(f.month)
    elif f.period_mode == "custom":
        if f.date_from:
            clauses.append(f"{alias}.local_date >= ?")
            params.append(f.date_from)
        if f.date_to:
            clauses.append(f"{alias}.local_date <= ?")
            params.append(f.date_to)
    return " AND ".join(clauses), params


def _detect_obsession_phases(rows) -> list[dict[str, Any]]:
    """Detect 14-day sliding windows where an artist spikes intensely."""
    if not rows:
        return []

    day_totals: dict[str, int] = defaultdict(int)
    artist_days: dict[str, list[tuple[date, int, int]]] = defaultdict(list)
    artist_meta: dict[str, dict[str, Any]] = {}
    artist_global_ms: dict[str, int] = defaultdict(int)
    grand_total_ms = 0

    for r in rows:
        d_str = r["local_date"]
        ak = r["artist_group_key"]
        ms = r["total_ms"]
        p = r["plays"]
        day_totals[d_str] += ms
        grand_total_ms += ms
        artist_global_ms[ak] += ms
        artist_days[ak].append((date.fromisoformat(d_str), ms, p))
        if ak not in artist_meta or (r["artwork_url"] and not artist_meta[ak]["artwork_url"]):
            artist_meta[ak] = {"artist_name": r["artist_name"], "artwork_url": r["artwork_url"]}

    if grand_total_ms <= 0:
        return []

    # Pre-index day_totals by date object for fast 14-day window sum
    all_dates_sorted = sorted(date.fromisoformat(d) for d in day_totals.keys())
    date_ms_map = {date.fromisoformat(d): ms for d, ms in day_totals.items()}

    candidates = []
    for ak, entries in artist_days.items():
        if len(entries) < 2:
            continue
        baseline_share = artist_global_ms[ak] / grand_total_ms
        # Sliding 14-day window over this artist's active days
        best_win = None
        for i in range(len(entries)):
            start_d = entries[i][0]
            end_d = start_d + timedelta(days=13)
            win_ms = 0
            win_plays = 0
            actual_end = start_d
            j = i
            while j < len(entries) and entries[j][0] <= end_d:
                win_ms += entries[j][1]
                win_plays += entries[j][2]
                actual_end = entries[j][0]
                j += 1
            if win_plays < 12 or win_ms < 25 * 60 * 1000:  # at least 12 plays & 25 min in 2 weeks
                continue
            # Total listening across all artists in that 14-day window
            tot_win_ms = sum(
                ms for dt, ms in date_ms_map.items() if start_d <= dt <= end_d
            ) or 1
            win_share = win_ms / tot_win_ms
            lift = win_share / max(baseline_share, 0.005)
            # Score balances absolute intensity (plays/time) and spike ratio
            if win_share >= 0.14 and lift >= 1.8:
                score = win_share * 100 + min(lift, 10) * 6 + (win_ms / 3_600_000) * 8
                if best_win is None or score > best_win["score"]:
                    best_win = {
                        "artist_group_key": ak,
                        "artist_name": artist_meta[ak]["artist_name"],
                        "artwork_url": artist_meta[ak]["artwork_url"],
                        "start_date": start_d.isoformat(),
                        "end_date": actual_end.isoformat(),
                        "plays": win_plays,
                        "total_ms": win_ms,
                        "window_share_pct": round(win_share * 100, 1),
                        "baseline_share_pct": round(baseline_share * 100, 1),
                        "lift": round(lift, 1),
                        "score": round(score, 1),
                    }
        if best_win:
            candidates.append(best_win)

    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:12]
