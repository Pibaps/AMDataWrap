"""Unit tests for backend/app/config.py and backend/app/security.py."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from backend.app.config import load_settings
from backend.app.security import is_public_ip, validate_proxy_url


def test_load_settings_defaults_and_env_overrides(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "AMDW_ENV=production\n"
        "AMDW_CORS_ORIGINS=http://localhost:5173,https://app.example.com\n"
        "AMDW_PROXY_TIMEOUT_SEC=12.5\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("AMDW_ENV", raising=False)
    monkeypatch.delenv("AMDW_CORS_ORIGINS", raising=False)
    monkeypatch.delenv("AMDW_PROXY_TIMEOUT_SEC", raising=False)

    s = load_settings(env_path=env_file)
    assert s.env == "production"
    assert s.cors_origins == ["http://localhost:5173", "https://app.example.com"]
    assert s.proxy_timeout_sec == 12.5
    assert s.app_version == "4.5.0"


@pytest.mark.parametrize(
    "ip_str,expected",
    [
        ("8.8.8.8", True),
        ("1.1.1.1", True),
        ("127.0.0.1", False),
        ("10.0.0.1", False),
        ("172.16.0.1", False),
        ("192.168.1.10", False),
        ("169.254.169.254", False),  # AWS/cloud metadata link-local
        ("::1", False),
        ("fc00::1", False),
        ("fe80::1", False),
        ("not-an-ip", False),
    ],
)
def test_is_public_ip(ip_str: str, expected: bool):
    assert is_public_ip(ip_str) is expected


def test_validate_proxy_url_allows_known_public_hosts():
    with patch("backend.app.security._resolve_host_ips", return_value=["104.16.10.10"]):
        url = validate_proxy_url(
            "https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg",
            "artwork",
        )
        assert url.startswith("https://is1-ssl.mzstatic.com/")

        audio = validate_proxy_url(
            "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/test.m4a",
            "audio",
        )
        assert audio.startswith("https://audio-ssl.itunes.apple.com/")


def test_validate_proxy_url_rejects_bad_scheme_port_host_and_private_ip():
    with pytest.raises(HTTPException) as exc1:
        validate_proxy_url("http://is1-ssl.mzstatic.com/a.jpg", "artwork")
    assert exc1.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        validate_proxy_url("https://is1-ssl.mzstatic.com:8443/a.jpg", "artwork")
    assert exc2.value.status_code == 400

    with pytest.raises(HTTPException) as exc3:
        validate_proxy_url("https://evil.internal.local/secret", "artwork")
    assert exc3.value.status_code == 400

    with patch("backend.app.security._resolve_host_ips", return_value=["127.0.0.1"]):
        with pytest.raises(HTTPException) as exc4:
            validate_proxy_url("https://is1-ssl.mzstatic.com/a.jpg", "artwork")
        assert exc4.value.status_code == 400
