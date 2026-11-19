import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

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


def ingest_zip(zip_path: Path, filename: str | None = None) -> dict[str, Any]:
    """Full Pass 1 ingestion from Apple Media Services information.zip into SQLite."""
    init_db()
    zip_sha = _compute_file_sha256(zip_path)
    zip_name = filename or zip_path.name

    with zipfile.ZipFile(zip_path, "r") as zf:
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
                "first_played_local": None,
                "enrichment_status": "local_only",
                "enrichment_source": "pass1_local" if disp_artist else None,
                "enriched_at": None,
            }
            return tkey

        with zf.open(pa_entry) as raw_f:
            text_f = io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")
            reader = csv.DictReader(text_f)
            for row in reader:
                total_raw_rows += 1
                event_type = (row.get("Event Type") or "").strip()
                media_type = (row.get("Media Type") or "").strip()

                if event_type not in ("PLAY_END", "LYRIC_DISPLAY"):
                    continue
                if event_type == "PLAY_END" and media_type != "AUDIO":
                    continue

                song = clean_display_title(row.get("Song Name"))
                album = clean_display_title(row.get("Album Name") or row.get("Container Album Name"))
                if not song:
                    continue

                play_ms = max(0, _parse_int(row.get("Play Duration Milliseconds"), 0))
                media_ms = max(0, _parse_int(row.get("Media Duration In Milliseconds"), 0))

                # Strictly Event Start Timestamp, fallback Event End - Play Duration (NEVER Event Received)
                start_utc = _parse_iso_utc(row.get("Event Start Timestamp"))
                if start_utc is None:
                    end_utc = _parse_iso_utc(row.get("Event End Timestamp"))
                    if end_utc is not None:
                        start_utc = end_utc - timedelta(milliseconds=play_ms)
                if start_utc is None:
                    continue

                utc_offset_sec = _parse_int(row.get("UTC Offset In Seconds"), 3600)
                local_dt = start_utc + timedelta(seconds=utc_offset_sec)
                started_at_utc = start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
                started_at_local = local_dt.strftime("%Y-%m-%dT%H:%M:%S")
                local_date = local_dt.strftime("%Y-%m-%d")
                local_year = local_dt.year
                local_month = local_dt.strftime("%Y-%m")
                local_month_num = local_dt.month
                local_season = _season_for_month(local_month_num)
                local_dow = local_dt.weekday()  # 0=Mon .. 6=Sun
                local_hour = local_dt.hour
                started_epoch = int(start_utc.timestamp())

                device_os = (row.get("Device OS Name") or "").strip()
                build_version = (row.get("Build Version") or "").strip()
                client_device = (row.get("Client Device Name") or "").strip()
                source_type = (row.get("Source Type") or "").strip()
                device_id = (row.get("Device Identifier") or "").strip()
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
                            (row.get("Display Type") or "").strip() or None,
                            (row.get("Display Language") or "").strip() or None,
                            1 if (row.get("Translation Displayed") or "").strip().lower() == "true" else 0,
                            1 if (row.get("Pronunciation Displayed") or "").strip().lower() == "true" else 0,
                            device_label,
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
                for pid_col in ("Container iTunes Playlist ID", "Container Global Playlist ID", "Container ID"):
                    pid = (row.get(pid_col) or "").strip()
                    if pid and pid in playlist_map:
                        pl_name = playlist_map[pid]
                        break

                play_events_raw.append(
                    {
                        "event_id": (row.get("Event ID") or "").strip(),
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
                        "end_reason_type": (row.get("End Reason Type") or "").strip() or "UNKNOWN",
                        "is_valid_lastfm": is_valid_lastfm,
                        "is_skip_30s": is_skip_30s,
                        "container_type": (row.get("Container Type") or "").strip() or "UNKNOWN",
                        "container_origin_type": (row.get("Container Origin Type") or "").strip() or None,
                        "playlist_name": pl_name,
                        "feature_name": (row.get("Feature Name") or "").strip() or None,
                        "device_label": device_label,
                        "device_os": device_os or "Inconnu",
                        "source_type": source_type or "ORIGINATING_DEVICE",
                        "offline": 1 if (row.get("Offline") or "").strip().lower() == "true" else 0,
                        "auto_play": (row.get("Auto Play") or "").strip() or None,
                        "shuffle_play": (row.get("Shuffle Play") or "").strip() or None,
                        "repeat_play": (row.get("Repeat Play") or "").strip() or None,
                        "audio_quality": (row.get("User's Audio Quality") or "").strip() or None,
                        "playback_format": (row.get("Provided Playback Format") or "").strip() or None,
                    }
                )

                tc = tracks_catalog[tkey]
                tc["total_plays"] += 1
                tc["total_ms"] += effective_ms
                if tc["first_played_local"] is None or started_at_local < tc["first_played_local"]:
                    tc["first_played_local"] = started_at_local

        # ------------------------------------------------------------------
        # 3. Sort chronologically & reconstruct listening sessions (< 30 min gap)
        # ------------------------------------------------------------------
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
            raw_searches: list[tuple[int, str, str, str, str]] = []
            with zf.open(click_entry) as raw_f:
                text_f = io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")
                reader = csv.DictReader(text_f)
                for row in reader:
                    term = (row.get("Search Term") or "").strip()
                    if not term or len(term) < 2:
                        continue
                    dt_utc = _parse_iso_utc(row.get("Event Date Time") or row.get("Event Start Timestamp"))
                    if dt_utc is None:
                        continue
                    # Client Timezone Offset in Click Activity is usually minutes or seconds; fallback +3600/+7200
                    tz_raw = _parse_int(row.get("Client Timezone Offset"), 3600)
                    if -86400 <= tz_raw <= 86400 and abs(tz_raw) <= 720:
                        tz_sec = tz_raw * 60
                    elif -86400 <= tz_raw <= 86400:
                        tz_sec = tz_raw
                    else:
                        tz_sec = 3600
                    loc_dt = dt_utc + timedelta(seconds=tz_sec)
                    dos = (row.get("Device OS Name") or "").strip() or "Inconnu"
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
                    (term, normalize_basic(term), utc_s, loc_s, ldate, lyear, lmonth, dos)
                )

    # ------------------------------------------------------------------
    # 5. Persist everything into SQLite (preserving enrichment_cache!)
    # ------------------------------------------------------------------
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

        # Replace transient tables
        conn.execute("DELETE FROM play_events")
        conn.execute("DELETE FROM lyric_events")
        conn.execute("DELETE FROM search_events")
        conn.execute("DELETE FROM favorites")
        conn.execute("DELETE FROM tracks_catalog")

        conn.executemany(
            """
            INSERT INTO tracks_catalog (
                track_key, song_name, song_norm, song_group_key,
                album_name, album_norm, album_group_key,
                artist_name, artist_norm, artist_group_key,
                itunes_track_id, genre, release_year, release_date,
                artwork_url, preview_url, total_plays, total_ms,
                first_played_local, enrichment_status, enrichment_source, enriched_at
            ) VALUES (
                :track_key, :song_name, :song_norm, :song_group_key,
                :album_name, :album_norm, :album_group_key,
                :artist_name, :artist_norm, :artist_group_key,
                :itunes_track_id, :genre, :release_year, :release_date,
                :artwork_url, :preview_url, :total_plays, :total_ms,
                :first_played_local, :enrichment_status, :enrichment_source, :enriched_at
            )
            """,
            list(tracks_catalog.values()),
        )

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
                session_id
            ) VALUES (
                :event_id, :track_key, :started_at_utc, :started_at_local, :started_epoch,
                :local_date, :local_year, :local_month, :local_month_num, :local_season,
                :local_dow, :local_hour, :utc_offset_sec,
                :play_duration_ms, :media_duration_ms, :completion_ratio,
                :end_reason_type, :is_valid_lastfm, :is_skip_30s,
                :container_type, :container_origin_type, :playlist_name, :feature_name,
                :device_label, :device_os, :source_type, :offline,
                :auto_play, :shuffle_play, :repeat_play, :audio_quality, :playback_format,
                :session_id
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
                    translation_displayed, pronunciation_displayed, device_label
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                lyric_events_rows,
            )

        if search_events_rows:
            conn.executemany(
                """
                INSERT INTO search_events (
                    query, query_norm, searched_at_utc, searched_at_local,
                    local_date, local_year, local_month, device_os
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                search_events_rows,
            )

        if favorites_rows:
            conn.executemany(
                """
                INSERT INTO favorites (
                    favorite_type, item_reference, item_description, last_modified, preference
                ) VALUES (?, ?, ?, ?, ?)
                """,
                favorites_rows,
            )

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
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
                total_plays,
                len(lyric_events_rows),
                len(search_events_rows),
                len(tracks_catalog),
                pass1_artist_pct,
                pass1_gy_pct,
                min_date,
                max_date,
            ),
        )

    return {
        "zip_filename": zip_name,
        "total_raw_rows": total_raw_rows,
        "total_play_events": total_plays,
        "total_lyric_events": len(lyric_events_rows),
        "total_search_events": len(search_events_rows),
        "unique_tracks": len(tracks_catalog),
        "pass1_artist_pct": pass1_artist_pct,
        "pass1_genre_year_pct": pass1_gy_pct,
        "min_date": min_date,
        "max_date": max_date,
    }
