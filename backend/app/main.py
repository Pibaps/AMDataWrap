"""AMDataWrap FastAPI Application Entrypoint (V4.5)."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .analytics.duckdb_engine import configure_duckdb_global_allocator, ensure_parquet_snapshot
from .config import settings
from .continuum.live_hub import live_hub_router
from .continuum.os_media import os_media_tracker
from .continuum.smtc_worker import smtc_worker
from .db import ROOT_DIR, async_db_session, init_db
from .enrichment import enrichment_manager
from .importers import importers_router
from .ingestion import ingest_zip
from .jobs.worker import job_worker
from .playback import playback_router
from .profiles import profiles_router
from .routers import analytics_router, external_router, proxy_router, system_router
from .schemas import ErrorResponse
from .vinyl_enrichment import vinyl_router

DEFAULT_ZIP_PATH = ROOT_DIR / "Apple Media Services information.zip"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    configure_duckdb_global_allocator()
    app.state.proxy_http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(settings.proxy_timeout_sec, pool=20.0),
        follow_redirects=False,
        limits=httpx.Limits(max_connections=32, max_keepalive_connections=12),
    )
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
    version=settings.app_version,
    description="Backend unifié AMDataWrap (V4.5 Salon d'écoute 3D + V1/V2/V3/V4).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
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


# Mount V4 + V4.5 Routers
app.include_router(system_router)
app.include_router(proxy_router)
app.include_router(external_router)
app.include_router(analytics_router)
app.include_router(profiles_router)
app.include_router(importers_router)
app.include_router(vinyl_router)
app.include_router(live_hub_router)
app.include_router(playback_router)


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
