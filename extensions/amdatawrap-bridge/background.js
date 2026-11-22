/**
 * AMDataWrap V4 Bridge — Manifest V3 Service Worker
 * Maintains a persistent local WebSocket to ws://127.0.0.1:8000/ws/bridge
 * with 20s keepalive (Chrome 116+ SW WebSocket idle limit) + chrome.alarms fallback.
 */

const WS_URL = "ws://127.0.0.1:8000/ws/bridge?role=extension";
const KEEPALIVE_INTERVAL_MS = 20000;
const ALARM_NAME = "amdw-bridge-keepalive";

let socket = null;
let keepaliveTimer = null;
let reconnectTimer = null;
let reconnectDelayMs = 1000;
let reconnectAttempts = 0;
let lastConnectedAt = null;
let connected = false;
let lastBridgeError = null;
const recentBridgeLogs = [];

function recordBridgeLog(entry) {
  if (!entry) return;
  recentBridgeLogs.push(entry);
  if (recentBridgeLogs.length > 25) recentBridgeLogs.shift();
}

const PLATFORM_PATTERNS = {
  apple_music: "https://music.apple.com/*",
  spotify: "https://open.spotify.com/*",
  deezer: "https://www.deezer.com/*",
  youtube_music: "https://music.youtube.com/*",
};

const CONTENT_SCRIPTS = {
  apple_music: "content-apple.js",
  spotify: "content-spotify.js",
  deezer: "content-deezer.js",
  youtube_music: "content-ytm.js",
};

