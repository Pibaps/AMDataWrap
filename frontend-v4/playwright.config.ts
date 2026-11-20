import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5176",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-1440p",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-390x844",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
