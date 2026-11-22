import { afterEach, describe, expect, it } from "vitest";
import {
  buildQueryParams,
  coverUrl,
  formatDateFr,
  formatDurationMs,
  formatHours,
  formatInt,
  setActiveLocale,
  setActiveTimeUnit,
  type GlobalFilters,
} from "../api/client";

const BASE_FILTERS: GlobalFilters = {
  source_provider: "all",
  year: "all",
  period_mode: "year",
  month: "all",
  season: "all",
  date_from: "",
  date_to: "",
  skip_mode: "lastfm",
  min_seconds: 30,
  min_completion_pct: 50,
  metric: "ms",
  genre: "all",
  device: "all",
  offline: "",
  exclude_incognito: true,
  profile_id: null,
};

describe("api/client helpers", () => {
  afterEach(() => {
    setActiveLocale("fr");
    setActiveTimeUnit("hours");
  });

  it("buildQueryParams serializes active filters and skips defaults", () => {
    const qs = buildQueryParams({
      ...BASE_FILTERS,
      period_mode: "month",
      year: "all",
      month: "06",
      skip_mode: "custom",
      min_seconds: 45,
      min_completion_pct: 60,
      metric: "plays",
      profile_id: 2,
    });
    expect(qs).toContain("period_mode=month");
    expect(qs).toContain("month=06");
    expect(qs).toContain("skip_mode=custom");
    expect(qs).toContain("min_seconds=45");
    expect(qs).toContain("min_completion_pct=60");
    expect(qs).toContain("metric=plays");
    expect(qs).toContain("profile_id=2");
  });

  it("coverUrl normalizes http to https and proxies valid URLs", () => {
    expect(coverUrl(null)).toBeNull();
    expect(coverUrl("ftp://bad.example/a.jpg")).toBeNull();
    const proxied = coverUrl("http://coverartarchive.org/release/1/front.jpg", 300);
    expect(proxied).toBe(
      "/api/artwork-proxy?url=https%3A%2F%2Fcoverartarchive.org%2Frelease%2F1%2Ffront.jpg&w=300&fmt=webp",
    );
  });

  it("formats durations, hours, integers and dates in FR and EN", () => {
    expect(formatDurationMs(125_000)).toBe("2:05");
    expect(formatDurationMs(0)).toBe("0:00");

    setActiveLocale("fr");
    expect(formatHours(5_400_000)).toBe("1,5 h");
    expect(formatInt(1234)).toMatch(/1[\s\u202f\u00a0]234/);
    expect(formatDateFr("2024-06-15")).toContain("2024");

    setActiveLocale("en");
    expect(formatHours(5_400_000)).toBe("1.5 h");
    setActiveTimeUnit("minutes");
    expect(formatHours(5_400_000)).toBe("90 min");
  });
});
