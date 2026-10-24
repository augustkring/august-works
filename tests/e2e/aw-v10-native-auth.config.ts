import path from "node:path";
import { defineConfig } from "@playwright/test";
import authenticated from "./aw-v5-authenticated.config.js";
const server = authenticated.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected an isolated authenticated server");
export default defineConfig({
  ...authenticated,
  testMatch: "aw-v10-native-auth.spec.ts",
  timeout: 180000,
  expect: { timeout: 20000 },
  use: { ...authenticated.use, screenshot: "off", trace: "off" },
  webServer: { ...server, command: `NODE_ENV=production ${server.command}`, timeout: 600000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
    env: { ...server.env, PAPERCLIP_AUTH_RATE_LIMIT_ENABLED: "false" } },
  outputDir: path.resolve(import.meta.dirname, "../../test-results/v10-native-auth"),
});
