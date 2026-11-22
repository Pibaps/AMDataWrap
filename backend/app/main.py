import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse

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
from .analytics.duckdb_engine import (
    configure_duckdb_global_allocator,
    ensure_parquet_snapshot,
    export_parquet_snapshot,
    get_snapshot_status,
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
from .analytics.v3_science import (
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
    upsert_track_audio_dna,
)
from .analytics.wrapped import get_wrapped_story
from .continuum.live_hub import live_hub_router
from .continuum.os_media import os_media_tracker
from .continuum.providers import (
    ingest_listenbrainz_submit_payload,
    push_playlist_to_listenbrainz,
    save_provider_config,
    sync_lastfm,
    sync_listenbrainz,
)
from .continuum.smtc_worker import is_smtc_supported, smtc_worker
from .db import ROOT_DIR, async_db_session, db_session, init_db
from .enrichment import enrichment_manager
from .external import (
    fetch_artist_bio_wikipedia,
    fetch_lyrics_lrclib,
    fetch_track_bpm_deezer,
)
from .filters import FilterParams, get_filter_params
from .importers import importers_router
from .ingestion import ingest_zip
from .jobs.worker import fetch_artist_setlists, fetch_cover_art_archive, job_worker
from .nlp.sentiment import analyze_lyrics_sentiment, save_track_lyrics_sentiment
from .playback import playback_router
from .profiles import profiles_router
from .schemas import (
    AudioDnaIn,
    ContinuumStatusOut,
    ErrorResponse,
    FtsSearchOut,
    NowPlayingOut,
    PlaylistBuildIn,
    ProviderConfigIn,
    ProviderStatusOut,
    SyncResultOut,
)
from .vinyl_enrichment import vinyl_router

DEFAULT_ZIP_PATH = ROOT_DIR / "Apple Media Services information.zip"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    configure_duckdb_global_allocator()
    app.state.proxy_http_client = httpx.AsyncClient(
        timeout=8.0,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=12, max_keepalive_connections=4),
    )
    # Auto-ingest workspace ZIP if database has no data yet
    async with async_db_session() as conn:
        cur = await conn.execute("SELECT total_play_events FROM import_meta WHERE id = 1")
        row = await cur.fetchone()
        has_data = bool(row and row["total_play_events"] > 0)

    if not has_data and DEFAULT_ZIP_PATH.exists() and os.environ.get("AMDW_AUTO_INGEST_APPLE") == "1":
        await asyncio.to_thread(ingest_zip, DEFAULT_ZIP_PATH, DEFAULT_ZIP_PATH.name)
        has_data = True

    if has_data:
        await asyncio.to_thread(ensure_parquet_snapshot)
        await asyncio.to_thread(job_worker.seed_artist_graph_jobs, 120)
        enrichment_manager.get_snapshot()
        enrichment_manager.start()
        job_worker.start()

    yield
    await enrichment_manager.stop()
    await job_worker.stop()
    await smtc_worker.stop()
    await os_media_tracker.stop()
    proxy_client = getattr(app.state, "proxy_http_client", None)
    if proxy_client is not None:
        await proxy_client.aclose()


app = FastAPI(
    title="AMDataWrap API",
    version="4.1.0",
    description="Backend unifié AMDataWrap (V4.1 Salon d'écoute 3D + V1/V2/V3/V4.0).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_v4_security_headers(request: Request, call_next):
    response = await call_next(request)
    # Anti-Error 153 for YouTube IFrame API embeds
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


# Mount V4 Routers (additive — preserves all V1/V2/V3 endpoints intact)
app.include_router(profiles_router)
app.include_router(importers_router)
app.include_router(vinyl_router)
app.include_router(live_hub_router)
app.include_router(playback_router)


# ---------------------------------------------------------------------------
# Standardized Error Handlers (Phase 0: predictable ErrorResponse contracts)
# ---------------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    payload = ErrorResponse(
        code=f"HTTP_{exc.status_code}",
        message=str(exc.detail),
        detail=exc.detail,
    )
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    payload = ErrorResponse(
        code="VALIDATION_ERROR",
        message="Paramètres de requête invalides.",
        detail=exc.errors(),
    )
    return JSONResponse(status_code=422, content=payload.model_dump())


