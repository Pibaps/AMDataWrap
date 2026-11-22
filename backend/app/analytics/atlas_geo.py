"""World Atlas of Artist Origins (MusicBrainz + Wikidata + Curated Seed)."""

from __future__ import annotations

import hashlib
from typing import Any

from ..db import db_session
from ..filters import FilterParams, build_where_clause, metric_order_sql
from ..jobs.worker import COUNTRY_CENTROIDS, CURATED_ARTIST_GEO


def get_world_atlas(f: FilterParams, limit: int = 150) -> dict[str, Any]:
    where, params = build_where_clause(f)
    order = metric_order_sql(f)
    with db_session() as conn:
        rows = conn.execute(
            f"""
            SELECT tc.artist_group_key AS artist_key, MAX(tc.artist_name) AS artist_name,
                   MAX(tc.genre) AS genre, MAX(tc.artwork_url) AS artwork_url,
                   COUNT(*) AS plays, SUM(pe.play_duration_ms) AS total_ms,
                   mb.mbid, mb.country_iso, mb.country_name, mb.area_name, mb.begin_area,
                   mb.lat, mb.lng, mb.source AS geo_source
            FROM play_events pe
            JOIN tracks_catalog tc ON tc.track_key = pe.track_key
            LEFT JOIN artist_musicbrainz mb ON mb.artist_group_key = tc.artist_group_key
            WHERE {where} AND tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
            GROUP BY tc.artist_group_key
            ORDER BY {order}
            LIMIT ?
            """,
            params + [limit],
        ).fetchall()

    home = {"label": "France (Vous)", "lat": 48.8566, "lng": 2.3522}
    nodes = []
    country_stats: dict[str, dict[str, Any]] = {}

    for r in rows:
        ak = r["artist_key"]
        lat, lng = r["lat"], r["lng"]
        iso = r["country_iso"]
        city = r["begin_area"] or r["area_name"]
        cname = r["country_name"]
        src = r["geo_source"]

        if lat is None or lng is None:
            if ak in CURATED_ARTIST_GEO:
                iso, city, lat, lng, _ = CURATED_ARTIST_GEO[ak]
                cname = COUNTRY_CENTROIDS.get(iso, (iso, lat, lng))[0]
                src = "curated_seed"
            else:
                g = (r["genre"] or "").lower()
                if "french" in g or "chanson" in g or "variété" in g:
                    iso = "FR"
                elif "k-pop" in g:
                    iso = "KR"
                elif "j-pop" in g or "anime" in g:
                    iso = "JP"
                elif "latin" in g or "reggaeton" in g:
                    iso = "PR"
                elif "afro" in g:
                    iso = "NG"
                elif "brit" in g:
                    iso = "GB"
                else:
                    continue
                cname, lat, lng = COUNTRY_CENTROIDS[iso]
                city = cname
                src = "inferred_genre"

        h = hashlib.md5(ak.encode("utf-8")).digest()
        j_lat = ((h[0] / 255.0) - 0.5) * 0.5
        j_lng = ((h[1] / 255.0) - 0.5) * 0.5

        hours = round(int(r["total_ms"] or 0) / 3_600_000.0, 2)
        nodes.append(
            {
                "artist_key": ak,
                "artist_name": r["artist_name"],
                "genre": r["genre"] or "Autre",
                "artwork_url": r["artwork_url"],
                "mbid": r["mbid"],
                "country_iso": iso,
                "country_name": cname or iso,
                "city": city or cname or "",
                "lat": round(float(lat) + j_lat, 4),
                "lng": round(float(lng) + j_lng, 4),
                "plays": int(r["plays"]),
                "hours": hours,
                "total_ms": int(r["total_ms"] or 0),
                "geo_source": src,
            }
        )
        if iso:
            if iso not in country_stats:
                country_stats[iso] = {
                    "country_iso": iso,
                    "country_name": cname or iso,
                    "artists": 0,
                    "plays": 0,
                    "hours": 0.0,
                }
            country_stats[iso]["artists"] += 1
            country_stats[iso]["plays"] += int(r["plays"])
            country_stats[iso]["hours"] = round(country_stats[iso]["hours"] + hours, 2)

    countries = sorted(country_stats.values(), key=lambda c: c["hours"], reverse=True)
    return {
        "home": home,
        "nodes": nodes,
        "countries": countries,
        "mapped_count": len(nodes),
        "total_considered": len(rows),
    }
