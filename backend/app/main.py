import asyncio
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response, StreamingResponse

from .analytics.behavior import get_behavior_and_obsessions
from .analytics.chrono import get_chronobiology
from .analytics.detail import (
    export_history_csv,
    get_album_detail,
    get_artist_detail,
    get_day_detail,
    get_history,
    get_sessions,
)
from .analytics.galaxy import get_sonic_galaxy
from .analytics.overview import (
    get_filter_options,
    get_overview,
    get_top_albums,
    get_top_artists,
    get_top_genres,
    get_top_tracks,
)
from .analytics.persona import get_persona_and_eras
from .analytics.wrapped import get_wrapped_story
from .db import ROOT_DIR, db_session, init_db
from .enrichment import enrichment_manager
from .external import (
    fetch_artist_bio_wikipedia,
    fetch_lyrics_lrclib,
    fetch_track_bpm_deezer,
)
from .filters import FilterParams, get_filter_params
from .ingestion import ingest_zip

DEFAULT_ZIP_PATH = ROOT_DIR / "Apple Media Services information.zip"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Auto-ingest workspace ZIP if database has no data yet
    with db_session() as conn:
        row = conn.execute("SELECT total_play_events FROM import_meta WHERE id = 1").fetchone()
        has_data = bool(row and row["total_play_events"] > 0)

    if not has_data and DEFAULT_ZIP_PATH.exists():
        await asyncio.to_thread(ingest_zip, DEFAULT_ZIP_PATH, DEFAULT_ZIP_PATH.name)
        has_data = True

    if has_data:
        enrichment_manager.get_snapshot()
        enrichment_manager.start()

    yield
    await enrichment_manager.stop()


app = FastAPI(title="AMDataWrap API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health & Import
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    with db_session() as conn:
        meta = conn.execute("SELECT * FROM import_meta WHERE id = 1").fetchone()
    return {
        "status": "ok",
        "has_data": bool(meta and meta["total_play_events"] > 0),
        "meta": dict(meta) if meta else None,
        "enrichment": enrichment_manager.get_snapshot(),
    }


@app.post("/api/import")
async def upload_zip(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Veuillez déposer une archive .zip valide.")

    await enrichment_manager.stop()
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            tmp_path = Path(tmp.name)
            shutil.copyfileobj(file.file, tmp)
        result = await asyncio.to_thread(ingest_zip, tmp_path, file.filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erreur lors de l'import du ZIP : {exc}") from exc
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)

    enrichment_manager.get_snapshot()
    enrichment_manager.start(force_restart=True)
    return {"ok": True, "summary": result}


# ---------------------------------------------------------------------------
# Pass 2 Enrichment & SSE Progress Stream
# ---------------------------------------------------------------------------
@app.get("/api/enrichment/status")
def enrichment_status():
    return enrichment_manager.get_snapshot()


@app.post("/api/enrichment/start")
def enrichment_start():
    enrichment_manager.start()
    return enrichment_manager.get_snapshot()


@app.post("/api/enrichment/stop")
async def enrichment_stop():
    await enrichment_manager.stop()
    return enrichment_manager.get_snapshot()


@app.get("/api/enrichment/stream")
async def enrichment_stream():
    queue = enrichment_manager.subscribe()

    async def event_generator():
        try:
            # Immediate initial state
            import json

            yield f"data: {json.dumps(enrichment_manager.get_snapshot(), ensure_ascii=False)}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            enrichment_manager.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# CORS-safe Artwork Proxy (for dominant color extraction & PNG HD export)
# ---------------------------------------------------------------------------
@app.get("/api/artwork-proxy")
async def artwork_proxy(url: str = Query(...)):
    if not (
        url.startswith("https://is")
        or url.startswith("https://cdn-images.dzcdn.net")
        or url.startswith("https://e-cdns-images.dzcdn.net")
        or url.startswith("https://upload.wikimedia.org")
    ):
        raise HTTPException(status_code=400, detail="URL d'artwork non autorisée.")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Artwork introuvable.")
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "image/jpeg"),
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/audio-proxy")
async def audio_proxy(url: str = Query(...)):
    """CORS-safe proxy for 30s iTunes/Deezer previews so Web Audio API AnalyserNode can read FFT frequencies."""
    if not (
        url.startswith("https://audio-ssl.itunes.apple.com")
        or url.startswith("https://cdns-preview-")
        or url.startswith("https://cdnt-preview.")
    ):
        raise HTTPException(status_code=400, detail="URL audio non autorisée.")
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Extrait audio introuvable.")
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "audio/mp4"),
                headers={
                    "Cache-Control": "public, max-age=3600",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Free External Connectors (LRCLIB Lyrics, Wikipedia Bio, Deezer BPM)
# ---------------------------------------------------------------------------
@app.get("/api/external/lyrics")
async def external_lyrics(
    song: str = Query(...),
    artist: str = Query(""),
    album: str = Query(""),
):
    return await fetch_lyrics_lrclib(song, artist, album)


@app.get("/api/external/artist-bio")
async def external_artist_bio(artist: str = Query(...)):
    return await fetch_artist_bio_wikipedia(artist)


@app.get("/api/external/track-bpm")
async def external_track_bpm(song: str = Query(...), artist: str = Query("")):
    return await fetch_track_bpm_deezer(song, artist)


@app.get("/api/analytics/galaxy")
def galaxy_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(75, ge=10, le=120),
):
    return get_sonic_galaxy(f, limit=limit)


