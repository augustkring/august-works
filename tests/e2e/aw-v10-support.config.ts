import path from "node:path";
import { defineConfig } from "@playwright/test";
import authenticated from "./aw-v5-authenticated.config.js";

const server = authenticated.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected one isolated authenticated server");

export default defineConfig({
  ...authenticated,
  testMatch: "aw-v10-support.spec.ts",
  webServer: {
    ...server,
    command: `NODE_ENV=production ${server.command}`,
    timeout: 600000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30000 },
    env: { ...server.env, AW_SUPPORT_CASE_DATA_POLICY_JSON: JSON.stringify({
      schemaVersion: 1, policyVersion: "support-browser-fixture-v1",
      recipientName: "Disposable browser-test support", privacyNoticeUrl: "https://example.test/privacy",
      processingRegion: "test-fixture", retentionTrigger: "after_last_customer_or_support_message",
      retentionDays: 30, backupMaxDays: 7, restoreLagDays: 1, deletionMarkerDays: 30,
      legalHoldPolicyId: "support-browser-fixture-v1",
    }) },
  },
  outputDir: path.resolve(import.meta.dirname, "../../test-results/v10-support"),
});
