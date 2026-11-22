"""Free external metadata connectors (LRCLIB, Wikipedia, Deezer BPM, Setlists, Cover Art Archive)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..external import (
    fetch_artist_bio_wikipedia,
    fetch_lyrics_lrclib,
    fetch_track_bpm_deezer,
)
from ..jobs.worker import fetch_artist_setlists, fetch_cover_art_archive

external_router = APIRouter(tags=["external"])


@external_router.get("/api/external/lyrics")
async def external_lyrics(
    song: str = Query(...),
    artist: str = Query(""),
    album: str = Query(""),
):
    return await fetch_lyrics_lrclib(song, artist, album)


@external_router.get("/api/external/artist-bio")
async def external_artist_bio(artist: str = Query(...)):
    return await fetch_artist_bio_wikipedia(artist)


@external_router.get("/api/external/track-bpm")
async def external_track_bpm(song: str = Query(...), artist: str = Query("")):
    return await fetch_track_bpm_deezer(song, artist)


@external_router.get("/api/v3/external/setlists/{artist_key}")
async def v3_artist_setlists(artist_key: str):
    return await fetch_artist_setlists(artist_key)


@external_router.get("/api/v3/external/cover-art/{release_group_mbid}")
async def v3_cover_art(release_group_mbid: str):
    return await fetch_cover_art_archive(release_group_mbid)
