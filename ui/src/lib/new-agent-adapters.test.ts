import { expect, it } from "vitest";
import { isNewAgentAdapterAllowed } from "./new-agent-adapters";
it("SaaS creation exposes remote providers and rejects every local runner despite experimental flags", () => {
  for (const type of [
    "openclaw_gateway",
    "hermes_gateway",
    "http",
    "cursor_cloud",
  ])
    expect(
      isNewAgentAdapterAllowed(type, {
        cloud: false,
        saas: true,
        nativeRunnerEnabled: true,
      }),
    ).toBe(true);
  for (const type of [
    "process",
    "paperclip_runner",
    "claude_local",
    "codex_local",
    "cursor",
    "hermes_local",
  ])
    expect(
      isNewAgentAdapterAllowed(type, {
        cloud: false,
        saas: true,
        nativeRunnerEnabled: true,
      }),
    ).toBe(false);
});
it("local and legacy cloud preserve their creation policies", () => {
  expect(
    isNewAgentAdapterAllowed("paperclip_runner", {
      cloud: false,
      nativeRunnerEnabled: false,
    }),
  ).toBe(false);
  expect(
    isNewAgentAdapterAllowed("paperclip_runner", {
      cloud: false,
      nativeRunnerEnabled: true,
    }),
  ).toBe(true);
  expect(
    isNewAgentAdapterAllowed("codex_local", {
      cloud: true,
      nativeRunnerEnabled: false,
    }),
  ).toBe(true);
  expect(
    isNewAgentAdapterAllowed("openclaw_gateway", {
      cloud: true,
      nativeRunnerEnabled: true,
    }),
  ).toBe(false);
});
