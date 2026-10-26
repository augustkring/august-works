import path from "node:path";
import { defineConfig } from "@playwright/test";
import authenticated from "./aw-v5-authenticated.config.js";

const server = authenticated.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected one isolated authenticated server");
process.env.PAPERCLIP_E2E_AUTH_MODE = "authenticated";

export default defineConfig({
  ...authenticated,
  testMatch: ["agent-chat-sessions.spec.ts", "agent-chat-projects.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  webServer: {
    ...server,
    command: `NODE_ENV=production ${server.command}`,
    timeout: 600_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    env: {
      ...server.env,
      PAPERCLIP_E2E_AUTH_MODE: "authenticated",
      PAPERCLIP_AUTH_RATE_LIMIT_ENABLED: "false",
    },
  },
  outputDir: path.resolve(import.meta.dirname, "../../test-results/v10-agent-chat-authenticated"),
});
