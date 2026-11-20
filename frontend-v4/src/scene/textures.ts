/**
 * Procedural textures for the listening room (no external assets):
 * wood, plaster, vinyl grooves (colour / roughness / anisotropy maps),
 * record labels, strobe dots, turntable top-plate printing, sleeve backs,
 * cover wear, felt slipmat.
 */

import * as THREE from "three";
import type { VinylDetail, VinylSide } from "../api/client";
import { formatDurationMs } from "../api/client";

// ---------------------------------------------------------------- helpers
function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Cheap 2D value noise. */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a: number, b: number) => hash(a * 157 + b * 311);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, oct = 4): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------------------------------------------------------------- wood
export function makeWoodTexture(base: string, dark: string, opts: { size?: number; rings?: number; seed?: number } = {}) {
  const size = opts.size ?? 256;
  const rings = opts.rings ?? 26;
  const seed = opts.seed ?? 1;
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const [br, bg, bb] = hexToRgb(base);
  const [dr, dg, db] = hexToRgb(dark);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const warp = fbm(nx * 3 + seed, ny * 0.6 + seed * 3, 4) * 2.2;
      const g = Math.sin((ny * rings + warp * 3.2) * Math.PI);
      let t = Math.pow(Math.abs(g), 0.35);
      const fine = vnoise(nx * 900, ny * 14 + seed) * 0.18;
      t = Math.min(1, Math.max(0, t * 0.82 + fine));
      const i = (y * size + x) * 4;
      img.data[i] = dr + (br - dr) * t;
      img.data[i + 1] = dg + (bg - dg) * t;
      img.data[i + 2] = db + (bb - db) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- plaster wall
export function makePlasterTexture(size = 256) {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 90, y / 90, 5);
      const n2 = vnoise(x / 3, y / 3) * 0.08;
      const v = 0.78 + n * 0.3 + n2;
      const i = (y * size + x) * 4;
      img.data[i] = 64 * v;
      img.data[i + 1] = 52 * v;
      img.data[i + 2] = 44 * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- felt slipmat
export function makeFeltTexture(size = 512) {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 14 + Math.random() * 10;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v + 1;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const cx = size / 2;
  ctx.save();
  ctx.translate(cx, cx);
  ctx.fillStyle = "rgba(220,214,204,0.55)";
  ctx.font = `600 ${size * 0.035}px Inter, sans-serif`;
  ctx.textAlign = "center";
  const text = "AMDATAWRAP  ·  SALON D'ÉCOUTE  ·  ";
  const radius = size * 0.43;
  const chars = text.split("");
  const step = (Math.PI * 1.15) / chars.length;
  ctx.rotate(-Math.PI / 2 - (chars.length * step) / 2);
  for (const ch of chars) {
    ctx.save();
    ctx.translate(0, -radius);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    ctx.rotate(step);
  }
  ctx.restore();
  return toTexture(c);
}

// ---------------------------------------------------------------- vinyl grooves
export const RECORD_R = 1.524; // 12"
export const LABEL_R = 0.5;
export const GROOVE_OUTER_R = 1.46;
export const GROOVE_INNER_R = 0.64;

export interface GrooveMaps {
  map: THREE.CanvasTexture;
}

/**
 * Fast vector-drawn vinyl groove texture using native 2D canvas arcs & conic sheen
 * (~1.5 ms instead of 260,000 pixel loops!). Track gaps are placed proportionally
 * to the real track durations of the active side.
 */
export function makeGrooveMaps(side: VinylSide | undefined, vinylHex = "#0d0d0e", size = 384): GrooveMaps {
  const [c, ctx] = canvas(size);
  const cx = size / 2;
  const maxR = size * 0.495;
  const outerGrooveR = size * (GROOVE_OUTER_R / RECORD_R) * 0.5;
  const innerGrooveR = size * (GROOVE_INNER_R / RECORD_R) * 0.5;

  let [vr, vg, vb] = hexToRgb(vinylHex || "#0d0d0e");
  const lum = 0.2126 * vr + 0.7152 * vg + 0.0722 * vb;
  if (lum > 55) {
    const k = 55 / lum;
    vr = Math.round(vr * k);
    vg = Math.round(vg * k);
    vb = Math.round(vb * k);
  }
  ctx.fillStyle = `rgb(${vr},${vg},${vb})`;
  ctx.fillRect(0, 0, size, size);

  // Anisotropic dual-lobe vinyl sheen baked via conic gradient
  const sheen = ctx.createConicGradient(0.35, cx, cx);
  sheen.addColorStop(0.0, "rgba(255,248,236,0.01)");
  sheen.addColorStop(0.14, "rgba(255,248,236,0.17)");
  sheen.addColorStop(0.28, "rgba(255,248,236,0.01)");
  sheen.addColorStop(0.5, "rgba(255,248,236,0.01)");
  sheen.addColorStop(0.64, "rgba(255,248,236,0.16)");
  sheen.addColorStop(0.78, "rgba(255,248,236,0.01)");
  sheen.addColorStop(1.0, "rgba(255,248,236,0.01)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(cx, cx, maxR, 0, Math.PI * 2);
  ctx.fill();

  // Concentric microgrooves
  ctx.lineWidth = 0.75;
  for (let r = innerGrooveR; r <= outerGrooveR; r += 1.9) {
    ctx.strokeStyle = (Math.round(r) & 1) === 0 ? "rgba(255,250,240,0.06)" : "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.arc(cx, cx, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Smooth track-gap bands proportional to track durations
  const tracks = side?.tracks?.length ? side.tracks : [{ duration_ms: 220000 }, { duration_ms: 200000 }, { duration_ms: 240000 }];
  const total = Math.max(1, tracks.reduce((a, t) => a + (t.duration_ms || 200000), 0));
  let acc = 0;
  ctx.strokeStyle = "rgba(255,248,236,0.22)";
  ctx.lineWidth = 1.8;
  for (let i = 0; i < tracks.length - 1; i++) {
    acc += tracks[i].duration_ms || 200000;
    const gr = outerGrooveR - (acc / total) * (outerGrooveR - innerGrooveR);
    ctx.beginPath();
    ctx.arc(cx, cx, gr, 0, Math.PI * 2);
    ctx.stroke();
  }

  return { map: toTexture(c) };
}

/** Radius (world units) where a given side-relative time sits on the record. */
export function radiusForSideTime(side: VinylSide | undefined, sideMs: number): number {
  const total = Math.max(1, side?.total_duration_ms || side?.tracks?.reduce((a, t) => a + (t.duration_ms || 0), 0) || 1);
  const f = Math.min(1, Math.max(0, sideMs / total));
  return GROOVE_OUTER_R - f * (GROOVE_OUTER_R - GROOVE_INNER_R);
}

export function sideTimeForRadius(side: VinylSide | undefined, r: number): number {
  const total = Math.max(1, side?.total_duration_ms || side?.tracks?.reduce((a, t) => a + (t.duration_ms || 0), 0) || 1);
  const f = (GROOVE_OUTER_R - r) / (GROOVE_OUTER_R - GROOVE_INNER_R);
  return Math.min(1, Math.max(0, f)) * total;
}

// ---------------------------------------------------------------- record label
function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, radius: number, startAngle: number, spread: number, inward = false) {
  const chars = text.split("");
  if (!chars.length) return;
  const step = spread / chars.length;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(startAngle);
  for (const ch of chars) {
    ctx.save();
    if (inward) {
      ctx.translate(0, radius);
      ctx.rotate(Math.PI);
    } else {
      ctx.translate(0, -radius);
    }
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    ctx.rotate(inward ? -step : step);
  }
  ctx.restore();
}

export function makeLabelTexture(
  info: { album: string; artist: string; label: string; catalog: string; year: number | null; side: string; tracks: Array<{ number: string; title: string; duration_ms: number }> },
  paper: string,
  rpm: 33 | 45 = 33,
  size = 512
) {
  const [c, ctx] = canvas(size);
  const cx = size / 2;
  ctx.clearRect(0, 0, size, size);
  // paper
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.fill();
  // paper grain & print ring
  for (let i = 0; i < 1600; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * cx;
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    ctx.fillRect(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 1.5, 1.5);
  }
  const [pr, pg, pb] = hexToRgb(paper);
  const light = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb > 140;
  const ink = light ? "rgba(24,18,14,0.92)" : "rgba(246,238,226,0.94)";
  const ink2 = light ? "rgba(24,18,14,0.62)" : "rgba(246,238,226,0.62)";
  ctx.strokeStyle = ink2;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cx, cx * 0.93, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // label name arched on top
  ctx.font = `700 ${size * 0.05}px Inter, sans-serif`;
  const labelTxt = (info.label || "AMDW RECORDS").toUpperCase().slice(0, 28);
  arcText(ctx, labelTxt, cx, cx, cx * 0.8, -Math.min(1.5, labelTxt.length * 0.075) / 2 - 0.0, Math.min(1.5, labelTxt.length * 0.075));

  // title & artist under the hole
  ctx.font = `600 ${size * 0.058}px Fraunces, Georgia, serif`;
  ctx.fillText(info.artist.slice(0, 26), cx, cx + size * 0.14);
  ctx.font = `italic 400 ${size * 0.05}px Fraunces, Georgia, serif`;
  ctx.fillText(info.album.slice(0, 30), cx, cx + size * 0.205);

  // side & speed
  ctx.font = `700 ${size * 0.11}px Fraunces, Georgia, serif`;
  ctx.fillText(info.side, cx + size * 0.28, cx - size * 0.02);
  ctx.font = `600 ${size * 0.034}px Inter, sans-serif`;
  ctx.fillStyle = ink2;
  ctx.fillText(`SIDE`, cx + size * 0.28, cx - size * 0.1);
  ctx.fillText(rpm === 45 ? "45 RPM" : "33⅓ RPM", cx - size * 0.28, cx - size * 0.06);
  ctx.fillText("STEREO", cx - size * 0.28, cx + size * 0.0);
  ctx.fillText(`${info.catalog || "—"}${info.year ? ` · ${info.year}` : ""}`, cx, cx - size * 0.16);

  // tracklist (bottom arc area)
  ctx.font = `500 ${size * 0.028}px Inter, sans-serif`;
  ctx.fillStyle = ink2;
  const tl = info.tracks.slice(0, 5);
  tl.forEach((t, i) => {
    ctx.fillText(`${t.number}  ${t.title.slice(0, 30)}  ${formatDurationMs(t.duration_ms)}`, cx, cx + size * 0.26 + i * size * 0.036);
  });

  // spindle hole
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.026, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  return toTexture(c);
}

// ---------------------------------------------------------------- platter strobe dots
export function makeStrobeTexture() {
  const w = 1024;
  const h = 64;
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#8d8f92");
  g.addColorStop(0.5, "#c9cbcd");
  g.addColorStop(1, "#7a7c7f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rows = [180, 183, 133, 135];
  rows.forEach((count, ri) => {
    const y = 14 + ri * 27;
    const step = w / count;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = "#2b2c2e";
      ctx.fillRect(i * step + step * 0.3, y, step * 0.42, 13);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(i * step + step * 0.3, y, step * 0.42, 2);
    }
  });
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- dial (counterweight / anti-skate)
export function makeDialSideTexture(marks: number, labelEvery: number, dark = true) {
  const w = 1024;
  const h = 128;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = dark ? "#151515" : "#c7c7c5";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? "#e8e2d6" : "#1a1a1a";
  ctx.font = "600 34px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < marks; i++) {
    const x = (i / marks) * w;
    const big = i % labelEvery === 0;
    ctx.fillRect(x, 0, 3, big ? 48 : 26);
    if (big) ctx.fillText(String((i / labelEvery) % 10), x, 92);
  }
  return toTexture(c);
}

export function makeRibTexture() {
  const [c, ctx] = canvas(256, 16);
  for (let x = 0; x < 256; x++) {
    const v = x % 8 < 4 ? 200 : 60;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, 16);
  }
  const t = toTexture(c, false);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

// ---------------------------------------------------------------- turntable top plate printing
export const PLINTH_W = 4.53;
export const PLINTH_D = 3.6;

export function makeTopPlateTexture(bg: string, inkColor: string, accent = "#c9a86b") {
  const W = 1024;
  const H = Math.round((W * PLINTH_D) / PLINTH_W);
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // brushed/satin texture
  for (let y = 0; y < H; y += 1) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    ctx.fillRect(0, y, W, 1);
  }
  const px = (x: number) => ((x + PLINTH_W / 2) / PLINTH_W) * W;
  const pz = (z: number) => ((z + PLINTH_D / 2) / PLINTH_D) * H;
  const u = W / PLINTH_W; // px per unit
  ctx.fillStyle = inkColor;
  ctx.strokeStyle = inkColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // brand
  ctx.font = `800 ${u * 0.17}px Inter, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("AMDATAWRAP", px(-2.05), pz(-1.52));
  ctx.font = `500 ${u * 0.07}px Inter, sans-serif`;
  ctx.fillText("QUARTZ  DIRECT  DRIVE  TURNTABLE  SYSTEM", px(-2.05), pz(-1.36));
  ctx.textAlign = "center";

  // under buttons
  ctx.font = `600 ${u * 0.06}px Inter, sans-serif`;
  ctx.fillText("START · STOP", px(-1.45), pz(1.4));
  ctx.fillText("33", px(-0.98), pz(1.6));
  ctx.fillText("45", px(-0.72), pz(1.6));
  ctx.fillText("POWER", px(-1.98), pz(1.28));

  // pitch scale
  const x0 = px(1.85);
  const zTop = 0.2;
  const zBot = 1.5;
  ctx.lineWidth = 2;
  ctx.font = `600 ${u * 0.055}px JetBrains Mono, monospace`;
  for (let i = 0; i <= 16; i++) {
    const z = zTop + (i / 16) * (zBot - zTop);
    const val = 8 - i;
    const len = i % 2 === 0 ? 0.12 : 0.06;
    ctx.beginPath();
    ctx.moveTo(x0 - u * 0.1 - u * len, pz(z));
    ctx.lineTo(x0 - u * 0.1, pz(z));
    ctx.stroke();
    if (i % 4 === 0) {
      ctx.textAlign = "right";
      ctx.fillText(`${val > 0 ? "+" : ""}${val}`, x0 - u * 0.26, pz(z));
    }
  }
  ctx.textAlign = "center";
  ctx.fillText("PITCH ADJ.", x0, pz(1.66));
  ctx.fillStyle = accent;
  ctx.fillText("%", x0 + u * 0.2, pz(zTop - 0.08));
  ctx.fillStyle = inkColor;

  // tonearm area markings
  const ax = px(1.18);
  const az = pz(-1.27);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ax, az, u * 0.52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `600 ${u * 0.045}px Inter, sans-serif`;
  ctx.fillText("ANTI-SKATING", px(1.9), pz(-1.6));
  ctx.fillText("ARM ELEVATION", px(1.86), pz(-0.52));

  // platter well shadow ring
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = u * 0.03;
  ctx.beginPath();
  ctx.arc(px(-0.55), pz(0), u * 1.68, 0, Math.PI * 2);
  ctx.stroke();

  // model plate bottom-right
  ctx.fillStyle = inkColor;
  ctx.font = `700 ${u * 0.075}px Inter, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("SL-1  MK II", px(2.15), pz(1.72));
  return toTexture(c);
}

// ---------------------------------------------------------------- button cap with text
export function makeButtonTexture(text: string, bg = "#1a1a1a", fg = "#e9e2d6") {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(255,255,255,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = fg;
  ctx.font = "700 34px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 66);
  return toTexture(c);
}

// ---------------------------------------------------------------- sleeve front (cover + wear)
export function averageColor(img: CanvasImageSource): string {
  const [c, ctx] = canvas(12);
  try {
    ctx.drawImage(img, 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return `#${[r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#6b5a4a";
  }
}

export function makeCoverTexture(img: CanvasImageSource | null, fallback: { title: string; artist: string; seed: number }, size = 256) {
  const [c, ctx] = canvas(size);
  if (img) {
    ctx.drawImage(img, 0, 0, size, size);
  } else {
    const hues = [18, 32, 200, 150, 350, 45];
    const hue = hues[Math.floor(hash(fallback.seed) * hues.length)];
    ctx.fillStyle = `hsl(${hue} 22% 24%)`;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = `hsl(${hue} 30% 70%)`;
    ctx.beginPath();
    ctx.arc(size * 0.68, size * 0.36, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f1e8da";
    ctx.font = `600 ${size * 0.075}px Fraunces, Georgia, serif`;
    ctx.textAlign = "left";
    wrapText(ctx, fallback.title, size * 0.08, size * 0.7, size * 0.84, size * 0.085, 2);
    ctx.font = `500 ${size * 0.045}px Inter, sans-serif`;
    ctx.fillStyle = "rgba(241,232,218,0.75)";
    ctx.fillText(fallback.artist.slice(0, 32), size * 0.08, size * 0.9);
  }
  ctx.strokeStyle = "rgba(255,248,236,0.12)";
  ctx.lineWidth = size * 0.008;
  ctx.strokeRect(0, 0, size, size);
  return toTexture(c);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lh);
      lines++;
      line = w;
      if (lines >= maxLines) return;
    } else line = test;
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lh);
}

// ---------------------------------------------------------------- generic sleeve back
let genericBack: THREE.CanvasTexture | null = null;
export function getGenericBackTexture() {
  if (genericBack) return genericBack;
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = "#cbbfa9";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(80,60,40,${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  ctx.fillStyle = "rgba(40,30,20,0.35)";
  for (let i = 0; i < 14; i++) ctx.fillRect(22, 40 + i * 12, 90 + hash(i) * 60, 4);
  for (let i = 0; i < 14; i++) ctx.fillRect(140, 40 + i * 12, 60 + hash(i + 9) * 40, 4);
  genericBack = toTexture(c);
  return genericBack;
}

// ---------------------------------------------------------------- detailed sleeve back (inspect)
export function makeBackCoverTexture(v: VinylDetail, coverImg: CanvasImageSource | null, accent: string, size = 768) {
  const [c, ctx] = canvas(size);
  // printed card stock
  ctx.fillStyle = "#e9e1d2";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(90,70,50,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4);
  }
  const m = size * 0.07;
  // band of colour from the cover
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, size, size * 0.012);
  // header
  if (coverImg) {
    try {
      ctx.drawImage(coverImg, m, m, size * 0.17, size * 0.17);
    } catch {
      /* ignore */
    }
  }
  const tx = coverImg ? m + size * 0.2 : m;
  ctx.fillStyle = "#1d1611";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${size * 0.05}px Fraunces, Georgia, serif`;
  wrapText(ctx, v.artist_name, tx, m + size * 0.05, size - tx - m, size * 0.055, 1);
  ctx.font = `italic 400 ${size * 0.04}px Fraunces, Georgia, serif`;
  wrapText(ctx, v.album_name, tx, m + size * 0.105, size - tx - m, size * 0.045, 2);
  ctx.font = `500 ${size * 0.018}px Inter, sans-serif`;
  ctx.fillStyle = "rgba(29,22,17,0.6)";
  ctx.fillText(`${(v.label_name || "").toUpperCase()}   ${v.catalog_number || ""}   ${v.country || ""} ${v.release_year || ""}`, tx, m + size * 0.165);

  // tracklist columns
  const sides = v.sides.slice(0, 4);
  const colW = (size - m * 2 - size * 0.04) / 2;
  sides.forEach((s, si) => {
    const col = si % 2;
    const rowBlock = Math.floor(si / 2);
    const x = m + col * (colW + size * 0.04);
    let y = m + size * 0.26 + rowBlock * size * 0.3;
    ctx.fillStyle = "#1d1611";
    ctx.font = `700 ${size * 0.022}px Inter, sans-serif`;
    ctx.fillText(`SIDE ${s.side}`, x, y);
    ctx.font = `500 ${size * 0.018}px JetBrains Mono, monospace`;
    ctx.fillStyle = "rgba(29,22,17,0.55)";
    ctx.textAlign = "right";
    ctx.fillText(formatDurationMs(s.total_duration_ms), x + colW, y);
    ctx.textAlign = "left";
    y += size * 0.012;
    ctx.fillStyle = "rgba(29,22,17,0.25)";
    ctx.fillRect(x, y, colW, 1.5);
    y += size * 0.035;
    for (const t of s.tracks.slice(0, 7)) {
      ctx.fillStyle = "#1d1611";
      ctx.font = `500 ${size * 0.02}px Inter, sans-serif`;
      ctx.fillText(`${t.number}`, x, y);
      wrapText(ctx, t.title, x + size * 0.045, y, colW - size * 0.12, size * 0.024, 1);
      ctx.textAlign = "right";
      ctx.font = `500 ${size * 0.018}px JetBrains Mono, monospace`;
      ctx.fillStyle = "rgba(29,22,17,0.6)";
      ctx.fillText(formatDurationMs(t.duration_ms), x + colW, y);
      ctx.textAlign = "left";
      y += size * 0.032;
    }
  });

  // footer: personal liner note + barcode
  const fy = size - m - size * 0.09;
  ctx.fillStyle = "rgba(29,22,17,0.25)";
  ctx.fillRect(m, fy - size * 0.03, size - m * 2, 1.5);
  ctx.fillStyle = "#1d1611";
  ctx.font = `italic 400 ${size * 0.024}px Fraunces, Georgia, serif`;
  ctx.fillText(`${v.total_plays} écoutes · ${(v.total_ms / 3_600_000).toFixed(1).replace(".", ",")} h dans ta collection`, m, fy + size * 0.01);
  ctx.font = `500 ${size * 0.015}px Inter, sans-serif`;
  ctx.fillStyle = "rgba(29,22,17,0.5)";
  ctx.fillText("All rights of the producer and of the owner of the recorded work reserved. Made in AMDW.", m, fy + size * 0.05);
  // barcode
  let bx = size - m - size * 0.2;
  const by = fy - size * 0.01;
  const seed = v.album_name.length * 7 + v.artist_name.length;
  ctx.fillStyle = "#fff";
  ctx.fillRect(bx - 8, by - 8, size * 0.2 + 16, size * 0.085 + 16);
  ctx.fillStyle = "#111";
  for (let i = 0; i < 46; i++) {
    const w = 1 + Math.floor(hash(seed + i) * 3);
    if (i % 2 === 0) ctx.fillRect(bx, by, w * 1.6, size * 0.065);
    bx += w * 1.6 + 1.5;
    if (bx > size - m) break;
  }
  ctx.font = `500 ${size * 0.014}px JetBrains Mono, monospace`;
  ctx.fillText(String(v.catalog_number || "0 000000 000000").slice(0, 18), size - m - size * 0.2, by + size * 0.08);
  return toTexture(c);
}

// ---------------------------------------------------------------- soft dot sprite (dust)
export function makeDotSprite() {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,240,220,1)");
  g.addColorStop(0.4, "rgba(255,230,200,0.35)");
  g.addColorStop(1, "rgba(255,220,180,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}
