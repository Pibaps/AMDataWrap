/**
 * Content script for https://music.apple.com/*
 * Injects `apple-main-bridge.js` into MAIN world and relays commands/state.
 */
(() => {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("apple-main-bridge.js");
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.source !== "amdw-apple-main") return;
    if (ev.data.type === "state" && ev.data.data?.song_name) {
      chrome.runtime.sendMessage({ type: "amdw-state", data: ev.data.data });
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.source !== "amdw-bridge") return false;
    window.postMessage(
      { source: "amdw-apple-cmd", command: msg.command, payload: msg.payload },
      "*"
    );
    sendResponse({ ok: true });
    return true;
  });
})();
