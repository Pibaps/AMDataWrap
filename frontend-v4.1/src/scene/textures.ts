/**
 * Zero-RAM GPU-only Textures & Analytical GLSL Shaders for AMDataWrap V4.1 ("Salon d'écoute").
 *
 * V4.1 Extreme Optimization Pipeline (PDF p. 5-8, 15-23):
 * 1. Crate Covers: Single `THREE.DataArrayTexture(null, 384, 384, 20)` uploaded via
 *    `createImageBitmap({ imageOrientation: 'flipY', premultiplyAlpha: 'none', resizeWidth, resizeHeight })`
 *    + `renderer.copyTextureToTexture(tempTex, arrayTex, null, _dstPos, 0)` + `bitmap.close()` -> 0 MiB CPU RAM.
 * 2. HD Easel & Inspect Covers: `loadZeroRamTexture(renderer, url, 1024)` -> `renderer.initTexture()` + `bitmap.close()`.
 * 3. Ephemeral Verso & Gatefold Liner Notes: `OffscreenCanvas` (manual vertical flip) -> `transferToImageBitmap()` -> `bitmap.close()`.
 * 4. Analytical GLSL Materials (0 Mo VRAM, infinite sharpness, unique `customProgramCacheKey()`):
 *    - `createProceduralVinylMaterial`: real `uTrackStops[16]` + micro-grooves `sin(r * 1450.0)` + hourglass anisotropic sheen.
 *    - `createProceduralWalnutMaterial`: analytical wood rings & fine fibers.
 *    - `createProceduralPlasterMaterial`: warm plaster micro-noise roughness.
 *    - `createProceduralStrobeMaterial`: 4-row Technics SL-1200 strobe dots.
 *    - `createCrateInstancedMaterial`: 1 draw call for all 20 vinyl sleeves via `sampler2DArray` + `aSlotIndex`.
 *    - `createContactShadowMaterial`: analytical `exp(-k * r²)` soft ambient occlusion shadow.
 */

import * as THREE from "three";
import { coverUrl, formatDurationMs, type VinylDetail, type VinylSide } from "../api/client";

// ---------------------------------------------------------------- constants
export const RECORD_R = 1.524; // 12" vinyl
export const LABEL_R = 0.5;
export const GROOVE_OUTER_R = 1.46;
export const GROOVE_INNER_R = 0.64;

// Enlarged V4.1 plinth (+20% mechanical breathing room — zero overlaps!)
export const PLINTH_W = 5.44;
export const PLINTH_D = 4.32;

const _dstPos = new THREE.Vector3();

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

