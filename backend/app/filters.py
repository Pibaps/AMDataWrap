from dataclasses import dataclass
from typing import Any
from fastapi import Query


SOURCE_PROVIDER_ALIASES: dict[str, tuple[str, ...]] = {
    "apple_music": ("apple_rgpd_zip", "apple_music", "musickit_web"),
    "apple": ("apple_rgpd_zip", "apple_music", "musickit_web"),
    "spotify": ("spotify_extended", "spotify_account", "spotify_rgpd", "spotify_web", "spotify"),
    "youtube_music": ("youtube_takeout", "youtube_music", "youtube_iframe", "youtube_web"),
    "youtube": ("youtube_takeout", "youtube_music", "youtube_iframe", "youtube_web"),
    "deezer": ("deezer_rgpd", "deezer"),
    "tidal": ("tidal_csv", "tidal_rgpd", "tidal"),
    "live": (
        "local_smtc",
        "os_media",
        "web_scrobbler",
        "extension_bridge",
        "local_receiver",
        "listenbrainz",
        "lastfm",
        "youtube_iframe",
        "preview_audio",
    ),
}

PROVIDER_TO_PLATFORM: dict[str, str] = {
    "apple_rgpd_zip": "apple_music",
    "apple_music": "apple_music",
    "apple": "apple_music",
    "musickit_web": "apple_music",
    "spotify_extended": "spotify",
    "spotify_account": "spotify",
    "spotify_rgpd": "spotify",
    "spotify_web": "spotify",
    "spotify": "spotify",
    "youtube_takeout": "youtube_music",
    "youtube_music": "youtube_music",
    "youtube_iframe": "youtube_music",
    "youtube_web": "youtube_music",
    "youtube": "youtube_music",
    "deezer_rgpd": "deezer",
    "deezer": "deezer",
    "tidal_csv": "tidal",
    "tidal_rgpd": "tidal",
    "tidal": "tidal",
    "local_smtc": "os_media",
    "os_media": "os_media",
    "web_scrobbler": "web_scrobbler",
    "extension_bridge": "extension_bridge",
    "local_receiver": "listenbrainz",
    "listenbrainz": "listenbrainz",
    "lastfm": "lastfm",
    "preview_audio": "preview_audio",
}


def canonical_platform_for(source_provider: str | None) -> str:
    """Map a raw source_provider token to its canonical V4 platform identifier."""
    raw = (source_provider or "apple_rgpd_zip").strip().lower()
    return PROVIDER_TO_PLATFORM.get(raw, raw or "apple_music")


def expand_source_providers(raw: str | None) -> list[str]:
    """Expand alias(es) or comma-separated raw provider tokens into exact SQL values.

    Returns [] when unfiltered (None, '', or 'all').
    """
    if not raw:
        return []
    tokens = [t.strip().lower() for t in raw.split(",") if t.strip()]
    if not tokens or "all" in tokens:
        return []
    expanded: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        values = SOURCE_PROVIDER_ALIASES.get(tok, (tok,))
        for v in values:
            if v not in seen:
                seen.add(v)
                expanded.append(v)
    return expanded


def build_profile_id_clause(
    profile_id: int | None,
    alias: str = "pe",
    *,
    include_exclusions: bool = True,
) -> tuple[str | None, list[Any]]:
    """Return pure-SQL clause + params scoping a table to a standard or merged profile."""
    if profile_id is None:
        return None, []
    membership_sql = (
        f"COALESCE({alias}.profile_id, 1) IN ("
        "SELECT p.id FROM profiles p WHERE p.id = ? AND p.kind = 'standard' "
        "UNION "
        "SELECT CAST(je.value AS INTEGER) FROM profiles p, "
        "json_each(CASE WHEN json_valid(p.merged_profile_ids_json) THEN p.merged_profile_ids_json ELSE '[]' END) je "
        "WHERE p.id = ? AND p.kind = 'merged'"
        ")"
    )
    if not include_exclusions:
        return membership_sql, [profile_id, profile_id]
    full_sql = (
        f"({membership_sql} AND NOT EXISTS ("
        f"SELECT 1 FROM profile_merged_exclusions pme "
        f"WHERE pme.merged_profile_id = ? AND pme.play_event_id = {alias}.id"
        "))"
    )
    return full_sql, [profile_id, profile_id, profile_id]


@dataclass
class FilterParams:
    period_mode: str = "all"  # all | year | month | season | custom
    year: int | None = None
    month: str | None = None  # YYYY-MM
    season: str | None = None  # Hiver | Printemps | Été | Automne
    date_from: str | None = None  # YYYY-MM-DD
    date_to: str | None = None  # YYYY-MM-DD

    # Skip / listening threshold mode
    skip_mode: str = "lastfm"  # lastfm | all | custom
    min_seconds: int = 30
    min_completion_pct: int = 50

    # Ranking metric
    metric: str = "ms"  # ms | plays

    # Advanced filters
    artist: str | None = None
    genre: str | None = None
    decade: int | None = None  # e.g. 1980, 1990, 2000, 2010, 2020
    container_type: str | None = None
    feature_name: str | None = None
    device: str | None = None
    offline: str | None = None  # "true" | "false" | None

    # V4 Multi-platform & Multi-profile filters
    source_provider: str | None = None  # alias (apple_music, spotify, ...) or raw or comma-separated
    profile_id: int | None = None  # standard or merged profile id (None = legacy all-events)
    exclude_incognito: bool = False  # True excludes Spotify incognito_mode = 1 plays


