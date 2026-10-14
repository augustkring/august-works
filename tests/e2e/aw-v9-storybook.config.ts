import path from "node:path";
import { defineConfig } from "@playwright/test";

// Separate static component qualification; no company server or live provider.
const port = 6191;
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: ".",
  testMatch: "aw-v9-storybook.spec.ts",
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: origin,
    headless: true,
    browserName: "chromium",
    screenshot: "only-on-failure",
    ...(process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE ? {
      launchOptions: { executablePath: process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE },
    } : {}),
  },
  webServer: {
    cwd: path.resolve(import.meta.dirname, "../.."),
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory ui/storybook-static`,
    url: `${origin}/index.json`,
    reuseExistingServer: false,
    timeout: 15000,
  },
  outputDir: "../../test-results/v9-storybook",
  reporter: [["list"]],
});
