import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

ProgressCallback = Callable[[str, int, str], None]

_LIVE_SCROBBLE_PROVIDERS = (
    "local_smtc",
    "os_media",
    "web_scrobbler",
    "extension_bridge",
    "local_receiver",
    "listenbrainz",
    "lastfm",
    "youtube_iframe",
    "preview_audio",
)

from .db import db_session, init_db
from .normalize import (
    clean_display_title,
    clean_group_key,
    make_track_key,
    normalize_basic,
    primary_artist_name,
)

SESSION_GAP_SECONDS = 30 * 60  # 30 minutes


def _parse_iso_utc(ts: str | None) -> datetime | None:
    if not ts:
        return None
    s = ts.strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _season_for_month(month: int) -> str:
    if month in (12, 1, 2):
        return "Hiver"
    if month in (3, 4, 5):
        return "Printemps"
    if month in (6, 7, 8):
        return "Été"
    return "Automne"


def _resolve_device_label(
    device_os: str,
    build_version: str,
    client_device: str,
    source_type: str,
    device_id: str,
    device_map: dict[str, str],
) -> str:
    if source_type == "CHROMECAST":
        return "Chromecast"
    if source_type == "WEB_APP":
        return "Apple Music Web"
    if device_id and device_id in device_map:
        name = device_map[device_id]
        if "motorola" in name.lower():
            return "Motorola Edge 60 Neo"
        if "realme" in name.lower():
            return "Realme RMX3472"
        if "a530f" in name.lower():
            return "Samsung Galaxy A8"
        if name.startswith("DESKTOP-") or "PIERRICK" in name.upper():
            return f"Windows PC ({name})"
        return name

    combined = f"{build_version} {client_device}".lower()
    if "motorolaedge60neo" in combined:
        return "Motorola Edge 60 Neo"
    if "realmermx3472" in combined:
        return "Realme RMX3472"
    if "samsungsma530f" in combined:
        return "Samsung Galaxy A8"
    if device_os.lower() == "windows":
        return "Windows PC"
    if device_os.lower() == "android":
        return "Android"
    if device_os.lower() == "linux":
        return "Chromecast / Linux"
    return device_os or "Inconnu"


def _find_zip_entry(zf: zipfile.ZipFile, suffix: str) -> str | None:
    low_suffix = suffix.lower()
    for name in zf.namelist():
        if name.lower().endswith(low_suffix):
            return name
    return None


def _read_nested_json(zf: zipfile.ZipFile, entry_name: str | None) -> list[dict[str, Any]]:
    if not entry_name:
        return []
    raw = zf.read(entry_name)
    if entry_name.lower().endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(raw)) as nzf:
            for n in nzf.namelist():
                if n.lower().endswith(".json"):
                    return json.loads(nzf.read(n).decode("utf-8-sig", errors="replace"))
        return []
    return json.loads(raw.decode("utf-8-sig", errors="replace"))


def _compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_int(val: str | None, default: int = 0) -> int:
    if not val:
        return default
    try:
        return int(float(val.strip()))
    except ValueError:
        return default


def _extract_year(year_val: Any, rel_date: str | None) -> int | None:
    if year_val:
        try:
            y = int(year_val)
            if 1900 <= y <= 2030:
                return y
        except (ValueError, TypeError):
            pass
    if rel_date and len(rel_date) >= 4:
        try:
            y = int(rel_date[:4])
            if 1900 <= y <= 2030:
                return y
        except ValueError:
            pass
    return None