function wrapText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
  maxLines: number
) {
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

// ---------------------------------------------------------------- groove math
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

// ---------------------------------------------------------------- GPU-only DataArrayTexture (Crate 384px x 20)
export function createCrateCoverArray(
  renderer: THREE.WebGLRenderer,
  slots = 20,
  size = 384
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(null, size, size, slots);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  // Allocate GPU-only TEXTURE_2D_ARRAY storage (0 bytes CPU) before locking dataReady = false
  tex.source.dataReady = true;
  tex.needsUpdate = true;
  renderer.initTexture(tex);
  tex.source.dataReady = false;
  return tex;
}

function drawFallbackCoverToCtx(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  fallback: { title: string; artist: string; seed: number },
  size: number
) {
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
  ctx.strokeStyle = "rgba(255,248,236,0.14)";
  ctx.lineWidth = size * 0.008;
  ctx.strokeRect(0, 0, size, size);
}

async function createFallbackBitmap(
  fallback: { title: string; artist: string; seed: number },
  size: number
): Promise<ImageBitmap> {
  if (typeof OffscreenCanvas !== "undefined") {
    const oc = new OffscreenCanvas(size, size);
    const ctx = oc.getContext("2d")!;
    // Manual flipY because WebGL ignores Texture.flipY for ImageBitmap
    ctx.translate(0, size);
    ctx.scale(1, -1);
    drawFallbackCoverToCtx(ctx, fallback, size);
    return oc.transferToImageBitmap();
  }
  const [c, ctx] = canvas(size);
  drawFallbackCoverToCtx(ctx, fallback, size);
  return createImageBitmap(c, { imageOrientation: "flipY", premultiplyAlpha: "none" });
}

export async function uploadCoverToArraySlot(
  renderer: THREE.WebGLRenderer,
  arrayTex: THREE.DataArrayTexture,
  slotIndex: number,
  rawUrl: string | null | undefined,
  fallback: { title: string; artist: string; seed: number },
  size = 384,
  forceCache = false
): Promise<void> {
  let bitmap: ImageBitmap | null = null;
  const proxied = coverUrl(rawUrl, size);

  if (proxied) {
    try {
      const resp = await fetch(proxied, { cache: forceCache ? "force-cache" : "default" });
      if (resp.ok) {
        const blob = await resp.blob();
        bitmap = await createImageBitmap(blob, {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
          resizeWidth: size,
          resizeHeight: size,
          resizeQuality: "medium",
        });
      }
    } catch {
      bitmap = null;
    }
  }

  if (!bitmap) {
    bitmap = await createFallbackBitmap(fallback, size);
  }

  const tempTex = new THREE.Texture(bitmap);
  tempTex.colorSpace = THREE.SRGBColorSpace;
  tempTex.flipY = false;
  tempTex.generateMipmaps = false;

  try {
    // Exact Three.js r174 signature: copyTextureToTexture(src, dst, srcRegion, dstPosition, level)
    renderer.copyTextureToTexture(tempTex, arrayTex, null, _dstPos.set(0, 0, slotIndex), 0);
  } finally {
    tempTex.dispose();
    bitmap.close();
  }
}

export function regenerateArrayMipmaps(renderer: THREE.WebGLRenderer, arrayTex: THREE.DataArrayTexture): void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (!("TEXTURE_2D_ARRAY" in gl)) return;
  const props = renderer.properties.get(arrayTex) as { __webglTexture?: WebGLTexture } | undefined;
  const glTex = props?.__webglTexture;
  if (!glTex) return;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

// ---------------------------------------------------------------- Zero-RAM HD Texture (1024px Inspect / Easel)
export async function loadZeroRamTexture(
  renderer: THREE.WebGLRenderer,
  rawUrl: string | null | undefined,
  fallback?: { title: string; artist: string; seed: number },
  size = 1024
): Promise<THREE.Texture | null> {
  let bitmap: ImageBitmap | null = null;
  const proxied = coverUrl(rawUrl, size);

  if (proxied) {
    try {
      const resp = await fetch(proxied);
      if (resp.ok) {
        const blob = await resp.blob();
        bitmap = await createImageBitmap(blob, {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
          resizeWidth: size,
          resizeHeight: size,
          resizeQuality: "high",
        });
      }
    } catch {
      bitmap = null;
    }
  }

  if (!bitmap && fallback) {
    bitmap = await createFallbackBitmap(fallback, Math.min(size, 512));
  }
  if (!bitmap) return null;

  const tex = new THREE.Texture(bitmap);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  try {
    renderer.initTexture(tex);
  } finally {
    bitmap.close();
  }
  return tex;
}

// ---------------------------------------------------------------- Ephemeral Verso & Gatefold Inner (0 MiB CPU RAM)
function paintBackCover(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  v: VinylDetail,
  accent: string,
  size: number
) {
  ctx.fillStyle = "#e9e1d2";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4500; i++) {
    ctx.fillStyle = `rgba(90,70,50,${hash(i * 1.7) * 0.045})`;
    ctx.fillRect(hash(i * 3.1) * size, hash(i * 7.3) * size, 1.5, 1.5);
  }
  const m = size * 0.07;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, size, size * 0.014);

  const tx = m;
  ctx.fillStyle = "#1d1611";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${size * 0.05}px Fraunces, Georgia, serif`;
  wrapText(ctx, v.artist_name, tx, m + size * 0.055, size - tx - m, size * 0.055, 1);
  ctx.font = `italic 400 ${size * 0.04}px Fraunces, Georgia, serif`;
  wrapText(ctx, v.album_name, tx, m + size * 0.11, size - tx - m, size * 0.045, 2);
  ctx.font = `500 ${size * 0.018}px Inter, sans-serif`;
  ctx.fillStyle = "rgba(29,22,17,0.62)";
  const discTag = v.disc_count >= 2 ? ` · ${v.disc_count}×LP GATEFOLD` : "";
  ctx.fillText(
    `${(v.label_name || "").toUpperCase()}   ${v.catalog_number || ""}   ${v.country || ""} ${v.release_year || ""}${discTag}`,
    tx,
    m + size * 0.175
  );

  const sides = v.sides.slice(0, 4);
  const colW = (size - m * 2 - size * 0.04) / 2;
  sides.forEach((s, si) => {
    const col = si % 2;
    const rowBlock = Math.floor(si / 2);
    const x = m + col * (colW + size * 0.04);
    let y = m + size * 0.25 + rowBlock * size * 0.29;
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
    y += size * 0.032;
    for (const t of s.tracks.slice(0, 7)) {
      ctx.fillStyle = "#1d1611";
      ctx.font = `500 ${size * 0.019}px Inter, sans-serif`;
      ctx.fillText(`${t.number}`, x, y);
      wrapText(ctx, t.title, x + size * 0.045, y, colW - size * 0.12, size * 0.023, 1);
      ctx.textAlign = "right";
      ctx.font = `500 ${size * 0.017}px JetBrains Mono, monospace`;
      ctx.fillStyle = "rgba(29,22,17,0.6)";
      ctx.fillText(formatDurationMs(t.duration_ms), x + colW, y);
      ctx.textAlign = "left";
      y += size * 0.03;
    }
  });

  const fy = size - m - size * 0.09;
  ctx.fillStyle = "rgba(29,22,17,0.25)";
  ctx.fillRect(m, fy - size * 0.03, size - m * 2, 1.5);
  ctx.fillStyle = "#1d1611";
  ctx.font = `italic 400 ${size * 0.024}px Fraunces, Georgia, serif`;
  ctx.fillText(
    `${v.total_plays} écoutes · ${(v.total_ms / 3_600_000).toFixed(1).replace(".", ",")} h dans ta collection`,
    m,
    fy + size * 0.01
  );
  ctx.font = `500 ${size * 0.015}px Inter, sans-serif`;
  ctx.fillStyle = "rgba(29,22,17,0.5)";
  ctx.fillText("All rights of the producer and of the owner of the recorded work reserved. Made in AMDW.", m, fy + size * 0.05);

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
}

export async function createEphemeralVersoTexture(
  renderer: THREE.WebGLRenderer,
  v: VinylDetail,
  accent: string,
  size = 768
): Promise<THREE.Texture> {
  let bitmap: ImageBitmap;
  if (typeof OffscreenCanvas !== "undefined") {
    const oc = new OffscreenCanvas(size, size);
    const ctx = oc.getContext("2d")!;
    ctx.translate(0, size);
    ctx.scale(1, -1);
    paintBackCover(ctx, v, accent, size);
    bitmap = oc.transferToImageBitmap();
  } else {
    const [c, ctx] = canvas(size);
    paintBackCover(ctx, v, accent, size);
    bitmap = await createImageBitmap(c, { imageOrientation: "flipY", premultiplyAlpha: "none" });
  }
  const tex = new THREE.Texture(bitmap);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  try {
    renderer.initTexture(tex);
  } finally {
    bitmap.close();
  }
  return tex;
}

export async function createEphemeralGatefoldInnerTexture(
  renderer: THREE.WebGLRenderer,
  v: VinylDetail,
  accent: string,
  sidePair: "AB" | "CD",
  size = 512
): Promise<THREE.Texture> {
  const paint = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    ctx.fillStyle = "#19130f";
    ctx.fillRect(0, 0, size, size);
    const m = size * 0.08;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(m * 0.5, m * 0.5, size - m, size - m);

    ctx.fillStyle = "#c9a86b";
    ctx.font = `700 ${size * 0.026}px JetBrains Mono, monospace`;
    ctx.textAlign = "left";
    ctx.fillText(sidePair === "AB" ? "DISQUE 1 · LP 1 (FACES A / B)" : "DISQUE 2 · LP 2 (FACES C / D)", m, m + size * 0.04);

    ctx.fillStyle = "#ede2d2";
    ctx.font = `600 ${size * 0.046}px Fraunces, Georgia, serif`;
    wrapText(ctx, v.album_name, m, m + size * 0.11, size - m * 2, size * 0.052, 2);

    const sides = sidePair === "AB" ? v.sides.slice(0, 2) : v.sides.slice(2, 4);
    let y = m + size * 0.24;
    for (const s of sides) {
      ctx.fillStyle = "#e8873e";
      ctx.font = `700 ${size * 0.025}px Inter, sans-serif`;
      ctx.fillText(`FACE ${s.side}`, m, y);
      ctx.fillStyle = "rgba(237,226,210,0.55)";
      ctx.textAlign = "right";
      ctx.font = `500 ${size * 0.021}px JetBrains Mono, monospace`;
      ctx.fillText(formatDurationMs(s.total_duration_ms), size - m, y);
      ctx.textAlign = "left";
      y += size * 0.018;
      ctx.fillStyle = "rgba(237,226,210,0.18)";
      ctx.fillRect(m, y, size - m * 2, 1);
      y += size * 0.036;
      for (const t of s.tracks.slice(0, 7)) {
        ctx.fillStyle = "#ede2d2";
        ctx.font = `500 ${size * 0.022}px Inter, sans-serif`;
        ctx.fillText(t.number, m, y);
        wrapText(ctx, t.title, m + size * 0.06, y, size - m * 2 - size * 0.16, size * 0.026, 1);
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(237,226,210,0.6)";
        ctx.font = `500 ${size * 0.02}px JetBrains Mono, monospace`;
        ctx.fillText(formatDurationMs(t.duration_ms), size - m, y);
        ctx.textAlign = "left";
        y += size * 0.036;
      }
      y += size * 0.04;
    }

    ctx.fillStyle = "rgba(237,226,210,0.45)";
    ctx.font = `500 ${size * 0.018}px Inter, sans-serif`;
    ctx.fillText("Cliquer sur le disque pour le sortir et le poser sur la platine", m, size - m * 0.9);
  };

  let bitmap: ImageBitmap;
  if (typeof OffscreenCanvas !== "undefined") {
    const oc = new OffscreenCanvas(size, size);
    const ctx = oc.getContext("2d")!;
    ctx.translate(0, size);
    ctx.scale(1, -1);
    paint(ctx);
    bitmap = oc.transferToImageBitmap();
  } else {
    const [c, ctx] = canvas(size);
    paint(ctx);
    bitmap = await createImageBitmap(c, { imageOrientation: "flipY", premultiplyAlpha: "none" });
  }
  const tex = new THREE.Texture(bitmap);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  try {
    renderer.initTexture(tex);
  } finally {
    bitmap.close();
  }
  return tex;
}

// ---------------------------------------------------------------- Analytical GLSL Materials (0 Mo VRAM!)

/**
 * Procedural 12" Vinyl Material (0 Mo VRAM, infinite sharpness):
 * - Real inter-track pause bands from `uTrackStops[16]`
 * - Micro-grooves `sin(r * 1450.0)` modulating roughness & specular reflection
 * - Anisotropic hourglass sheen `pow(abs(sin(angle * 2.0 + 0.45)), 3.5)`
 */
export function createProceduralVinylMaterial(vinylHex = "#0d0d0e") {
  const uniforms = {
    uTrackStops: { value: new Float32Array(16) },
    uStopCount: { value: 0 },
    uVinylColor: { value: new THREE.Color(vinylHex) },
  };

  const clampVinylColor = (hex: string) => {
    const [r, g, b] = hexToRgb(hex || "#0d0d0e");
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = lum > 58 ? 58 / lum : 1;
    uniforms.uVinylColor.value.setRGB((r * k) / 255, (g * k) / 255, (b * k) / 255);
  };
  clampVinylColor(vinylHex);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.24,
    metalness: 0.22,
  });
  material.customProgramCacheKey = () => "amdw-vinyl-glsl-v41";

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTrackStops = uniforms.uTrackStops;
    shader.uniforms.uStopCount = uniforms.uStopCount;
    shader.uniforms.uVinylColor = uniforms.uVinylColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vVinylLocalPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vVinylLocalPos = position;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTrackStops[16];
        uniform int uStopCount;
        uniform vec3 uVinylColor;
        varying vec3 vVinylLocalPos;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float vr = length(vVinylLocalPos.xz) / ${RECORD_R.toFixed(4)};
        float va = atan(vVinylLocalPos.z, vVinylLocalPos.x);
        float inGrooveZone = smoothstep(0.41, 0.425, vr) * (1.0 - smoothstep(0.952, 0.968, vr));
        float microGroove = 0.5 + 0.5 * sin(vr * 1450.0);
        float macroGroove = 0.5 + 0.5 * sin(vr * 240.0 + sin(vr * 31.0));

        float trackGap = 0.0;
        for (int i = 0; i < 16; i++) {
          if (i >= uStopCount) break;
          float d = abs(vr - uTrackStops[i]);
          trackGap = max(trackGap, 1.0 - smoothstep(0.0025, 0.0075, d));
        }

        // Anisotropic hourglass specular highlight under warm brass lamp
        float hourglass = pow(abs(sin(va * 2.0 + 0.45)), 3.5);
        float sheenBand = hourglass * inGrooveZone * (0.65 + 0.35 * microGroove) * (1.0 - 0.7 * trackGap);

        vec3 baseCol = uVinylColor * (0.86 + 0.14 * macroGroove * inGrooveZone);
        baseCol += vec3(0.11, 0.095, 0.08) * sheenBand;
        baseCol += vec3(0.035, 0.032, 0.028) * trackGap * inGrooveZone;
        diffuseColor.rgb = baseCol;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float vrR = length(vVinylLocalPos.xz) / ${RECORD_R.toFixed(4)};
        float vaR = atan(vVinylLocalPos.z, vVinylLocalPos.x);
        float inGZ = smoothstep(0.41, 0.425, vrR) * (1.0 - smoothstep(0.952, 0.968, vrR));
        float mgR = 0.5 + 0.5 * sin(vrR * 1450.0);
        float hgR = pow(abs(sin(vaR * 2.0 + 0.45)), 3.5);
        roughnessFactor = mix(0.12, 0.28 + 0.09 * mgR - 0.12 * hgR, inGZ);`
      );
  };

  const setTrackStops = (side?: VinylSide) => {
    const tracks = side?.tracks?.length
      ? side.tracks
      : [{ duration_ms: 220000 }, { duration_ms: 200000 }, { duration_ms: 240000 }];
    const total = Math.max(1, tracks.reduce((a, t) => a + (t.duration_ms || 200000), 0));
    const arr = uniforms.uTrackStops.value;
    arr.fill(0);
    let acc = 0;
    const count = Math.min(16, Math.max(0, tracks.length - 1));
    const outerNorm = GROOVE_OUTER_R / RECORD_R;
    const innerNorm = GROOVE_INNER_R / RECORD_R;
    for (let i = 0; i < count; i++) {
      acc += tracks[i].duration_ms || 200000;
      arr[i] = outerNorm - (acc / total) * (outerNorm - innerNorm);
    }
    uniforms.uStopCount.value = count;
  };

  setTrackStops(undefined);

  return {
    material,
    setTrackStops,
    setVinylColor: clampVinylColor,
  };
}

