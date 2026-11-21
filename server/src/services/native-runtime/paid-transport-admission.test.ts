import { describe, expect, it } from "vitest";
import {
  assertNativePaidTransportAdmitted,
  assertNativePaidTransportCandidate,
  NativePaidTransportAdmissionError,
} from "./paid-transport-admission.js";

describe("Native paid transport admission", () => {
  it.each(["codex", "claude_managed", "aws_agentcore", "acpx"])(
    "rejects unsupported Paperclip Runner provider candidate %s",
    (provider) => {
      expect(() => assertNativePaidTransportCandidate({
        provider,
      })).toThrow(NativePaidTransportAdmissionError);
    },
  );

  it("does not treat a provider name or injected broker environment as proof", () => {
    assertNativePaidTransportCandidate({ provider: "opencode" });
    expect(() => assertNativePaidTransportAdmitted({
      provider: "opencode", adapterType: "paperclip_runner",
      companyId: "company", agentId: "agent",
    })).toThrow(NativePaidTransportAdmissionError);
  });

  it("admits only the server-selected Runnerd OpenCode sandbox route", () => {
    assertNativePaidTransportCandidate({ provider: "opencode" });
    expect(() => assertNativePaidTransportAdmitted({
      provider: "opencode", adapterType: "paperclip_runner",
      backendDriverKind: "opencode_server", useRunnerd: true,
      executionTarget: { kind: "remote", transport: "sandbox" },
      companyId: "company", agentId: "agent",
    })).not.toThrow();
  });

  it.each([
    { adapterType: "paperclip_runner", backendDriverKind: "opencode_server", useRunnerd: true, executionTarget: { kind: "remote", transport: "ssh" } },
    { adapterType: "paperclip_runner", backendDriverKind: "opencode_server", useRunnerd: true, executionTarget: { kind: "local" } },
    { adapterType: "paperclip_runner", backendDriverKind: "opencode_server", useRunnerd: false, executionTarget: { kind: "remote", transport: "sandbox" } },
    { adapterType: "other_adapter", backendDriverKind: "opencode_server", useRunnerd: true, executionTarget: { kind: "remote", transport: "sandbox" } },
    { adapterType: "paperclip_runner", backendDriverKind: "codex", useRunnerd: true, executionTarget: { kind: "remote", transport: "sandbox" } },
  ])("blocks unqualified OpenCode route %#", (route) => {
    expect(() => assertNativePaidTransportAdmitted({
      provider: "opencode", ...route, companyId: "company", agentId: "agent",
    })).toThrow(NativePaidTransportAdmissionError);
  });

  it("blocks direct AI Connection credentials while preserving the selected provider", () => {
    expect(() => assertNativePaidTransportCandidate({
      provider: "opencode", aiConnectionBound: true,
    })).toThrow("This runtime is not available for managed model calls. Choose an available runtime in Runtime settings.");
  });

  it("keeps the private server-owned draft route admitted", () => {
    assertNativePaidTransportCandidate({
      provider: "aw_text_only", serverOwnedDraft: true,
    });
    expect(() => assertNativePaidTransportAdmitted({
      provider: "aw_text_only", adapterType: "paperclip_runner",
      companyId: "company", agentId: "agent", serverOwnedDraft: true,
    })).not.toThrow();
  });
});
