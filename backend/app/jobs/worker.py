"""Persistent SQLite `background_jobs` Worker & Open Music Graph Connectors (Phase 2).

Strict protocol guardrails (PDF p. 6, p. 8, p. 15):
- MusicBrainz WS/2: contactable `User-Agent: AMDataWrap/3.0 (https://github.com/Pibaps/AMDataWrap)`,
  strict `1 req/s` per IP, explicit `HTTP 503` (not 429) exponential backoff + jitter.
- Wikidata Entity API (NO slow SPARQL!): resolve exact QID from MusicBrainz `url-rels` via
  `wbgetentities` with `User-Agent`, `Accept-Encoding: gzip`, and `maxlag=5`.
- ListenBrainz MBID Mapper (`POST /1/metadata/lookup/`) & Popularity (`POST /1/popularity/artist`).
- Cover Art Archive: front + back covers (`back_cover_url`) & 250/500/1200 thumbnails (no rate limit).
- Discogs (60 req/min auth / 25 unauth) & Setlist.fm (2 req/s, 1440/day quota) optional connectors.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ..db import db_session
from ..normalize import clean_group_key

CONTACT_UA = "AMDataWrap/3.0 (https://github.com/Pibaps/AMDataWrap; contact@amdatawrap.local)"

# Per-provider minimum interval between requests (seconds)
PROVIDER_MIN_INTERVAL: dict[str, float] = {
    "musicbrainz": 1.15,  # Strict <= 1 req/s to avoid HTTP 503 ban
    "wikidata": 0.4,
    "listenbrainz": 0.3,
    "coverart": 0.1,
    "discogs": 1.05,  # 60 req/min auth
    "setlistfm": 0.55,  # 2 req/s, max 1440/day
}

# Country ISO -> (French display name, centroid lat, centroid lng) for instant geo projection
COUNTRY_CENTROIDS: dict[str, tuple[str, float, float]] = {
    "FR": ("France", 46.6034, 1.8883),
    "US": ("États-Unis", 39.8283, -98.5795),
    "GB": ("Royaume-Uni", 54.0, -2.5),
    "BE": ("Belgique", 50.8503, 4.3517),
    "CA": ("Canada", 56.1304, -106.3468),
    "DE": ("Allemagne", 51.1657, 10.4515),
    "JP": ("Japon", 36.2048, 138.2529),
    "KR": ("Corée du Sud", 35.9078, 127.7669),
    "SE": ("Suède", 60.1282, 18.6435),
    "AU": ("Australie", -25.2744, 133.7751),
    "IE": ("Irlande", 53.1424, -7.6921),
    "IT": ("Italie", 41.8719, 12.5674),
    "ES": ("Espagne", 40.4637, -3.7492),
    "NL": ("Pays-Bas", 52.1326, 5.2913),
    "CH": ("Suisse", 46.8182, 8.2275),
    "NO": ("Norvège", 60.4720, 8.4689),
    "IS": ("Islande", 64.9631, -19.0208),
    "BR": ("Brésil", -14.2350, -51.9253),
    "CO": ("Colombie", 4.5709, -74.2973),
    "PR": ("Porto Rico", 18.2208, -66.5901),
    "MX": ("Mexique", 23.6345, -102.5528),
    "JM": ("Jamaïque", 18.1096, -77.2975),
    "NG": ("Nigeria", 9.0820, 8.6753),
    "ZA": ("Afrique du Sud", -30.5595, 22.9375),
    "SN": ("Sénégal", 14.4974, -14.4524),
    "MA": ("Maroc", 31.7917, -7.0926),
    "DZ": ("Algérie", 28.0339, 1.6596),
    "NZ": ("Nouvelle-Zélande", -40.9006, 174.8860),
    "DK": ("Danemark", 56.2639, 9.5018),
    "FI": ("Finlande", 61.9241, 25.7482),
    "PT": ("Portugal", 39.3999, -8.2245),
    "AT": ("Autriche", 47.5162, 14.5501),
    "PL": ("Pologne", 51.9194, 19.1451),
    "AR": ("Argentine", -38.4161, -63.6167),
    "CL": ("Chili", -35.6751, -71.5430),
    "IN": ("Inde", 20.5937, 78.9629),
    "TW": ("Taïwan", 23.6978, 120.9605),
}

# Built-in curated seed for major French & international artists (immediate Atlas/Iceberg richness before live MB sync)
CURATED_ARTIST_GEO: dict[str, tuple[str, str, float, float, int]] = {
    # artist_group_key: (country_iso, city, lat, lng, approx_global_popularity_0_100)
    "daft punk": ("FR", "Paris", 48.8566, 2.3522, 95),
    "stromae": ("BE", "Bruxelles", 50.8503, 4.3517, 90),
    "angele": ("BE", "Bruxelles", 50.8503, 4.3517, 86),
    "damso": ("BE", "Bruxelles", 50.8503, 4.3517, 84),
    "hamza": ("BE", "Bruxelles", 50.8503, 4.3517, 80),
    "orelsan": ("FR", "Caen", 49.1829, -0.3707, 85),
    "nekfeu": ("FR", "Paris", 48.8566, 2.3522, 84),
    "pnl": ("FR", "Corbeil-Essonnes", 48.6139, 2.4820, 86),
    "ninho": ("FR", "Longjumeau", 48.6939, 2.2952, 85),
    "jul": ("FR", "Marseille", 43.2965, 5.3698, 86),
    "sch": ("FR", "Marseille", 43.2965, 5.3698, 83),
    "booba": ("FR", "Boulogne-Billancourt", 48.8397, 2.2399, 85),
    "laylow": ("FR", "Toulouse", 43.6047, 1.4442, 78),
    "lomepal": ("FR", "Paris", 48.8566, 2.3522, 80),
    "vald": ("FR", "Aulnay-sous-Bois", 48.9386, 2.4906, 78),
    "alpha wann": ("FR", "Paris", 48.8566, 2.3522, 74),
    "freeze corleone": ("FR", "Les Lilas", 48.8803, 2.4167, 75),
    "sdm": ("FR", "Clamart", 48.8014, 2.2628, 79),
    "tiakola": ("FR", "La Courneuve", 48.9322, 2.3967, 82),
    "gazo": ("FR", "Saint-Denis", 48.9362, 2.3574, 81),
    "wamp": ("FR", "Paris", 48.8566, 2.3522, 60),
    "wisp": ("US", "San Francisco", 37.7749, -122.4194, 70),
    "aya nakamura": ("FR", "Aulnay-sous-Bois", 48.9386, 2.4906, 88),
    "clara luciani": ("FR", "Martigues", 43.4053, 5.0475, 78),
    "pomme": ("FR", "Lyon", 45.7640, 4.8357, 74),
    "zaho de sagazan": ("FR", "Saint-Nazaire", 47.2735, -2.2137, 76),
    "phoenix": ("FR", "Versailles", 48.8049, 2.1204, 83),
    "justice": ("FR", "Paris", 48.8566, 2.3522, 84),
    "m83": ("FR", "Antibes", 43.5804, 7.1251, 82),
    "air": ("FR", "Versailles", 48.8049, 2.1204, 80),
    "l imperatrice": ("FR", "Paris", 48.8566, 2.3522, 74),
    "kavinsky": ("FR", "Seine-Saint-Denis", 48.9137, 2.4846, 80),
    "gesaffelstein": ("FR", "Lyon", 45.7640, 4.8357, 77),
    "the weeknd": ("CA", "Toronto", 43.6532, -79.3832, 99),
    "drake": ("CA", "Toronto", 43.6532, -79.3832, 99),
    "kaytranada": ("CA", "Montréal", 45.5017, -73.5673, 81),
    "charlotte cardin": ("CA", "Montréal", 45.5017, -73.5673, 76),
    "mac demarco": ("CA", "Edmonton", 53.5461, -113.4938, 82),
    "men i trust": ("CA", "Montréal", 45.5017, -73.5673, 76),
    "kendrick lamar": ("US", "Compton", 33.8958, -118.2201, 98),
    "kanye west": ("US", "Chicago", 41.8781, -87.6298, 98),
    "ye": ("US", "Chicago", 41.8781, -87.6298, 96),
    "travis scott": ("US", "Houston", 29.7604, -95.3698, 97),
    "tyler the creator": ("US", "Los Angeles", 34.0522, -118.2437, 94),
    "frank ocean": ("US", "New Orleans", 29.9511, -90.0715, 93),
    "sza": ("US", "St. Louis", 38.6270, -90.1994, 95),
    "billie eilish": ("US", "Los Angeles", 34.0522, -118.2437, 98),
    "taylor swift": ("US", "Nashville", 36.1627, -86.7816, 100),
    "lana del rey": ("US", "New York", 40.7128, -74.0060, 96),
    "playboi carti": ("US", "Atlanta", 33.7490, -84.3880, 93),
    "future": ("US", "Atlanta", 33.7490, -84.3880, 94),
    "metro boomin": ("US", "St. Louis", 38.6270, -90.1994, 92),
    "21 savage": ("US", "Atlanta", 33.7490, -84.3880, 93),
    "asap rocky": ("US", "New York", 40.7128, -74.0060, 91),
    "a ap rocky": ("US", "New York", 40.7128, -74.0060, 91),
    "j cole": ("US", "Fayetteville", 35.0527, -78.8784, 93),
    "eminem": ("US", "Detroit", 42.3314, -83.0458, 98),
    "mac miller": ("US", "Pittsburgh", 40.4406, -79.9959, 90),
    "kid cudi": ("US", "Cleveland", 41.4993, -81.6944, 89),
    "childish gambino": ("US", "Los Angeles", 34.0522, -118.2437, 89),
    "steve lacy": ("US", "Compton", 33.8958, -118.2201, 87),
    "deftones": ("US", "Sacramento", 38.5816, -121.4944, 88),
    "linkin park": ("US", "Los Angeles", 34.0522, -118.2437, 96),
    "nirvana": ("US", "Seattle", 47.6062, -122.3321, 95),
    "metallica": ("US", "Los Angeles", 34.0522, -118.2437, 95),
    "red hot chili peppers": ("US", "Los Angeles", 34.0522, -118.2437, 94),
    "the strokes": ("US", "New York", 40.7128, -74.0060, 89),
    "the neighbourhood": ("US", "Newbury Park", 34.1842, -118.9101, 91),
    "cigarettes after sex": ("US", "El Paso", 31.7619, -106.4850, 90),
    "olivia rodrigo": ("US", "Los Angeles", 34.0522, -118.2437, 95),
    "sabrina carpenter": ("US", "Quakertown", 40.4418, -75.3416, 96),
    "chappell roan": ("US", "Willard", 37.3050, -93.4285, 92),
    "clairo": ("US", "Atlanta", 33.7490, -84.3880, 86),
    "kali uchis": ("US", "Alexandria", 38.8048, -77.0469, 89),
    "don toliver": ("US", "Houston", 29.7604, -95.3698, 90),
    "lil uzi vert": ("US", "Philadelphia", 39.9526, -75.1652, 91),
    "gunna": ("US", "College Park", 33.6534, -84.4494, 89),
    "radiohead": ("GB", "Oxford", 51.7520, -1.2577, 94),
    "arctic monkeys": ("GB", "Sheffield", 53.3811, -1.4701, 95),
    "pink floyd": ("GB", "Londres", 51.5072, -0.1276, 95),
    "the beatles": ("GB", "Liverpool", 53.4084, -2.9916, 98),
    "queen": ("GB", "Londres", 51.5072, -0.1276, 98),
    "david bowie": ("GB", "Londres", 51.5072, -0.1276, 94),
    "coldplay": ("GB", "Londres", 51.5072, -0.1276, 98),
    "gorillaz": ("GB", "Londres", 51.5072, -0.1276, 92),
    "fred again": ("GB", "Londres", 51.5072, -0.1276, 88),
    "charli xcx": ("GB", "Cambridge", 52.2053, 0.1218, 93),
    "dua lipa": ("GB", "Londres", 51.5072, -0.1276, 96),
    "central cee": ("GB", "Londres", 51.5072, -0.1276, 91),
    "pinkpantheress": ("GB", "Bath", 51.3811, -2.3590, 86),
    "beabadoobee": ("GB", "Londres", 51.5072, -0.1276, 86),
    "the smiths": ("GB", "Manchester", 53.4808, -2.2426, 90),
    "oasis": ("GB", "Manchester", 53.4808, -2.2426, 93),
    "massive attack": ("GB", "Bristol", 51.4545, -2.5879, 85),
    "aphex twin": ("GB", "Cornouailles", 50.2660, -5.0527, 83),
    "tame impala": ("AU", "Perth", -31.9505, 115.8605, 92),
    "flume": ("AU", "Sydney", -33.8688, 151.2093, 85),
    "rufus du sol": ("AU", "Sydney", -33.8688, 151.2093, 84),
    "ac dc": ("AU", "Sydney", -33.8688, 151.2093, 94),
    "rammstein": ("DE", "Berlin", 52.5200, 13.4050, 91),
    "hans zimmer": ("DE", "Francfort", 50.1109, 8.6821, 92),
    "paul kalkbrenner": ("DE", "Berlin", 52.5200, 13.4050, 81),
    "bad bunny": ("PR", "San Juan", 18.4655, -66.1057, 99),
    "rosalia": ("ES", "Barcelone", 41.3874, 2.1686, 91),
    "maneskin": ("IT", "Rome", 41.9028, 12.4964, 89),
    "ludovico einaudi": ("IT", "Turin", 45.0703, 7.6869, 86),
    "bts": ("KR", "Séoul", 37.5665, 126.9780, 98),
    "newjeans": ("KR", "Séoul", 37.5665, 126.9780, 91),
    "blackpink": ("KR", "Séoul", 37.5665, 126.9780, 95),
    "yoasobi": ("JP", "Tokyo", 35.6762, 139.6503, 88),
    "joe hisaishi": ("JP", "Nagano", 36.6485, 138.1942, 85),
    "nujabes": ("JP", "Tokyo", 35.6762, 139.6503, 82),
    "kenshi yonezu": ("JP", "Tokushima", 34.0703, 134.5548, 86),
    "ado": ("JP", "Tokyo", 35.6762, 139.6503, 85),
    "fujii kaze": ("JP", "Okayama", 34.6551, 133.9195, 84),
    "abba": ("SE", "Stockholm", 59.3293, 18.0686, 95),
    "avicii": ("SE", "Stockholm", 59.3293, 18.0686, 94),
    "bladee": ("SE", "Stockholm", 59.3293, 18.0686, 77),
    "yung lean": ("SE", "Stockholm", 59.3293, 18.0686, 79),
    "bjork": ("IS", "Reykjavik", 64.1466, -21.9426, 84),
    "sigur ros": ("IS", "Reykjavik", 64.1466, -21.9426, 81),
    "burna boy": ("NG", "Port Harcourt", 4.8156, 7.0498, 90),
    "rema": ("NG", "Benin City", 6.3350, 5.6037, 89),
    "wizkid": ("NG", "Lagos", 6.5244, 3.3792, 88),
    "tems": ("NG", "Lagos", 6.5244, 3.3792, 86),
    "bob marley": ("JM", "Kingston", 17.9712, -76.7936, 94),
    "hozier": ("IE", "Bray", 53.2009, -6.1111, 91),
    "fontaines dc": ("IE", "Dublin", 53.3498, -6.2603, 81),
    "u2": ("IE", "Dublin", 53.3498, -6.2603, 93),
    "martin garrix": ("NL", "Amsterdam", 52.3676, 4.9041, 90),
    "tiesto": ("NL", "Breda", 51.5719, 4.7683, 91),
}

_WIKIDATA_QID_RE = re.compile(r"wikidata\.org/(?:wiki|entity)/(Q\d+)")


class PersistentJobWorker:
    """Asyncio worker consuming SQLite `background_jobs` with strict per-API rate limits."""

    def __init__(self):
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._last_call: dict[str, float] = {}
        self.running = False
        self.stats: dict[str, Any] = {
            "running": False,
            "pending": 0,
            "done": 0,
            "failed": 0,
            "current_job": None,
            "last_error": None,
        }

    def enqueue(
        self,
        *,
        job_type: str,
        provider: str,
        target_key: str,
        payload: dict[str, Any] | None = None,
        priority: int = 50,
    ):
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with db_session() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO background_jobs (
                    job_type, provider, target_key, payload_json, priority,
                    status, attempts, max_attempts, next_run_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 5, 0, ?, ?)
                """,
                (
                    job_type,
                    provider,
                    target_key,
                    json.dumps(payload or {}, ensure_ascii=False),
                    priority,
                    now_iso,
                    now_iso,
                ),
            )

    def seed_artist_graph_jobs(self, limit: int = 120) -> int:
        """Seed initial curated geo/popularity rows and queue live MusicBrainz jobs for top artists."""
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        queued = 0
        with db_session() as conn:
            rows = conn.execute(
                """
                SELECT tc.artist_group_key, MAX(tc.artist_name) AS artist_name,
                       SUM(pe.play_duration_ms) AS total_ms, COUNT(*) AS plays
                FROM play_events pe
                JOIN tracks_catalog tc ON tc.track_key = pe.track_key
                WHERE tc.artist_group_key IS NOT NULL AND tc.artist_group_key != ''
                GROUP BY tc.artist_group_key
                ORDER BY total_ms DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

            for idx, r in enumerate(rows):
                akey = r["artist_group_key"]
                aname = r["artist_name"] or akey
                existing = conn.execute(
                    "SELECT source FROM artist_musicbrainz WHERE artist_group_key = ?",
                    (akey,),
                ).fetchone()

                if not existing and akey in CURATED_ARTIST_GEO:
                    iso, city, lat, lng, pop = CURATED_ARTIST_GEO[akey]
                    cname = COUNTRY_CENTROIDS.get(iso, (iso, lat, lng))[0]
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO artist_musicbrainz (
                            artist_group_key, artist_name, country_iso, country_name,
                            area_name, begin_area, lat, lng, obscurity_score, source, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated_seed', ?)
                        """,
                        (akey, aname, iso, cname, city, city, lat, lng, round(100.0 - pop, 1), now_iso),
                    )

                if not existing or existing["source"] != "musicbrainz":
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO background_jobs (
                            job_type, provider, target_key, payload_json, priority,
                            status, attempts, max_attempts, next_run_at, created_at, updated_at
                        ) VALUES ('artist_mb', 'musicbrainz', ?, ?, ?, 'pending', 0, 4, 0, ?, ?)
                        """,
                        (
                            akey,
                            json.dumps({"artist_group_key": akey, "artist_name": aname}, ensure_ascii=False),
                            max(10, 100 - idx),
                            now_iso,
                            now_iso,
                        ),
                    )
                    queued += 1
        return queued

    def get_status(self) -> dict[str, Any]:
        with db_session() as conn:
            counts = {
                r["status"]: r["c"]
                for r in conn.execute("SELECT status, COUNT(*) AS c FROM background_jobs GROUP BY status").fetchall()
            }
            mb_count = conn.execute("SELECT COUNT(*) FROM artist_musicbrainz WHERE lat IS NOT NULL").fetchone()[0]
            dna_count = conn.execute("SELECT COUNT(*) FROM track_audio_dna").fetchone()[0]
            sent_count = conn.execute("SELECT COUNT(*) FROM track_lyrics_sentiment").fetchone()[0]
        self.stats.update(
            {
                "running": self.running,
                "pending": counts.get("pending", 0),
                "done": counts.get("done", 0),
                "failed": counts.get("failed", 0),
                "artists_geolocated": mb_count,
                "tracks_audio_dna": dna_count,
                "tracks_sentiment": sent_count,
            }
        )
        return dict(self.stats)

    def start(self):
        curr_loop = asyncio.get_running_loop()
        if self._task and not self._task.done():
            if self._task.get_loop() is curr_loop:
                return
        self._stop = asyncio.Event()
        self.running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
            if self._task.get_loop() is asyncio.get_running_loop():
                try:
                    await self._task
                except (asyncio.CancelledError, RuntimeError):
                    pass
        self._task = None
        self.running = False

    async def _rate_wait(self, provider: str):
        interval = PROVIDER_MIN_INTERVAL.get(provider, 1.0)
        now = time.monotonic()
        last = self._last_call.get(provider, 0.0)
        wait = interval - (now - last)
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_call[provider] = time.monotonic()

    async def _process_artist_mb(self, client: httpx.AsyncClient, payload: dict[str, Any]):
        akey = payload["artist_group_key"]
        aname = payload["artist_name"]

        await self._rate_wait("musicbrainz")
        resp = await client.get(
            "https://musicbrainz.org/ws/2/artist/",
            params={"query": f'artist:"{aname}"', "fmt": "json", "limit": 3},
            headers={"User-Agent": CONTACT_UA, "Accept": "application/json"},
        )
        if resp.status_code == 503:
            raise RuntimeError("MUSICBRAINZ_503_RATE_LIMIT")
        resp.raise_for_status()
        artists = resp.json().get("artists") or []
        if not artists:
            return
        best = artists[0]
        mbid = best.get("id")
        country_iso = best.get("country") or ((best.get("area") or {}).get("iso-3166-1-codes") or [None])[0]
        area_name = (best.get("area") or {}).get("name")
        begin_area = (best.get("begin-area") or {}).get("name")
        life = best.get("life-span") or {}
        artist_type = best.get("type")

        wikidata_id = None
        related: list[dict[str, str]] = []
        lat = None
        lng = None

        if mbid:
            await self._rate_wait("musicbrainz")
            dresp = await client.get(
                f"https://musicbrainz.org/ws/2/artist/{mbid}",
                params={"inc": "url-rels+artist-rels", "fmt": "json"},
                headers={"User-Agent": CONTACT_UA, "Accept": "application/json"},
            )
            if dresp.status_code == 503:
                raise RuntimeError("MUSICBRAINZ_503_RATE_LIMIT")
            if dresp.status_code == 200:
                detail = dresp.json()
                for rel in detail.get("relations") or []:
                    if rel.get("type") == "wikidata" and rel.get("url"):
                        m = _WIKIDATA_QID_RE.search(rel["url"].get("resource", ""))
                        if m:
                            wikidata_id = m.group(1)
                    elif rel.get("target-type") == "artist" and rel.get("artist"):
                        related.append(
                            {
                                "name": rel["artist"].get("name", ""),
                                "mbid": rel["artist"].get("id", ""),
                                "type": rel.get("type", "member"),
                            }
                        )

        # Direct Wikidata Entity API (NO slow SPARQL!) with maxlag=5 & gzip
        if wikidata_id:
            try:
                await self._rate_wait("wikidata")
                wresp = await client.get(
                    "https://www.wikidata.org/w/api.php",
                    params={
                        "action": "wbgetentities",
                        "ids": wikidata_id,
                        "props": "claims",
                        "format": "json",
                        "maxlag": 5,
                    },
                    headers={"User-Agent": CONTACT_UA, "Accept-Encoding": "gzip"},
                )
                if wresp.status_code == 200:
                    ent = (wresp.json().get("entities") or {}).get(wikidata_id) or {}
                    claims = ent.get("claims") or {}
                    # P625 coordinate location if directly on entity
                    for claim in claims.get("P625") or []:
                        val = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
                        if isinstance(val, dict) and "latitude" in val and "longitude" in val:
                            lat = float(val["latitude"])
                            lng = float(val["longitude"])
                            break
            except Exception:
                pass

        if (lat is None or lng is None) and country_iso and country_iso in COUNTRY_CENTROIDS:
            _, lat, lng = COUNTRY_CENTROIDS[country_iso]

        # ListenBrainz Popularity endpoint (POST /1/popularity/artist)
        lb_listens = None
        lb_users = None
        obscurity = None
        if mbid:
            try:
                await self._rate_wait("listenbrainz")
                presp = await client.post(
                    "https://api.listenbrainz.org/1/popularity/artist",
                    json={"artist_mbids": [mbid]},
                    headers={"User-Agent": CONTACT_UA},
                )
                if presp.status_code == 200:
                    arr = presp.json()
                    if isinstance(arr, list) and arr:
                        lb_listens = arr[0].get("total_listen_count")
                        lb_users = arr[0].get("total_user_count")
                        if lb_users is not None:
                            # Logarithmic obscurity index 0 (mega mainstream) -> 100 (deep underground)
                            import math

                            obscurity = round(max(0.0, min(100.0, 100.0 - (math.log10(max(lb_users, 1)) / 5.5) * 100.0)), 1)
            except Exception:
                pass

        cname = COUNTRY_CENTROIDS.get(country_iso or "", (country_iso or area_name or "Inconnu", 0.0, 0.0))[0]
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with db_session() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO artist_musicbrainz (
                    artist_group_key, artist_name, mbid, country_iso, country_name,
                    area_name, begin_area, lat, lng, artist_type, active_begin, active_end,
                    wikidata_id, lb_listen_count, lb_user_count, obscurity_score,
                    related_artists_json, source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'musicbrainz', ?)
                """,
                (
                    akey,
                    aname,
                    mbid,
                    country_iso,
                    cname,
                    area_name,
                    begin_area,
                    lat,
                    lng,
                    artist_type,
                    life.get("begin"),
                    life.get("end"),
                    wikidata_id,
                    lb_listens,
                    lb_users,
                    obscurity,
                    json.dumps(related[:12], ensure_ascii=False),
                    now_iso,
                ),
            )
            if mbid:
                conn.execute("UPDATE tracks_catalog SET mbid_artist = ? WHERE artist_group_key = ?", (mbid, akey))

    async def _loop(self):
        try:
            while not self._stop.is_set():
                now = time.time()
                with db_session() as conn:
                    job = conn.execute(
                        """
                        SELECT * FROM background_jobs
                        WHERE status = 'pending' AND next_run_at <= ?
                        ORDER BY priority DESC, id ASC
                        LIMIT 1
                        """,
                        (now,),
                    ).fetchone()
                if not job:
                    self.stats["current_job"] = None
                    await asyncio.sleep(5.0)
                    continue

                self.stats["current_job"] = f"{job['job_type']}:{job['target_key']}"
                payload = json.loads(job["payload_json"] or "{}")
                now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                try:
                    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
                        if job["job_type"] == "artist_mb":
                            await self._process_artist_mb(client, payload)
                    with db_session() as conn:
                        conn.execute(
                            "UPDATE background_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?",
                            (now_iso, job["id"]),
                        )
                except Exception as exc:
                    err = str(exc)
                    self.stats["last_error"] = err
                    attempts = int(job["attempts"] or 0) + 1
                    max_att = int(job["max_attempts"] or 5)
                    # Exponential backoff with jitter (especially for MusicBrainz HTTP 503)
                    delay = (2 ** attempts) * (3.0 if "503" in err else 2.0) + random.uniform(0.5, 2.5)
                    new_status = "failed" if attempts >= max_att else "pending"
                    with db_session() as conn:
                        conn.execute(
                            """
                            UPDATE background_jobs
                            SET status = ?, attempts = ?, next_run_at = ?, last_error = ?, updated_at = ?
                            WHERE id = ?
                            """,
                            (new_status, attempts, time.time() + delay, err[:300], now_iso, job["id"]),
                        )
                    await asyncio.sleep(1.5)
        except asyncio.CancelledError:
            pass
        finally:
            self.running = False


