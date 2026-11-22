"""System, health, import, enrichment, continuum, jobs & audio-dna/NLP endpoints."""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from ..analytics.duckdb_engine import export_parquet_snapshot, get_snapshot_status
from ..analytics.v3_science import upsert_track_audio_dna
from ..config import settings
from ..continuum.providers import (
    ingest_listenbrainz_submit_payload,
    save_provider_config,
    sync_lastfm,
    sync_listenbrainz,
)
from ..continuum.smtc_worker import is_smtc_supported, smtc_worker
from ..db import async_db_session, db_session, rebuild_fts_indexes
from ..demo import load_demo_library, unload_demo_library
from ..enrichment import enrichment_manager
from ..ingestion import ingest_zip
from ..jobs.worker import job_worker
from ..nlp.sentiment import analyze_lyrics_sentiment, save_track_lyrics_sentiment
from ..schemas import (
    AudioDnaIn,
    ContinuumStatusOut,
    NowPlayingOut,
    ProviderConfigIn,
    ProviderStatusOut,
    SyncResultOut,
)

system_router = APIRouter(tags=["system"])


@system_router.get("/api/health")
async def health():
    async with async_db_session() as conn:
        cur = await conn.execute("SELECT * FROM import_meta WHERE id = 1")
        meta = await cur.fetchone()
    return {
        "status": "ok",
        "version": settings.app_version,
        "has_data": bool(meta and meta["total_play_events"] > 0),
        "meta": dict(meta) if meta else None,
        "enrichment": enrichment_manager.get_snapshot(),
        "parquet_snapshot": get_snapshot_status(),
        "jobs": job_worker.get_status(),
    }


@system_router.post("/api/import")
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


@system_router.post("/api/v4/demo/load")
async def demo_load():
    """Load an isolated 1-click Demo library in < 1s without overwriting user data."""
    return await asyncio.to_thread(load_demo_library)


@system_router.post("/api/v4/demo/unload")
async def demo_unload():
    """Remove the Demo profile cleanly and restore user's primary profile."""
    return await asyncio.to_thread(unload_demo_library)


@system_router.post("/api/v4/data/clear")
async def clear_all_data():
    """Clear all imported listening data (Apple Music / Spotify / etc.) and reset Parquet snapshot."""
    await enrichment_manager.stop()
    await job_worker.stop()

    def _wipe():
        from .. import db as db_mod

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
        if db_mod.PARQUET_SNAPSHOT_PATH.exists():
            db_mod.PARQUET_SNAPSHOT_PATH.unlink(missing_ok=True)

    await asyncio.to_thread(_wipe)
    enrichment_manager.get_snapshot()
    return {"ok": True, "message": "Toutes les données importées ont été effacées."}


@system_router.get("/api/enrichment/status")
def enrichment_status():
    return enrichment_manager.get_snapshot()


@system_router.post("/api/enrichment/start")
def enrichment_start():
    enrichment_manager.start()
    return enrichment_manager.get_snapshot()


@system_router.post("/api/enrichment/stop")
async def enrichment_stop():
    await enrichment_manager.stop()
    return enrichment_manager.get_snapshot()


@system_router.post("/api/v4/enrichment/repair")
async def enrichment_repair():
    """Re-queue tracks with missing artwork, missing/expired previews, or prior not_found."""
    await enrichment_manager.stop()
    queued = await asyncio.to_thread(enrichment_manager.queue_repair_missing)
    if queued > 0:
        enrichment_manager.start(force_restart=True)
    return {"ok": True, "queued_tracks": queued, "enrichment": enrichment_manager.get_snapshot()}


@system_router.get("/api/enrichment/stream")
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


@system_router.get("/api/v3/continuum/status", response_model=ContinuumStatusOut)
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


@system_router.post("/api/v3/continuum/providers/{provider}")
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


@system_router.post("/api/v3/continuum/sync/{provider}", response_model=SyncResultOut)
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


@system_router.post("/api/v3/continuum/smtc/{action}")
async def v3_smtc_control(action: str):
    if action == "start":
        return smtc_worker.start()
    if action == "stop":
        await smtc_worker.stop()
        return {"ok": True, "running": False}
    raise HTTPException(status_code=400, detail="Action attendue : start ou stop")


@system_router.get("/apis/listenbrainz/1/validate-token")
def lb_receiver_validate_token():
    return {"code": 200, "message": "Token valid.", "valid": True, "user_name": "amdatawrap_local"}


@system_router.post("/apis/listenbrainz/1/submit-listens")
async def lb_receiver_submit_listens(request: Request, body: dict[str, Any] = Body(...)):
    ua = request.headers.get("user-agent") or "Pano / Local Scrobbler"
    res = await asyncio.to_thread(ingest_listenbrainz_submit_payload, body, ua[:60])
    return res


@system_router.post("/api/v3/audio-dna")
def v3_save_audio_dna(body: AudioDnaIn):
    return upsert_track_audio_dna(body.model_dump())


@system_router.post("/api/v3/nlp/sentiment")
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


@system_router.get("/api/v3/jobs/status")
def v3_jobs_status():
    return {"jobs": job_worker.get_status(), "parquet": get_snapshot_status()}


@system_router.post("/api/v3/jobs/seed")
async def v3_jobs_seed(limit: int = Query(120, ge=10, le=500)):
    queued = await asyncio.to_thread(job_worker.seed_artist_graph_jobs, limit)
    job_worker.start()
    return {"ok": True, "queued": queued, "status": job_worker.get_status()}


@system_router.post("/api/v3/parquet/rebuild")
async def v3_rebuild_parquet():
    meta = await asyncio.to_thread(export_parquet_snapshot)
    return {"ok": True, "snapshot": meta}
