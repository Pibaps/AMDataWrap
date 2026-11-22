"""V1/V2/V3 Core Analytics, Detail Drawers, Sessions, History & Smart Playlists endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse, Response

from ..analytics.behavior import get_behavior_and_obsessions
from ..analytics.chrono import get_chronobiology
from ..analytics.detail import (
    export_history_csv,
    get_album_detail,
    get_artist_detail,
    get_day_detail,
    get_history,
    get_sessions,
)
from ..analytics.galaxy import get_sonic_galaxy
from ..analytics.overview import (
    get_filter_options,
    get_overview,
    get_top_albums,
    get_top_artists,
    get_top_genres,
    get_top_tracks,
)
from ..analytics.persona import get_persona_and_eras
from ..analytics.iceberg_games import search_suggestions
from ..analytics.v3_science import (
    build_smart_playlist,
    format_playlist_export,
    fts5_search,
    get_blind_test_quiz,
    get_camelot_wheel,
    get_collector_atelier,
    get_cooccurrence_graph_2d,
    get_emotional_compass,
    get_music_iceberg,
    get_musical_eras_pelt,
    get_science_metrics,
    get_world_atlas,
)
from ..analytics.wrapped import get_wrapped_story
from ..continuum.providers import push_playlist_to_listenbrainz
from ..filters import FilterParams, get_filter_params
from ..schemas import FtsSearchOut, PlaylistBuildIn

analytics_router = APIRouter(tags=["analytics"])


@analytics_router.get("/api/analytics/galaxy")
def galaxy_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(75, ge=10, le=120),
):
    return get_sonic_galaxy(f, limit=limit)


@analytics_router.get("/api/filters")
def filters_endpoint(
    profile_id: int | None = Query(None),
    source_provider: str | None = Query(None),
):
    return get_filter_options(profile_id=profile_id, source_provider=source_provider)


@analytics_router.get("/api/analytics/overview")
def overview_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_overview(f)


@analytics_router.get("/api/analytics/tops/artists")
def top_artists_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return get_top_artists(f, limit=limit, offset=offset)


@analytics_router.get("/api/analytics/tops/albums")
def top_albums_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return get_top_albums(f, limit=limit, offset=offset)


@analytics_router.get("/api/analytics/tops/tracks")
def top_tracks_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return get_top_tracks(f, limit=limit, offset=offset)


@analytics_router.get("/api/analytics/tops/genres")
def top_genres_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(30, ge=1, le=100),
):
    return get_top_genres(f, limit=limit)


@analytics_router.get("/api/analytics/chronobiology")
def chronobiology_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_chronobiology(f)


@analytics_router.get("/api/analytics/persona")
def persona_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_persona_and_eras(f)


@analytics_router.get("/api/analytics/behavior")
def behavior_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_behavior_and_obsessions(f)


@analytics_router.get("/api/analytics/wrapped")
def wrapped_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_wrapped_story(f)


@analytics_router.get("/api/detail/artist/{artist_key}")
def artist_detail_endpoint(artist_key: str, f: FilterParams = Depends(get_filter_params)):
    return get_artist_detail(artist_key, f)


@analytics_router.get("/api/detail/album/{album_key}")
def album_detail_endpoint(album_key: str, f: FilterParams = Depends(get_filter_params)):
    return get_album_detail(album_key, f)


@analytics_router.get("/api/detail/day/{target_date}")
def day_detail_endpoint(target_date: str, f: FilterParams = Depends(get_filter_params)):
    return get_day_detail(target_date, f)


@analytics_router.get("/api/sessions")
def sessions_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str = Query("recent"),
):
    return get_sessions(f, limit=limit, offset=offset, sort=sort)


@analytics_router.get("/api/history")
def history_endpoint(
    f: FilterParams = Depends(get_filter_params),
    search: str | None = Query(None),
    sort_by: str = Query("started_at_local"),
    sort_dir: str = Query("desc"),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    return get_history(f, search=search, sort_by=sort_by, sort_dir=sort_dir, limit=limit, offset=offset)


@analytics_router.get("/api/history/export.csv")
def history_export_endpoint(
    f: FilterParams = Depends(get_filter_params),
    search: str | None = Query(None),
):
    csv_text = export_history_csv(f, search=search)
    return PlainTextResponse(
        content="\ufeff" + csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="amdatawrap_history.csv"'},
    )


@analytics_router.get("/api/v3/search", response_model=FtsSearchOut)
def v3_fts5_search(
    q: str = Query("", max_length=200),
    limit: int = Query(25, ge=1, le=100),
    scope: str = Query("all", description="all | tracks | artists | albums | lyrics"),
    genre: str | None = Query(None),
    year_from: int | None = Query(None),
    year_to: int | None = Query(None),
    min_plays: int = Query(0, ge=0),
    sort: str = Query("relevance", description="relevance | plays | duration"),
):
    return fts5_search(
        q,
        limit=limit,
        scope=scope,
        genre=genre,
        year_from=year_from,
        year_to=year_to,
        min_plays=min_plays,
        sort=sort,
    )


@analytics_router.get("/api/v3/search/suggest")
def v3_search_suggest(
    q: str = Query("", max_length=100),
    limit: int = Query(8, ge=1, le=20),
):
    return search_suggestions(q, limit=limit)


@analytics_router.get("/api/v3/analytics/eras")
def v3_eras_pelt(f: FilterParams = Depends(get_filter_params)):
    return get_musical_eras_pelt(f)


@analytics_router.get("/api/v3/analytics/compass")
def v3_emotional_compass(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(250, ge=20, le=500),
):
    return get_emotional_compass(f, limit=limit)


@analytics_router.get("/api/v3/analytics/camelot")
def v3_camelot_wheel(f: FilterParams = Depends(get_filter_params)):
    return get_camelot_wheel(f)


@analytics_router.post("/api/v3/playlists/generate")
async def v3_generate_playlist(
    body: PlaylistBuildIn,
    f: FilterParams = Depends(get_filter_params),
):
    pl = await asyncio.to_thread(
        build_smart_playlist,
        f,
        kind=body.kind,
        seed_track_key=body.seed_track_key,
        era_index=body.era_index,
        limit=body.limit,
        custom_name=body.name,
    )
    lb_result = None
    if body.push_to_listenbrainz and pl["tracks"]:
        lb_result = await push_playlist_to_listenbrainz(pl["name"], pl["tracks"])
    return {**pl, "listenbrainz_push": lb_result}


@analytics_router.get("/api/v3/playlists/export")
def v3_export_playlist(
    f: FilterParams = Depends(get_filter_params),
    kind: str = Query("harmonic_mix"),
    fmt: str = Query("jspf"),
    seed_track_key: str | None = Query(None),
    era_index: int | None = Query(None),
    limit: int = Query(20, ge=5, le=60),
):
    pl = build_smart_playlist(
        f,
        kind=kind,
        seed_track_key=seed_track_key,
        era_index=era_index,
        limit=limit,
    )
    content, media_type, filename = format_playlist_export(pl, fmt.lower())
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@analytics_router.get("/api/v3/analytics/science")
def v3_science_metrics(f: FilterParams = Depends(get_filter_params)):
    return get_science_metrics(f)


@analytics_router.get("/api/v3/analytics/atlas")
def v3_world_atlas(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(150, ge=10, le=400),
):
    return get_world_atlas(f, limit=limit)


@analytics_router.get("/api/v3/analytics/graph2d")
def v3_graph_2d(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(320, ge=30, le=800),
):
    return get_cooccurrence_graph_2d(f, limit=limit)


@analytics_router.get("/api/v3/analytics/iceberg")
def v3_music_iceberg(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(120, ge=20, le=300),
):
    return get_music_iceberg(f, limit=limit)


@analytics_router.get("/api/v3/games/blind-test")
def v3_blind_test(
    f: FilterParams = Depends(get_filter_params),
    rounds: int = Query(8, ge=3, le=15),
    seed: int | None = Query(None),
):
    return get_blind_test_quiz(f, rounds=rounds, seed=seed)


@analytics_router.get("/api/v3/collector/atelier")
def v3_collector_atelier(f: FilterParams = Depends(get_filter_params)):
    return get_collector_atelier(f)


@analytics_router.get("/api/v3/wrapped/scrollytelling")
def v3_wrapped_scrollytelling(f: FilterParams = Depends(get_filter_params)):
    return {
        "wrapped": get_wrapped_story(f),
        "eras": get_musical_eras_pelt(f),
        "compass": get_emotional_compass(f, limit=60),
        "science": get_science_metrics(f),
        "atlas": get_world_atlas(f, limit=80),
        "iceberg": get_music_iceberg(f, limit=60),
    }
