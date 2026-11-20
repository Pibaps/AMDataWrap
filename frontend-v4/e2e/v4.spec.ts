import { test, expect } from "@playwright/test";

test.describe("AMDataWrap V4 — Desktop 1440p & Mobile 390x844 Validation", () => {
  test("Persistent 3D Canvas, Turntable 3 Finishes, Galaxy 3D Legend & Hub LAN QR", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.getByText("AMDataWrap")).toBeVisible();
    await expect(page.getByText("VINYL STUDIO 3D", { exact: true })).toBeVisible();

    // 1. Verify persistent 3D canvas (or Tier 0 fallback in headless without WebGL) is mounted
    const stageLocator = page.locator('[data-testid="persistent-3d-canvas"], [data-testid="tier0-fallback-stage"]');
    await expect(stageLocator.first()).toBeVisible();
    const initialCanvasHandle = await stageLocator.first().elementHandle();

    // 2. Verify all 3 turntable finishes switch cleanly in 1 click
    await expect(page.getByTestId("turntable-finish-switcher")).toBeVisible();
    await page.getByTestId("finish-walnut").click();
    await page.getByTestId("finish-studio").click();
    await page.getByTestId("finish-obsidian").click();

    // 3. Navigate to Galaxy 3D V4 -> verify HUD legend & canvas visible
    await page.getByTestId("nav-galaxy").click();
    await expect(page.getByTestId("galaxy-3d-canvas")).toBeVisible();
    await expect(page.getByTestId("galaxy-hud-legend")).toBeVisible();

    // 4. Navigate to Hub & Import -> verify Capabilities Matrix, LAN QR SVG, and Graphics Tier / WebGPU card
    await page.getByTestId("nav-hub").click();
    await expect(page.getByTestId("capabilities-matrix")).toBeVisible();
    await expect(page.getByTestId("lan-qr-card")).toBeVisible();
    await expect(page.getByTestId("graphics-tier-card")).toBeVisible();

    // 5. Return to Vinyl Studio -> verify the root stage element NEVER unmounted (zero animation reset!)
    await page.getByTestId("nav-studio").click();
    const afterCanvasHandle = await stageLocator.first().elementHandle();
    const isSameNode = await page.evaluate(
      ([a, b]) => Boolean(a && b && a === b),
      [initialCanvasHandle, afterCanvasHandle]
    );
    expect(isSameNode).toBe(true);

    // Zero uncaught page errors
    expect(errors).toEqual([]);
  });
});