/** Analytical GLSL Walnut / Oak Wood Material (0 Mo VRAM, infinite sharpness). */
export function createProceduralWalnutMaterial(
  baseHex = "#4f3220",
  darkHex = "#29180d",
  variant = "walnut",
  opts: { roughness?: number; metalness?: number; rings?: number; scale?: number } = {}
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.roughness ?? 0.54,
    metalness: opts.metalness ?? 0.05,
  });
  mat.customProgramCacheKey = () => `amdw-wood-glsl-${variant}`;

  const uBase = new THREE.Color(baseHex);
  const uDark = new THREE.Color(darkHex);
  const rings = (opts.rings ?? 24).toFixed(1);
  const scale = (opts.scale ?? 0.35).toFixed(3);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWoodBase = { value: uBase };
    shader.uniforms.uWoodDark = { value: uDark };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWoodPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWoodPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uWoodBase;
        uniform vec3 uWoodDark;
        varying vec3 vWoodPos;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x),
            mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 wp = vec2(vWoodPos.x * ${scale}, (vWoodPos.z + vWoodPos.y * 0.7) * ${scale});
        float warp = wNoise(wp * 2.2) * 1.4 + wNoise(wp * 5.5) * 0.45;
        float ring = abs(sin((wp.y * ${rings} + warp * 3.1) * 3.14159));
        float grain = pow(ring, 0.38);
        float fibers = wNoise(vec2(wp.x * 160.0, wp.y * 12.0)) * 0.14;
        float t = clamp(grain * 0.85 + fibers, 0.0, 1.0);
        diffuseColor.rgb = mix(uWoodDark, uWoodBase, t);`
      );
  };
  return mat;
}

/** Analytical GLSL Warm Plaster Wall Material (0 Mo VRAM). */
export function createProceduralPlasterMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
  });
  mat.customProgramCacheKey = () => "amdw-plaster-glsl-v41";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPlasterPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPlasterPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vPlasterPos;
        float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x),
            mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 pp = vPlasterPos.xy * 0.42;
        float n = pNoise(pp) * 0.55 + pNoise(pp * 2.4) * 0.3 + pNoise(pp * 14.0) * 0.15;
        float v = 0.78 + n * 0.28;
        diffuseColor.rgb = vec3(0.251, 0.204, 0.173) * v;`
      );
  };
  return mat;
}

