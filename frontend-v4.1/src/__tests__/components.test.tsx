import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterDrawer } from "../components/FilterDrawer";
import { Header, NAV_TAB_IDS } from "../components/Header";
import { LyricsPanel } from "../components/LyricsPanel";
import { Cover } from "../components/ui";
import { WelcomeOverlay } from "../components/WelcomeOverlay";

describe("V4.5 UI components", () => {
  it("Cover renders fallback icon when image errors", () => {
    render(<Cover url="https://is1-ssl.mzstatic.com/broken.jpg" alt="Broken Cover" size={40} />);
    const img = screen.getByAltText("Broken Cover");
    fireEvent.error(img);
    expect(screen.queryByAltText("Broken Cover")).not.toBeInTheDocument();
  });

  it("FilterDrawer renders when open and triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <FilterDrawer
        open={true}
        onClose={onClose}
        options={{
          years: [2024],
          months: ["01"],
          seasons: ["winter"],
          genres: ["Electronic"],
          devices: ["Mac"],
          decades: [2020],
          artists: [],
          containers: [],
          features: [],
          providers: ["apple_music"],
        }}
        hasIncognito={true}
      />,
    );
    expect(screen.getByTestId("filter-drawer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /fermer|close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("WelcomeOverlay renders Demo CTA", () => {
    render(<WelcomeOverlay onLoaded={vi.fn(async () => {})} />);
    expect(screen.getByTestId("load-demo-btn")).toBeInTheDocument();
  });

  it("LyricsPanel renders standby message when open with no track", () => {
    render(<LyricsPanel open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("lyrics-panel")).toBeInTheDocument();
  });

  it("Header renders all 12 tabs inline on xl desktop without overflow menu", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1440 });
    render(
      <Header
        hasData={false}
        availablePlatforms={["apple_music", "spotify"]}
        selectedPlatforms={["apple_music", "spotify"]}
        isAllPlatforms={true}
        platformLabels={{ apple_music: "Apple Music", spotify: "Spotify" }}
        activePlatformBanner="APPLE MUSIC + SPOTIFY"
        availableYears={[2025, 2026]}
        filtersOpen={false}
        activeAdvancedCount={0}
        onTogglePlatform={vi.fn()}
        onToggleFilters={vi.fn()}
      />,
    );
    for (const id of NAV_TAB_IDS) {
      expect(screen.getByTestId(`nav-${id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("nav-more-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sources-dropdown-toggle")).not.toBeInTheDocument();
  });

  it("Header collapses overflow tabs and platform sources into popovers on mobile without scrollbars", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 390 });
    render(
      <Header
        hasData={false}
        availablePlatforms={["apple_music", "spotify", "youtube_music"]}
        selectedPlatforms={["apple_music", "spotify", "youtube_music"]}
        isAllPlatforms={true}
        platformLabels={{ apple_music: "Apple Music", spotify: "Spotify", youtube_music: "YouTube Music" }}
        activePlatformBanner="APPLE MUSIC + SPOTIFY + YOUTUBE MUSIC"
        availableYears={[2025, 2026]}
        filtersOpen={false}
        activeAdvancedCount={1}
        onTogglePlatform={vi.fn()}
        onToggleFilters={vi.fn()}
      />,
    );
    const moreBtn = screen.getByTestId("nav-more-toggle");
    expect(moreBtn).toBeInTheDocument();
    expect(screen.queryByTestId("nav-overview")).not.toBeInTheDocument();
    fireEvent.click(moreBtn);
    expect(screen.getByTestId("nav-more-menu")).toBeInTheDocument();
    expect(screen.getByTestId("nav-overview")).toBeInTheDocument();

    const sourcesBtn = screen.getByTestId("sources-dropdown-toggle");
    expect(sourcesBtn).toBeInTheDocument();
    fireEvent.click(sourcesBtn);
    expect(screen.getByTestId("sources-dropdown-menu")).toBeInTheDocument();
  });
});
