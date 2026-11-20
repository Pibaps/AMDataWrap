/**
 * Procedural high-resolution Canvas textures for the 3D Vinyl Studio:
 * - Authentic Back-Cover Pressing (Faces A/B/C/D, Label, Catalog #, Year/Country, Barcode, Personal Stats)
 * - Concentric Vinyl Microgrooves (proportional to track durations on the active side)
 * - Authentic Center Record Label ("Macaron")
 */

import * as THREE from "three";
import { formatDurationMs, type VinylDetail, type VinylSide } from "../api/client";

export function createVinylGroovesTexture(
  side: VinylSide | undefined,
  vinylColorHex: string = "#111114",
  size = 512
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.49;
  const minR = size * 0.175;

  ctx.fillStyle = vinylColorHex || "#111114";
  ctx.fillRect(0, 0, size, size);

  // Subtle anisotropic sheen gradient
  const sheen = ctx.createConicGradient(0, cx, cy);
  sheen.addColorStop(0, "rgba(255,255,255,0.02)");
  sheen.addColorStop(0.18, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.32, "rgba(255,255,255,0.02)");
  sheen.addColorStop(0.68, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.84, "rgba(255,255,255,0.02)");
  sheen.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.fill();

  // Fine concentric microgrooves
  for (let r = minR; r < maxR; r += 2.2) {
    ctx.strokeStyle = r % 4.4 < 2.2 ? "rgba(255,255,255,0.065)" : "rgba(0,0,0,0.45)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Proportional lead-in / track gap bands based on actual side track durations
  const tracks = side?.tracks || [];
  const totalMs = Math.max(1, tracks.reduce((acc, t) => acc + (t.duration_ms || 180000), 0));
  let accMs = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    accMs += tracks[i].duration_ms || 180000;
    const ratio = accMs / totalMs;
    const gapR = maxR - ratio * (maxR - minR);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(cx, cy, gapR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center label ("Macaron")
  const labelGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, minR * 0.96);
  labelGrad.addColorStop(0, "#ec4899");
  labelGrad.addColorStop(0.65, "#6366f1");
  labelGrad.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = labelGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, minR * 0.95, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f4f1ea";
  ctx.font = `700 ${Math.round(size * 0.038)}px "Syne", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`FACE ${side?.side || "A"}`, cx, cy - minR * 0.34);
  ctx.font = `500 ${Math.round(size * 0.025)}px "JetBrains Mono", monospace`;
  ctx.fillText("33⅓ RPM · STEREO", cx, cy + minR * 0.48);

  // Spindle hole
  ctx.fillStyle = "#08080c";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.022, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createGeneratedBackCoverDataUrl(vinyl: VinylDetail): string {
  const size = 800;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Matte vintage sleeve paper background
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, "#14141d");
  bg.addColorStop(1, "#0b0b12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Fine border
  ctx.strokeStyle = "rgba(244,241,234,0.16)";
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, size - 56, size - 56);

  // Header
  ctx.fillStyle = "#f4f1ea";
  ctx.font = '800 34px "Syne", sans-serif';
  ctx.fillText(vinyl.album_name.slice(0, 34), 56, 94);
  ctx.fillStyle = "rgba(244,241,234,0.72)";
  ctx.font = 'italic 26px "Instrument Serif", Georgia, serif';
  ctx.fillText(vinyl.artist_name.slice(0, 40), 56, 130);

  // Pressing badge
  ctx.fillStyle = "#ec4899";
  ctx.font = '600 15px "JetBrains Mono", monospace';
  const pressMeta = `${vinyl.label_name}  ·  ${vinyl.catalog_number}  ·  ${vinyl.country || "XW"} ${vinyl.release_year || ""}`;
  ctx.fillText(pressMeta.slice(0, 62), 56, 166);

  // Tracklist per side
  let y = 216;
  for (const side of vinyl.sides.slice(0, 2)) {
    ctx.fillStyle = "#a5b4fc";
    ctx.font = '700 18px "Syne", sans-serif';
    ctx.fillText(`FACE ${side.side}  (${formatDurationMs(side.total_duration_ms)})`, 56, y);
    y += 28;
    ctx.font = '500 16px "JetBrains Mono", monospace';
    for (const tr of side.tracks.slice(0, 7)) {
      ctx.fillStyle = "rgba(244,241,234,0.9)";
      ctx.fillText(`${tr.number.padEnd(3)} ${tr.title.slice(0, 38)}`, 64, y);
      ctx.fillStyle = "rgba(244,241,234,0.52)";
      ctx.fillText(formatDurationMs(tr.duration_ms), size - 130, y);
      y += 26;
    }
    y += 16;
  }

  // Personal stats box + stylized barcode
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(56, size - 136, 420, 78);
  ctx.fillStyle = "#f4f1ea";
  ctx.font = '600 15px "JetBrains Mono", monospace';
  ctx.fillText(`TES ÉCOUTES : ${vinyl.total_plays} PLAYS`, 74, size - 104);
  ctx.fillStyle = "rgba(244,241,234,0.68)";
  ctx.fillText(`TEMPS CUMULÉ : ${(vinyl.total_ms / 3_600_000).toFixed(1)} H`, 74, size - 76);

  // Barcode
  let bx = size - 210;
  for (let i = 0; i < 34; i++) {
    const w = ((i * 7 + vinyl.album_name.length) % 3) + 1.5;
    ctx.fillStyle = i % 2 === 0 ? "#f4f1ea" : "transparent";
    ctx.fillRect(bx, size - 132, w, 58);
    bx += w + 2;
  }
  ctx.fillStyle = "rgba(244,241,234,0.6)";
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillText(vinyl.catalog_number, size - 210, size - 58);

  return canvas.toDataURL("image/jpeg", 0.9);
}
