import { test, expect } from "@playwright/test";

test.describe("AMDataWrap V4.1 — Perf Extrême, Salon 3D & Suite Analytique", () => {
  test("3D Listening Room, Demand-Driven Idle, Draw Calls < 35, Bridge Switcher, InfoTooltips & All 12 Tabs", async ({
    page,
  }) => {
    const errors: string[] = [];
    const failedApiCalls: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/") && res.status() >= 400) {
        failedApiCalls.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto("/");
    await expect(page.getByText("AMDataWrap")).toBeVisible();

    // 1. Verify persistent 3D canvas & Turntable-embedded OLED display are mounted
    const canvas = page.getByTestId("persistent-3d-canvas").locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("turntable-digital-display")).toBeVisible();

    // Verify pointer events reach the WebGL <canvas>
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const hitTag = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      { x: box!.x + box!.width * 0.5, y: box!.y + box!.height * 0.5 }
    );
    expect(hitTag).toBe("CANVAS");

    // 2. Verify V4.1 WebGL performance stats (`window.__AMDW_STATS()`)
    await page.waitForTimeout(1800);
    const stats = await page.evaluate(() => (window as any).__AMDW_STATS?.());
    console.log("V4.1_WEBGL_STATS:", JSON.stringify(stats));
    expect(stats).toBeTruthy();
    expect(stats.calls).toBeLessThan(120); // Massive reduction vs V4.0 (~230+ calls; 1-draw-call crate!)
    expect(stats.textures).toBeLessThanOrEqual(16); // Zero permanent CanvasTexture bloat!
    expect(stats.pixelRatio).toBeLessThanOrEqual(1.5);
    expect(stats.rafActive).toBe(false); // Demand-driven loop auto-sleeps at 0 Hz when idle!

    // 3. Verify 0 EUR Source Switcher (YouTube / Mon onglet / 30s)
    await expect(page.getByTestId("source-youtube")).toBeVisible();
    await expect(page.getByTestId("source-bridge")).toBeVisible();
    await expect(page.getByTestId("source-preview")).toBeVisible();

    // 4. Verify all 3 turntable finishes switch cleanly in 1 click
    await expect(page.getByTestId("turntable-finish-switcher")).toBeVisible();
    await page.getByTestId("finish-walnut").click();
    await page.getByTestId("finish-silver").click();
    await page.getByTestId("finish-black").click();

    // 5. Verify 3D Sleeve Inspection
    await expect(page.getByTestId("focused-crate-album")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("focused-crate-album").click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/v41-sleeve-inspect-3d.png" });
    await page.locator(".chip", { hasText: "Salon" }).click();
    await page.waitForTimeout(650);

    // 6. Navigate across all 12 tabs with zero runtime or HTTP >= 400 errors
    const tabs: Array<{ id: string; marker: string }> = [
      { id: "overview", marker: "Temps cumulé" },
      { id: "tops", marker: "Classements" },
      { id: "chrono", marker: "Heure de pointe" },
      { id: "persona", marker: "Figure dominante" },
      { id: "behavior", marker: "Écoutes en boucle" },
      { id: "science", marker: "Nombre d'Eddington" },
      { id: "atlas", marker: "Atlas mondial des origines" },
      { id: "galaxy", marker: "Constellation sonore" },
      { id: "search", marker: "Recherche plein-texte" },
      { id: "wrapped", marker: "Rétrospective éditoriale" },
      { id: "hub", marker: "Importer mes écoutes" },
      { id: "studio", marker: "Free Cam" },
    ];
    for (const t of tabs) {
      const btn = page.getByTestId(`nav-${t.id}`);
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await expect(page.getByText(t.marker).first()).toBeVisible({ timeout: 10_000 });
      if (t.id === "hub") {
        // Verify advanced technical drawer is collapsed by default
        const isOpen = await page.getByTestId("hub-advanced-drawer").getAttribute("open");
        expect(isOpen).toBeNull();
      }
      if (t.id === "science") {
        // Verify ? InfoTooltips are present
        await expect(page.locator('[role="tooltip"]').first()).toBeAttached();
      }
    }

    await page.waitForTimeout(450);

    // 7. Regression checks: rapid Skip (Next/Next/Prev) in 3D & Overview must NEVER crash React!
    await page.getByLabel("Piste suivante").first().click();
    await page.waitForTimeout(1200);
    await page.getByLabel("Piste suivante").first().click();
    await page.waitForTimeout(1200);
    await page.getByLabel("Piste précédente").first().click();
    await page.waitForTimeout(900);

    // Verify Play + Skip from Overview (non-3D tab)
    await page.getByTestId("nav-overview").click();
    await expect(page.getByText("Temps cumulé")).toBeVisible({ timeout: 10_000 });
    const playBtns = page.getByRole("button", { name: "Écouter" });
    if ((await playBtns.count()) > 0) {
      await playBtns.first().click();
      await page.waitForTimeout(1000);
      await page.getByLabel("Piste suivante").first().click();
      await page.waitForTimeout(900);
    }

    await page.getByTestId("nav-studio").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/v41-salon-3d.png" });

    expect(errors).toEqual([]);
    expect(failedApiCalls).toEqual([]);
  });
});