def get_filter_params(
    period_mode: str = Query("all"),
    year: int | None = Query(None),
    month: str | None = Query(None),
    season: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    skip_mode: str = Query("lastfm"),
    min_seconds: int = Query(30, ge=0, le=600),
    min_completion_pct: int = Query(50, ge=0, le=100),
    metric: str = Query("ms"),
    artist: str | None = Query(None),
    genre: str | None = Query(None),
    decade: int | None = Query(None),
    container_type: str | None = Query(None),
    feature_name: str | None = Query(None),
    device: str | None = Query(None),
    offline: str | None = Query(None),
    source_provider: str | None = Query(None),
    profile_id: int | None = Query(None),
    exclude_incognito: bool = Query(False),
) -> FilterParams:
    return FilterParams(
        period_mode=period_mode,
        year=year,
        month=month,
        season=season,
        date_from=date_from,
        date_to=date_to,
        skip_mode=skip_mode,
        min_seconds=min_seconds,
        min_completion_pct=min_completion_pct,
        metric="plays" if metric == "plays" else "ms",
        artist=artist or None,
        genre=genre or None,
        decade=decade,
        container_type=container_type or None,
        feature_name=feature_name or None,
        device=device or None,
        offline=offline or None,
        source_provider=source_provider or None,
        profile_id=profile_id,
        exclude_incognito=bool(exclude_incognito),
    )


def build_where_clause(
    f: FilterParams,
    *,
    include_skip_filter: bool = True,
    pe_alias: str = "pe",
    tc_alias: str = "tc",
) -> tuple[str, list[Any]]:
    clauses: list[str] = ["1=1"]
    params: list[Any] = []

    # Period filter
    if f.period_mode == "year" and f.year is not None:
        clauses.append(f"{pe_alias}.local_year = ?")
        params.append(f.year)
    elif f.period_mode == "month" and f.month:
        clauses.append(f"{pe_alias}.local_month = ?")
        params.append(f.month)
    elif f.period_mode == "season" and f.season:
        clauses.append(f"{pe_alias}.local_season = ?")
        params.append(f.season)
        if f.year is not None:
            clauses.append(f"{pe_alias}.local_year = ?")
            params.append(f.year)
    elif f.period_mode == "custom":
        if f.date_from:
            clauses.append(f"{pe_alias}.local_date >= ?")
            params.append(f.date_from)
        if f.date_to:
            clauses.append(f"{pe_alias}.local_date <= ?")
            params.append(f.date_to)

    # Skip threshold filter
    if include_skip_filter:
        if f.skip_mode == "lastfm":
            clauses.append(f"{pe_alias}.is_valid_lastfm = 1")
        elif f.skip_mode == "custom":
            min_ms = f.min_seconds * 1000
            min_ratio = f.min_completion_pct / 100.0
            clauses.append(f"{pe_alias}.play_duration_ms >= ?")
            params.append(min_ms)
            if min_ratio > 0:
                clauses.append(f"({pe_alias}.completion_ratio >= ? OR {pe_alias}.play_duration_ms >= 240000)")
                params.append(min_ratio)

    # Advanced filters
    if f.artist:
        clauses.append(f"{tc_alias}.artist_group_key = ?")
        params.append(f.artist)
    if f.genre:
        clauses.append(f"{tc_alias}.genre = ?")
        params.append(f.genre)
    if f.decade is not None:
        clauses.append(f"{tc_alias}.release_year >= ? AND {tc_alias}.release_year < ?")
        params.append(f.decade)
        params.append(f.decade + 10)
    if f.container_type:
        clauses.append(f"{pe_alias}.container_type = ?")
        params.append(f.container_type)
    if f.feature_name:
        clauses.append(f"{pe_alias}.feature_name = ?")
        params.append(f.feature_name)
    if f.device:
        clauses.append(f"{pe_alias}.device_label = ?")
        params.append(f.device)
    if f.offline == "true":
        clauses.append(f"{pe_alias}.offline = 1")
    elif f.offline == "false":
        clauses.append(f"{pe_alias}.offline = 0")

    # V4 Multi-platform source_provider filter
    providers = expand_source_providers(f.source_provider)
    if providers:
        placeholders = ", ".join("?" for _ in providers)
        clauses.append(f"COALESCE({pe_alias}.source_provider, 'apple_rgpd_zip') IN ({placeholders})")
        params.extend(providers)

    # V4 Multi-profile (standard + merged with dedup exclusions)
    prof_clause, prof_params = build_profile_id_clause(
        f.profile_id, pe_alias, include_exclusions=True
    )
    if prof_clause:
        clauses.append(prof_clause)
        params.extend(prof_params)

    # V4 Spotify incognito filter
    if f.exclude_incognito:
        clauses.append(f"COALESCE({pe_alias}.incognito_mode, 0) = 0")

    return " AND ".join(clauses), params


def metric_order_sql(f: FilterParams) -> str:
    return "plays DESC, total_ms DESC" if f.metric == "plays" else "total_ms DESC, plays DESC"
