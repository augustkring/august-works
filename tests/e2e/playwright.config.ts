import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Use a dedicated authenticated instance and a real bootstrap Human session.
// Product journeys that read private sources must not rely on local-implicit
// authority, which deliberately cannot stand in for an authenticated Human.
const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAPERCLIP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-e2e-home-"));
const PAPERCLIP_INSTANCE_ID = "playwright-e2e";
const PAPERCLIP_CONFIG = path.join(PAPERCLIP_HOME, "instances", PAPERCLIP_INSTANCE_ID, "config.json");
const PAPERCLIP_AGENT_JWT_SECRET = process.env.PAPERCLIP_AGENT_JWT_SECRET ?? "playwright-e2e-agent-jwt-secret";
const PAPERCLIP_E2E_AUTH_SECRET = "disposable-browser-authentication-secret-2026";
const PAPERCLIP_DECISION_SIGNING_SECRET =
  process.env.PAPERCLIP_DECISION_SIGNING_SECRET ?? "playwright-e2e-decision-signing-secret";
const PAPERCLIP_TOOL_ACTION_SIGNING_SECRET =
  process.env.PAPERCLIP_TOOL_ACTION_SIGNING_SECRET ?? "playwright-e2e-tool-action-signing-secret";
const PLAYWRIGHT_CHANNEL = process.env.PAPERCLIP_PLAYWRIGHT_CHANNEL;
const PLAYWRIGHT_EXECUTABLE = process.env.PAPERCLIP_PLAYWRIGHT_EXECUTABLE;

process.env.PAPERCLIP_HOME = PAPERCLIP_HOME;
process.env.PAPERCLIP_CONFIG = PAPERCLIP_CONFIG;
// Worker processes reload this config; retain the main process's server path
// for specs that seed historical database state in the throwaway instance.
process.env.PAPERCLIP_E2E_SERVER_CONFIG ??= PAPERCLIP_CONFIG;
process.env.PAPERCLIP_E2E_AUTH_STORAGE_STATE ??= path.join(PAPERCLIP_HOME, "browser-owner-session.json");
process.env.PAPERCLIP_E2E_AUTH_MODE = "authenticated";
// Specs that mint agent JWTs in-process (via createLocalAgentJwt) must derive
// the same per-instance signing key as the webServer, or verification fails
// with a 401 instead of authenticating as the agent.
process.env.PAPERCLIP_INSTANCE_ID = PAPERCLIP_INSTANCE_ID;
process.env.PAPERCLIP_AGENT_JWT_SECRET = PAPERCLIP_AGENT_JWT_SECRET;
process.env.BETTER_AUTH_SECRET = PAPERCLIP_E2E_AUTH_SECRET;
process.env.PAPERCLIP_DECISION_SIGNING_SECRET = PAPERCLIP_DECISION_SIGNING_SECRET;
process.env.PAPERCLIP_TOOL_ACTION_SIGNING_SECRET = PAPERCLIP_TOOL_ACTION_SIGNING_SECRET;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // These suites target dedicated multi-user configurations/ports and are
  // intentionally not part of the default product-journey run.
  testIgnore: ["in-feed-native/**", "multi-user.spec.ts", "multi-user-authenticated.spec.ts", "agent-chat-sessions.spec.ts", "agent-chat-projects.spec.ts", "aw-v5-authenticated.spec.ts", "aw-v7-authenticated.spec.ts", "aw-v9-storybook.spec.ts", "aw-v10-native-auth.spec.ts", "aw-v10-support.spec.ts"],
  timeout: 60_000,
  retries: 0,
  // All specs share one throwaway server, and several toggle instance-level
  // state (the `enableConferenceRoomChat` experimental flag) that changes
  // which UI variant renders. Run files serially so a flag flip in one spec
  // can't change the wizard/thread under another spec mid-flight.
  workers: 1,
  globalSetup: path.resolve(import.meta.dirname, "fixtures/bootstrap-browser-owner.ts"),
  use: {
    baseURL: BASE_URL,
    storageState: process.env.PAPERCLIP_E2E_AUTH_STORAGE_STATE,
    extraHTTPHeaders: { Origin: BASE_URL },
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
        ...(PLAYWRIGHT_EXECUTABLE ? { launchOptions: { executablePath: PLAYWRIGHT_EXECUTABLE } } : {}),
      },
    },
  ],
  // The webServer directive bootstraps a throwaway instance and then starts it.
  // `onboard --yes --run` works in a non-interactive temp PAPERCLIP_HOME.
  webServer: {
    cwd: path.resolve(import.meta.dirname, "../.."),
    // Exercise the shipped UI. Source-checkout onboarding otherwise enables
    // Vite middleware: every reload traverses thousands of modules, including
    // service-worker-intercepted requests, before React can even start.
    // Build the server's first-choice static directory so a prior package build
    // cannot shadow the UI under test with stale server/ui-dist assets.
    // Keep the browser artifact equivalent to an ordinary production build.
    // The backend still needs NODE_ENV=test for its disposable fixtures.
    command: "NODE_ENV=production pnpm --filter @paperclipai/ui build --outDir ../server/ui-dist --emptyOutDir && node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts onboard --yes --bind lan --run",
    url: `${BASE_URL}/api/health`,
    // Always boot a dedicated throwaway instance for e2e so browser tests
    // never attach to the developer's active Paperclip home/server.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PAPERCLIP_UI_DEV_MIDDLEWARE: "false",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${path.resolve(import.meta.dirname, "fixtures/agent-chat-github.mjs")}`,
      PORT: String(PORT),
      PAPERCLIP_OPEN_ON_LISTEN: "false",
      PAPERCLIP_API_URL: BASE_URL,
      PAPERCLIP_HOME,
      PAPERCLIP_INSTANCE_ID,
      PAPERCLIP_CONFIG,
      PAPERCLIP_AGENT_JWT_SECRET,
      BETTER_AUTH_SECRET: PAPERCLIP_E2E_AUTH_SECRET,
      PAPERCLIP_DECISION_SIGNING_SECRET,
      PAPERCLIP_TOOL_ACTION_SIGNING_SECRET,
      PAPERCLIP_BIND: "lan",
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated",
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "private",
      PAPERCLIP_PUBLIC_URL: BASE_URL,
      PAPERCLIP_AUTH_PUBLIC_BASE_URL: BASE_URL,
    },
  },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