/** Analytical GLSL Technics Strobe Dots Material for Platter Rim (0 Mo VRAM). */
export function createProceduralStrobeMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0.85,
  });
  mat.customProgramCacheKey = () => "amdw-strobe-glsl-v41";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStrobeLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvStrobeLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vStrobeLocal;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float ang = atan(vStrobeLocal.z, vStrobeLocal.x);
        float u = (ang + 3.14159265) / 6.2831853;
        float y = clamp((vStrobeLocal.y + 0.095) / 0.19, 0.0, 1.0);
        // Brushed aluminum base gradient
        vec3 alu = mix(vec3(0.50, 0.51, 0.52), vec3(0.79, 0.80, 0.81), sin(y * 3.14159));
        // 3 rows of Technics strobe dots (180, 135, 180)
        float dotMask = 0.0;
        if (y > 0.14 && y < 0.32) {
          dotMask = step(0.45, fract(u * 135.0));
        } else if (y > 0.42 && y < 0.62) {
          dotMask = step(0.42, fract(u * 180.0));
        } else if (y > 0.72 && y < 0.88) {
          dotMask = step(0.48, fract(u * 135.0));
        }
        diffuseColor.rgb = mix(alu, vec3(0.14, 0.145, 0.15), dotMask);`
      );
  };
  return mat;
}

/**
 * Single-Draw-Call Crate InstancedMesh Material using `sampler2DArray` + per-instance `aSlotIndex`.
 * Front face (+Z) samples the 384x384 cover layer; Back face (-Z) renders printed card stock;
 * Edges/spine render warm vinyl sleeve cardboard.
 */
export function createCrateInstancedMaterial(coverArray: THREE.DataArrayTexture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0.04,
  });
  mat.customProgramCacheKey = () => "amdw-crate-instanced-array-v41";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCoverArray = { value: coverArray };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aSlotIndex;
        varying float vSlotIndex;
        varying vec2 vCrateUv;
        varying vec3 vCrateNormal;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSlotIndex = aSlotIndex;
        vCrateUv = uv;
        vCrateNormal = normal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2DArray uCoverArray;
        varying float vSlotIndex;
        varying vec2 vCrateUv;
        varying vec3 vCrateNormal;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vCrateNormal.z > 0.5) {
          vec4 cov = texture(uCoverArray, vec3(vCrateUv, vSlotIndex));
          diffuseColor.rgb = cov.rgb;
        } else if (vCrateNormal.z < -0.5) {
          // Warm vintage linen card stock back
          float lines = step(0.82, fract(vCrateUv.y * 18.0)) * step(0.12, vCrateUv.x) * step(vCrateUv.x, 0.82);
          diffuseColor.rgb = mix(vec3(0.76, 0.71, 0.63), vec3(0.32, 0.27, 0.22), lines * 0.38);
        } else {
          // Sleeve cardboard spine
          diffuseColor.rgb = vec3(0.11, 0.095, 0.085);
        }`
      );
  };
  return mat;
}

