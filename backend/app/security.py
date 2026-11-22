"""SSRF-hardened URL validation and bounded HTTP fetching for media proxies."""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException

ARTWORK_HOST_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^is\d+-ssl\.mzstatic\.com$",
        r"^a\d+\.mzstatic\.com$",
        r"^cdn-images\.dzcdn\.net$",
        r"^e-cdns-images\.dzcdn\.net$",
        r"^e-cdn-images\.dzcdn\.net$",
        r"^upload\.wikimedia\.org$",
        r"^coverartarchive\.org$",
        r"^archive\.org$",
        r"^ia\d+\.(?:us|ca)\.archive\.org$",
        r"^i\.scdn\.co$",
        r"^image-cdn-(?:ak|fa)\.spotifycdn\.com$",
        r"^lh\d+\.googleusercontent\.com$",
        r"^i\.ytimg\.com$",
    )
)

AUDIO_HOST_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^audio-ssl\.itunes\.apple\.com$",
        r"^cdns-preview-[a-f0-9]+\.dzcdn\.net$",
        r"^cdnt-preview\.dzcdn\.net$",
    )
)


def is_public_ip(ip_str: str) -> bool:
    """Return True only if the parsed IPv4/IPv6 address is globally routable."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return is_public_ip(str(ip.ipv4_mapped))
    return True


def _resolve_host_ips(hostname: str) -> list[str]:
    """Resolve DNS A/AAAA records for `hostname`. Isolated for clean mocking in tests."""
    infos = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    ips: list[str] = []
    for info in infos:
        sockaddr = info[4]
        if sockaddr and isinstance(sockaddr[0], str):
            ips.append(sockaddr[0])
    return ips


def validate_proxy_url(url: str, kind: Literal["artwork", "audio"]) -> str:
    """Validate scheme, credentials, port, allowlisted hostname and resolved public IPs."""
    raw = (url or "").strip()
    if not raw or len(raw) > 2048:
        raise HTTPException(status_code=400, detail="URL de proxy invalide.")

    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise HTTPException(status_code=400, detail="Seul le protocole HTTPS est autorisé.")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Identifiants dans l'URL interdits.")
    if parsed.port not in (None, 443):
        raise HTTPException(status_code=400, detail="Port réseau non autorisé.")

    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        raise HTTPException(status_code=400, detail="Hôte manquant dans l'URL.")

    # Reject raw IP literals directly
    try:
        ipaddress.ip_address(host)
        raise HTTPException(status_code=400, detail="Adresse IP directe non autorisée.")
    except ValueError:
        pass

    patterns = ARTWORK_HOST_PATTERNS if kind == "artwork" else AUDIO_HOST_PATTERNS
    if not any(pat.match(host) for pat in patterns):
        label = "artwork" if kind == "artwork" else "audio"
        raise HTTPException(status_code=400, detail=f"URL {label} non autorisée.")

    try:
        ips = _resolve_host_ips(host)
    except OSError as exc:
        raise HTTPException(status_code=502, detail=f"Résolution DNS impossible : {exc}") from exc

    if not ips or any(not is_public_ip(ip) for ip in ips):
        raise HTTPException(status_code=400, detail="Hôte résolu vers une adresse réseau non publique.")

    return raw


async def safe_fetch_bytes(
    client: httpx.AsyncClient,
    url: str,
    *,
    kind: Literal["artwork", "audio"],
    max_bytes: int,
    max_redirects: int = 3,
    retries: int = 2,
) -> tuple[bytes, str]:
    """Fetch `url` safely with per-hop SSRF validation, bounded streaming size, and retries."""
    current_url = validate_proxy_url(url, kind)
    last_exc: Exception | None = None

    for attempt in range(retries + 1):
        target = current_url
        try:
            for _hop in range(max_redirects + 1):
                validate_proxy_url(target, kind)
                async with client.stream("GET", target, follow_redirects=False) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location")
                        if not loc:
                            raise HTTPException(status_code=502, detail="Redirection sans cible.")
                        target = urljoin(target, loc)
                        continue
                    if resp.status_code in (404, 410):
                        raise HTTPException(status_code=404, detail="Ressource média introuvable.")
                    if resp.status_code >= 500:
                        raise httpx.HTTPStatusError(
                            f"Upstream {resp.status_code}",
                            request=resp.request,
                            response=resp,
                        )
                    if resp.status_code != 200:
                        raise HTTPException(status_code=404, detail="Ressource média indisponible.")

                    content_len = resp.headers.get("content-length")
                    if content_len and content_len.isdigit() and int(content_len) > max_bytes:
                        raise HTTPException(status_code=502, detail="Réponse média trop volumineuse.")

                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in resp.aiter_bytes(65536):
                        total += len(chunk)
                        if total > max_bytes:
                            raise HTTPException(status_code=502, detail="Réponse média trop volumineuse.")
                        chunks.append(chunk)
                    media_type = resp.headers.get("content-type", "application/octet-stream")
                    return b"".join(chunks), media_type
            raise HTTPException(status_code=502, detail="Trop de redirections.")
        except HTTPException:
            raise
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                await asyncio.sleep(0.25 * (attempt + 1))
                continue
            raise HTTPException(status_code=502, detail=str(last_exc)) from last_exc

    raise HTTPException(status_code=502, detail=str(last_exc or "Erreur proxy"))
