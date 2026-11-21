import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected one isolated E2E server");
const origin = base.use?.baseURL;
if (!origin) throw new Error("Expected an isolated E2E origin");
export default defineConfig({
  ...base,
  // Authentication/account suites create their own principals and must start
  // signed out; the ordinary product suite's bootstrap account is not shared.
  globalSetup: undefined,
  testMatch: "aw-v5-authenticated.spec.ts",
  testIgnore: [],
  use: { ...base.use, storageState: undefined, extraHTTPHeaders: { Origin: origin } },
  webServer: {
    ...server,
    command: "pnpm --filter @paperclipai/ui build --outDir ../server/ui-dist --emptyOutDir && node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts onboard --yes --bind lan --run",
    env: { ...server.env, PAPERCLIP_DEPLOYMENT_MODE: "authenticated", PAPERCLIP_PUBLIC_URL: origin, PAPERCLIP_AUTH_PUBLIC_BASE_URL: origin },
  },
  outputDir: path.resolve(import.meta.dirname, "../../test-results/v5-authenticated"),
});
