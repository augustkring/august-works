import path from "node:path";
import { defineConfig } from "@playwright/test";
import authenticated from "./aw-v5-authenticated.config.js";
const origin = new URL(authenticated.use!.baseURL!);
origin.hostname = "localhost";
const server = authenticated.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected an isolated authenticated server");
export default defineConfig({
  ...authenticated,
  testMatch: "aw-v10-native-auth.spec.ts",
  timeout: 180000,
  expect: { timeout: 20000 },
  use: { ...authenticated.use, baseURL: origin.origin, extraHTTPHeaders: { Origin: origin.origin }, actionTimeout: 20000, screenshot: "off", trace: "off" },
  webServer: { ...server, url: `${origin.origin}/api/health`, command: `NODE_ENV=production ${server.command}`, timeout: 600000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
    env: { ...server.env, PAPERCLIP_AUTH_RATE_LIMIT_ENABLED: "false", PAPERCLIP_PUBLIC_URL: origin.origin, PAPERCLIP_AUTH_PUBLIC_BASE_URL: origin.origin } },
  outputDir: path.resolve(import.meta.dirname, "../../test-results/v10-native-auth"),
});