function normStr(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a, b) {
  const sa = new Set(normStr(a).split(" ").filter(Boolean));
  const sb = new Set(normStr(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

function splitArtistsBg(s) {
  return String(s || "")
    .split(/\s*(?:,|&|\+|\/|\bx\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i)
    .map((p) => normStr(p))
    .filter(Boolean);
}

function strictArtistMatchBg(reqArtist, candArtist) {
  const nReq = normStr(reqArtist);
  if (!nReq || nReq === "artiste inconnu") return true;
  const nCand = normStr(candArtist);
  if (!nCand) return false;
  if (nReq === nCand) return true;
  const reqParts = splitArtistsBg(reqArtist);
  const candParts = splitArtistsBg(candArtist);
  for (const rp of reqParts) {
    for (const cp of candParts) {
      if (rp && cp && rp === cp) return true;
    }
  }
  const main = reqParts[0] || nReq;
  const sa = new Set(main.split(" ").filter(Boolean));
  const sb = new Set(nCand.split(" ").filter(Boolean));
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const cov = sa.size > 0 ? inter / sa.size : 0;
  return sa.size === 1 ? cov === 1 : cov >= 0.8;
}

/**
 * Targeted free iTunes fallback (album -> lookup tracks first, then song search).
 */
async function resolveAppleSongIdFallback(payload) {
  if (payload?.apple_song_id) return String(payload.apple_song_id);
  const song = payload?.song_name || "";
  const artist = payload?.artist_name || "";
  const album =
    payload?.album_name && payload.album_name.toLowerCase() !== "single / inconnu"
      ? payload.album_name
      : "";
  if (!song) return null;

  if (album && artist) {
    try {
      const albUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        `${artist} ${album}`
      )}&media=music&entity=album&attribute=albumTerm&limit=10&country=FR`;
      const albResp = await fetch(albUrl);
      if (albResp.ok) {
        const albJson = await albResp.json();
        const albums = (albJson?.results || []).filter(
          (a) => a.collectionId && strictArtistMatchBg(artist, a.artistName)
        );
        for (const alb of albums.slice(0, 2)) {
          const lkResp = await fetch(
            `https://itunes.apple.com/lookup?id=${alb.collectionId}&entity=song&country=FR`
          );
          if (!lkResp.ok) continue;
          const lkJson = await lkResp.json();
          const tracks = (lkJson?.results || []).filter((r) => r.wrapperType === "track" && r.trackId);
          let best = null;
          let bestScore = -1;
          for (const tr of tracks) {
            if (!strictArtistMatchBg(artist, tr.artistName)) continue;
            const sc = tokenOverlap(song, tr.trackName);
            if (sc > bestScore) {
              bestScore = sc;
              best = tr;
            }
          }
          if (best?.trackId && bestScore >= 0.55) return String(best.trackId);
        }
      }
    } catch {
      /* fallback to song search */
    }
  }

  const queries = [`${artist} ${song}`.trim(), song].filter(
    (q, idx, arr) => q && arr.indexOf(q) === idx
  );
  for (const q of queries) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
        q
      )}&media=music&entity=song&limit=50&country=FR`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const items = (await resp.json())?.results || [];
      let best = null;
      let bestScore = -1;
      for (const it of items) {
        if (!it.trackId || !strictArtistMatchBg(artist, it.artistName)) continue;
        const sTitle = tokenOverlap(song, it.trackName);
        const sAlbum = album ? tokenOverlap(album, it.collectionName) : 0;
        const sc = sTitle * 0.75 + sAlbum * 0.25;
        if (sc > bestScore) {
          bestScore = sc;
          best = it;
        }
      }
      if (best?.trackId && bestScore >= 0.55) return String(best.trackId);
    } catch {
      /* try next */
    }
  }
  return null;
}

async function scanOpenPlatforms() {
  const platforms = [];
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs.length > 0) {
      platforms.push({
        platform,
        tabId: tabs[0].id,
        title: tabs[0].title || platform,
        url: tabs[0].url,
      });
    }
  }
  return platforms;
}

function sendWS(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

async function announcePlatforms() {
  const platforms = await scanOpenPlatforms();
  sendWS({ type: "hello", version: "4.1.0", platforms });
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendWS({ type: "ping", ts: Date.now() });
    } else {
      connectWS();
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(30000, reconnectDelayMs * 2);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWS();
  }, delay);
}

function connectWS() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    connected = false;
    scheduleReconnect();
    return;
  }

  socket.onopen = async () => {
    connected = true;
    reconnectDelayMs = 1000;
    reconnectAttempts = 0;
    lastConnectedAt = new Date().toISOString();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    startKeepalive();
    await announcePlatforms();
  };

  socket.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "pong") return;
    await handleBackendCommand(msg);
  };

  socket.onclose = () => {
    connected = false;
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    connected = false;
  };
}

async function sendToTabWithAutoInject(tabId, targetPlatform, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Tab was probably open before the extension was loaded/reloaded — inject content script & retry!
    const scriptFile = CONTENT_SCRIPTS[targetPlatform];
    if (scriptFile && chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [scriptFile],
      });
      await new Promise((r) => setTimeout(r, 450));
      return await chrome.tabs.sendMessage(tabId, message);
    }
    throw err;
  }
}

async function handleBackendCommand(msg) {
  const targetPlatform = msg.platform || "apple_music";
  const pattern = PLATFORM_PATTERNS[targetPlatform];
  if (!pattern) return;

  let tabs = await chrome.tabs.query({ url: pattern });
  if (tabs.length === 0) {
    const defaultUrls = {
      apple_music: "https://music.apple.com/",
      spotify: "https://open.spotify.com/",
      deezer: "https://www.deezer.com/",
      youtube_music: "https://music.youtube.com/",
    };
    const created = await chrome.tabs.create({ url: defaultUrls[targetPlatform], active: false });
    tabs = [created];
    await new Promise((r) => setTimeout(r, 3000));
  }

  const tab = tabs[0];
  const command = msg.command || msg.type;
  const payload = { ...(msg.payload || msg) };

  // Enrich Apple Music play_track with targeted free iTunes fallback when no cached ID or ISRC is provided
  if (
    targetPlatform === "apple_music" &&
    command === "play_track" &&
    !payload.apple_song_id &&
    !payload.isrcs?.length
  ) {
    const fallbackId = await resolveAppleSongIdFallback(payload);
    if (fallbackId) {
      payload.fallback_itunes_id = fallbackId;
    }
  }

  try {
    const resp = await sendToTabWithAutoInject(tab.id, targetPlatform, {
      source: "amdw-bridge",
      command,
      payload,
    });
    if (resp && resp.autoplayBlocked) {
      sendWS({
        type: "autoplay_blocked",
        platform: targetPlatform,
        tabId: tab.id,
        detail: "Clique une fois dans l'onglet Apple Music / lecteur pour autoriser l'audio.",
      });
    }
  } catch (err) {
    sendWS({ type: "error", platform: targetPlatform, detail: String(err) });
  }
}

// Relay telemetry & errors from content scripts to backend
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "amdw-state") {
    sendWS({ type: "state", data: message.data });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-autoplay-blocked") {
    sendWS({
      type: "autoplay_blocked",
      platform: message.platform || "apple_music",
      tabId: sender?.tab?.id,
      detail: message.detail || "Clique une fois dans l'onglet Apple Music pour autoriser l'audio.",
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-error") {
    lastBridgeError = message.detail || "Erreur lecteur externe.";
    recordBridgeLog({ ts: new Date().toISOString(), level: "error", message: lastBridgeError });
    sendWS({
      type: "error",
      platform: message.platform || "apple_music",
      detail: lastBridgeError,
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-track-ended") {
    sendWS({
      type: "track_ended",
      platform: message.platform || "apple_music",
      data: message.data || {},
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-resolved-mapping") {
    sendWS({
      type: "resolved_mapping",
      track_key: message.data?.track_key,
      apple_song_id: message.data?.apple_song_id,
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-debug-log") {
    recordBridgeLog(message.entry);
    sendWS({
      type: "bridge_log",
      platform: message.platform || "apple_music",
      entry: message.entry,
    });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-popup-status") {
    scanOpenPlatforms().then((platforms) => {
      sendResponse({
        connected,
        reconnectAttempts,
        lastConnectedAt,
        platforms,
        lastError: lastBridgeError,
        logs: recentBridgeLogs,
      });
    });
    return true;
  }
  if (message?.type === "amdw-focus-tab" && message.tabId) {
    chrome.tabs.update(message.tabId, { active: true });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    announcePlatforms();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  announcePlatforms();
});

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    connectWS();
  }
});

connectWS();
