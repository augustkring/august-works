import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { cancelNativeSession, executePaperclipNativeSession } from "./native-session-executor.js";
import { NativePaidTransportAdmissionError } from "./paid-transport-admission.js";
import type { NativeExecutionInputV1 } from "@paperclipai/paperclip-runner";

function execution(provider: Record<string, unknown>, driverKind: string, runId: string) {
  return {
    schema: "paperclip.native-execution-input.v1",
    provider,
    binding: {
      companyId: "company", runId, issueId: "issue", agentId: "agent",
      executionWorkspaceId: "workspace",
    },
    task: { identifier: "PAP-PAID", title: "Test", description: null,
      prompt: "Test paid transport admission.", workMode: "standard" },
    workspace: { cwd: "/tmp/native-paid-admission", repoUrl: null, repoRef: null,
      branchName: null },
    session: { normalizedSessionId: `session-${runId}`, driverKind,
      protocolVersion: 1, lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
    completionContract: { id: "contract", sha256: "sha", schemaVersion: "paperclip.completion-contract.v1",
      contract: { revision: "1", objective: "Test", criteria: [{ id: "test", requirement: "Test" }] } },
    interactionResponses: [], credentialBindings: [],
  } as unknown as NativeExecutionInputV1;
}

describe("Native paid admission at executor entry", () => {
  it("rejects a paid CLI before backend startup and leaves Stop callable", async () => {
    const runId = "run-unqualified-native-admission";
    const openSession = vi.fn();
    await expect(executePaperclipNativeSession({
      db: {} as Db,
      execution: execution({ kind: "codex", model: null }, "codex_app_server", runId),
      runnerInstanceId: "unqualified-native-admission",
      adapterType: "paperclip_runner",
      backend: { openSession } as never,
    })).rejects.toBeInstanceOf(NativePaidTransportAdmissionError);
    expect(openSession).not.toHaveBeenCalled();
    await expect(cancelNativeSession(runId, "operator Stop")).resolves.toBe(false);
  });

  it("does not let reserved environment values authorize an SSH OpenCode launch", async () => {
    const openSession = vi.fn();
    await expect(executePaperclipNativeSession({
      db: {} as Db,
      execution: execution({ kind: "opencode", model: "anthropic/managed" }, "opencode_server", "run-forged-native-admission"),
      runnerInstanceId: "forged-native-admission",
      adapterType: "paperclip_runner",
      useRunnerd: true,
      backend: { openSession } as never,
      runnerEnvironment: {
        PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://forged.example",
        PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: "100000",
        PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: "65536",
      },
      runnerExecutionTarget: { kind: "remote", transport: "ssh", remoteCwd: "/work", spec: {} } as never,
    })).rejects.toBeInstanceOf(NativePaidTransportAdmissionError);
    expect(openSession).not.toHaveBeenCalled();
  });
});
