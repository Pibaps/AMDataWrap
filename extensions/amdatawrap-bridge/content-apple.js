/**
 * Content script for https://music.apple.com/*
 * Injects `apple-main-bridge.js` into MAIN world and relays commands/state/events/errors.
 */
(() => {
  if (window.__AMDW_APPLE_CS__) return;
  window.__AMDW_APPLE_CS__ = true;

  function safeSendMessage(payload) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch {
      /* Extension context invalidated after reload — tab refresh will rebind */
    }
  }

  function injectMainBridge() {
    try {
      if (!chrome?.runtime?.id) return;
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("apple-main-bridge.js");
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch {
      /* ignore if context invalidated */
    }
  }

  injectMainBridge();

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.source !== "amdw-apple-main") return;
    const msgType = ev.data.type;
    if (msgType === "state" && ev.data.data) {
      safeSendMessage({ type: "amdw-state", data: ev.data.data });
    } else if (msgType === "track_ended") {
      safeSendMessage({ type: "amdw-track-ended", platform: "apple_music", data: ev.data.data || {} });
    } else if (msgType === "resolved_mapping") {
      safeSendMessage({ type: "amdw-resolved-mapping", data: ev.data.data || {} });
    } else if (msgType === "autoplay_blocked") {
      safeSendMessage({
        type: "amdw-autoplay-blocked",
        platform: "apple_music",
        detail: ev.data.detail || "Clique une fois dans l'onglet Apple Music pour autoriser l'audio.",
      });
    } else if (msgType === "error") {
      safeSendMessage({
        type: "amdw-error",
        platform: "apple_music",
        detail: ev.data.detail || "Erreur Apple Music Web.",
      });
    } else if (msgType === "debug_log") {
      safeSendMessage({ type: "amdw-debug-log", platform: "apple_music", entry: ev.data.entry });
    }
  });

  try {
    if (chrome?.runtime?.id) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.source !== "amdw-bridge") return false;
        window.postMessage(
          { source: "amdw-apple-cmd", command: msg.command, payload: msg.payload },
          "*"
        );
        sendResponse({ ok: true });
        return true;
      });
    }
  } catch {
    /* ignore */
  }
})();
