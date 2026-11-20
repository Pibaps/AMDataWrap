/**
 * Runs inside the MAIN world of https://music.apple.com to directly drive
 * `window.MusicKit.getInstance()` at 0 EUR (no Apple Developer key required).
 */
(() => {
  if (window.__AMDW_MUSICKIT_BRIDGE__) return;
  window.__AMDW_MUSICKIT_BRIDGE__ = true;

  function getMK() {
    try {
      return window.MusicKit && typeof window.MusicKit.getInstance === "function"
        ? window.MusicKit.getInstance()
        : null;
    } catch {
      return null;
    }
  }

  function emitState() {
    const mk = getMK();
    if (!mk) return;
    const item = mk.nowPlayingItem;
    const attrs = item?.attributes || {};
    const art = attrs.artwork?.url
      ? attrs.artwork.url.replace("{w}", "600").replace("{h}", "600")
      : null;
    window.postMessage(
      {
        source: "amdw-apple-main",
        type: "state",
        data: {
          platform: "apple_music",
          song_name: attrs.name || "",
          artist_name: attrs.artistName || "",
          album_name: attrs.albumName || "",
          artwork_url: art,
          duration_ms: Math.round((mk.currentPlaybackDuration || 0) * 1000),
          position_ms: Math.round((mk.currentPlaybackTime || 0) * 1000),
          is_playing: Boolean(mk.isPlaying),
        },
      },
      "*"
    );
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || ev.data?.source !== "amdw-apple-cmd") return;
    const mk = getMK();
    if (!mk) return;
    const { command, payload } = ev.data;
    try {
      if (command === "play_track" && payload?.songId) {
        await mk.setQueue({ song: String(payload.songId), startPlaying: true });
      } else if (command === "play") {
        await mk.play();
      } else if (command === "pause") {
        await mk.pause();
      } else if (command === "seek" && typeof payload?.seconds === "number") {
        await mk.seekToTime(payload.seconds);
      } else if (command === "next") {
        await mk.skipToNextItem();
      } else if (command === "prev") {
        await mk.skipToPreviousItem();
      }
      emitState();
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || String(err).includes("NotAllowed"))) {
        window.postMessage({ source: "amdw-apple-main", type: "autoplay_blocked" }, "*");
      }
    }
  });

  setInterval(emitState, 1500);
})();
