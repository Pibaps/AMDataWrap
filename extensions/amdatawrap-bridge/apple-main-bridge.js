/**
 * Runs inside the MAIN world of https://music.apple.com to directly drive
 * `window.MusicKit.getInstance()` at 0 EUR (no Apple Developer key required).
 */
(() => {
  if (window.__AMDW_MUSICKIT_BRIDGE__) return;
  window.__AMDW_MUSICKIT_BRIDGE__ = true;

  const DEBUG_LOGS = [];
  const MAX_LOGS = 40;
  let listenersAttachedTo = null;
  let commandChain = Promise.resolve();
  let lastTimeEmitAt = 0;
  let lastEndSignature = "";
  let pendingManualQueueSwitchUntil = 0;

  function pushLog(level, message, extra) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      extra: extra || null,
    };
    DEBUG_LOGS.push(entry);
    if (DEBUG_LOGS.length > MAX_LOGS) DEBUG_LOGS.shift();
    if (level === "error" || level === "warn") {
      console.warn("[AMDW AppleBridge]", message, extra || "");
      window.postMessage({ source: "amdw-apple-main", type: "debug_log", entry }, "*");
    }
  }

  function postError(detail, extra) {
    pushLog("error", detail, extra);
    window.postMessage({ source: "amdw-apple-main", type: "error", detail }, "*");
  }

  function getMK() {
    try {
      return window.MusicKit && typeof window.MusicKit.getInstance === "function"
        ? window.MusicKit.getInstance()
        : null;
    } catch {
      return null;
    }
  }

  async function waitForMK(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const mk = getMK();
      if (mk) {
        attachMKListeners(mk);
        return mk;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  function getStorefront(mk) {
    const sf = String(mk?.storefrontId || mk?.storefrontCountryCode || "fr").trim().toLowerCase();
    return /^[a-z]{2}$/.test(sf) ? sf : "fr";
  }

  // ---- Normalisation & Validation stricte d'artiste ----
  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(feat|ft|featuring)\b\.?/g, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripParenTags(s) {
    return String(s || "")
      .replace(/\([^)]*\b(?:feat|ft|featuring|remaster(?:ed)?|live|edit|version|radio\s*edit|deluxe)\b[^)]*\)/gi, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim();
  }

  function splitArtists(s) {
    return String(s || "")
      .split(/\s*(?:,|&|\+|\/|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i)
      .map((part) => norm(part))
      .filter(Boolean);
  }

  function tokenCoverage(needle, haystack) {
    const sa = new Set(norm(needle).split(" ").filter(Boolean));
    const sb = new Set(norm(haystack).split(" ").filter(Boolean));
    if (sa.size === 0 || sb.size === 0) return 0;
    let inter = 0;
    for (const w of sa) if (sb.has(w)) inter++;
    return inter / sa.size;
  }

  function jaccardOverlap(a, b) {
    const sa = new Set(norm(a).split(" ").filter(Boolean));
    const sb = new Set(norm(b).split(" ").filter(Boolean));
    if (sa.size === 0 || sb.size === 0) return 0;
    let inter = 0;
    for (const w of sa) if (sb.has(w)) inter++;
    return inter / (sa.size + sb.size - inter);
  }

  function strictArtistMatch(reqArtist, candArtist) {
    const nReq = norm(reqArtist);
    if (!nReq || nReq === "artiste inconnu" || nReq === "unknown artist") {
      return { ok: true, score: 0.5 };
    }
    const nCand = norm(candArtist);
    if (!nCand) return { ok: false, score: 0 };
    if (nReq === nCand) return { ok: true, score: 1.0 };

    const reqParts = splitArtists(reqArtist);
    const candParts = splitArtists(candArtist);
    for (const rp of reqParts) {
      for (const cp of candParts) {
        if (rp && cp && rp === cp) return { ok: true, score: 0.96 };
      }
    }

    const reqMain = reqParts[0] || nReq;
    const cov = tokenCoverage(reqMain, candArtist);
    const wordCount = reqMain.split(" ").filter(Boolean).length;
    if (wordCount === 1 && cov < 1.0) return { ok: false, score: 0 };
    if (cov >= 0.8) return { ok: true, score: 0.85 * cov };
    return { ok: false, score: 0 };
  }

  const BANNED_VARIANT_TAGS = [
    "cover",
    "remix",
    "club edit",
    "instrumental",
    "karaoke",
    "lofi",
    "tribute",
    "sped up",
    "slowed",
    "nightcore",
    "8d audio",
    "rework",
  ];

  function scoreTrackCandidate(attrs, reqSong, reqArtist, reqAlbum) {
    const title = attrs?.name || "";
    const artistName = attrs?.artistName || "";
    const albumName = attrs?.albumName || "";

    const artistCheck = strictArtistMatch(reqArtist, artistName);
    if (!artistCheck.ok) return -1;

    const cleanTitle = stripParenTags(title);
    const cleanReqSong = stripParenTags(reqSong);
    const tExact = norm(cleanTitle) === norm(cleanReqSong) ? 1.0 : 0.0;
    const tOverlap = Math.max(jaccardOverlap(reqSong, title), jaccardOverlap(cleanReqSong, cleanTitle));
    const tScore = Math.max(tExact, tOverlap);
    if (reqSong && tScore < 0.42) return -1;

    const nReq = norm(reqSong);
    const nCand = norm(`${title} ${albumName}`);
    for (const tag of BANNED_VARIANT_TAGS) {
      const re = new RegExp(`\\b${tag.replace(/\s+/g, "\\s+")}\\b`);
      if (re.test(nCand) && !re.test(nReq)) {
        return -1;
      }
    }

    const alScore =
      reqAlbum && reqAlbum.toLowerCase() !== "single / inconnu" ? jaccardOverlap(reqAlbum, albumName) : 0;

    return tScore * 0.5 + artistCheck.score * 0.35 + alScore * 0.15;
  }

  // ---- Wrapper réseau résilient (mk.api.music + fallback amp-api.music.apple.com) ----
  function unwrapResponse(res) {
    if (!res) return null;
    if (res.data && (res.data.results || res.data.data)) return res.data;
    return res;
  }

  async function amApiGet(mk, path, queryParams = null) {
    const qs = queryParams
      ? "?" +
        Object.entries(queryParams)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const fullPath = `${path}${qs}`;

    if (mk?.api?.music) {
      try {
        const res = queryParams ? await mk.api.music(path, queryParams) : await mk.api.music(path);
        const unwrapped = unwrapResponse(res);
        if (unwrapped) return unwrapped;
      } catch (err) {
        pushLog("warn", `mk.api.music échoué sur ${fullPath}, bascule amp-api`, {
          err: err?.message || String(err),
        });
      }
    }

    if (mk?.developerToken) {
      const headers = {
        Authorization: `Bearer ${mk.developerToken}`,
        Accept: "application/json",
      };
      if (mk.musicUserToken) headers["Music-User-Token"] = mk.musicUserToken;

      const resp = await fetch(`https://amp-api.music.apple.com${fullPath}`, {
        method: "GET",
        headers,
        credentials: "include",
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`amp-api HTTP ${resp.status} sur ${path}: ${txt.slice(0, 140)}`);
      }
      return await resp.json();
    }

    throw new Error("MusicKit api.music et developerToken indisponibles.");
  }

  // ---- Cascade de résolution à 4 niveaux ----
  async function resolveByISRC(mk, storefront, isrcs, reqSong, reqArtist, reqAlbum) {
    if (!Array.isArray(isrcs) || isrcs.length === 0) return null;
    const batch = isrcs.slice(0, 25).join(",");
    try {
      const data = await amApiGet(
        mk,
        `/v1/catalog/${storefront}/songs?filter%5Bisrc%5D=${encodeURIComponent(batch)}&include=albums`
      );
      const songs = Array.isArray(data?.data) ? data.data : [];
      if (songs.length === 0) return null;

      let bestId = null;
      let bestScore = -1;
      for (const s of songs) {
        const attrs = s?.attributes || {};
        const sc = scoreTrackCandidate(attrs, reqSong || attrs.name, reqArtist, reqAlbum);
        const artistOk = strictArtistMatch(reqArtist, attrs.artistName || "").ok;
        const effectiveScore =
          sc >= 0
            ? sc
            : artistOk
            ? 0.65 + (reqAlbum ? jaccardOverlap(reqAlbum, attrs.albumName || "") * 0.25 : 0)
            : -1;
        if (effectiveScore > bestScore) {
          bestScore = effectiveScore;
          bestId = String(s.id);
        }
      }
      if (bestId) {
        pushLog("info", `Résolu via ISRC (${batch}) -> ${bestId}`, { bestScore });
        return { songId: bestId, tier: "isrc" };
      }
    } catch (err) {
      pushLog("warn", "Lookup ISRC échoué", { err: err?.message || String(err) });
    }
    return null;
  }

  async function resolveByAlbumTracks(mk, storefront, reqSong, reqArtist, reqAlbum) {
    if (!reqAlbum || reqAlbum.toLowerCase() === "single / inconnu" || !reqArtist) return null;
    try {
      const searchRes = await amApiGet(mk, `/v1/catalog/${storefront}/search`, {
        term: `${reqArtist} ${stripParenTags(reqAlbum)}`.trim(),
        types: "albums",
        limit: 10,
      });
      const albums = searchRes?.results?.albums?.data || [];
      const matchingAlbums = albums
        .filter((alb) => strictArtistMatch(reqArtist, alb?.attributes?.artistName || "").ok)
        .map((alb) => ({
          alb,
          alScore: jaccardOverlap(reqAlbum, alb?.attributes?.name || ""),
        }))
        .filter((x) => x.alScore >= 0.45)
        .sort((a, b) => b.alScore - a.alScore);

      for (const { alb } of matchingAlbums.slice(0, 3)) {
        let tracks = [];
        try {
          const tracksRes = await amApiGet(mk, `/v1/catalog/${storefront}/albums/${alb.id}/tracks`, {
            limit: 100,
          });
          tracks = Array.isArray(tracksRes?.data) ? tracksRes.data : [];
        } catch {
          /* fallback below */
        }
        if (tracks.length === 0) {
          const detailRes = await amApiGet(mk, `/v1/catalog/${storefront}/albums/${alb.id}`, {
            include: "tracks",
          });
          tracks = detailRes?.data?.[0]?.relationships?.tracks?.data || [];
        }

        let bestId = null;
        let bestScore = -1;
        for (const tr of tracks) {
          const attrs = tr?.attributes || {};
          const sc = scoreTrackCandidate(
            { ...attrs, albumName: alb?.attributes?.name || reqAlbum },
            reqSong,
            reqArtist,
            reqAlbum
          );
          if (sc > bestScore) {
            bestScore = sc;
            bestId = String(tr.id);
          }
        }
        if (bestId && bestScore >= 0.55) {
          pushLog("info", `Résolu via album "${alb?.attributes?.name}" -> ${bestId}`, { bestScore });
          return { songId: bestId, tier: "album_tracks" };
        }
      }
    } catch (err) {
      pushLog("warn", "Résolution par album échouée", { err: err?.message || String(err) });
    }
    return null;
  }

  async function resolveByCatalogSongs(mk, storefront, reqSong, reqArtist, reqAlbum, rawQuery) {
    const cleanSong = stripParenTags(reqSong);
    const queries = [
      `${reqArtist} ${cleanSong}`.trim(),
      `${cleanSong} ${reqArtist}`.trim(),
      rawQuery || "",
      cleanSong,
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);

    let bestId = null;
    let bestScore = -1;

    for (const q of queries) {
      try {
        const res = await amApiGet(mk, `/v1/catalog/${storefront}/search`, {
          term: q,
          types: "songs",
          limit: 25,
        });
        const songs = res?.results?.songs?.data || [];
        for (const s of songs) {
          const sc = scoreTrackCandidate(s?.attributes || {}, reqSong, reqArtist, reqAlbum);
          if (sc > bestScore) {
            bestScore = sc;
            bestId = String(s.id);
          }
        }
        if (bestId && bestScore >= 0.72) {
          pushLog("info", `Résolu via catalog search "${q}" -> ${bestId}`, { bestScore });
          return { songId: bestId, tier: "catalog_search" };
        }
      } catch (err) {
        pushLog("warn", `Recherche catalogue échouée sur "${q}"`, { err: err?.message || String(err) });
      }
    }

    if (bestId && bestScore >= 0.52) {
      pushLog("info", `Résolu via catalog search (seuil secondaire) -> ${bestId}`, { bestScore });
      return { songId: bestId, tier: "catalog_search" };
    }
    return null;
  }

  async function resolveByPersonalLibrary(mk, reqSong, reqArtist, reqAlbum) {
    if (!mk?.musicUserToken) return null;
    try {
      const res = await amApiGet(mk, `/v1/me/library/search`, {
        term: `${reqArtist} ${stripParenTags(reqSong)}`.trim(),
        types: "library-songs",
        limit: 15,
      });
      const songs = res?.results?.["library-songs"]?.data || [];
      let bestId = null;
      let bestScore = -1;
      for (const s of songs) {
        const attrs = s?.attributes || {};
        const sc = scoreTrackCandidate(attrs, reqSong, reqArtist, reqAlbum);
        if (sc > bestScore) {
          bestScore = sc;
          bestId = String(attrs?.playParams?.catalogId || s.id);
        }
      }
      if (bestId && bestScore >= 0.52) {
        pushLog("info", `Résolu via bibliothèque personnelle -> ${bestId}`, { bestScore });
        return { songId: bestId, tier: "library_search" };
      }
    } catch (err) {
      pushLog("warn", "Recherche bibliothèque personnelle échouée", { err: err?.message || String(err) });
    }
    return null;
  }

  async function resolveSongId(mk, payload) {
    if (payload?.apple_song_id) {
      return { songId: String(payload.apple_song_id), tier: "cached_backend" };
    }
    const storefront = getStorefront(mk);
    const reqSong = payload?.song_name || "";
    const reqArtist = payload?.artist_name || "";
    const reqAlbum = payload?.album_name || "";
    const isrcs = Array.isArray(payload?.isrcs) ? payload.isrcs : [];

    const r1 = await resolveByISRC(mk, storefront, isrcs, reqSong, reqArtist, reqAlbum);
    if (r1) return r1;

    const r2 = await resolveByAlbumTracks(mk, storefront, reqSong, reqArtist, reqAlbum);
    if (r2) return r2;

    const r3 = await resolveByCatalogSongs(mk, storefront, reqSong, reqArtist, reqAlbum, payload?.query);
    if (r3) return r3;

    const r4 = await resolveByPersonalLibrary(mk, reqSong, reqArtist, reqAlbum);
    if (r4) return r4;

    if (payload?.fallback_itunes_id) {
      return { songId: String(payload.fallback_itunes_id), tier: "itunes_fallback" };
    }
    return null;
  }

  // ---- État temps réel & Événements MusicKit JS v3 ----
  function getPlaybackStateName(mk) {
    const states = window.MusicKit?.PlaybackStates || {};
    const st = mk?.playbackState;
    for (const [k, v] of Object.entries(states)) {
      if (v === st) return k;
    }
    return String(st ?? "unknown");
  }

  function emitState(mkArg) {
    const mk = mkArg || getMK();
    if (!mk) return;
    const item = mk.nowPlayingItem;
    const attrs = item?.attributes || {};
    const art = attrs.artwork?.url
      ? attrs.artwork.url.replace("{w}", "600").replace("{h}", "600")
      : null;
    const catalogId = attrs?.playParams?.catalogId || item?.id || null;

    window.postMessage(
      {
        source: "amdw-apple-main",
        type: "state",
        data: {
          platform: "apple_music",
          apple_song_id: catalogId ? String(catalogId) : null,
          song_name: attrs.name || "",
          artist_name: attrs.artistName || "",
          album_name: attrs.albumName || "",
          artwork_url: art,
          duration_ms: Math.round((mk.currentPlaybackDuration || 0) * 1000),
          position_ms: Math.round((mk.currentPlaybackTime || 0) * 1000),
          is_playing: Boolean(mk.isPlaying),
          playback_state: getPlaybackStateName(mk),
        },
      },
      "*"
    );
  }

  function attachMKListeners(mk) {
    if (!mk || listenersAttachedTo === mk || typeof mk.addEventListener !== "function") return;
    listenersAttachedTo = mk;

    mk.addEventListener("playbackStateDidChange", (ev) => {
      const states = window.MusicKit?.PlaybackStates || {};
      const stateVal = ev?.state ?? mk.playbackState;
      emitState(mk);

      const dur = mk.currentPlaybackDuration || 0;
      const cur = mk.currentPlaybackTime || 0;
      const nearEnd = dur > 5 && cur >= dur - 1.2;
      const isEnded =
        stateVal === (states.ended ?? 5) ||
        stateVal === (states.completed ?? 10) ||
        (nearEnd && (stateVal === (states.stopped ?? 4) || stateVal === (states.paused ?? 3)));
      if (isEnded && Date.now() > pendingManualQueueSwitchUntil) {
        const queueLen = mk.queue?.items?.length || 0;
        const queuePos = mk.queue?.position ?? -1;
        const atQueueEnd =
          queueLen <= 1 ||
          queuePos >= queueLen - 1 ||
          stateVal === (states.completed ?? 10) ||
          nearEnd;
        if (atQueueEnd) {
          const item = mk.nowPlayingItem;
          const sig = `${item?.id || "none"}::${Math.floor(Date.now() / 2000)}`;
          if (sig !== lastEndSignature) {
            lastEndSignature = sig;
            pushLog("info", "track_ended émis", {
              state: getPlaybackStateName(mk),
              cur,
              dur,
              song: item?.attributes?.name || "",
            });
            window.postMessage(
              {
                source: "amdw-apple-main",
                type: "track_ended",
                data: {
                  apple_song_id: item?.id ? String(item.id) : null,
                  song_name: item?.attributes?.name || "",
                  state: getPlaybackStateName(mk),
                },
              },
              "*"
            );
          }
        }
      }
    });

    mk.addEventListener("nowPlayingItemDidChange", () => {
      lastTimeEmitAt = Date.now();
      emitState(mk);
    });

    mk.addEventListener("playbackTimeDidChange", () => {
      const now = Date.now();
      if (mk.isPlaying && now - lastTimeEmitAt >= 1000) {
        lastTimeEmitAt = now;
        emitState(mk);
      }
    });

    mk.addEventListener("mediaItemStateDidChange", (ev) => {
      pushLog("info", "mediaItemStateDidChange", { state: ev?.state });
    });

    pushLog("info", "Écouteurs temps réel MusicKit JS v3 attachés", {
      storefront: getStorefront(mk),
      hasDevToken: Boolean(mk.developerToken),
      hasUserToken: Boolean(mk.musicUserToken),
    });
  }

  function enqueueCommand(fn) {
    commandChain = commandChain.then(fn, fn);
    return commandChain;
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.source !== "amdw-apple-cmd") return;
    const { command, payload } = ev.data;

    enqueueCommand(async () => {
      const mk = await waitForMK();
      if (!mk) {
        postError("MusicKit non initialisé sur l'onglet Apple Music (vérifie que tu es connecté).");
        return;
      }

      try {
        if (command === "play_track") {
          const resolved = await resolveSongId(mk, payload);
          if (!resolved?.songId) {
            postError(
              `Titre introuvable avec artiste exact (${payload?.artist_name || "?"}) : ${payload?.song_name || "?"}`
            );
            return;
          }

          if (payload?.track_key && resolved.tier !== "cached_backend" && resolved.tier !== "library_search") {
            window.postMessage(
              {
                source: "amdw-apple-main",
                type: "resolved_mapping",
                data: { track_key: payload.track_key, apple_song_id: resolved.songId },
              },
              "*"
            );
          }

          pendingManualQueueSwitchUntil = Date.now() + 2500;
          if (typeof mk.shuffleMode !== "undefined") {
            mk.shuffleMode = 0;
          }
          if (typeof payload?.volume === "number" && Number.isFinite(payload.volume)) {
            mk.volume = Math.max(0, Math.min(1, payload.volume));
          }

          if (Array.isArray(payload?.queue_song_ids) && payload.queue_song_ids.length > 1) {
            const idx = Math.max(0, payload.queue_song_ids.indexOf(resolved.songId));
            try {
              await mk.setQueue({ songs: payload.queue_song_ids, startWith: idx, startPlaying: true });
            } catch {
              await mk.setQueue({ song: resolved.songId, startPlaying: true });
            }
          } else {
            await mk.setQueue({ song: resolved.songId, startPlaying: true });
          }

          if (!mk.isPlaying) {
            await mk.play();
          }
        } else if (command === "play") {
          await mk.play();
        } else if (command === "pause") {
          await mk.pause();
        } else if (command === "seek") {
          const sec =
            typeof payload?.seconds === "number"
              ? payload.seconds
              : typeof payload?.position_ms === "number"
              ? payload.position_ms / 1000
              : null;
          if (sec !== null && Number.isFinite(sec)) {
            await mk.seekToTime(Math.max(0, sec));
            lastTimeEmitAt = 0;
          }
        } else if (command === "next") {
          pendingManualQueueSwitchUntil = Date.now() + 1500;
          await mk.skipToNextItem();
        } else if (command === "prev") {
          pendingManualQueueSwitchUntil = Date.now() + 1500;
          await mk.skipToPreviousItem();
        } else if (command === "change_index" && typeof payload?.index === "number") {
          pendingManualQueueSwitchUntil = Date.now() + 1500;
          await mk.changeToMediaAtIndex(payload.index);
        } else if (command === "volume") {
          const v =
            typeof payload?.volume === "number"
              ? payload.volume
              : typeof payload?.volume_pct === "number"
              ? payload.volume_pct / 100
              : null;
          if (v !== null && Number.isFinite(v)) {
            mk.volume = Math.max(0, Math.min(1, v));
          }
        }
        emitState(mk);
      } catch (err) {
        if (err && (err.name === "NotAllowedError" || String(err).includes("NotAllowed"))) {
          window.postMessage(
            {
              source: "amdw-apple-main",
              type: "autoplay_blocked",
              detail: "Autoplay bloqué par Chrome : clique une fois dans l'onglet Apple Music puis relance.",
            },
            "*"
          );
        } else {
          postError(`Apple Music : ${err?.message || String(err)}`, { command, payload });
        }
      }
    });
  });

  waitForMK(10000);

  window.__AMDW_DEBUG__ = {
    inspect() {
      const mk = getMK();
      if (!mk) return { ready: false };
      return {
        ready: true,
        storefrontId: getStorefront(mk),
        hasDeveloperToken: Boolean(mk.developerToken),
        hasMusicUserToken: Boolean(mk.musicUserToken),
        isPlaying: mk.isPlaying,
        playbackState: getPlaybackStateName(mk),
        queueLength: mk.queue?.items?.length || 0,
        queuePosition: mk.queue?.position ?? -1,
        nowPlaying: mk.nowPlayingItem?.attributes || null,
        lastLogs: DEBUG_LOGS.slice(-15),
      };
    },
    async testResolve(song_name, artist_name, album_name = "", isrc = "") {
      const mk = await waitForMK();
      if (!mk) throw new Error("MusicKit introuvable");
      return resolveSongId(mk, {
        song_name,
        artist_name,
        album_name,
        isrcs: isrc ? [isrc] : [],
      });
    },
    logs: DEBUG_LOGS,
  };
})();
