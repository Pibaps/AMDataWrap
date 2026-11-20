/**
 * Content script for https://open.spotify.com/*
 * Uses resilient ARIA/data-testid selectors (WebNowPlaying-Redux pattern) + URL navigation.
 */
(() => {
  function readState() {
    const titleEl =
      document.querySelector('[data-testid="context-item-info-title"] a') ||
      document.querySelector('[data-testid="nowplaying-track-link"]');
    const artistEl =
      document.querySelector('[data-testid="context-item-info-subtitles"] a') ||
      document.querySelector('[data-testid="context-item-info-artist"]');
    const artEl = document.querySelector('[data-testid="cover-art-image"]');
    const playBtn = document.querySelector('[data-testid="control-button-playpause"]');
    const aria = (playBtn?.getAttribute("aria-label") || "").toLowerCase();
    const isPlaying = aria.includes("pause") || aria.includes("mettre en pause");
    const posEl = document.querySelector('[data-testid="playback-position"]');
    const durEl = document.querySelector('[data-testid="playback-duration"]');

    const parseClock = (txt) => {
      if (!txt) return 0;
      const parts = txt.trim().split(":").map(Number);
      if (parts.some(Number.isNaN)) return 0;
      return parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000 : 0;
    };

    const song = titleEl?.textContent?.trim() || "";
    if (!song) return null;
    return {
      platform: "spotify",
      song_name: song,
      artist_name: artistEl?.textContent?.trim() || "",
      album_name: "",
      artwork_url: artEl?.getAttribute("src") || null,
      position_ms: parseClock(posEl?.textContent),
      duration_ms: parseClock(durEl?.textContent),
      is_playing: isPlaying,
    };
  }

  setInterval(() => {
    const st = readState();
    if (st) chrome.runtime.sendMessage({ type: "amdw-state", data: st });
  }, 2000);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.source !== "amdw-bridge") return false;
    const { command, payload } = msg;
    const playBtn = document.querySelector('[data-testid="control-button-playpause"]');
    const nextBtn = document.querySelector('[data-testid="control-button-skip-forward"]');
    const prevBtn = document.querySelector('[data-testid="control-button-skip-back"]');

    if (command === "play_track" && payload?.url) {
      window.location.href = payload.url;
    } else if (command === "play" || command === "pause" || command === "toggle") {
      playBtn?.click();
    } else if (command === "next") {
      nextBtn?.click();
    } else if (command === "prev") {
      prevBtn?.click();
    }
    sendResponse({ ok: true });
    return true;
  });
})();
