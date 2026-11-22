"""SSRF-hardened CORS-safe Artwork & Audio Proxy endpoints."""

from __future__ import annotations

import asyncio
import hashlib
import io

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from ..config import settings
from ..security import safe_fetch_bytes, validate_proxy_url

proxy_router = APIRouter(tags=["proxy"])


@proxy_router.get("/api/artwork-proxy")
async def artwork_proxy(
    request: Request,
    url: str = Query(...),
    w: int | None = Query(None, ge=64, le=2048),
    fmt: str | None = Query(None, description="webp | jpeg"),
):
    validated_url = validate_proxy_url(url, "artwork")
    norm_fmt = (fmt or "").lower()
    etag_key = f"{validated_url}|{w or ''}|{norm_fmt}".encode("utf-8")
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
        timeout=settings.proxy_timeout_sec,
        follow_redirects=False,
        limits=httpx.Limits(max_connections=12, max_keepalive_connections=4),
    )
    try:
        raw_bytes, media_type = await safe_fetch_bytes(
            client,
            validated_url,
            kind="artwork",
            max_bytes=settings.artwork_proxy_max_bytes,
        )

        if w is not None or norm_fmt in ("webp", "jpeg", "jpg"):
            from PIL import Image

            def _transform(data: bytes) -> tuple[bytes, str]:
                with Image.open(io.BytesIO(data)) as im:
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
    finally:
        if own_client:
            await client.aclose()


@proxy_router.get("/api/audio-proxy")
async def audio_proxy(request: Request, url: str = Query(...)):
    """CORS-safe proxy for 30s iTunes/Deezer previews (Web Audio API FFT + Essentia.js WASM)."""
    validated_url = validate_proxy_url(url, "audio")
    shared_client: httpx.AsyncClient | None = getattr(request.app.state, "proxy_http_client", None)
    own_client = shared_client is None
    client = shared_client or httpx.AsyncClient(
        timeout=max(12.0, settings.proxy_timeout_sec),
        follow_redirects=False,
    )
    try:
        raw_bytes, media_type = await safe_fetch_bytes(
            client,
            validated_url,
            kind="audio",
            max_bytes=settings.audio_proxy_max_bytes,
        )
        return Response(
            content=raw_bytes,
            media_type=media_type or "audio/mp4",
            headers={
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
            },
        )
    finally:
        if own_client:
            await client.aclose()
