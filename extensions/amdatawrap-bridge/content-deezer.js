/**
 * Content script for https://www.deezer.com/* (AMDataWrap V4.1 Bridge)
 * Bidirectional control (play, pause, toggle, seek, next, prev, play_track) + live state telemetry.
 * 0 € — controls the user's already-open Deezer web tab without any paid API key.
 */
(() => {
  const parseClock = (txt) => {
    if (!txt) return 0;
    const parts = txt.trim().split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.length === 2 ? (parts[0] * 60 + parts[1]) * 1000 : 0;
  };

  function findPlayPauseButton() {
    return (
      document.querySelector('[data-testid="play_button_pause"]') ||
      document.querySelector('[data-testid="play_button_play"]') ||
      document.querySelector('button[aria-label*="Pause" i]') ||
      document.querySelector('button[aria-label*="Lire" i]') ||
      document.querySelector('button[aria-label*="Play" i]')
    );
  }

  function readState() {
    const titleEl =
      document.querySelector('[data-testid="item_title"] a') ||
      document.querySelector('[data-testid="item_title"]') ||
      document.querySelector(".track-link[href*='/track/']");
    const artistEl =
      document.querySelector('[data-testid="item_subtitle"] a') ||
      document.querySelector('[data-testid="item_subtitle"]') ||
      document.querySelector(".track-link[href*='/artist/']");
    const artEl =
      document.querySelector('[data-testid="item_cover"] img') ||
      document.querySelector(".player-cover img");

    const pauseBtn =
      document.querySelector('[data-testid="play_button_pause"]') ||
      document.querySelector('button[aria-label*="Pause" i]');
    const isPlaying = Boolean(pauseBtn);

    const posEl = document.querySelector('[data-testid="elapsed_time"]');
    const durEl = document.querySelector('[data-testid="remaining_time"]');

    const song = titleEl?.textContent?.trim() || "";
    if (!song) return null;
    return {
      platform: "deezer",
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

    const playPauseBtn = findPlayPauseButton();
    const nextBtn =
      document.querySelector('[data-testid="next_track_button"]') ||
      document.querySelector('button[aria-label*="Suivant" i]') ||
      document.querySelector('button[aria-label*="Next" i]');
    const prevBtn =
      document.querySelector('[data-testid="previous_track_button"]') ||
      document.querySelector('button[aria-label*="Précédent" i]') ||
      document.querySelector('button[aria-label*="Previous" i]');

    if (command === "play_track") {
      if (payload?.url) {
        window.location.href = payload.url;
      } else if (payload?.query || payload?.song_name) {
        const q = encodeURIComponent(payload.query || `${payload.artist_name || ""} ${payload.song_name || ""}`.trim());
        window.location.href = `https://www.deezer.com/search/${q}/track`;
      }
    } else if (command === "play") {
      const isPaused = Boolean(document.querySelector('[data-testid="play_button_play"]'));
      if (isPaused || !document.querySelector('[data-testid="play_button_pause"]')) {
        playPauseBtn?.click();
      }
    } else if (command === "pause") {
      const pauseBtn = document.querySelector('[data-testid="play_button_pause"]');
      pauseBtn?.click();
    } else if (command === "toggle") {
      playPauseBtn?.click();
    } else if (command === "next") {
      nextBtn?.click();
    } else if (command === "prev") {
      prevBtn?.click();
    } else if (command === "seek" && typeof payload?.position_ms === "number") {
      const slider = document.querySelector('input[type="range"][aria-label*="seek" i], [data-testid="seekbar"] input[type="range"]');
      const dur = parseClock(document.querySelector('[data-testid="remaining_time"]')?.textContent) || payload?.duration_ms || 0;
      if (slider && dur > 0) {
        const pct = Math.max(0, Math.min(100, (payload.position_ms / dur) * 100));
        slider.value = String(pct);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        slider.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    sendResponse({ ok: true });
    return true;
  });
})();
