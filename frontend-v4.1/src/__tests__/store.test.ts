import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GLOBAL_FILTERS, useV4Store } from "../store/useV4Store";

describe("useV4Store", () => {
  beforeEach(() => {
    useV4Store.setState({
      filters: { ...DEFAULT_GLOBAL_FILTERS },
      locale: "fr",
      drawerTarget: null,
      timeUnit: "hours",
    });
  });

  it("updates and resets filters cleanly", () => {
    useV4Store.getState().setFilters({ year: "2024", genre: "Electronic" });
    expect(useV4Store.getState().filters.year).toBe("2024");
    expect(useV4Store.getState().filters.genre).toBe("Electronic");

    useV4Store.getState().resetFilters();
    expect(useV4Store.getState().filters.year).toBe("all");
    expect(useV4Store.getState().filters.genre).toBe("");
  });

  it("switches locale, timeUnit and drawerTarget", () => {
    useV4Store.getState().setLocale("en");
    expect(useV4Store.getState().locale).toBe("en");

    useV4Store.getState().setTimeUnit("minutes");
    expect(useV4Store.getState().timeUnit).toBe("minutes");

    useV4Store.getState().openDrawer({ type: "artist", key: "daft punk" });
    expect(useV4Store.getState().drawerTarget).toEqual({ type: "artist", key: "daft punk" });

    useV4Store.getState().closeDrawer();
    expect(useV4Store.getState().drawerTarget).toBeNull();
  });
});
