/**
 * Content script for https://music.youtube.com/*
 * Directly drives `<video>` / `#movie_player` for 0 EUR full-track playback & seek.
 */
(() => {
  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function readState() {
    const titleEl = document.querySelector("ytmusic-player-bar .title");
    const bylineEl = document.querySelector("ytmusic-player-bar .byline");
    const artEl = document.querySelector("ytmusic-player-bar img.image");
    const video = getVideo();
    const song = titleEl?.textContent?.trim() || "";
    if (!song) return null;
    const bylineParts = (bylineEl?.textContent || "").split("•").map((s) => s.trim());
    return {
      platform: "youtube_music",
      song_name: song,
      artist_name: bylineParts[0] || "",
      album_name: bylineParts[1] || "",
      artwork_url: artEl?.getAttribute("src") || null,
      position_ms: video ? Math.round((video.currentTime || 0) * 1000) : 0,
      duration_ms: video && Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      is_playing: video ? !video.paused : false,
    };
  }

  setInterval(() => {
    const st = readState();
    if (st) chrome.runtime.sendMessage({ type: "amdw-state", data: st });
  }, 1500);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.source !== "amdw-bridge") return false;
    const video = getVideo();
    const { command, payload } = msg;
    if (command === "play_track" && payload?.videoId) {
      window.location.href = `https://music.youtube.com/watch?v=${encodeURIComponent(payload.videoId)}`;
      sendResponse({ ok: true });
      return true;
    }
    if (command === "play" && video) {
      video.play().catch(() => sendResponse({ ok: false, autoplayBlocked: true }));
      return true;
    }
    if (command === "pause" && video) {
      video.pause();
    } else if (command === "seek" && video && typeof payload?.seconds === "number") {
      video.currentTime = payload.seconds;
    } else if (command === "next") {
      document.querySelector("ytmusic-player-bar .next-button")?.click();
    } else if (command === "prev") {
      document.querySelector("ytmusic-player-bar .previous-button")?.click();
    }
    sendResponse({ ok: true });
    return true;
  });
})();
