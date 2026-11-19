from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause
from .behavior import get_behavior_and_obsessions
from .chrono import get_chronobiology
from .overview import get_overview, get_top_albums, get_top_artists, get_top_genres, get_top_tracks
from .persona import get_persona_and_eras


def _period_label(f: FilterParams, min_date: str | None, max_date: str | None) -> str:
    if f.period_mode == "year" and f.year:
        return f"Année {f.year}"
    if f.period_mode == "month" and f.month:
        return f"Mois {f.month}"
    if f.period_mode == "season" and f.season:
        return f"{f.season} {f.year}" if f.year else f.season
    if f.period_mode == "custom" and (f.date_from or f.date_to):
        return f"{f.date_from or '...'} → {f.date_to or '...'}"
    if min_date and max_date:
        return f"{min_date[:7]} → {max_date[:7]}"
    return "Tout l'historique"


def _fun_equivalents(total_hours: float) -> list[dict[str, str]]:
    return [
        {
            "label": "Vols Paris → Tokyo",
            "value": f"{round(total_hours / 12.5, 1)}×",
            "detail": "12h30 par vol",
        },
        {
            "label": "Trilogies Seigneur des Anneaux",
            "value": f"{round(total_hours / 11.4, 1)}×",
            "detail": "version longue (11h24)",
        },
        {
            "label": "Marathons courus",
            "value": f"{round(total_hours / 4.2, 1)}×",
            "detail": "rythme moyen 4h12",
        },
    ]


def get_wrapped_story(f: FilterParams) -> dict[str, Any]:
    overview = get_overview(f)
    persona_data = get_persona_and_eras(f)
    chrono = get_chronobiology(f)
    behavior = get_behavior_and_obsessions(f)

    top_artists = get_top_artists(f, limit=5)["items"]
    top_tracks = get_top_tracks(f, limit=5)["items"]
    top_albums = get_top_albums(f, limit=5)["items"]
    top_genres = get_top_genres(f, limit=5)["items"]

    # Moment of glory + #1 track preview for Top Artist #1
    top_artist_glory = None
    top_artist_preview = None
    top_artist_song = None
    if top_artists:
        a1 = top_artists[0]
        where_sql, params = build_where_clause(f, include_skip_filter=True)
        with db_session() as conn:
            peak = conn.execute(
                f"""
                SELECT pe.local_month AS month, COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key = ?
                GROUP BY pe.local_month
                ORDER BY total_ms DESC
                LIMIT 1
                """,
                [*params, a1["artist_group_key"]],
            ).fetchone()
            if peak:
                top_artist_glory = dict(peak)

            t1 = conn.execute(
                f"""
                SELECT tc.song_name, tc.preview_url, tc.artwork_url, SUM(pe.play_duration_ms) AS ms
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE {where_sql} AND tc.artist_group_key = ? AND tc.preview_url IS NOT NULL
                GROUP BY tc.track_key
                ORDER BY ms DESC
                LIMIT 1
                """,
                [*params, a1["artist_group_key"]],
            ).fetchone()
            if t1:
                top_artist_preview = t1["preview_url"]
                top_artist_song = t1["song_name"]
                if not a1.get("artwork_url") and t1["artwork_url"]:
                    a1["artwork_url"] = t1["artwork_url"]

    kpis = overview["kpis"]
    return {
        "period_label": _period_label(f, kpis.get("min_date"), kpis.get("max_date")),
        "metric": f.metric,
        "kpis": kpis,
        "equivalents": _fun_equivalents(kpis["total_hours"]),
        "rhythm": {
            "peak_hour": chrono["peak_hour"],
            "time_slots": chrono["time_slots"],
        },
        "top_loop": behavior["loops"]["record_loop"],
        "total_loops": behavior["loops"]["total_consecutive_repeats"],
        "top_phase": behavior["phases"][0] if behavior["phases"] else None,
        "top_artist": {
            **(top_artists[0] if top_artists else {}),
            "glory_month": top_artist_glory,
            "preview_url": top_artist_preview,
            "signature_song": top_artist_song,
        }
        if top_artists
        else None,
        "top_track": top_tracks[0] if top_tracks else None,
        "top_album": top_albums[0] if top_albums else None,
        "listening_age": persona_data["listening_age"],
        "persona": persona_data["persona"],
        "records": overview["records"],
        "lyrics_highlight": {
            "total_views": behavior["lyrics"]["total_views"],
            "top_track": behavior["lyrics"]["top_tracks"][0] if behavior["lyrics"]["top_tracks"] else None,
            "top_3": behavior["lyrics"]["top_tracks"][:3],
        },
        "searches_highlight": {
            "total_searches": behavior["searches"]["total_searches"],
            "top_queries": behavior["searches"]["top_queries"][:6],
        },
        "summary_card": {
            "top_artists": top_artists,
            "top_tracks": top_tracks,
            "top_albums": top_albums[:3],
            "top_genres": top_genres[:5],
        },
    }
