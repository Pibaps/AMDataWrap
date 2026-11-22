import { describe, expect, it } from "vitest";
import { playbackClock } from "../audio/playbackClock";

describe("playbackClock", () => {
  it("tracks elapsed ms while playing and freezes when paused", () => {
    playbackClock.set(10_000, 180_000, false);
    expect(playbackClock.getPositionMs()).toBe(10_000);
    expect(playbackClock.getDurationMs()).toBe(180_000);
    expect(playbackClock.isPlaying()).toBe(false);

    playbackClock.set(12_000, 180_000, true);
    expect(playbackClock.isPlaying()).toBe(true);
    expect(playbackClock.getPositionMs()).toBeGreaterThanOrEqual(12_000);

    playbackClock.set(15_000, 180_000, false);
    expect(playbackClock.isPlaying()).toBe(false);
    expect(playbackClock.getPositionMs()).toBe(15_000);
  });
});
