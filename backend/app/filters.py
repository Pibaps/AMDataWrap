from dataclasses import dataclass
from typing import Any
from fastapi import Query


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

    return " AND ".join(clauses), params


def metric_order_sql(f: FilterParams) -> str:
    return "plays DESC, total_ms DESC" if f.metric == "plays" else "total_ms DESC, plays DESC"