/** Analytical Soft Contact Shadow Material (`exp(-k * r²)`, 0 Mo VRAM). */
export function createContactShadowMaterial(opacity = 0.42, falloff = 5.2): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x050302,
    transparent: true,
    depthWrite: false,
    opacity,
  });
  mat.customProgramCacheKey = () => `amdw-contact-shadow-${falloff.toFixed(1)}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vShadowUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShadowUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vShadowUv;")
      .replace(
        "#include <dithering_fragment>",
        `vec2 sc = (vShadowUv - 0.5) * 2.0;
        float r2 = dot(sc, sc);
        gl_FragColor.a *= exp(-${falloff.toFixed(2)} * r2) * smoothstep(1.0, 0.65, r2);
        #include <dithering_fragment>`
      );
  };
  return mat;
}

// ---------------------------------------------------------------- Compact One-Time Turntable Detail Textures
export function makeFeltTexture(size = 256) {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = "#121214";
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2;
  ctx.save();
  ctx.translate(cx, cx);
  ctx.fillStyle = "rgba(220,214,204,0.55)";
  ctx.font = `600 ${size * 0.036}px Inter, sans-serif`;
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

function arcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  spread: number,
  inward = false
) {
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
  info: {
    album: string;
    artist: string;
    label: string;
    catalog: string;
    year: number | null;
    side: string;
    tracks: Array<{ number: string; title: string; duration_ms: number }>;
  },
  paper: string,
  rpm: 33 | 45 = 33,
  size = 384
) {
  const [c, ctx] = canvas(size);
  const cx = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.fill();

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
  ctx.font = `700 ${size * 0.05}px Inter, sans-serif`;
  const labelTxt = (info.label || "AMDW RECORDS").toUpperCase().slice(0, 28);
  arcText(ctx, labelTxt, cx, cx, cx * 0.8, -Math.min(1.5, labelTxt.length * 0.075) / 2, Math.min(1.5, labelTxt.length * 0.075));

  ctx.font = `600 ${size * 0.058}px Fraunces, Georgia, serif`;
  ctx.fillText(info.artist.slice(0, 26), cx, cx + size * 0.14);
  ctx.font = `italic 400 ${size * 0.05}px Fraunces, Georgia, serif`;
  ctx.fillText(info.album.slice(0, 30), cx, cx + size * 0.205);

  ctx.font = `700 ${size * 0.11}px Fraunces, Georgia, serif`;
  ctx.fillText(info.side, cx + size * 0.28, cx - size * 0.02);
  ctx.font = `600 ${size * 0.034}px Inter, sans-serif`;
  ctx.fillStyle = ink2;
  ctx.fillText("SIDE", cx + size * 0.28, cx - size * 0.1);
  ctx.fillText(rpm === 45 ? "45 RPM" : "33⅓ RPM", cx - size * 0.28, cx - size * 0.06);
  ctx.fillText("STEREO", cx - size * 0.28, cx + size * 0.0);
  ctx.fillText(`${info.catalog || "—"}${info.year ? ` · ${info.year}` : ""}`, cx, cx - size * 0.16);

  ctx.font = `500 ${size * 0.028}px Inter, sans-serif`;
  ctx.fillStyle = ink2;
  info.tracks.slice(0, 5).forEach((t, i) => {
    ctx.fillText(`${t.number}  ${t.title.slice(0, 30)}  ${formatDurationMs(t.duration_ms)}`, cx, cx + size * 0.26 + i * size * 0.036);
  });

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.026, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  return toTexture(c);
}

