"""Centralized environment & application configuration for AMDataWrap V4.5."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]


def load_dotenv(env_path: Path | None = None) -> dict[str, str]:
    """Load KEY=VALUE pairs from `.env` into `os.environ` without overriding existing vars."""
    target = env_path or (ROOT_DIR / ".env")
    loaded: dict[str, str] = {}
    if not target.exists() or not target.is_file():
        return loaded
    try:
        for raw_line in target.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            if key.startswith("export "):
                key = key[7:].strip()
            val = val.strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            if key:
                os.environ.setdefault(key, val)
                loaded[key] = val
    except OSError:
        pass
    return loaded


def _parse_cors_origins(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return ["*"]
    items = [part.strip() for part in raw.split(",") if part.strip()]
    return items or ["*"]


def _parse_int(raw: str | None, default: int, *, minimum: int = 1) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        return max(minimum, int(raw.strip()))
    except ValueError:
        return default


def _parse_float(raw: str | None, default: float, *, minimum: float = 0.5) -> float:
    if raw is None or not raw.strip():
        return default
    try:
        return max(minimum, float(raw.strip()))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    env: str
    db_path: Path
    parquet_path: Path
    artwork_cache_dir: Path
    cors_origins: list[str]
    proxy_timeout_sec: float
    artwork_proxy_max_bytes: int
    audio_proxy_max_bytes: int
    default_user_id: int
    app_version: str = "4.5.0"


def load_settings(env_path: Path | None = None) -> Settings:
    load_dotenv(env_path)
    default_data_dir = ROOT_DIR / "data"
    db_raw = os.environ.get("AMDW_DB_PATH", "").strip()
    db_path = Path(db_raw).expanduser() if db_raw else (default_data_dir / "amdatawrap.sqlite")
    if not db_path.is_absolute():
        db_path = (ROOT_DIR / db_path).resolve()

    pq_raw = os.environ.get("AMDW_PARQUET_PATH", "").strip()
    parquet_path = Path(pq_raw).expanduser() if pq_raw else (db_path.parent / "analytics_snapshot.parquet")
    if not parquet_path.is_absolute():
        parquet_path = (ROOT_DIR / parquet_path).resolve()

    cache_raw = os.environ.get("AMDW_ARTWORK_CACHE_DIR", "").strip()
    artwork_cache_dir = Path(cache_raw).expanduser() if cache_raw else (db_path.parent / "artwork_cache")
    if not artwork_cache_dir.is_absolute():
        artwork_cache_dir = (ROOT_DIR / artwork_cache_dir).resolve()

    return Settings(
        env=os.environ.get("AMDW_ENV", "development").strip() or "development",
        db_path=db_path,
        parquet_path=parquet_path,
        artwork_cache_dir=artwork_cache_dir,
        cors_origins=_parse_cors_origins(os.environ.get("AMDW_CORS_ORIGINS")),
        proxy_timeout_sec=_parse_float(os.environ.get("AMDW_PROXY_TIMEOUT_SEC"), 8.0),
        artwork_proxy_max_bytes=_parse_int(os.environ.get("AMDW_ARTWORK_PROXY_MAX_BYTES"), 10_485_760),
        audio_proxy_max_bytes=_parse_int(os.environ.get("AMDW_AUDIO_PROXY_MAX_BYTES"), 15_728_640),
        default_user_id=_parse_int(os.environ.get("AMDW_DEFAULT_USER_ID"), 1),
    )


settings = load_settings()
