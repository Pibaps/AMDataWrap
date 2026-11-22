"""Apple Music RGPD ZIP importer wrapper for V4 multi-profile support."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..db import db_session
from ..ingestion import ingest_zip
from ..profiles import (
    get_or_create_standard_profile,
    record_profile_source,
    refresh_all_merged_profiles_containing,
)
from .base import ProgressCallback, compute_sha256


def import_apple_zip(
    zip_path: Path,
    *,
    filename: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    progress_cb: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Import an Apple Music RGPD archive while registering profile_sources & merged profiles.

    Delegates parsing to the battle-tested `ingestion.ingest_zip` (preserving V1/V2/V3)
    and tags newly ingested rows with the resolved `profile_id`.
    """
    with db_session() as conn:
        target_profile_id = get_or_create_standard_profile(
            conn, profile_id=profile_id, profile_name=profile_name
        )
    file_sha = compute_sha256(zip_path)
    summary = ingest_zip(
        zip_path,
        filename=filename or zip_path.name,
        profile_id=target_profile_id,
        progress_cb=progress_cb,
    )

    with db_session() as conn:
        record_profile_source(
            conn,
            target_profile_id,
            source_provider="apple_rgpd_zip",
            filename=filename or zip_path.name,
            file_sha256=file_sha,
            events_count=int(summary.get("total_play_events", 0)),
            unique_tracks=int(summary.get("unique_tracks", 0)),
            min_date=summary.get("min_date"),
            max_date=summary.get("max_date"),
            metadata={"parser": "apple_rgpd_zip"},
        )
        merged = refresh_all_merged_profiles_containing(conn, target_profile_id)

    if progress_cb:
        progress_cb("done", 100, "Import Apple Music terminé.")

    return {
        "ok": True,
        "source_provider": "apple_rgpd_zip",
        "profile_id": target_profile_id,
        "inserted_events": int(summary.get("total_play_events", 0)),
        "skipped_duplicates": 0,
        "unique_tracks": int(summary.get("unique_tracks", 0)),
        "min_date": summary.get("min_date"),
        "max_date": summary.get("max_date"),
        "merged_profiles_refreshed": list(merged.keys()),
        "legacy_summary": summary,
    }