# ---------------------------------------------------------------------------
# Health & Import (Async SQLite WAL)
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    async with async_db_session() as conn:
        cur = await conn.execute("SELECT * FROM import_meta WHERE id = 1")
        meta = await cur.fetchone()
    return {
        "status": "ok",
        "version": "4.1.0",
        "has_data": bool(meta and meta["total_play_events"] > 0),
        "meta": dict(meta) if meta else None,
        "enrichment": enrichment_manager.get_snapshot(),
        "parquet_snapshot": get_snapshot_status(),
        "jobs": job_worker.get_status(),
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
    job_worker.start()
    return {"ok": True, "summary": result}


@app.post("/api/v4/data/clear")
async def clear_all_data():
    """Clear all imported listening data (Apple Music / Spotify / etc.) and reset Parquet snapshot."""
    await enrichment_manager.stop()
    await job_worker.stop()

    def _wipe():
        from .db import PARQUET_SNAPSHOT_PATH, rebuild_fts_indexes

        with db_session() as conn:
            for tbl in (
                "play_events",
                "lyric_events",
                "search_events",
                "recording_isrcs",
                "platform_track_mappings",
                "profile_sources",
                "profile_merged_exclusions",
                "tracks_catalog",
            ):
                try:
                    conn.execute(f"DELETE FROM {tbl}")
                except Exception:
                    pass
            conn.execute(
                """
                UPDATE import_meta SET
                    zip_filename = NULL,
                    zip_sha256 = NULL,
                    imported_at = NULL,
                    total_raw_rows = 0,
                    total_play_events = 0,
                    total_lyric_events = 0,
                    total_search_events = 0,
                    unique_tracks = 0,
                    pass1_artist_pct = 0.0,
                    pass1_genre_year_pct = 0.0,
                    min_date = NULL,
                    max_date = NULL
                WHERE id = 1
                """
            )
            rebuild_fts_indexes(conn)
        if PARQUET_SNAPSHOT_PATH.exists():
            PARQUET_SNAPSHOT_PATH.unlink(missing_ok=True)

    await asyncio.to_thread(_wipe)
    enrichment_manager.get_snapshot()
    return {"ok": True, "message": "Toutes les données importées ont été effacées."}


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
# CORS-safe Artwork & Audio Proxies (extended with Cover Art Archive)
# ---------------------------------------------------------------------------
@app.get("/api/artwork-proxy")
async def artwork_proxy(
    request: Request,
    url: str = Query(...),
    w: int | None = Query(None, ge=64, le=2048),
    fmt: str | None = Query(None, description="webp | jpeg"),
):
    if not (
        url.startswith("https://is")
        or url.startswith("https://cdn-images.dzcdn.net")
        or url.startswith("https://e-cdns-images.dzcdn.net")
        or url.startswith("https://upload.wikimedia.org")
        or url.startswith("https://coverartarchive.org")
        or url.startswith("https://archive.org")
        or url.startswith("https://ia")
        or url.startswith("https://i.scdn.co")
        or url.startswith("https://image-cdn-")
        or url.startswith("https://lh3.googleusercontent.com")
        or url.startswith("https://i.ytimg.com")
    ):
        raise HTTPException(status_code=400, detail="URL d'artwork non autorisée.")

    norm_fmt = (fmt or "").lower()
    etag_key = f"{url}|{w or ''}|{norm_fmt}".encode("utf-8")
    etag = f'"{hashlib.blake2b(etag_key, digest_size=12).hexdigest()}"'
    cache_headers = {
        "Cache-Control": "public, max-age=604800, immutable",
        "ETag": etag,
        "Access-Control-Allow-Origin": "*",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    shared_client: httpx.AsyncClient | None = getattr(request.app.state, "proxy_http_client", None)
    own_client = shared_client is None
    client = shared_client or httpx.AsyncClient(
        timeout=8.0,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=12, max_keepalive_connections=4),
    )
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Artwork introuvable.")
        raw_bytes = resp.content
        media_type = resp.headers.get("content-type", "image/jpeg")

        if w is not None or norm_fmt in ("webp", "jpeg", "jpg"):
            import io
            from PIL import Image

            def _transform(data: bytes) -> tuple[bytes, str]:
                with Image.open(io.BytesIO(data)) as im:
                    # Native libjpeg DCT downscale before full RGB decode (cuts Storage.c RAM peak)
                    if w is not None and im.format in ("JPEG", "MPO"):
                        im.draft("RGB", (w, w))
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGB")
                    if w is not None and (im.width > w or im.height > w):
                        im.thumbnail((w, w), Image.Resampling.LANCZOS)
                    out = io.BytesIO()
                    if norm_fmt == "webp":
                        im.save(out, format="WEBP", quality=82, method=4)
                        return out.getvalue(), "image/webp"
                    if im.mode == "RGBA":
                        im = im.convert("RGB")
                    im.save(out, format="JPEG", quality=85, optimize=True)
                    return out.getvalue(), "image/jpeg"

            raw_bytes, media_type = await asyncio.to_thread(_transform, raw_bytes)

        return Response(
            content=raw_bytes,
            media_type=media_type,
            headers=cache_headers,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        if own_client:
            await client.aclose()


@app.get("/api/audio-proxy")
async def audio_proxy(url: str = Query(...)):
    """CORS-safe proxy for 30s iTunes/Deezer previews (Web Audio API FFT + Essentia.js WASM)."""
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


# ---------------------------------------------------------------------------
# V1/V2 Core Analytics Endpoints (100% preserved & backward compatible)
# ---------------------------------------------------------------------------
@app.get("/api/analytics/galaxy")
def galaxy_endpoint(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(75, ge=10, le=120),
):
    return get_sonic_galaxy(f, limit=limit)


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


# ===========================================================================
# V3 CONTINUUM ENDPOINTS (Phase 0, 1, 2, 3, 4)
# ===========================================================================

# --- Phase 0: Instant SQLite FTS5 Search (unicode61 + trigram + lyrics) ---
@app.get("/api/v3/search", response_model=FtsSearchOut)
def v3_fts5_search(q: str = Query("", max_length=200), limit: int = Query(25, ge=1, le=100)):
    return fts5_search(q, limit=limit)


# --- Phase 1: Hub Continuum (Sync Providers, Now Playing, SMTC, Local Receiver) ---
@app.get("/api/v3/continuum/status", response_model=ContinuumStatusOut)
async def v3_continuum_status():
    async with async_db_session() as conn:
        cur = await conn.execute("SELECT * FROM sync_providers_config ORDER BY provider ASC")
        prov_rows = await cur.fetchall()
        cur_np = await conn.execute("SELECT * FROM now_playing_state WHERE id = 1")
        np_row = await cur_np.fetchone()
        cur_src = await conn.execute(
            """
            SELECT COALESCE(source_provider, 'apple_rgpd_zip') AS provider,
                   COUNT(*) AS plays,
                   SUM(play_duration_ms) AS total_ms,
                   SUM(COALESCE(duration_is_estimated, 0)) AS estimated_plays
            FROM play_events
            GROUP BY provider
            ORDER BY plays DESC
            """
        )
        src_rows = await cur_src.fetchall()

    providers = []
    for r in prov_rows:
        try:
            extra = json.loads(r["extra_json"] or "{}")
        except Exception:
            extra = {}
        providers.append(
            ProviderStatusOut(
                provider=r["provider"],
                enabled=bool(r["enabled"]),
                username=r["username"],
                has_token=bool(r["token"]),
                has_api_key=bool(r["api_key"]),
                last_sync_at=r["last_sync_at"],
                last_cursor_ts=int(r["last_cursor_ts"] or 0),
                last_status=r["last_status"] or "idle",
                last_error=r["last_error"],
                total_synced=int(r["total_synced"] or 0),
                extra=extra,
            )
        )

    np_out = (
        NowPlayingOut(
            active=bool(np_row["is_playing"]),
            provider=np_row["provider"],
            song_name=np_row["song_name"],
            artist_name=np_row["artist_name"],
            album_name=np_row["album_name"],
            artwork_url=np_row["artwork_url"],
            started_at_utc=np_row["started_at_utc"],
            duration_ms=int(np_row["duration_ms"] or 0),
            position_ms=int(np_row["position_ms"] or 0),
            is_playing=bool(np_row["is_playing"]),
            updated_at=np_row["updated_at"],
        )
        if np_row
        else NowPlayingOut(active=False)
    )

    breakdown = [
        {
            "provider": r["provider"],
            "plays": int(r["plays"]),
            "hours": round(int(r["total_ms"] or 0) / 3_600_000.0, 2),
            "estimated_plays": int(r["estimated_plays"] or 0),
        }
        for r in src_rows
    ]
    total_plays = sum(b["plays"] for b in breakdown)
    est_plays = sum(b["estimated_plays"] for b in breakdown)

    return ContinuumStatusOut(
        providers=providers,
        now_playing=np_out,
        source_breakdown=breakdown,
        estimated_duration_plays=est_plays,
        total_plays=total_plays,
        smtc_supported=is_smtc_supported(),
        smtc_running=smtc_worker.running,
    )


@app.post("/api/v3/continuum/providers/{provider}")
def v3_configure_provider(provider: str, body: ProviderConfigIn):
    allowed = {"listenbrainz", "lastfm", "local_smtc", "local_receiver", "discogs", "setlistfm"}
    if provider not in allowed:
        raise HTTPException(status_code=400, detail=f"Connecteur inconnu : {provider}")
    cfg = save_provider_config(
        provider,
        enabled=body.enabled,
        username=body.username,
        token=body.token,
        api_key=body.api_key,
        extra=body.extra,
    )
    if provider == "local_smtc" and body.enabled:
        smtc_worker.start()
    return {"ok": True, "provider": provider, "enabled": bool(cfg.get("enabled"))}


@app.post("/api/v3/continuum/sync/{provider}", response_model=SyncResultOut)
async def v3_sync_provider(provider: str):
    if provider == "listenbrainz":
        return await sync_listenbrainz()
    if provider == "lastfm":
        return await sync_lastfm()
    if provider == "local_smtc":
        res = smtc_worker.start()
        return SyncResultOut(
            provider="local_smtc",
            ok=res["ok"],
            error=None if res["ok"] else res.get("detail"),
            error_code=None if res["ok"] else "SMTC_UNAVAILABLE",
        )
    raise HTTPException(status_code=400, detail=f"Synchronisation non prise en charge pour : {provider}")


@app.post("/api/v3/continuum/smtc/{action}")
async def v3_smtc_control(action: str):
    if action == "start":
        return smtc_worker.start()
    if action == "stop":
        await smtc_worker.stop()
        return {"ok": True, "running": False}
    raise HTTPException(status_code=400, detail="Action attendue : start ou stop")


# Local Scrobble Receiver — ListenBrainz-compatible endpoints for Pano Scrobbler / AMWin-RP / Multi-Scrobbler
@app.get("/apis/listenbrainz/1/validate-token")
def lb_receiver_validate_token():
    return {"code": 200, "message": "Token valid.", "valid": True, "user_name": "amdatawrap_local"}


@app.post("/apis/listenbrainz/1/submit-listens")
async def lb_receiver_submit_listens(request: Request, body: dict[str, Any] = Body(...)):
    ua = request.headers.get("user-agent") or "Pano / Local Scrobbler"
    res = await asyncio.to_thread(ingest_listenbrainz_submit_payload, body, ua[:60])
    return res


# --- Phase 2: Audio DNA (Essentia.js WASM), Local NLP Sentiment, Open Graph Jobs, Parquet/DuckDB ---
@app.post("/api/v3/audio-dna")
def v3_save_audio_dna(body: AudioDnaIn):
    return upsert_track_audio_dna(body.model_dump())


@app.post("/api/v3/nlp/sentiment")
def v3_analyze_sentiment(body: dict[str, Any] = Body(...)):
    text = str(body.get("text") or "")
    track_key = body.get("track_key")
    if track_key:
        return save_track_lyrics_sentiment(
            str(track_key),
            str(body.get("song_name") or ""),
            str(body.get("artist_name") or ""),
            text,
        )
    return analyze_lyrics_sentiment(text)


@app.get("/api/v3/jobs/status")
def v3_jobs_status():
    return {"jobs": job_worker.get_status(), "parquet": get_snapshot_status()}


@app.post("/api/v3/jobs/seed")
async def v3_jobs_seed(limit: int = Query(120, ge=10, le=500)):
    queued = await asyncio.to_thread(job_worker.seed_artist_graph_jobs, limit)
    job_worker.start()
    return {"ok": True, "queued": queued, "status": job_worker.get_status()}


@app.post("/api/v3/parquet/rebuild")
async def v3_rebuild_parquet():
    meta = await asyncio.to_thread(export_parquet_snapshot)
    return {"ok": True, "snapshot": meta}


@app.get("/api/v3/external/setlists/{artist_key}")
async def v3_artist_setlists(artist_key: str):
    return await fetch_artist_setlists(artist_key)


@app.get("/api/v3/external/cover-art/{release_group_mbid}")
async def v3_cover_art(release_group_mbid: str):
    return await fetch_cover_art_archive(release_group_mbid)


# --- Phase 3: Musicological Science (PELT Eras, Russell Compass, Camelot, Eddington/Gini/Survival, Atlas, 2D Graph) ---
@app.get("/api/v3/analytics/eras")
def v3_eras_pelt(f: FilterParams = Depends(get_filter_params)):
    return get_musical_eras_pelt(f)


@app.get("/api/v3/analytics/compass")
def v3_emotional_compass(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(250, ge=20, le=500),
):
    return get_emotional_compass(f, limit=limit)


@app.get("/api/v3/analytics/camelot")
def v3_camelot_wheel(f: FilterParams = Depends(get_filter_params)):
    return get_camelot_wheel(f)


@app.post("/api/v3/playlists/generate")
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


@app.get("/api/v3/playlists/export")
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


@app.get("/api/v3/analytics/science")
def v3_science_metrics(f: FilterParams = Depends(get_filter_params)):
    return get_science_metrics(f)


@app.get("/api/v3/analytics/atlas")
def v3_world_atlas(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(150, ge=10, le=400),
):
    return get_world_atlas(f, limit=limit)


@app.get("/api/v3/analytics/graph2d")
def v3_graph_2d(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(320, ge=30, le=800),
):
    return get_cooccurrence_graph_2d(f, limit=limit)


# --- Phase 4: Iceberg, Blind-Test, Collector Atelier, Scrollytelling Wrapped ---
@app.get("/api/v3/analytics/iceberg")
def v3_music_iceberg(
    f: FilterParams = Depends(get_filter_params),
    limit: int = Query(120, ge=20, le=300),
):
    return get_music_iceberg(f, limit=limit)


@app.get("/api/v3/games/blind-test")
def v3_blind_test(
    f: FilterParams = Depends(get_filter_params),
    rounds: int = Query(8, ge=3, le=15),
    seed: int | None = Query(None),
):
    return get_blind_test_quiz(f, rounds=rounds, seed=seed)


@app.get("/api/v3/collector/atelier")
def v3_collector_atelier(f: FilterParams = Depends(get_filter_params)):
    return get_collector_atelier(f)


@app.get("/api/v3/wrapped/scrollytelling")
def v3_wrapped_scrollytelling(f: FilterParams = Depends(get_filter_params)):
    return {
        "wrapped": get_wrapped_story(f),
        "eras": get_musical_eras_pelt(f),
        "compass": get_emotional_compass(f, limit=60),
        "science": get_science_metrics(f),
        "atlas": get_world_atlas(f, limit=80),
        "iceberg": get_music_iceberg(f, limit=60),
    }