export function makeDialSideTexture(marks: number, labelEvery: number, dark = true) {
  const w = 512;
  const h = 64;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = dark ? "#151515" : "#c7c7c5";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = dark ? "#e8e2d6" : "#1a1a1a";
  ctx.font = "600 18px Inter, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < marks; i++) {
    const x = (i / marks) * w;
    const big = i % labelEvery === 0;
    ctx.fillRect(x, 0, 2, big ? 24 : 13);
    if (big) ctx.fillText(String((i / labelEvery) % 10), x, 48);
  }
  return toTexture(c);
}

export function makeRibTexture() {
  const [c, ctx] = canvas(128, 8);
  for (let x = 0; x < 128; x++) {
    const v = x % 8 < 4 ? 200 : 60;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const t = toTexture(c, false);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

export function makeTopPlateTexture(bg: string, inkColor: string, accent = "#c9a86b") {
  const W = 1024;
  const H = Math.round((W * PLINTH_D) / PLINTH_W);
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${hash(y) * 0.022})`;
    ctx.fillRect(0, y, W, 1);
  }
  const px = (x: number) => ((x + PLINTH_W / 2) / PLINTH_W) * W;
  const pz = (z: number) => ((z + PLINTH_D / 2) / PLINTH_D) * H;
  const u = W / PLINTH_W;
  ctx.fillStyle = inkColor;
  ctx.strokeStyle = inkColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Brand top-left (generous margin)
  ctx.font = `800 ${u * 0.16}px Inter, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("AMDATAWRAP", px(-2.48), pz(-1.86));
  ctx.font = `500 ${u * 0.068}px Inter, sans-serif`;
  ctx.fillText("QUARTZ  DIRECT  DRIVE  TURNTABLE  SYSTEM", px(-2.48), pz(-1.7));
  ctx.textAlign = "center";

  // Left-front controls (clear of platter strobe ring!)
  ctx.font = `600 ${u * 0.062}px Inter, sans-serif`;
  ctx.fillText("POWER", px(-2.3), pz(1.52));
  ctx.fillText("START · STOP", px(-1.7), pz(1.74));
  ctx.fillText("33", px(-1.12), pz(1.94));
  ctx.fillText("45", px(-0.82), pz(1.94));

  // Right-side linear volume / gain fader (clear of tonearm rest!)
  const x0 = px(2.26);
  const zTop = 0.28;
  const zBot = 1.72;
  ctx.lineWidth = 2;
  ctx.font = `600 ${u * 0.055}px JetBrains Mono, monospace`;
  for (let i = 0; i <= 10; i++) {
    const z = zTop + (i / 10) * (zBot - zTop);
    const val = (10 - i) * 10;
    const len = i % 2 === 0 ? 0.12 : 0.06;
    ctx.beginPath();
    ctx.moveTo(x0 - u * 0.12 - u * len, pz(z));
    ctx.lineTo(x0 - u * 0.12, pz(z));
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.textAlign = "right";
      ctx.fillText(`${val}`, x0 - u * 0.28, pz(z));
    }
  }
  ctx.textAlign = "center";
  ctx.fillText("VOLUME · GAIN", x0, pz(1.92));
  ctx.fillStyle = accent;
  ctx.fillText("%", x0 + u * 0.22, pz(zTop - 0.1));
  ctx.fillStyle = inkColor;

  // Tonearm gimbal ring
  const ax = px(1.5);
  const az = pz(-1.38);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ax, az, u * 0.54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `600 ${u * 0.048}px Inter, sans-serif`;
  ctx.fillText("ANTI-SKATING", px(2.22), pz(-1.82));
  ctx.fillText("ARM ELEVATION", px(2.22), pz(-0.62));

  // Platter well shadow ring (centered at x = -0.68, z = -0.05)
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = u * 0.03;
  ctx.beginPath();
  ctx.arc(px(-0.68), pz(-0.05), u * 1.66, 0, Math.PI * 2);
  ctx.stroke();

  // Model plate bottom-right
  ctx.fillStyle = inkColor;
  ctx.font = `700 ${u * 0.075}px Inter, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("SL-1200  V4.1", px(2.54), pz(2.02));
  return toTexture(c);
}

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

// Legacy compatibility shims (kept minimal while P3 migrates PersistentStageCanvas)
export function makeWoodTexture(base: string, dark: string) {
  const [c, ctx] = canvas(64);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 16, 64, 16);
  return toTexture(c);
}
export function makePlasterTexture() {
  const [c, ctx] = canvas(32);
  ctx.fillStyle = "#3a2e26";
  ctx.fillRect(0, 0, 32, 32);
  return toTexture(c);
}
export function makeStrobeTexture() {
  const [c, ctx] = canvas(64, 16);
  ctx.fillStyle = "#9fa1a4";
  ctx.fillRect(0, 0, 64, 16);
  return toTexture(c);
}
export function makeGrooveMaps(_side?: VinylSide, vinylHex = "#0d0d0e") {
  const [c, ctx] = canvas(32);
  ctx.fillStyle = vinylHex;
  ctx.fillRect(0, 0, 32, 32);
  return { map: toTexture(c) };
}
export function makeCoverTexture(_img: CanvasImageSource | null, fallback: { title: string; artist: string; seed: number }, size = 256) {
  const [c, ctx] = canvas(size);
  drawFallbackCoverToCtx(ctx, fallback, size);
  return toTexture(c);
}
export function getGenericBackTexture() {
  const [c, ctx] = canvas(64);
  ctx.fillStyle = "#cbbfa9";
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}
export function makeBackCoverTexture(v: VinylDetail, _coverImg: CanvasImageSource | null, accent: string, size = 512) {
  const [c, ctx] = canvas(size);
  paintBackCover(ctx, v, accent, size);
  return toTexture(c);
}
export function makeDotSprite() {
  const [c, ctx] = canvas(32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,240,220,1)");
  g.addColorStop(1, "rgba(255,220,180,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return toTexture(c);
}
