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
let connected = false;

const PLATFORM_PATTERNS = {
  apple_music: "https://music.apple.com/*",
  spotify: "https://open.spotify.com/*",
  youtube_music: "https://music.youtube.com/*",
};

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
  sendWS({ type: "hello", version: "4.0.0", platforms });
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

function connectWS() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    connected = false;
    return;
  }

  socket.onopen = async () => {
    connected = true;
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
  };

  socket.onerror = () => {
    connected = false;
  };
}

async function handleBackendCommand(msg) {
  const targetPlatform = msg.platform || "apple_music";
  const pattern = PLATFORM_PATTERNS[targetPlatform];
  if (!pattern) return;

  let tabs = await chrome.tabs.query({ url: pattern });
  if (tabs.length === 0) {
    // Open the web player tab if not already open
    const defaultUrls = {
      apple_music: "https://music.apple.com/",
      spotify: "https://open.spotify.com/",
      youtube_music: "https://music.youtube.com/",
    };
    const created = await chrome.tabs.create({ url: defaultUrls[targetPlatform], active: false });
    tabs = [created];
    await new Promise((r) => setTimeout(r, 2500));
  }

  const tab = tabs[0];
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      source: "amdw-bridge",
      command: msg.command || msg.type,
      payload: msg.payload || msg,
    });
    if (resp && resp.autoplayBlocked) {
      sendWS({
        type: "autoplay_blocked",
        platform: targetPlatform,
        tabId: tab.id,
        detail: "Clique dans l'onglet du lecteur ou sur « Focus onglet » pour autoriser l'audio.",
      });
    }
  } catch (err) {
    sendWS({ type: "error", platform: targetPlatform, detail: String(err) });
  }
}

// Relay telemetry from content scripts to backend
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "amdw-state") {
    sendWS({ type: "state", data: message.data });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "amdw-popup-status") {
    scanOpenPlatforms().then((platforms) => {
      sendResponse({ connected, platforms });
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
