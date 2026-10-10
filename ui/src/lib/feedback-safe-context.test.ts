import { expect, it } from "vitest";
import {
  feedbackClientEnvironment,
  feedbackPageContext,
} from "./feedback-safe-context";

it.each([
  [
    "Mozilla/5.0 (Windows NT 10.0) Chrome/143.0 Safari/537.36 Edg/143.0",
    "edge",
    143,
    "windows",
    10,
  ],
  [
    "Mozilla/5.0 (Android 16) Chrome/141.0 Mobile Safari/537.36",
    "chrome",
    141,
    "android",
    16,
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1) Version/19.0 Mobile Safari/605.1",
    "safari",
    19,
    "ios",
    19,
  ],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/144.0",
    "firefox",
    144,
    "macos",
    10,
  ],
  ["Mozilla/5.0 (Linux) Chromium/143.0", "chromium", 143, "linux", null],
  [
    "Mozilla/5.0 (CrOS x86_64 16483.0) Chrome/143.0 Safari/537.36",
    "chrome",
    143,
    "chromeos",
    null,
  ],
  [
    "Mozilla/5.0 Chrome/143.0 Safari/537.36 OPR/126.0",
    "opera",
    126,
    "unknown",
    null,
  ],
] as const)(
  "reduces reported environment to known families and major versions: %s",
  (ua, browser, major, os, osMajor) => {
    expect(feedbackClientEnvironment(ua)).toEqual({
      source: "reported_user_agent",
      browser: { family: browser, majorVersion: major },
      operatingSystem: { family: os, majorVersion: osMajor },
    });
  },
);

it("drops raw private and oversized UA text and never guesses an unknown version", () => {
  const result = feedbackClientEnvironment(
    "private-ua-canary Chrome/143.0 private-account-name",
  );
  expect(JSON.stringify(result)).not.toContain("private");
  for (const ua of [
    "private-only",
    "Chrome/0 Android 0",
    "Chrome/12345",
    "Chrome/143.0" + "private".repeat(1000),
  ]) {
    expect(feedbackClientEnvironment(ua).browser).toEqual({
      family: "unknown",
      majorVersion: null,
    });
    expect(feedbackClientEnvironment(ua).operatingSystem).toEqual({
      family: "unknown",
      majorVersion: null,
    });
  }
});

it("keeps support, exact recognized screens and unspecific routes distinct without copying route IDs or query values", () => {
  expect(
    feedbackPageContext(
      "/AW/company/support-access?secret=private-query#private-fragment",
    ),
  ).toEqual({ surfaceKey: "support", screenContractId: "SUPPORT-ACCESS" });
  expect(feedbackPageContext("/AW/company/settings/support")).toEqual({
    surfaceKey: "support",
  });
  expect(feedbackPageContext("/AW/agents/private-agent-id/monitor")).toEqual({
    surfaceKey: "agents",
    screenContractId: "AGENT-MONITOR",
  });
  expect(feedbackPageContext("/AW/saas/activation/private-screen")).toEqual({
    surfaceKey: "onboarding",
  });
  expect(feedbackPageContext("/AW/private-other?secret=x")).toEqual({
    surfaceKey: "other",
  });
  expect(
    JSON.stringify(
      feedbackPageContext(
        "/AW/workflows/private-workflow-id/runs/private-run-id",
      ),
    ),
  ).not.toContain("private");
});