def ingest_zip(
    zip_path: Path,
    filename: str | None = None,
    *,
    profile_id: int = 1,
    progress_cb: ProgressCallback | None = None,
) -> dict[str, Any]:
    """Full Pass 1 ingestion from Apple Media Services information.zip into SQLite."""
    init_db()
    if progress_cb:
        progress_cb("reading", 6, "Calcul de l'empreinte de l'archive…")
    zip_sha = _compute_file_sha256(zip_path)
    zip_name = filename or zip_path.name

    with zipfile.ZipFile(zip_path, "r") as zf:
        if progress_cb:
            progress_cb("reading", 10, "Lecture des appareils, playlists et bibliothèque…")
        # ------------------------------------------------------------------
        # 1. Load local reference tables for Pass 1 resolution
        # ------------------------------------------------------------------
        # 1a. Device ID -> friendly name
        device_map: dict[str, str] = {}
        for dev_suffix in (
            "Customer Device History - Push Notification Authorization.csv",
            "Customer Device History - Computer Authorizations.csv",
            "Customer Device History - iTunes in the Cloud Authorization.csv",
        ):
            entry = _find_zip_entry(zf, dev_suffix)
            if entry:
                text = zf.read(entry).decode("utf-8-sig", errors="replace")
                for row in csv.DictReader(io.StringIO(text)):
                    did = (row.get("Device Identifier") or "").strip()
                    dname = (row.get("Device Name") or "").strip()
                    if did and dname:
                        device_map[did] = dname

        # 1b. Playlists ID -> Title
        playlist_map: dict[str, str] = {"2": "Morceaux préférés"}
        pl_entry = _find_zip_entry(zf, "Apple Music Library Playlists.json.zip")
        for pl in _read_nested_json(zf, pl_entry):
            title = clean_display_title(pl.get("Title"))
            if not title:
                continue
            cid = pl.get("Container Identifier")
            if cid is not None:
                playlist_map[str(cid)] = title
            pub_id = pl.get("Public Playlist Identifier")
            if pub_id:
                playlist_map[str(pub_id)] = title

        # Also check Recently Played Containers for playlist names
        rpc_entry = _find_zip_entry(zf, "Apple Music - Recently Played Containers.csv")
        if rpc_entry:
            text = zf.read(rpc_entry).decode("utf-8-sig", errors="replace")
            for row in csv.DictReader(io.StringIO(text)):
                cref = (row.get("Container Reference") or "").strip()
                cdesc = (row.get("Container Description") or "").strip()
                if cref and cdesc and cdesc != "N/A" and cref not in playlist_map:
                    playlist_map[cref] = cdesc

        # 1c. Library Tracks (13k tracks: artist, album, genre, year, releaseDate, itunes_track_id)
        lib_by_title_album: dict[tuple[str, str], dict[str, Any]] = {}
        lib_by_title: dict[str, dict[str, Any]] = {}
        lib_by_group_title: dict[str, dict[str, Any]] = {}

        lib_entry = _find_zip_entry(zf, "Apple Music Library Tracks.json.zip")
        for t in _read_nested_json(zf, lib_entry):
            title = clean_display_title(t.get("Title"))
            album = clean_display_title(t.get("Album"))
            artist = clean_display_title(t.get("Artist") or t.get("Album Artist"))
            if not title:
                continue
            genre = clean_display_title(t.get("Genre")) or None
            rel_date = (t.get("Release Date") or "").strip() or None
            rel_year = _extract_year(t.get("Track Year"), rel_date)
            am_id = t.get("Apple Music Track Identifier") or t.get("Purchased Track Identifier")
            itunes_id = str(am_id) if am_id else None

            info = {
                "artist": artist or None,
                "album": album or None,
                "genre": genre,
                "release_year": rel_year,
                "release_date": rel_date,
                "itunes_track_id": itunes_id,
            }
            nt, na = normalize_basic(title), normalize_basic(album)
            if nt and na:
                lib_by_title_album[(nt, na)] = info
            if nt and nt not in lib_by_title:
                lib_by_title[nt] = info
            gt = clean_group_key(title)
            if gt and gt not in lib_by_group_title:
                lib_by_group_title[gt] = info

        # 1d. Play History Daily Tracks ("Artist - Title" + Track Identifier)
        daily_by_title: dict[str, dict[str, Any]] = {}
        daily_entry = _find_zip_entry(zf, "Apple Music - Play History Daily Tracks.csv")
        if daily_entry:
            text = zf.read(daily_entry).decode("utf-8-sig", errors="replace")
            for row in csv.DictReader(io.StringIO(text)):
                desc = (row.get("Track Description") or "").strip()
                tid = (row.get("Track Identifier") or row.get("Track Reference") or "").strip()
                if " - " in desc:
                    artist, title = desc.split(" - ", 1)
                    nt = normalize_basic(title)
                    if nt and nt not in daily_by_title:
                        daily_by_title[nt] = {
                            "artist": clean_display_title(artist),
                            "itunes_track_id": tid if tid.isdigit() else None,
                        }

        # 1e. Track Play History & Recently Played Tracks
        extra_artist_by_title: dict[str, str] = {}
        tph_entry = _find_zip_entry(zf, "Apple Music - Track Play History.csv")
        if tph_entry:
            text = zf.read(tph_entry).decode("utf-8-sig", errors="replace")
            for row in csv.DictReader(io.StringIO(text)):
                desc = (row.get("Track Name") or "").strip()
                if " - " in desc:
                    artist, title = desc.split(" - ", 1)
                    nt = normalize_basic(title)
                    if nt and nt not in extra_artist_by_title:
                        extra_artist_by_title[nt] = clean_display_title(artist)

        rpt_entry = _find_zip_entry(zf, "Apple Music - Recently Played Tracks.csv")
        if rpt_entry:
            text = zf.read(rpt_entry).decode("utf-8-sig", errors="replace")
            for row in csv.DictReader(io.StringIO(text)):
                desc = (row.get("Track Description") or "").strip()
                tid = (row.get("Track Reference") or "").strip()
                if " - " in desc:
                    artist, title = desc.split(" - ", 1)
                    nt = normalize_basic(title)
                    if nt and nt not in daily_by_title:
                        daily_by_title[nt] = {
                            "artist": clean_display_title(artist),
                            "itunes_track_id": tid if tid.isdigit() else None,
                        }
                    elif nt and nt not in extra_artist_by_title:
                        extra_artist_by_title[nt] = clean_display_title(artist)

        # 1f. Favorites
        favorites_rows: list[tuple] = []
        fav_entry = _find_zip_entry(zf, "Apple Music - Favorites.csv")
        if fav_entry:
            text = zf.read(fav_entry).decode("utf-8-sig", errors="replace")
            for row in csv.DictReader(io.StringIO(text)):
                favorites_rows.append(
                    (
                        (row.get("Favorite Type") or "").strip(),
                        (row.get("Item Reference") or "").strip(),
                        clean_display_title(row.get("Item Description")),
                        (row.get("Last Modified") or "").strip(),
                        (row.get("Preference") or "").strip(),
                    )
                )

        # ------------------------------------------------------------------
        # 2. Parse Apple Music Play Activity.csv (PLAY_END AUDIO + LYRIC_DISPLAY)
        # ------------------------------------------------------------------
        pa_entry = _find_zip_entry(zf, "Apple Music Play Activity.csv")
        if not pa_entry:
            raise ValueError("Fichier 'Apple Music Play Activity.csv' introuvable dans l'archive ZIP.")

        tracks_catalog: dict[str, dict[str, Any]] = {}
        play_events_raw: list[dict[str, Any]] = []
        lyric_events_rows: list[tuple] = []
        total_raw_rows = 0

        def ensure_track(song: str, album: str) -> str:
            tkey = make_track_key(song, album)
            if tkey in tracks_catalog:
                return tkey

            ns = normalize_basic(song)
            na = normalize_basic(album)
            gs = clean_group_key(song)

            artist = None
            genre = None
            release_year = None
            release_date = None
            itunes_track_id = None

            # Pass 1 resolution priority:
            # 1. Exact (title, album) in Library Tracks
            hit = lib_by_title_album.get((ns, na))
            if not hit:
                hit = lib_by_title.get(ns) or lib_by_group_title.get(gs)

            if hit:
                artist = hit.get("artist")
                genre = hit.get("genre")
                release_year = hit.get("release_year")
                release_date = hit.get("release_date")
                itunes_track_id = hit.get("itunes_track_id")

            # 2. Daily Tracks / Recently Played (also gives itunes_track_id)
            daily_hit = daily_by_title.get(ns)
            if daily_hit:
                if not artist:
                    artist = daily_hit.get("artist")
                if not itunes_track_id:
                    itunes_track_id = daily_hit.get("itunes_track_id")

            # 3. Track Play History
            if not artist:
                artist = extra_artist_by_title.get(ns)

            disp_artist = primary_artist_name(artist) if artist else None
            tracks_catalog[tkey] = {
                "track_key": tkey,
                "song_name": song,
                "song_norm": ns,
                "song_group_key": clean_group_key(song, strip_feat=True) or gs or ns,
                "album_name": album,
                "album_norm": na,
                "album_group_key": clean_group_key(album) or na,
                "artist_name": disp_artist,
                "artist_norm": normalize_basic(disp_artist) if disp_artist else None,
                "artist_group_key": clean_group_key(disp_artist) if disp_artist else None,
                "itunes_track_id": itunes_track_id,
                "genre": genre,
                "release_year": release_year,
                "release_date": release_date,
                "artwork_url": None,
                "preview_url": None,
                "total_plays": 0,
                "total_ms": 0,
                "duration_ms": 0,
                "first_played_local": None,
                "enrichment_status": "local_only",
                "enrichment_source": "pass1_local" if disp_artist else None,
                "enriched_at": None,
            }
            return tkey

        pa_info = zf.getinfo(pa_entry)
        pa_size = max(1, pa_info.file_size)
        if progress_cb:
            progress_cb("parsing", 16, "Lecture de Apple Music Play Activity.csv…")

        with zf.open(pa_entry) as raw_f:
            text_f = io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")
            reader = csv.reader(text_f)
            header = next(reader, None)
            if not header:
                header = []
            col_idx = {h: idx for idx, h in enumerate(header)}

            def _get(r: list[str], name: str) -> str:
                i = col_idx.get(name)
                return r[i] if (i is not None and i < len(r)) else ""

            i_etype = col_idx.get("Event Type")
            i_mtype = col_idx.get("Media Type")
            i_song = col_idx.get("Song Name")
            i_album = col_idx.get("Album Name")
            i_calbum = col_idx.get("Container Album Name")
            i_pms = col_idx.get("Play Duration Milliseconds")
            i_mms = col_idx.get("Media Duration In Milliseconds")
            i_estart = col_idx.get("Event Start Timestamp")
            i_eend = col_idx.get("Event End Timestamp")
            i_utc = col_idx.get("UTC Offset In Seconds")
            i_dos = col_idx.get("Device OS Name")
            i_bver = col_idx.get("Build Version")
            i_cdev = col_idx.get("Client Device Name")
            i_stype = col_idx.get("Source Type")
            i_did = col_idx.get("Device Identifier")
            i_dtype = col_idx.get("Display Type")
            i_dlang = col_idx.get("Display Language")
            i_trans = col_idx.get("Translation Displayed")
            i_pron = col_idx.get("Pronunciation Displayed")
            i_evid = col_idx.get("Event ID")
            i_endr = col_idx.get("End Reason Type")
            i_ctype = col_idx.get("Container Type")
            i_corig = col_idx.get("Container Origin Type")
            i_fname = col_idx.get("Feature Name")
            i_off = col_idx.get("Offline")
            i_auto = col_idx.get("Auto Play")
            i_shuf = col_idx.get("Shuffle Play")
            i_rep = col_idx.get("Repeat Play")
            i_aq = col_idx.get("User's Audio Quality")
            i_pfmt = col_idx.get("Provided Playback Format")
            pid_indices = [
                col_idx[c]
                for c in ("Container iTunes Playlist ID", "Container Global Playlist ID", "Container ID")
                if c in col_idx
            ]

            for row in reader:
                total_raw_rows += 1
                if progress_cb and total_raw_rows % 2500 == 0:
                    try:
                        frac = min(1.0, raw_f.tell() / pa_size)
                    except Exception:
                        frac = 0.5
                    pct = 16 + int(34 * frac)
                    progress_cb(
                        "parsing",
                        pct,
                        f"Analyse Play Activity ({total_raw_rows:,} lignes · {len(play_events_raw):,} écoutes)…".replace(",", " "),
                    )

                rlen = len(row)
                event_type = row[i_etype].strip() if (i_etype is not None and i_etype < rlen) else ""
                if event_type != "PLAY_END" and event_type != "LYRIC_DISPLAY":
                    continue
                if event_type == "PLAY_END":
                    media_type = row[i_mtype].strip() if (i_mtype is not None and i_mtype < rlen) else ""
                    if media_type != "AUDIO":
                        continue

                song_raw = row[i_song] if (i_song is not None and i_song < rlen) else ""
                song = clean_display_title(song_raw)
                if not song:
                    continue
                album_raw = (row[i_album] if (i_album is not None and i_album < rlen) else "") or (
                    row[i_calbum] if (i_calbum is not None and i_calbum < rlen) else ""
                )
                album = clean_display_title(album_raw)

                play_ms = max(0, _parse_int(row[i_pms] if (i_pms is not None and i_pms < rlen) else None, 0))
                media_ms = max(0, _parse_int(row[i_mms] if (i_mms is not None and i_mms < rlen) else None, 0))

                # Strictly Event Start Timestamp, fallback Event End - Play Duration (NEVER Event Received)
                start_utc = _parse_iso_utc(row[i_estart] if (i_estart is not None and i_estart < rlen) else None)
                if start_utc is None:
                    end_utc = _parse_iso_utc(row[i_eend] if (i_eend is not None and i_eend < rlen) else None)
                    if end_utc is not None:
                        start_utc = end_utc - timedelta(milliseconds=play_ms)
                if start_utc is None:
                    continue

                utc_offset_sec = _parse_int(row[i_utc] if (i_utc is not None and i_utc < rlen) else None, 3600)
                local_dt = start_utc + timedelta(seconds=utc_offset_sec)
                started_at_utc = start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
                started_at_local = local_dt.strftime("%Y-%m-%dT%H:%M:%S")
                local_date = started_at_local[:10]
                local_year = local_dt.year
                local_month = started_at_local[:7]
                local_month_num = local_dt.month
                local_season = _season_for_month(local_month_num)
                local_dow = local_dt.weekday()  # 0=Mon .. 6=Sun
                local_hour = local_dt.hour
                started_epoch = int(start_utc.timestamp())

                device_os = row[i_dos].strip() if (i_dos is not None and i_dos < rlen) else ""
                build_version = row[i_bver].strip() if (i_bver is not None and i_bver < rlen) else ""
                client_device = row[i_cdev].strip() if (i_cdev is not None and i_cdev < rlen) else ""
                source_type = row[i_stype].strip() if (i_stype is not None and i_stype < rlen) else ""
                device_id = row[i_did].strip() if (i_did is not None and i_did < rlen) else ""
                device_label = _resolve_device_label(
                    device_os, build_version, client_device, source_type, device_id, device_map
                )

                tkey = ensure_track(song, album)

                if event_type == "LYRIC_DISPLAY":
                    lyric_events_rows.append(
                        (
                            tkey,
                            started_at_utc,
                            started_at_local,
                            local_date,
                            local_year,
                            local_month,
                            (row[i_dtype].strip() if (i_dtype is not None and i_dtype < rlen) else "") or None,
                            (row[i_dlang].strip() if (i_dlang is not None and i_dlang < rlen) else "") or None,
                            1 if (i_trans is not None and i_trans < rlen and row[i_trans].strip().lower() == "true") else 0,
                            1 if (i_pron is not None and i_pron < rlen and row[i_pron].strip().lower() == "true") else 0,
                            device_label,
                            profile_id,
                        )
                    )
                    continue

                # PLAY_END AUDIO
                # Cap abnormal play_ms > media_ms * 1.5 if media_ms > 0 (rare Apple telemetry glitch)
                effective_ms = play_ms
                if media_ms > 0 and effective_ms > int(media_ms * 1.25):
                    effective_ms = media_ms

                comp_ratio = (effective_ms / media_ms) if media_ms > 0 else (1.0 if effective_ms >= 30000 else 0.0)
                comp_ratio = min(1.0, max(0.0, comp_ratio))

                # Last.fm rule: >= 30s AND (>= 50% OR >= 4 min)
                is_valid_lastfm = 1 if (effective_ms >= 30000 and (comp_ratio >= 0.5 or effective_ms >= 240000)) else 0
                is_skip_30s = 1 if effective_ms < 30000 else 0

                # Resolve playlist name if container is playlist
                pl_name = None
                for pid_i in pid_indices:
                    if pid_i < rlen:
                        pid = row[pid_i].strip()
                        if pid and pid in playlist_map:
                            pl_name = playlist_map[pid]
                            break

                play_events_raw.append(
                    {
                        "event_id": row[i_evid].strip() if (i_evid is not None and i_evid < rlen) else "",
                        "track_key": tkey,
                        "started_at_utc": started_at_utc,
                        "started_at_local": started_at_local,
                        "started_epoch": started_epoch,
                        "local_date": local_date,
                        "local_year": local_year,
                        "local_month": local_month,
                        "local_month_num": local_month_num,
                        "local_season": local_season,
                        "local_dow": local_dow,
                        "local_hour": local_hour,
                        "utc_offset_sec": utc_offset_sec,
                        "play_duration_ms": effective_ms,
                        "media_duration_ms": media_ms,
                        "completion_ratio": round(comp_ratio, 4),
                        "end_reason_type": (row[i_endr].strip() if (i_endr is not None and i_endr < rlen) else "") or "UNKNOWN",
                        "is_valid_lastfm": is_valid_lastfm,
                        "is_skip_30s": is_skip_30s,
                        "container_type": (row[i_ctype].strip() if (i_ctype is not None and i_ctype < rlen) else "") or "UNKNOWN",
                        "container_origin_type": (row[i_corig].strip() if (i_corig is not None and i_corig < rlen) else "") or None,
                        "playlist_name": pl_name,
                        "feature_name": (row[i_fname].strip() if (i_fname is not None and i_fname < rlen) else "") or None,
                        "device_label": device_label,
                        "device_os": device_os or "Inconnu",
                        "source_type": source_type or "ORIGINATING_DEVICE",
                        "offline": 1 if (i_off is not None and i_off < rlen and row[i_off].strip().lower() == "true") else 0,
                        "auto_play": (row[i_auto].strip() if (i_auto is not None and i_auto < rlen) else "") or None,
                        "shuffle_play": (row[i_shuf].strip() if (i_shuf is not None and i_shuf < rlen) else "") or None,
                        "repeat_play": (row[i_rep].strip() if (i_rep is not None and i_rep < rlen) else "") or None,
                        "audio_quality": (row[i_aq].strip() if (i_aq is not None and i_aq < rlen) else "") or None,
                        "playback_format": (row[i_pfmt].strip() if (i_pfmt is not None and i_pfmt < rlen) else "") or None,
                        "profile_id": profile_id,
                    }
                )

                tc = tracks_catalog[tkey]
                tc["total_plays"] += 1
                tc["total_ms"] += effective_ms
                if media_ms > tc["duration_ms"]:
                    tc["duration_ms"] = media_ms
                if tc["first_played_local"] is None or started_at_local < tc["first_played_local"]:
                    tc["first_played_local"] = started_at_local

        # ------------------------------------------------------------------
        # 3. Sort chronologically & reconstruct listening sessions (< 30 min gap)
        # ------------------------------------------------------------------
        if progress_cb:
            progress_cb("parsing", 52, "Reconstruction des sessions d'écoute…")
        play_events_raw.sort(key=lambda e: e["started_epoch"])
        session_id = 0
        prev_end_epoch: int | None = None
        for ev in play_events_raw:
            start_ep = ev["started_epoch"]
            if prev_end_epoch is None or (start_ep - prev_end_epoch) > SESSION_GAP_SECONDS:
                session_id += 1
            ev["session_id"] = session_id
            prev_end_epoch = max(prev_end_epoch or 0, start_ep + (ev["play_duration_ms"] // 1000))

        # ------------------------------------------------------------------
        # 4. Stream Apple Music Click Activity.csv for deduplicated Search History
        # ------------------------------------------------------------------
        search_events_rows: list[tuple] = []
        click_entry = _find_zip_entry(zf, "Apple Music Click Activity.csv")
        if click_entry:
            click_info = zf.getinfo(click_entry)
            click_size = max(1, click_info.file_size)
            if progress_cb:
                progress_cb("parsing", 55, "Extraction de l'historique de recherche (Click Activity)…")
            raw_searches: list[tuple[int, str, str, str, str]] = []
            with zf.open(click_entry) as raw_f:
                text_f = io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")
                reader = csv.reader(text_f)
                c_header = next(reader, None) or []
                c_idx = {h: idx for idx, h in enumerate(c_header)}
                i_term = c_idx.get("Search Term")
                i_dt1 = c_idx.get("Event Date Time")
                i_dt2 = c_idx.get("Event Start Timestamp")
                i_tz = c_idx.get("Client Timezone Offset")
                i_cdos = c_idx.get("Device OS Name")

                if i_term is not None:
                    click_rows = 0
                    for row in reader:
                        click_rows += 1
                        if progress_cb and click_rows % 15000 == 0:
                            try:
                                frac = min(1.0, raw_f.tell() / click_size)
                            except Exception:
                                frac = 0.5
                            pct = 55 + int(22 * frac)
                            progress_cb(
                                "parsing",
                                pct,
                                f"Analyse Click Activity ({click_rows:,} lignes · {len(raw_searches):,} recherches)…".replace(",", " "),
                            )
                        rlen = len(row)
                        if i_term >= rlen:
                            continue
                        term_raw = row[i_term]
                        if not term_raw:
                            continue
                        term = term_raw.strip()
                        if len(term) < 2:
                            continue
                        dt_raw = (row[i_dt1] if (i_dt1 is not None and i_dt1 < rlen) else "") or (
                            row[i_dt2] if (i_dt2 is not None and i_dt2 < rlen) else ""
                        )
                        dt_utc = _parse_iso_utc(dt_raw)
                        if dt_utc is None:
                            continue
                        tz_raw = _parse_int(row[i_tz] if (i_tz is not None and i_tz < rlen) else None, 3600)
                        if -86400 <= tz_raw <= 86400 and abs(tz_raw) <= 720:
                            tz_sec = tz_raw * 60
                        elif -86400 <= tz_raw <= 86400:
                            tz_sec = tz_raw
                        else:
                            tz_sec = 3600
                        loc_dt = dt_utc + timedelta(seconds=tz_sec)
                        dos = (row[i_cdos].strip() if (i_cdos is not None and i_cdos < rlen) else "") or "Inconnu"
                        raw_searches.append(
                            (
                                int(dt_utc.timestamp()),
                                dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                loc_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                                term,
                                dos,
                            )
                        )

            # Sort chronologically and collapse autocomplete prefix bursts within 25 seconds
            raw_searches.sort(key=lambda x: x[0])
            deduped: list[tuple[int, str, str, str, str]] = []
            for item in raw_searches:
                ep, utc_s, loc_s, term, dos = item
                tnorm = normalize_basic(term)
                if not tnorm:
                    continue
                if deduped:
                    prev_ep, _, _, prev_term, _ = deduped[-1]
                    prev_norm = normalize_basic(prev_term)
                    if ep - prev_ep <= 25:
                        if tnorm == prev_norm:
                            continue
                        if tnorm.startswith(prev_norm):
                            # User kept typing -> replace shorter prefix with fuller query
                            deduped[-1] = item
                            continue
                        if prev_norm.startswith(tnorm):
                            # Backspace right after full query -> keep fuller query
                            continue
                deduped.append(item)

            for ep, utc_s, loc_s, term, dos in deduped:
                ldate = loc_s[:10]
                lyear = int(loc_s[:4])
                lmonth = loc_s[:7]
                search_events_rows.append(
                    (term, normalize_basic(term), utc_s, loc_s, ldate, lyear, lmonth, dos, profile_id)
                )

    # ------------------------------------------------------------------
    # 5. Persist everything into SQLite (preserving enrichment_cache & other platforms!)
    # ------------------------------------------------------------------
    if progress_cb:
        progress_cb("persisting", 79, f"Enregistrement SQLite ({len(play_events_raw):,} écoutes Apple Music)…".replace(",", " "))
    total_plays = len(play_events_raw)
    artist_resolved = sum(
        1 for ev in play_events_raw if tracks_catalog[ev["track_key"]]["artist_name"]
    )
    gy_resolved = sum(
        1
        for ev in play_events_raw
        if tracks_catalog[ev["track_key"]]["genre"] and tracks_catalog[ev["track_key"]]["release_year"]
    )
    pass1_artist_pct = round((artist_resolved / total_plays * 100.0), 2) if total_plays else 0.0
    pass1_gy_pct = round((gy_resolved / total_plays * 100.0), 2) if total_plays else 0.0
    min_date = play_events_raw[0]["local_date"] if play_events_raw else None
    max_date = play_events_raw[-1]["local_date"] if play_events_raw else None

    with db_session() as conn:
        # Load existing enrichment_cache before overwriting tracks_catalog
        cache_by_key: dict[str, dict[str, Any]] = {}
        for r in conn.execute("SELECT * FROM enrichment_cache"):
            cache_by_key[r["cache_key"]] = dict(r)

        # Apply cached enrichment immediately to tracks_catalog
        for tkey, tc in tracks_catalog.items():
            cached = None
            if tc["itunes_track_id"] and f"id:{tc['itunes_track_id']}" in cache_by_key:
                cached = cache_by_key[f"id:{tc['itunes_track_id']}"]
            elif f"key:{tkey}" in cache_by_key:
                cached = cache_by_key[f"key:{tkey}"]

            if cached:
                if cached.get("artist_name") and not tc["artist_name"]:
                    disp = primary_artist_name(cached["artist_name"])
                    tc["artist_name"] = disp
                    tc["artist_norm"] = normalize_basic(disp)
                    tc["artist_group_key"] = clean_group_key(disp)
                if cached.get("genre") and not tc["genre"]:
                    tc["genre"] = cached["genre"]
                if cached.get("release_year") and not tc["release_year"]:
                    tc["release_year"] = cached["release_year"]
                    tc["release_date"] = cached.get("release_date")
                if cached.get("artwork_url"):
                    tc["artwork_url"] = cached["artwork_url"]
                if cached.get("preview_url"):
                    tc["preview_url"] = cached["preview_url"]
                if cached.get("itunes_track_id") and not tc["itunes_track_id"]:
                    tc["itunes_track_id"] = cached["itunes_track_id"]
                tc["enrichment_status"] = cached.get("status") or "enriched"
                tc["enrichment_source"] = cached.get("source")
                tc["enriched_at"] = cached.get("updated_at")

        # Preserve ONLY true live scrobbles (ListenBrainz / Last.fm / SMTC / Receiver) — NEVER touch Spotify/YouTube/Deezer/TIDAL RGPD events!
        live_placeholders = ",".join("?" for _ in _LIVE_SCROBBLE_PROVIDERS)
        live_rows = conn.execute(
            f"""
            SELECT pe.*, tc.song_name, tc.artist_name, tc.album_name, tc.artwork_url
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            WHERE pe.source_provider IN ({live_placeholders})
              AND COALESCE(pe.profile_id, 1) = ?
            """,
            (*_LIVE_SCROBBLE_PROVIDERS, profile_id),
        ).fetchall()

        # Replace ONLY Apple Music rows for this profile (keeps Spotify & other platforms intact!)
        conn.execute(
            f"DELETE FROM play_events WHERE (COALESCE(source_provider, 'apple_rgpd_zip') = 'apple_rgpd_zip' OR source_provider IN ({live_placeholders})) AND COALESCE(profile_id, 1) = ?",
            (*_LIVE_SCROBBLE_PROVIDERS, profile_id),
        )
        conn.execute("DELETE FROM lyric_events WHERE COALESCE(profile_id, 1) = ?", (profile_id,))
        conn.execute("DELETE FROM search_events WHERE COALESCE(profile_id, 1) = ?", (profile_id,))
        conn.execute("DELETE FROM favorites WHERE COALESCE(profile_id, 1) = ?", (profile_id,))

        conn.executemany(
            """
            INSERT INTO tracks_catalog (
                track_key, song_name, song_norm, song_group_key,
                album_name, album_norm, album_group_key,
                artist_name, artist_norm, artist_group_key,
                itunes_track_id, genre, release_year, release_date,
                artwork_url, preview_url, total_plays, total_ms, duration_ms,
                first_played_local, enrichment_status, enrichment_source, enriched_at
            ) VALUES (
                :track_key, :song_name, :song_norm, :song_group_key,
                :album_name, :album_norm, :album_group_key,
                :artist_name, :artist_norm, :artist_group_key,
                :itunes_track_id, :genre, :release_year, :release_date,
                :artwork_url, :preview_url, :total_plays, :total_ms, :duration_ms,
                :first_played_local, :enrichment_status, :enrichment_source, :enriched_at
            )
            ON CONFLICT(track_key) DO UPDATE SET
                artist_name = COALESCE(tracks_catalog.artist_name, excluded.artist_name),
                artist_norm = COALESCE(tracks_catalog.artist_norm, excluded.artist_norm),
                artist_group_key = COALESCE(tracks_catalog.artist_group_key, excluded.artist_group_key),
                itunes_track_id = COALESCE(tracks_catalog.itunes_track_id, excluded.itunes_track_id),
                genre = COALESCE(tracks_catalog.genre, excluded.genre),
                release_year = COALESCE(tracks_catalog.release_year, excluded.release_year),
                release_date = COALESCE(tracks_catalog.release_date, excluded.release_date),
                artwork_url = COALESCE(tracks_catalog.artwork_url, excluded.artwork_url),
                preview_url = COALESCE(tracks_catalog.preview_url, excluded.preview_url),
                total_plays = tracks_catalog.total_plays + excluded.total_plays,
                total_ms = tracks_catalog.total_ms + excluded.total_ms,
                duration_ms = MAX(COALESCE(tracks_catalog.duration_ms, 0), COALESCE(excluded.duration_ms, 0)),
                first_played_local = MIN(COALESCE(tracks_catalog.first_played_local, excluded.first_played_local), excluded.first_played_local)
            """,
            list(tracks_catalog.values()),
        )

        # Populate canonical_track_key & source metadata for V3 Continuum reconciliation
        for ev in play_events_raw:
            tc_meta = tracks_catalog.get(ev["track_key"]) or {}
            s_gk = tc_meta.get("song_group_key") or ""
            a_gk = tc_meta.get("artist_group_key") or ""
            ev["canonical_track_key"] = f"{s_gk}||{a_gk}"
            ev["source_provider"] = "apple_rgpd_zip"
            ev["source_priority"] = 100
            ev["duration_is_estimated"] = 0

        conn.executemany(
            """
            INSERT INTO play_events (
                event_id, track_key, started_at_utc, started_at_local, started_epoch,
                local_date, local_year, local_month, local_month_num, local_season,
                local_dow, local_hour, utc_offset_sec,
                play_duration_ms, media_duration_ms, completion_ratio,
                end_reason_type, is_valid_lastfm, is_skip_30s,
                container_type, container_origin_type, playlist_name, feature_name,
                device_label, device_os, source_type, offline,
                auto_play, shuffle_play, repeat_play, audio_quality, playback_format,
                session_id, source_provider, source_priority, canonical_track_key, duration_is_estimated,
                profile_id
            ) VALUES (
                :event_id, :track_key, :started_at_utc, :started_at_local, :started_epoch,
                :local_date, :local_year, :local_month, :local_month_num, :local_season,
                :local_dow, :local_hour, :utc_offset_sec,
                :play_duration_ms, :media_duration_ms, :completion_ratio,
                :end_reason_type, :is_valid_lastfm, :is_skip_30s,
                :container_type, :container_origin_type, :playlist_name, :feature_name,
                :device_label, :device_os, :source_type, :offline,
                :auto_play, :shuffle_play, :repeat_play, :audio_quality, :playback_format,
                :session_id, :source_provider, :source_priority, :canonical_track_key, :duration_is_estimated,
                :profile_id
            )
            """,
            play_events_raw,
        )

        if lyric_events_rows:
            conn.executemany(
                """
                INSERT INTO lyric_events (
                    track_key, started_at_utc, started_at_local, local_date,
                    local_year, local_month, display_type, display_language,
                    translation_displayed, pronunciation_displayed, device_label, profile_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                lyric_events_rows,
            )

        if search_events_rows:
            conn.executemany(
                """
                INSERT INTO search_events (
                    query, query_norm, searched_at_utc, searched_at_local,
                    local_date, local_year, local_month, device_os, profile_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                search_events_rows,
            )

        if favorites_rows:
            conn.executemany(
                """
                INSERT INTO favorites (
                    favorite_type, item_reference, item_description, last_modified, preference, profile_id
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [(*r, profile_id) for r in favorites_rows],
            )

        # Rebuild SQLite FTS5 indexes (unicode61 accent-insensitive + trigram)
        if progress_cb:
            progress_cb("indexing", 89, "Mise à jour de l'index plein-texte FTS5…")
        from .db import rebuild_fts_indexes

        rebuild_fts_indexes(conn)

        # Reconcile previously synced live scrobbles against the fresh authoritative ZIP
        if live_rows:
            from .continuum.reconciler import IncomingScrobble, reconcile_scrobble

            for lr in live_rows:
                reconcile_scrobble(
                    conn,
                    IncomingScrobble(
                        source_provider=lr["source_provider"],
                        song_name=lr["song_name"],
                        artist_name=lr["artist_name"] or "Artiste inconnu",
                        album_name=lr["album_name"] or "",
                        started_epoch=int(lr["started_epoch"]),
                        play_duration_ms=int(lr["play_duration_ms"]) if not lr["duration_is_estimated"] else None,
                        media_duration_ms=int(lr["media_duration_ms"]) if lr["media_duration_ms"] else None,
                        source_event_id=lr["source_event_id"],
                        device_label=lr["device_label"],
                        device_os=lr["device_os"],
                        utc_offset_sec=int(lr["utc_offset_sec"] or 3600),
                        artwork_url=lr["artwork_url"],
                    ),
                )

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        final_plays = conn.execute("SELECT COUNT(*) FROM play_events").fetchone()[0]
        final_tracks = conn.execute("SELECT COUNT(*) FROM tracks_catalog").fetchone()[0]
        conn.execute(
            """
            INSERT OR REPLACE INTO import_meta (
                id, zip_filename, zip_sha256, imported_at,
                total_raw_rows, total_play_events, total_lyric_events,
                total_search_events, unique_tracks,
                pass1_artist_pct, pass1_genre_year_pct, min_date, max_date
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                zip_name,
                zip_sha,
                now_iso,
                total_raw_rows,
                final_plays,
                len(lyric_events_rows),
                len(search_events_rows),
                final_tracks,
                pass1_artist_pct,
                pass1_gy_pct,
                min_date,
                max_date,
            ),
        )

    # Export immutable Parquet snapshot for DuckDB + seed open-graph jobs
    if progress_cb:
        progress_cb("snapshot", 94, "Génération du snapshot analytique Parquet…")
    try:
        from .analytics.duckdb_engine import export_parquet_snapshot
        from .jobs.worker import job_worker

        export_parquet_snapshot()
        job_worker.seed_artist_graph_jobs(limit=120)
    except Exception:
        pass
    if progress_cb:
        progress_cb("done", 100, "Import Apple Music terminé.")

    return {
        "zip_filename": zip_name,
        "total_raw_rows": total_raw_rows,
        "total_play_events": final_plays,
        "total_lyric_events": len(lyric_events_rows),
        "total_search_events": len(search_events_rows),
        "unique_tracks": final_tracks,
        "pass1_artist_pct": pass1_artist_pct,
        "pass1_genre_year_pct": pass1_gy_pct,
        "min_date": min_date,
        "max_date": max_date,
    }
