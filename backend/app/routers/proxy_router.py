"""SSRF-hardened CORS-safe Artwork & Audio Proxy endpoints with lightweight disk cache."""

from __future__ import annotations

import asyncio
import hashlib
import io
import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from ..config import settings
from ..security import safe_fetch_bytes, validate_proxy_url

proxy_router = APIRouter(tags=["proxy"])

_MAX_DISK_CACHE_FILES = 2000


def _cache_paths(cache_dir: Path, digest: str) -> tuple[Path, Path]:
    return cache_dir / f"{digest}.bin", cache_dir / f"{digest}.meta"


def _read_disk_cache(cache_dir: Path, digest: str) -> tuple[bytes, str] | None:
    bin_path, meta_path = _cache_paths(cache_dir, digest)
    if not bin_path.exists() or not meta_path.exists():
        return None
    try:
        media_type = meta_path.read_text(encoding="utf-8").strip() or "image/jpeg"
        data = bin_path.read_bytes()
        if data:
            return data, media_type
    except OSError:
        return None
    return None


def _write_disk_cache(cache_dir: Path, digest: str, data: bytes, media_type: str) -> None:
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        bin_path, meta_path = _cache_paths(cache_dir, digest)
        tmp_bin = cache_dir / f".{digest}.{os.getpid()}.tmp"
        tmp_meta = cache_dir / f".{digest}.{os.getpid()}.meta.tmp"
        tmp_bin.write_bytes(data)
        tmp_meta.write_text(media_type, encoding="utf-8")
        os.replace(tmp_bin, bin_path)
        os.replace(tmp_meta, meta_path)

        # Evict oldest entries if cache grows beyond _MAX_DISK_CACHE_FILES
        bin_files = [p for p in cache_dir.iterdir() if p.is_file() and p.suffix == ".bin"]
        if len(bin_files) > _MAX_DISK_CACHE_FILES:
            bin_files.sort(key=lambda p: p.stat().st_mtime)
            for old in bin_files[: len(bin_files) - _MAX_DISK_CACHE_FILES]:
                old.unlink(missing_ok=True)
                old.with_suffix(".meta").unlink(missing_ok=True)
    except OSError:
        pass


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
    digest = hashlib.blake2b(etag_key, digest_size=12).hexdigest()
    etag = f'"{digest}"'
    cache_headers = {
        "Cache-Control": "public, max-age=604800, immutable",
        "ETag": etag,
        "Access-Control-Allow-Origin": "*",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    cache_dir = settings.artwork_cache_dir
    cached = await asyncio.to_thread(_read_disk_cache, cache_dir, digest)
    if cached is not None:
        raw_bytes, media_type = cached
        return Response(content=raw_bytes, media_type=media_type, headers=cache_headers)

    shared_client: httpx.AsyncClient | None = getattr(request.app.state, "proxy_http_client", None)
    own_client = shared_client is None
    client = shared_client or httpx.AsyncClient(
        timeout=httpx.Timeout(settings.proxy_timeout_sec, pool=20.0),
        follow_redirects=False,
        limits=httpx.Limits(max_connections=32, max_keepalive_connections=12),
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

        await asyncio.to_thread(_write_disk_cache, cache_dir, digest, raw_bytes, media_type)

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
