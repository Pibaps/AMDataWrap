import { formatHours, formatInt } from "../api/client";
import type { WrappedData } from "../api/types";

const SCALE = 2.5;

function loadProxyImage(url?: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const proxied = url.startsWith("/api/")
      ? url
      : `/api/artwork-proxy?url=${encodeURIComponent(url)}&w=600&fmt=jpeg`;
    const timer = window.setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = proxied;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas export failed"));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, "image/png");
  });
}

export async function exportWrappedPosterPng(
  data: WrappedData,
  locale: "fr" | "en",
): Promise<void> {
  const W = 540;
  const H = 860;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(SCALE, SCALE);

  const [artistImg, trackImg, albumImg] = await Promise.all([
    loadProxyImage(data.top_artist?.artwork_url),
    loadProxyImage(data.top_track?.artwork_url),
    loadProxyImage(data.top_album?.artwork_url),
  ]);

  // Background — Salon d'écoute dark liner notes
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0b0b10");
  bg.addColorStop(0.55, "#12121a");
  bg.addColorStop(1, "#09090d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Warm ambient glow
  const glow = ctx.createRadialGradient(W * 0.78, 120, 20, W * 0.78, 120, 280);
  glow.addColorStop(0, "rgba(255, 69, 58, 0.16)");
  glow.addColorStop(1, "rgba(255, 69, 58, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Frame
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, 20, 20, W - 40, H - 40, 14);
  ctx.stroke();

  // Header
  ctx.fillStyle = "#ff453a";
  ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("AMDATAWRAP // SALON D'ÉCOUTE", 40, 56);

  ctx.fillStyle = "#f4f4f5";
  ctx.font = "700 28px Georgia, 'Times New Roman', serif";
  const title = locale === "en" ? "Listening Poster" : "Affiche d'Écoute";
  ctx.fillText(title, 40, 92);

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(fitText(ctx, data.period_label || "2024", W - 80), 40, 116);

  // KPI strip
  const kpiY = 142;
  const kpiW = (W - 80 - 24) / 3;
  const kpis = [
    {
      label: locale === "en" ? "TOTAL TIME" : "TEMPS TOTAL",
      value: formatHours(data.kpis.total_ms),
    },
    {
      label: locale === "en" ? "PLAYS" : "ÉCOUTES",
      value: formatInt(data.kpis.plays),
    },
    {
      label: locale === "en" ? "ACTIVE DAYS" : "JOURS ACTIFS",
      value: formatInt(data.kpis.active_days),
    },
  ];
  kpis.forEach((k, idx) => {
    const x = 40 + idx * (kpiW + 12);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    drawRoundedRect(ctx, x, kpiY, kpiW, 68, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    ctx.fillStyle = "#71717a";
    ctx.font = "600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(k.label, x + 12, kpiY + 22);

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 19px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(fitText(ctx, k.value, kpiW - 24), x + 12, kpiY + 50);
  });

  // Top Artist Hero Card
  const heroY = 232;
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  drawRoundedRect(ctx, 40, heroY, W - 80, 172, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.stroke();

  if (artistImg) {
    ctx.save();
    drawRoundedRect(ctx, 58, heroY + 18, 136, 136, 10);
    ctx.clip();
    ctx.drawImage(artistImg, 58, heroY + 18, 136, 136);
    ctx.restore();
  } else {
    ctx.fillStyle = "#18181b";
    drawRoundedRect(ctx, 58, heroY + 18, 136, 136, 10);
    ctx.fill();
  }

  ctx.fillStyle = "#ff453a";
  ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(locale === "en" ? "#1 ARTIST" : "ARTISTE #1", 214, heroY + 42);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 24px Georgia, 'Times New Roman', serif";
  ctx.fillText(
    fitText(ctx, data.top_artist?.artist_name || "—", W - 270),
    214,
    heroY + 76,
  );

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "500 12.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  const artistMeta = data.top_artist
    ? `${formatInt(data.top_artist.plays)} ${locale === "en" ? "plays" : "écoutes"} · ${formatHours(data.top_artist.total_ms)}`
    : "—";
  ctx.fillText(fitText(ctx, artistMeta, W - 270), 214, heroY + 104);

  if (data.top_artist?.signature_song) {
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "italic 12px Georgia, 'Times New Roman', serif";
    ctx.fillText(
      fitText(
        ctx,
        `${locale === "en" ? "Signature:" : "Titre signature :"} ${data.top_artist.signature_song}`,
        W - 270,
      ),
      214,
      heroY + 132,
    );
  }

  // Top Track & Top Album cards
  const cards = [
    {
      label: locale === "en" ? "#1 TRACK" : "TITRE #1",
      title: data.top_track?.song_name || "—",
      sub: data.top_track?.artist_name || "—",
      stat: data.top_track ? `${formatInt(data.top_track.plays)} ${locale === "en" ? "plays" : "écoutes"}` : "—",
      img: trackImg,
    },
    {
      label: locale === "en" ? "#1 ALBUM" : "ALBUM #1",
      title: data.top_album?.album_name || "—",
      sub: data.top_album?.artist_name || "—",
      stat: data.top_album ? formatHours(data.top_album.total_ms) : "—",
      img: albumImg,
    },
  ];

  cards.forEach((c, idx) => {
    const y = 424 + idx * 116;
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    drawRoundedRect(ctx, 40, y, W - 80, 98, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    if (c.img) {
      ctx.save();
      drawRoundedRect(ctx, 56, y + 14, 70, 70, 8);
      ctx.clip();
      ctx.drawImage(c.img, 56, y + 14, 70, 70);
      ctx.restore();
    } else {
      ctx.fillStyle = "#18181b";
      drawRoundedRect(ctx, 56, y + 14, 70, 70, 8);
      ctx.fill();
    }

    ctx.fillStyle = "#ff453a";
    ctx.font = "700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(c.label, 144, y + 28);

    ctx.fillStyle = "#fafafa";
    ctx.font = "700 17px Georgia, 'Times New Roman', serif";
    ctx.fillText(fitText(ctx, c.title, W - 204), 144, y + 54);

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(fitText(ctx, `${c.sub} · ${c.stat}`, W - 204), 144, y + 76);
  });

  // Footer highlights
  const footY = 668;
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  drawRoundedRect(ctx, 40, footY, W - 80, 124, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.stroke();

  ctx.fillStyle = "#71717a";
  ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(locale === "en" ? "LINER NOTES" : "NOTES DE POCHETTE", 58, footY + 26);

  ctx.fillStyle = "#e4e4e7";
  ctx.font = "500 12.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  const loopText = data.top_loop
    ? `${locale === "en" ? "Obsession:" : "Obsession :"} ${data.top_loop.song_name} (${data.top_loop.max_consecutive}×)`
    : `${locale === "en" ? "Sessions:" : "Sessions :"} ${formatInt(data.kpis.total_sessions)}`;
  ctx.fillText(fitText(ctx, loopText, W - 116), 58, footY + 54);

  const phaseText = data.top_phase
    ? `${locale === "en" ? "Phase:" : "Phase :"} ${data.top_phase.artist_name} (${data.top_phase.start_date} → ${data.top_phase.end_date})`
    : data.rhythm?.peak_hour != null
      ? `${locale === "en" ? "Peak hour:" : "Heure de pointe :"} ${String(data.rhythm.peak_hour).padStart(2, "0")}:00`
      : "";
  ctx.fillText(fitText(ctx, phaseText, W - 116), 58, footY + 80);

  if (data.equivalents?.[0]) {
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(
      fitText(ctx, `${data.equivalents[0].label}: ${data.equivalents[0].value}`, W - 116),
      58,
      footY + 104,
    );
  }

  ctx.fillStyle = "#52525b";
  ctx.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("AMDataWrap V4.5 · HD Poster Export", 40, H - 36);

  await downloadCanvasPng(canvas, `amdatawrap-poster-${Date.now()}.png`);
}

export async function exportWrappedReceiptPng(
  data: WrappedData,
  locale: "fr" | "en",
): Promise<void> {
  const W = 460;
  const H = 780;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(SCALE, SCALE);

  const artistImg = await loadProxyImage(data.top_artist?.artwork_url);

  // Paper ticket on dark matte backdrop
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#141418";
  drawRoundedRect(ctx, 24, 24, W - 48, H - 48, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#fafafa";
  ctx.font = "700 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("AMDATAWRAP COLLECTOR", 48, 70);

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(
    `${locale === "en" ? "RECEIPT" : "TICKET"} · ${fitText(ctx, data.period_label || "", 260)}`,
    48,
    92,
  );

  // Dashed divider
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(48, 114);
  ctx.lineTo(W - 48, 114);
  ctx.stroke();
  ctx.setLineDash([]);

  if (artistImg) {
    ctx.save();
    drawRoundedRect(ctx, W - 124, 130, 76, 76, 8);
    ctx.clip();
    ctx.drawImage(artistImg, W - 124, 130, 76, 76);
    ctx.restore();
  }

  const rows: Array<[string, string]> = [
    [locale === "en" ? "TOTAL PLAYS" : "TOTAL ÉCOUTES", formatInt(data.kpis.plays)],
    [locale === "en" ? "LISTENING TIME" : "TEMPS D'ÉCOUTE", formatHours(data.kpis.total_ms)],
    [locale === "en" ? "ACTIVE DAYS" : "JOURS ACTIFS", formatInt(data.kpis.active_days)],
    [locale === "en" ? "SESSIONS" : "SESSIONS", formatInt(data.kpis.total_sessions)],
    [locale === "en" ? "TOP ARTIST" : "ARTISTE #1", data.top_artist?.artist_name || "—"],
    [locale === "en" ? "TOP TRACK" : "TITRE #1", data.top_track?.song_name || "—"],
    [locale === "en" ? "TOP ALBUM" : "ALBUM #1", data.top_album?.album_name || "—"],
    [
      locale === "en" ? "TOP LOOP" : "BOUCLE #1",
      data.top_loop ? `${data.top_loop.song_name} (${data.top_loop.max_consecutive}×)` : "—",
    ],
    [
      locale === "en" ? "PEAK HOUR" : "HEURE DE POINTE",
      data.rhythm?.peak_hour != null ? `${String(data.rhythm.peak_hour).padStart(2, "0")}:00` : "—",
    ],
  ];

  let y = 152;
  rows.forEach(([k, v], i) => {
    const maxValW = i < 2 && artistImg ? W - 190 : W - 104;
    ctx.fillStyle = "#71717a";
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(k, 48, y);

    ctx.fillStyle = "#f4f4f5";
    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(fitText(ctx, v, maxValW), 48, y + 18);
    y += 52;
  });

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(48, H - 108);
  ctx.lineTo(W - 48, H - 108);
  ctx.stroke();
  ctx.setLineDash([]);

  // Barcode-style stripes
  for (let x = 48; x < W - 48; x += 6) {
    const barW = (x % 18 === 0) ? 3 : 1.5;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(x, H - 90, barW, 24);
  }

  ctx.fillStyle = "#71717a";
  ctx.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("AMDATAWRAP V4.5 // COLLECTOR EDITION", 48, H - 46);

  await downloadCanvasPng(canvas, `amdatawrap-ticket-${Date.now()}.png`);
}
