from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from .db import db_session


def init_external_cache():
    with db_session() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS external_cache (
                cache_key TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )


def _get_cache(key: str) -> dict[str, Any] | None:
    import json

    init_external_cache()
    with db_session() as conn:
        row = conn.execute("SELECT payload_json FROM external_cache WHERE cache_key = ?", (key,)).fetchone()
        if row:
            try:
                return json.loads(row["payload_json"])
            except Exception:
                return None
    return None


def _set_cache(key: str, payload: dict[str, Any]):
    import json

    init_external_cache()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db_session() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO external_cache (cache_key, payload_json, updated_at) VALUES (?, ?, ?)",
            (key, json.dumps(payload, ensure_ascii=False), now_iso),
        )


async def fetch_lyrics_lrclib(song: str, artist: str = "", album: str = "") -> dict[str, Any]:
    """Free, zero-key synced/plain lyrics from LRCLIB.net."""
    cache_key = f"lyrics:{song.lower().strip()}|{artist.lower().strip()}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached

    result: dict[str, Any] = {"found": False, "plain_lyrics": None, "synced_lines": [], "source": "lrclib"}
    try:
        async with httpx.AsyncClient(
            timeout=6.0,
            headers={"User-Agent": "AMDataWrap/2.0 (Local Apple Music Analytics)"},
        ) as client:
            params: dict[str, str] = {"track_name": song}
            if artist:
                params["artist_name"] = artist
            if album:
                params["album_name"] = album
            resp = await client.get("https://lrclib.net/api/get", params=params)
            item = resp.json() if resp.status_code == 200 else None

            # Fallback to search endpoint if exact get fails
            if not item or (not item.get("plainLyrics") and not item.get("syncedLyrics")):
                q = f"{song} {artist}".strip()
                sresp = await client.get("https://lrclib.net/api/search", params={"q": q})
                if sresp.status_code == 200:
                    arr = sresp.json()
                    if isinstance(arr, list) and arr:
                        item = arr[0]

            if item and (item.get("plainLyrics") or item.get("syncedLyrics")):
                synced_lines = []
                if item.get("syncedLyrics"):
                    for line in item["syncedLyrics"].splitlines():
                        if line.startswith("[") and "]" in line:
                            ts_part, txt = line.split("]", 1)
                            txt = txt.strip()
                            if txt:
                                synced_lines.append({"time": ts_part[1:], "text": txt})
                plain = item.get("plainLyrics") or "\n".join(l["text"] for l in synced_lines)
                result = {
                    "found": True,
                    "plain_lyrics": plain,
                    "synced_lines": synced_lines[:120],
                    "instrumental": bool(item.get("instrumental")),
                    "source": "lrclib.net",
                }
    except Exception:
        pass

    _set_cache(cache_key, result)
    return result


async def fetch_artist_bio_wikipedia(artist: str) -> dict[str, Any]:
    """Free, zero-key artist bio & portrait via Wikipedia REST API (FR -> EN fallback)."""
    cache_key = f"wiki:{artist.lower().strip()}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached

    result: dict[str, Any] = {"found": False, "summary": None, "description": None, "thumbnail": None, "url": None}
    try:
        async with httpx.AsyncClient(
            timeout=6.0,
            follow_redirects=True,
            headers={"User-Agent": "AMDataWrap/2.0 (Local Apple Music Analytics)"},
        ) as client:
            for lang in ("fr", "en"):
                slug = quote(artist.strip().replace(" ", "_"))
                resp = await client.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{slug}")
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("type") == "standard" and data.get("extract"):
                        result = {
                            "found": True,
                            "title": data.get("title"),
                            "description": data.get("description"),
                            "summary": data.get("extract"),
                            "thumbnail": (data.get("thumbnail") or {}).get("source"),
                            "url": (data.get("content_urls") or {}).get("desktop", {}).get("page"),
                            "lang": lang,
                        }
                        break
    except Exception:
        pass

    _set_cache(cache_key, result)
    return result


async def fetch_track_bpm_deezer(song: str, artist: str = "") -> dict[str, Any]:
    """Free, zero-key BPM & energy info via Deezer public API."""
    cache_key = f"bpm:{song.lower().strip()}|{artist.lower().strip()}"
    cached = _get_cache(cache_key)
    if cached is not None:
        return cached

    result: dict[str, Any] = {"found": False, "bpm": None, "gain": None, "duration": None}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            q = f"{song} {artist}".strip()
            sresp = await client.get("https://api.deezer.com/search", params={"q": q[:100], "limit": 1})
            if sresp.status_code == 200:
                items = sresp.json().get("data", [])
                if items:
                    tid = items[0].get("id")
                    if tid:
                        tresp = await client.get(f"https://api.deezer.com/track/{tid}")
                        if tresp.status_code == 200:
                            tdata = tresp.json()
                            bpm = tdata.get("bpm")
                            if bpm and bpm > 0:
                                result = {
                                    "found": True,
                                    "bpm": round(float(bpm), 1),
                                    "gain": tdata.get("gain"),
                                    "duration": tdata.get("duration"),
                                    "source": "deezer",
                                }
    except Exception:
        pass

    _set_cache(cache_key, result)
    return result
