"""Atomic Parquet snapshot writer + read-only DuckDB analytical engine (Phase 2).

ARCHITECTURE GUARDRAIL (PDF p. 13 & p. 15):
NEVER run `ATTACH ... TYPE sqlite` inside the FastAPI process while SQLite WAL writes occur
(risk of `database is locked` or fatal `EXC_BAD_ACCESS / SIGBUS`).
Instead, after each ZIP import or sync batch, export an immutable `data/analytics_snapshot.parquet`
via atomic temp-file + `os.replace()`. DuckDB queries ONLY this immutable Parquet file in-memory.
"""

from __future__ import annotations

import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from ..db import DATA_DIR, PARQUET_SNAPSHOT_PATH, db_session

_SNAPSHOT_LOCK = threading.Lock()
_LAST_EXPORT_META: dict[str, Any] = {
    "exists": False,
    "path": str(PARQUET_SNAPSHOT_PATH),
    "rows": 0,
    "exported_at": None,
    "size_bytes": 0,
}

PARQUET_SCHEMA = pa.schema(
    [
        ("id", pa.int64()),
        ("track_key", pa.string()),
        ("canonical_track_key", pa.string()),
        ("song_name", pa.string()),
        ("artist_name", pa.string()),
        ("artist_group_key", pa.string()),
        ("album_name", pa.string()),
        ("album_group_key", pa.string()),
        ("genre", pa.string()),
        ("release_year", pa.int32()),
        ("started_at_utc", pa.string()),
        ("started_at_local", pa.string()),
        ("started_epoch", pa.int64()),
        ("local_date", pa.string()),
        ("local_year", pa.int32()),
        ("local_month", pa.string()),
        ("local_month_num", pa.int32()),
        ("local_season", pa.string()),
        ("local_dow", pa.int32()),
        ("local_hour", pa.int32()),
        ("play_duration_ms", pa.int64()),
        ("media_duration_ms", pa.int64()),
        ("completion_ratio", pa.float64()),
        ("end_reason_type", pa.string()),
        ("is_valid_lastfm", pa.int8()),
        ("is_skip_30s", pa.int8()),
        ("container_type", pa.string()),
        ("playlist_name", pa.string()),
        ("device_label", pa.string()),
        ("offline", pa.int8()),
        ("session_id", pa.int64()),
        ("source_provider", pa.string()),
        ("source_priority", pa.int32()),
        ("duration_is_estimated", pa.int8()),
    ]
)


def export_parquet_snapshot(snapshot_path: Path | None = None) -> dict[str, Any]:
    """Export joined play_events + tracks_catalog to an immutable Parquet file atomically."""
    target = snapshot_path or PARQUET_SNAPSHOT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)

    with _SNAPSHOT_LOCK:
        with db_session() as conn:
            rows = conn.execute(
                """
                SELECT
                    pe.id,
                    pe.track_key,
                    COALESCE(pe.canonical_track_key, pe.track_key) AS canonical_track_key,
                    tc.song_name,
                    COALESCE(tc.artist_name, 'Artiste inconnu') AS artist_name,
                    COALESCE(tc.artist_group_key, 'artiste inconnu') AS artist_group_key,
                    tc.album_name,
                    tc.album_group_key,
                    COALESCE(tc.genre, 'Inconnu') AS genre,
                    tc.release_year,
                    pe.started_at_utc,
                    pe.started_at_local,
                    pe.started_epoch,
                    pe.local_date,
                    pe.local_year,
                    pe.local_month,
                    pe.local_month_num,
                    pe.local_season,
                    pe.local_dow,
                    pe.local_hour,
                    pe.play_duration_ms,
                    pe.media_duration_ms,
                    pe.completion_ratio,
                    COALESCE(pe.end_reason_type, '') AS end_reason_type,
                    pe.is_valid_lastfm,
                    pe.is_skip_30s,
                    COALESCE(pe.container_type, 'UNKNOWN') AS container_type,
                    COALESCE(pe.playlist_name, '') AS playlist_name,
                    COALESCE(pe.device_label, 'Inconnu') AS device_label,
                    COALESCE(pe.offline, 0) AS offline,
                    pe.session_id,
                    COALESCE(pe.source_provider, 'apple_rgpd_zip') AS source_provider,
                    COALESCE(pe.source_priority, 100) AS source_priority,
                    COALESCE(pe.duration_is_estimated, 0) AS duration_is_estimated
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                ORDER BY pe.started_epoch ASC, pe.id ASC
                """
            ).fetchall()

        columns: dict[str, list[Any]] = {field.name: [] for field in PARQUET_SCHEMA}
        for r in rows:
            for field in PARQUET_SCHEMA:
                columns[field.name].append(r[field.name])

        table = pa.table(columns, schema=PARQUET_SCHEMA)

        fd, tmp_name = tempfile.mkstemp(prefix=".analytics_snapshot_", suffix=".parquet", dir=str(target.parent))
        os.close(fd)
        try:
            pq.write_table(table, tmp_name, compression="zstd")
            os.replace(tmp_name, target)
        except Exception:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
            raise

        meta = {
            "exists": target.exists(),
            "path": str(target),
            "rows": len(rows),
            "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "size_bytes": target.stat().st_size if target.exists() else 0,
        }
        _LAST_EXPORT_META.update(meta)
        return dict(_LAST_EXPORT_META)


def ensure_parquet_snapshot() -> Path:
    if not PARQUET_SNAPSHOT_PATH.exists():
        export_parquet_snapshot()
    return PARQUET_SNAPSHOT_PATH


def get_snapshot_status() -> dict[str, Any]:
    if PARQUET_SNAPSHOT_PATH.exists():
        _LAST_EXPORT_META["exists"] = True
        _LAST_EXPORT_META["size_bytes"] = PARQUET_SNAPSHOT_PATH.stat().st_size
        if not _LAST_EXPORT_META.get("rows"):
            try:
                _LAST_EXPORT_META["rows"] = pq.read_metadata(PARQUET_SNAPSHOT_PATH).num_rows
            except Exception:
                pass
    return dict(_LAST_EXPORT_META)


def query_parquet(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    """Run a read-only DuckDB analytical query against the immutable Parquet snapshot.

    The placeholder `{parquet}` in SQL is replaced with the quoted Parquet path.
    """
    path = ensure_parquet_snapshot()
    quoted = str(path).replace("'", "''")
    rendered = sql.replace("{parquet}", f"read_parquet('{quoted}')")
    con = duckdb.connect(database=":memory:")
    try:
        cur = con.execute(rendered, params or [])
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        con.close()
