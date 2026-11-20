"""V4 Multi-Platform RGPD / Takeout Import Registry & FastAPI Router.

Supports auto-detection of all 5 V4.0 formats:
1. Apple Music RGPD ZIP (`apple_music`)
2. Spotify Extended Streaming History & Account Data JSON/ZIP (`spotify`)
3. YouTube Music Google Takeout `watch-history.json` / ZIP (`youtube_music`)
4. Deezer RGPD `.xlsx` (`deezer`)
5. TIDAL `.csv` UTF-8 with alias detection & assisted manual mapping (`tidal`)
"""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from .apple import import_apple_zip
from .deezer import import_deezer_xlsx
from .spotify import import_spotify_file
from .tidal import import_tidal_csv, preview_csv_columns
from .youtube import import_youtube_takeout_file

importers_router = APIRouter(prefix="/api/v4", tags=["v4-importers"])

PLATFORM_IMPORT_GUIDES: list[dict[str, Any]] = [
    {
        "platform": "apple_music",
        "label": "Apple Music",
        "accepted_extensions": [".zip"],
        "estimated_wait": "3–7 jours (privacy.apple.com)",
        "steps": [
            "Va sur privacy.apple.com et demande une copie de « Informations des services multimédias Apple ».",
            "Télécharge le fichier ZIP reçu par e-mail (sans le décompresser).",
            "Glisse-dépose l'archive ZIP ici : Play Activity, Daily Tracks, Library Tracks et Paroles sont importés automatiquement.",
        ],
    },
    {
        "platform": "spotify",
        "label": "Spotify",
        "accepted_extensions": [".zip", ".json"],
        "estimated_wait": "5–30 jours (Extended) / ~5 jours (Account Data)",
        "steps": [
            "Va sur spotify.com/account/privacy et coche « Historique de streaming étendu » (recommandé) ou « Données du compte ».",
            "Glisse-dépose l'archive ZIP ou un fichier `Streaming_History_Audio_*.json` / `StreamingHistory_music_*.json`.",
            "Les podcasts/audiobooks sont filtrés automatiquement ; option pour inclure ou exclure les sessions privées (`incognito_mode`).",
        ],
    },
    {
        "platform": "youtube_music",
        "label": "YouTube Music",
        "accepted_extensions": [".json", ".zip"],
        "estimated_wait": "Quelques minutes (takeout.google.com)",
        "steps": [
            "Va sur takeout.google.com, sélectionne uniquement « YouTube et YouTube Music » → format JSON pour l'historique.",
            "Glisse-dépose le fichier `watch-history.json` (ou l'archive ZIP Takeout).",
            "Seules les écoutes `YouTube Music` sont extraites ; les IDs vidéo sont stockés pour la lecture complète à 0 €.",
        ],
    },
    {
        "platform": "deezer",
        "label": "Deezer",
        "accepted_extensions": [".xlsx"],
        "estimated_wait": "Quelques jours (support RGPD Deezer)",
        "steps": [
            "Demande tes données personnelles RGPD depuis les paramètres de ton compte Deezer.",
            "Glisse-dépose le classeur `.xlsx` reçu.",
            "La colonne adresse IP est strictement rejetée et jamais stockée ; les durées `-1` sont imputées proprement.",
        ],
    },
    {
        "platform": "tidal",
        "label": "TIDAL",
        "accepted_extensions": [".csv"],
        "estimated_wait": "Immédiat (export CSV / TuneMyMusic / Soundiiz / RGPD)",
        "steps": [
            "Exporte ton historique ou ta bibliothèque TIDAL au format `.csv` UTF-8.",
            "Glisse-dépose le fichier `.csv` : les colonnes standard (`Title`, `Artist`, `Album`, `Duration`, `ISRC`) sont auto-détectées.",
            "Si tes colonnes sont atypiques, l'assistant de mappage manuel te permet de les associer en 1 clic.",
        ],
    },
]


