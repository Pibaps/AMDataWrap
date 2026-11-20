/**
 * High-frequency playback clock kept OUTSIDE React/Zustand.
 * - The player engine writes position/duration ~4×/s.
 * - The 3D scene reads `getPositionMs()` every frame (interpolated).
 * - UI widgets subscribe with `usePlaybackClock(rateMs)` and re-render at a low rate only.
 */

import { useEffect, useState } from "react";

interface ClockState {
  positionMs: number;
  durationMs: number;
  playing: boolean;
  stampedAt: number;
}

const state: ClockState = { positionMs: 0, durationMs: 0, playing: false, stampedAt: performance.now() };
const listeners = new Set<() => void>();

export const playbackClock = {
  set(positionMs: number, durationMs: number, playing: boolean) {
    state.positionMs = Math.max(0, positionMs);
    if (durationMs > 0) state.durationMs = durationMs;
    state.playing = playing;
    state.stampedAt = performance.now();
    listeners.forEach((l) => l());
  },
  reset(durationMs = 0) {
    state.positionMs = 0;
    state.durationMs = durationMs;
    state.playing = false;
    state.stampedAt = performance.now();
    listeners.forEach((l) => l());
  },
  /** Interpolated position (smooth between engine polls). */
  getPositionMs(): number {
    if (!state.playing) return state.positionMs;
    const p = state.positionMs + (performance.now() - state.stampedAt);
    return state.durationMs > 0 ? Math.min(p, state.durationMs) : p;
  },
  getDurationMs(): number {
    return state.durationMs;
  },
  isPlaying(): boolean {
    return state.playing;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Low-rate subscription for UI (default 4 Hz). */
export function usePlaybackClock(rateMs = 250): { positionMs: number; durationMs: number } {
  const [snap, setSnap] = useState(() => ({
    positionMs: playbackClock.getPositionMs(),
    durationMs: playbackClock.getDurationMs(),
  }));
  useEffect(() => {
    let last = 0;
    let pending: number | null = null;
    const push = () => {
      setSnap((prev) => {
        const next = { positionMs: playbackClock.getPositionMs(), durationMs: playbackClock.getDurationMs() };
        if (Math.abs(prev.positionMs - next.positionMs) < 200 && prev.durationMs === next.durationMs) return prev;
        return next;
      });
    };
    const unsub = playbackClock.subscribe(() => {
      const now = performance.now();
      if (now - last >= rateMs) {
        last = now;
        push();
      } else if (pending === null) {
        pending = window.setTimeout(() => {
          pending = null;
          last = performance.now();
          push();
        }, rateMs);
      }
    });
    return () => {
      unsub();
      if (pending !== null) clearTimeout(pending);
    };
  }, [rateMs]);
  return snap;
}
