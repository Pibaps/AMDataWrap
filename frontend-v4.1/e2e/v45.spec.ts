import { expect, test } from "@playwright/test";

test.describe("AMDataWrap V4.5 E2E", () => {
  test("Demo Mode, i18n, Drawers, FilterDrawer, Lyrics, Wrapped PNG, Search/Sessions & WebGL budgets", async ({
    page,
    request,
  }) => {
    // Load isolated demo profile via API so all 11 analytical tabs + 3D studio have rich data
    const loadRes = await request.post("/api/v4/demo/load");
    expect(loadRes.ok()).toBeTruthy();

    try {
      await page.goto("/");
      await expect(page.getByTestId("demo-banner")).toBeVisible({ timeout: 15_000 });

      // WebGL budget on Studio 3D tab
      await page.waitForFunction(() => typeof (window as any).__AMDW_STATS === "function", { timeout: 15_000 });
      const studioStats = await page.evaluate(() => (window as any).__AMDW_STATS());
      expect(studioStats.calls).toBeLessThan(120);
      expect(studioStats.textures).toBeLessThanOrEqual(16);

      // FR / EN language toggle
      const langToggle = page.getByTestId("lang-toggle");
      await langToggle.getByRole("button", { name: "EN" }).click();
      await expect(page.getByTestId("nav-overview")).toHaveText(/Overview/i);
      await langToggle.getByRole("button", { name: "FR" }).click();
      await expect(page.getByTestId("nav-overview")).toHaveText(/Synthèse/i);

      // FilterDrawer toggle
      await page.getByTestId("filters-toggle").click();
      await expect(page.getByTestId("filter-drawer")).toBeVisible();
      await page.getByTestId("filters-toggle").click();
      await expect(page.getByTestId("filter-drawer")).not.toBeVisible();

      // Switch to Overview -> RAF must pause (0 Hz idle) & test Artist DetailDrawer
      await page.getByTestId("nav-overview").click();
      await expect(page.locator("h1")).toContainText(/Synthèse/i);
      const offStudioStats = await page.evaluate(() => (window as any).__AMDW_STATS());
      expect(offStudioStats.rafActive).toBe(false);

      // Click first artist row to open DetailDrawer
      const firstArtistRow = page.locator(".row-hover.cursor-pointer").first();
      await expect(firstArtistRow).toBeVisible({ timeout: 10_000 });
      await firstArtistRow.click();
      await expect(page.getByTestId("detail-drawer")).toBeVisible();
      await page.getByTestId("detail-drawer").getByRole("button", { name: /Fermer|Close/i }).first().click();
      await expect(page.getByTestId("detail-drawer")).not.toBeVisible();

      // LyricsPanel toggle
      await page.getByTestId("lyrics-toggle").click();
      await expect(page.getByTestId("lyrics-panel")).toBeVisible();
      await page.getByTestId("lyrics-toggle").click();
      await expect(page.getByTestId("lyrics-panel")).not.toBeVisible();

      // Wrapped HD PNG export buttons
      await page.getByTestId("nav-wrapped").click();
      await expect(page.getByTestId("wrapped-export-poster")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("wrapped-export-receipt")).toBeVisible();

      // Search -> Sessions & Full History sub-tabs
      await page.getByTestId("nav-search").click();
      await page.getByRole("button", { name: /Sessions/i }).first().click();
      await page.getByRole("button", { name: /Historique complet|Full History/i }).first().click();
    } finally {
      await request.post("/api/v4/demo/unload");
    }
  });
});
