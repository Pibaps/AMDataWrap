chrome.runtime.sendMessage({ type: "amdw-popup-status" }, (resp) => {
  const statusEl = document.getElementById("status");
  const listEl = document.getElementById("platforms");
  if (!resp) return;
  statusEl.textContent = resp.connected ? "Connecté à AMDataWrap (127.0.0.1:8000)" : "Backend hors ligne";
  statusEl.className = `badge ${resp.connected ? "ok" : "off"}`;

  if (!resp.platforms || resp.platforms.length === 0) {
    listEl.innerHTML = "<li>Ouvre music.apple.com, open.spotify.com ou music.youtube.com</li>";
    return;
  }
  for (const p of resp.platforms) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = p.platform;
    const btn = document.createElement("button");
    btn.textContent = "Focus";
    btn.onclick = () => chrome.runtime.sendMessage({ type: "amdw-focus-tab", tabId: p.tabId });
    li.appendChild(span);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
});
