"""Strict Pydantic v2 schemas for AMDataWrap V3 OpenAPI contracts & normalized error responses."""

from typing import Any
from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    error: bool = True
    code: str = Field(..., description="Machine-readable error code")
    message: str = Field(..., description="Human-readable French message")
    detail: Any | None = None
    hint: str | None = None


class ProviderConfigIn(BaseModel):
    enabled: bool = True
    username: str | None = None
    token: str | None = None
    api_key: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class ProviderStatusOut(BaseModel):
    provider: str
    enabled: bool
    username: str | None = None
    has_token: bool = False
    has_api_key: bool = False
    last_sync_at: str | None = None
    last_cursor_ts: int = 0
    last_status: str = "idle"
    last_error: str | None = None
    total_synced: int = 0
    extra: dict[str, Any] = Field(default_factory=dict)


class NowPlayingOut(BaseModel):
    active: bool = False
    provider: str | None = None
    song_name: str | None = None
    artist_name: str | None = None
    album_name: str | None = None
    artwork_url: str | None = None
    started_at_utc: str | None = None
    duration_ms: int = 0
    position_ms: int = 0
    is_playing: bool = False
    updated_at: str | None = None


class ContinuumStatusOut(BaseModel):
    providers: list[ProviderStatusOut]
    now_playing: NowPlayingOut
    source_breakdown: list[dict[str, Any]]
    estimated_duration_plays: int = 0
    total_plays: int = 0
    smtc_supported: bool = False
    smtc_running: bool = False
    receiver_endpoint: str = "/apis/listenbrainz/1/submit-listens"
    lastfm_pro_notice: str = (
        "À partir du 1er décembre 2026, une clé API Last.fm exige un abonnement Last.fm Pro (4,99 $/mois). "
        "ListenBrainz, Windows SMTC et le récepteur local Pano Scrobbler restent 100 % gratuits."
    )


class SyncResultOut(BaseModel):
    provider: str
    ok: bool
    fetched: int = 0
    inserted: int = 0
    upgraded: int = 0
    deduplicated: int = 0
    now_playing_updated: bool = False
    error: str | None = None
    error_code: str | None = None
    hint: str | None = None


class AudioDnaIn(BaseModel):
    track_key: str
    bpm: float | None = Field(None, ge=30, le=260)
    musical_key: str | None = None
    musical_mode: str | None = None  # major | minor
    camelot_code: str | None = None
    key_confidence: float = Field(0.0, ge=0.0, le=1.0)
    energy: float | None = Field(None, ge=0.0, le=1.0)
    danceability: float | None = Field(None, ge=0.0, le=1.0)
    loudness_db: float | None = None
    valence_audio: float | None = Field(None, ge=0.0, le=1.0)
    dynamic_complexity: float | None = None
    spectral_centroid: float | None = None
    chroma: list[float] | None = None
    mfcc: list[float] | None = None
    source: str = "essentia_wasm"


class PlaylistBuildIn(BaseModel):
    kind: str = Field(
        "harmonic_mix",
        description="harmonic_mix | forgotten_gems | zero_skip | era_soundtrack",
    )
    seed_track_key: str | None = None
    era_index: int | None = None
    limit: int = Field(20, ge=5, le=60)
    name: str | None = None
    push_to_listenbrainz: bool = False


class SearchResultItem(BaseModel):
    track_key: str
    song_name: str
    artist_name: str
    album_name: str
    genre: str | None = None
    release_year: int | None = None
    artwork_url: str | None = None
    preview_url: str | None = None
    total_plays: int = 0
    total_ms: int = 0
    match_source: str = "fts5_unicode61"
    snippet: str | None = None


class FtsSearchOut(BaseModel):
    query: str
    total: int
    tracks: list[SearchResultItem]
    lyrics_matches: list[dict[str, Any]]
