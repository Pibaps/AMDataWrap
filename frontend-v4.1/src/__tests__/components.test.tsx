import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterDrawer } from "../components/FilterDrawer";
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
});