# ---------------------------------------------------------------------------
# Analytics Endpoints (all reactive to global FilterParams)
# ---------------------------------------------------------------------------
@app.get("/api/filters")
def filters_endpoint():
    return get_filter_options()


@app.get("/api/analytics/overview")
def overview_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_overview(f)


@app.get("/api/analytics/tops/artists")
def top_artists_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return get_top_artists(f, limit=limit, offset=offset)


@app.get("/api/analytics/tops/albums")
def top_albums_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return get_top_albums(f, limit=limit, offset=offset)


@app.get("/api/analytics/tops/tracks")
def top_tracks_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return get_top_tracks(f, limit=limit, offset=offset)


@app.get("/api/analytics/tops/genres")
def top_genres_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(30, ge=1, le=100),
):
    return get_top_genres(f, limit=limit)


@app.get("/api/analytics/chronobiology")
def chronobiology_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_chronobiology(f)


@app.get("/api/analytics/persona")
def persona_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_persona_and_eras(f)


@app.get("/api/analytics/behavior")
def behavior_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_behavior_and_obsessions(f)


@app.get("/api/analytics/wrapped")
def wrapped_endpoint(f: FilterParams = Depends(get_filter_params)):
    return get_wrapped_story(f)


# ---------------------------------------------------------------------------
# Drawers (Artist, Album, Day) + Sessions + Virtualized History & CSV Export
# ---------------------------------------------------------------------------
@app.get("/api/detail/artist/{artist_key}")
def artist_detail_endpoint(artist_key: str, f: FilterParams = Depends(get_filter_params)):
    return get_artist_detail(artist_key, f)


@app.get("/api/detail/album/{album_key}")
def album_detail_endpoint(album_key: str, f: FilterParams = Depends(get_filter_params)):
    return get_album_detail(album_key, f)


@app.get("/api/detail/day/{target_date}")
def day_detail_endpoint(target_date: str, f: FilterParams = Depends(get_filter_params)):
    return get_day_detail(target_date, f)


@app.get("/api/sessions")
def sessions_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str = Query("recent"),
):
    return get_sessions(f, limit=limit, offset=offset, sort=sort)


@app.get("/api/history")
def history_endpoint(
    f: FilterParams = Depends(get_filter_params),
    search: str | None = Query(None),
    sort_by: str = Query("started_at_local"),
    sort_dir: str = Query("desc"),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
):
    return get_history(f, search=search, sort_by=sort_by, sort_dir=sort_dir, limit=limit, offset=offset)


@app.get("/api/history/export.csv")
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