async def fetch_cover_art_archive(release_group_mbid: str) -> dict[str, Any]:
    """Fetch front & back covers from Cover Art Archive (no rate limit)."""
    if not release_group_mbid:
        return {"found": False}
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers={"User-Agent": CONTACT_UA}) as client:
            resp = await client.get(f"https://coverartarchive.org/release-group/{release_group_mbid}")
            if resp.status_code != 200:
                return {"found": False}
            imgs = resp.json().get("images") or []
            front = None
            back = None
            for img in imgs:
                thumbs = img.get("thumbnails") or {}
                url = thumbs.get("500") or thumbs.get("large") or img.get("image")
                if img.get("front") and not front:
                    front = url
                if img.get("back") and not back:
                    back = url
            return {"found": bool(front or back), "front_cover_url": front, "back_cover_url": back}
    except Exception:
        return {"found": False}


async def fetch_artist_setlists(artist_group_key: str, mbid: str | None = None) -> dict[str, Any]:
    """Optional Setlist.fm connector (2 req/s, 1440 req/day cached in SQLite) comparing live setlists vs user's known tracks."""
    with db_session() as conn:
        cached = conn.execute("SELECT setlists_json, updated_at FROM artist_setlists WHERE artist_group_key = ?", (artist_group_key,)).fetchone()
        cfg = conn.execute("SELECT api_key FROM sync_providers_config WHERE provider = 'setlistfm'").fetchone()
        known_rows = conn.execute(
            """
            SELECT song_group_key, song_name, total_plays FROM tracks_catalog
            WHERE artist_group_key = ?
            """,
            (artist_group_key,),
        ).fetchall()
        if not mbid:
            mb_row = conn.execute("SELECT mbid FROM artist_musicbrainz WHERE artist_group_key = ?", (artist_group_key,)).fetchone()
            mbid = mb_row["mbid"] if mb_row else None

    known_map = {r["song_group_key"]: r["total_plays"] for r in known_rows}

    if cached:
        sets = json.loads(cached["setlists_json"] or "[]")
        return {"found": True, "source": "cache", "setlists": sets, "known_tracks_count": len(known_map)}

    api_key = (cfg["api_key"] if cfg else None) or ""
    if not api_key or not mbid:
        return {
            "found": False,
            "configured": bool(api_key),
            "has_mbid": bool(mbid),
            "setlists": [],
            "hint": "Configurez une clé API gratuite Setlist.fm dans le Hub Continuum pour comparer les concerts récents.",
        }

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            headers={"x-api-key": api_key, "Accept": "application/json", "User-Agent": CONTACT_UA},
        ) as client:
            resp = await client.get(f"https://api.setlist.fm/rest/1.0/artist/{mbid}/setlists", params={"p": 1})
            if resp.status_code != 200:
                return {"found": False, "error": f"Setlist.fm HTTP {resp.status_code}", "setlists": []}
            raw_sets = (resp.json().get("setlist") or [])[:5]
            parsed = []
            for s in raw_sets:
                songs = []
                for block in (s.get("sets") or {}).get("set") or []:
                    for song in block.get("song") or []:
                        sname = song.get("name") or ""
                        sgk = clean_group_key(sname, strip_feat=True)
                        songs.append({"name": sname, "known_plays": known_map.get(sgk, 0)})
                known_hits = sum(1 for x in songs if x["known_plays"] > 0)
                parsed.append(
                    {
                        "date": s.get("eventDate"),
                        "venue": (s.get("venue") or {}).get("name"),
                        "city": ((s.get("venue") or {}).get("city") or {}).get("name"),
                        "country": (((s.get("venue") or {}).get("city") or {}).get("country") or {}).get("name"),
                        "songs": songs,
                        "known_ratio_pct": round(100.0 * known_hits / max(len(songs), 1), 1),
                    }
                )
            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            with db_session() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO artist_setlists (artist_group_key, mbid, setlists_json, updated_at) VALUES (?, ?, ?, ?)",
                    (artist_group_key, mbid, json.dumps(parsed, ensure_ascii=False), now_iso),
                )
            return {"found": True, "source": "setlistfm", "setlists": parsed, "known_tracks_count": len(known_map)}
    except Exception as exc:
        return {"found": False, "error": str(exc), "setlists": []}


job_worker = PersistentJobWorker()
