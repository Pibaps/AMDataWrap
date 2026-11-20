import { test, expect } from "@playwright/test";

test.describe("AMDataWrap V4 — Salon d'écoute 3D & Suite Analytique Apple Music", () => {
  test("3D Listening Room, Embedded Turntable YouTube Display, Chrono Rythmes & All 12 Tabs", async ({
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

    // 1. Verify persistent 3D canvas & Turntable-embedded YouTube OLED screen are mounted
    const canvas = page.getByTestId("persistent-3d-canvas").locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId("turntable-digital-display")).toBeVisible();

    // Verify that pointer events actually reach the 3D WebGL <canvas> in the middle of the screen (not blocked by <main>!)
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const hitTag = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      { x: box!.x + box!.width * 0.5, y: box!.y + box!.height * 0.5 }
    );
    expect(hitTag).toBe("CANVAS");

    // 2. Verify all 3 turntable finishes switch cleanly in 1 click
    await expect(page.getByTestId("turntable-finish-switcher")).toBeVisible();
    await page.getByTestId("finish-walnut").click();
    await page.getByTestId("finish-silver").click();
    await page.getByTestId("finish-black").click();

    // 3. Verify 3D Sleeve Inspection (pulls out of crate in 3D, zero 2D pop-up menu!)
    await expect(page.getByTestId("focused-crate-album")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("focused-crate-album").click();
    await page.waitForTimeout(750);
    await page.screenshot({ path: "test-results/desktop-sleeve-inspect-3d.png" });
    await page.getByText("Salon").first().click();
    await page.waitForTimeout(500);

    // 4. Specifically test "Rythmes" (chrono) after data arrives
    await page.getByTestId("nav-chrono").click();
    await expect(page.getByText("Heure de pointe")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Calendrier d'activité quotidienne")).toBeVisible();

    // 5. Navigate across all 12 tabs and wait for their content to render with zero runtime or HTTP >= 400 errors
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
      { id: "hub", marker: "Import & profils" },
      { id: "studio", marker: "Free Cam" },
    ];
    for (const t of tabs) {
      const btn = page.getByTestId(`nav-${t.id}`);
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await expect(page.getByText(t.marker).first()).toBeVisible({ timeout: 10_000 });
    }

    await page.waitForTimeout(380);
    await page.screenshot({ path: "test-results/desktop-salon-3d.png" });

    expect(errors).toEqual([]);
    expect(failedApiCalls).toEqual([]);
  });
});