def detect_import_format(path: Path, filename: str | None = None) -> str:
    """Auto-detect which of the 5 V4 platforms a file belongs to."""
    name = (filename or path.name).lower()
    ext = Path(name).suffix.lower() or path.suffix.lower()

    if ext == ".xlsx":
        return "deezer"
    if ext == ".csv":
        return "tidal"
    if ext == ".json":
        try:
            head = path.read_text(encoding="utf-8", errors="replace")[:8192]
            if '"header"' in head and "YouTube" in head:
                return "youtube_music"
            if (
                '"spotify_track_uri"' in head
                or '"master_metadata_track_name"' in head
                or '"msPlayed"' in head
                or '"ms_played"' in head
            ):
                return "spotify"
        except Exception:
            pass
        return "spotify"

    if ext == ".zip":
        try:
            with zipfile.ZipFile(path, "r") as zf:
                names_low = [n.lower() for n in zf.namelist()]
                if any("apple music" in n or "play activity" in n for n in names_low):
                    return "apple_music"
                if any("streaming_history_audio" in n or "streaminghistory" in n for n in names_low):
                    return "spotify"
                if any("watch-history.json" in n or "historique" in n for n in names_low):
                    return "youtube_music"
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Archive ZIP invalide ou corrompue.")
        return "apple_music"

    raise HTTPException(
        status_code=400,
        detail=f"Format de fichier non supporté ({ext}). Formats acceptés : .zip, .json, .xlsx, .csv.",
    )


def import_file_v4(
    path: Path,
    *,
    filename: str | None = None,
    platform_hint: str | None = None,
    profile_id: int | None = None,
    profile_name: str | None = None,
    include_incognito: bool = True,
    column_mapping: dict[str, str] | None = None,
) -> dict[str, Any]:
    fmt = (platform_hint or "").strip().lower()
    if fmt in ("", "auto"):
        fmt = detect_import_format(path, filename=filename)

    if fmt in ("apple", "apple_music", "apple_rgpd_zip"):
        res = import_apple_zip(
            path, filename=filename, profile_id=profile_id, profile_name=profile_name
        )
    elif fmt in ("spotify", "spotify_extended", "spotify_account"):
        res = import_spotify_file(
            path,
            filename=filename,
            profile_id=profile_id,
            profile_name=profile_name,
            include_incognito=include_incognito,
        )
    elif fmt in ("youtube", "youtube_music", "youtube_takeout"):
        res = import_youtube_takeout_file(
            path, filename=filename, profile_id=profile_id, profile_name=profile_name
        )
    elif fmt in ("deezer", "deezer_rgpd"):
        res = import_deezer_xlsx(
            path, filename=filename, profile_id=profile_id, profile_name=profile_name
        )
    elif fmt in ("tidal", "tidal_csv"):
        res = import_tidal_csv(
            path,
            filename=filename,
            profile_id=profile_id,
            profile_name=profile_name,
            column_mapping=column_mapping,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Plateforme inconnue : {fmt}")

    res["detected_platform"] = fmt
    return res


@importers_router.get("/import/guides")
def api_get_import_guides() -> dict[str, Any]:
    return {"platforms": PLATFORM_IMPORT_GUIDES}


@importers_router.post("/import/preview")
async def api_preview_import_csv(file: UploadFile = File(...)) -> dict[str, Any]:
    """Preview CSV headers & auto-detected mapping (used for TIDAL assisted manual mapping)."""
    suffix = Path(file.filename or "upload.csv").suffix or ".csv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)
    try:
        return await asyncio.to_thread(preview_csv_columns, tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


@importers_router.post("/import")
async def api_import_v4(
    file: UploadFile = File(...),
    platform: str = Form("auto"),
    profile_id: int | None = Form(None),
    profile_name: str | None = Form(None),
    include_incognito: bool = Form(True),
    column_mapping_json: str | None = Form(None),
) -> dict[str, Any]:
    """Universal V4 drag & drop import endpoint supporting all 5 platforms."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant.")

    col_mapping: dict[str, str] | None = None
    if column_mapping_json:
        try:
            parsed = json.loads(column_mapping_json)
            if isinstance(parsed, dict):
                col_mapping = {str(k): str(v) for k, v in parsed.items() if v}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"column_mapping_json invalide : {exc}")

    suffix = Path(file.filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)
    try:
        return await asyncio.to_thread(
            import_file_v4,
            tmp_path,
            filename=file.filename,
            platform_hint=platform,
            profile_id=profile_id,
            profile_name=profile_name,
            include_incognito=include_incognito,
            column_mapping=col_mapping,
        )
    finally:
        tmp_path.unlink(missing_ok=True)
