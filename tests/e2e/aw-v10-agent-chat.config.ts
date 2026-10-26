import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import authenticated from "./aw-v5-authenticated.config.js";

const server = authenticated.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected one isolated authenticated server");
process.env.PAPERCLIP_E2E_AUTH_MODE = "authenticated";
process.env.PAPERCLIP_E2E_NATIVE_CHAT = "true";

const runnerWorkspace = path.resolve(import.meta.dirname, "../../packages/paperclip-runner/runner");
const runnerBinary = process.env.PAPERCLIP_RUNNER_BINARY
  ?? path.join(runnerWorkspace, "target/release/paperclip-runnerd");
if (!path.isAbsolute(runnerBinary) || !fs.existsSync(runnerBinary))
  throw new Error("Native agent chat requires the built paperclip-runnerd binary");
const providerDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chat-native-codex-"));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
fs.writeFileSync(path.join(providerDir, "codex"),
  `#!/bin/sh\nexec node ${quote(path.resolve(import.meta.dirname, "fixtures/native-chat-codex.mjs"))} "$@"\n`,
  { mode: 0o755 });

const authenticatedServer = server;
const nativeChatServer = {
  ...authenticatedServer,
  env: {
    ...authenticatedServer.env,
    PAPERCLIP_RUNNER_BINARY: runnerBinary,
    PATH: `${providerDir}${path.delimiter}${process.env.PATH ?? ""}`,
    PAPERCLIP_E2E_NATIVE_CHAT: "true",
  },
};

export default defineConfig({
  ...authenticated,
  testMatch: ["agent-chat-sessions.spec.ts", "agent-chat-projects.spec.ts"],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  webServer: {
    ...nativeChatServer,
    command: `NODE_ENV=production ${server.command}`,
    timeout: 600_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    env: {
      ...server.env,
      PAPERCLIP_RUNNER_BINARY: runnerBinary,
      PATH: `${providerDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PAPERCLIP_E2E_AUTH_MODE: "authenticated",
      PAPERCLIP_AUTH_RATE_LIMIT_ENABLED: "false",
      PAPERCLIP_E2E_SOURCE_DENIAL_OBSERVER: "1",
    },
  },
  outputDir: process.env.PAPERCLIP_AGENT_CHAT_OUTPUT_DIR
    ? path.resolve(process.env.PAPERCLIP_AGENT_CHAT_OUTPUT_DIR)
    : path.resolve(import.meta.dirname, "../../test-results/v10-agent-chat-authenticated"),
});
