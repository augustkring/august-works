import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";

const { runAdapterExecutionTargetProcess } = vi.hoisted(() => ({
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0, signal: null, timedOut: false, stdout: "", stderr: "", pid: 321,
    startedAt: new Date().toISOString(),
  })),
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return { ...actual, runAdapterExecutionTargetProcess };
});

import {
  mapClaudeAcpAuthErrorCode,
  probeClaudeAcpSandboxLogin,
  testClaudeAcpEnvironment,
} from "./acp.js";
import { ADAPTER_AUTH_MISSING_CHECK_CODE } from "./auth-check.js";

afterEach(() => vi.clearAllMocks());

describe("mapClaudeAcpAuthErrorCode", () => {
  it("translates the generic acpx_auth_required code into claude_auth_required", () => {
    const engineResult: AdapterExecutionResult = {
      exitCode: 1, signal: null, timedOut: false, errorMessage: "Claude requires login.",
      errorCode: "acpx_auth_required", errorMeta: { category: "auth", errorName: "Error" },
    };
    expect(mapClaudeAcpAuthErrorCode(engineResult)).toMatchObject({
      errorCode: "claude_auth_required", errorMessage: "Claude requires login.",
      errorMeta: { category: "auth", errorName: "Error" },
    });
  });

  it("leaves unrelated and null error codes unchanged", () => {
    expect(mapClaudeAcpAuthErrorCode({ exitCode: 1, signal: null, timedOut: false, errorCode: "acpx_runtime_error" }).errorCode)
      .toBe("acpx_runtime_error");
    expect(mapClaudeAcpAuthErrorCode({ exitCode: 0, signal: null, timedOut: false, errorCode: null }).errorCode).toBeNull();
  });
});

describe("Claude ACP paid hello probe admission", () => {
  it.each([null, {
    kind: "remote" as const, transport: "ssh" as const, remoteCwd: "/work",
    spec: { host: "fixture", port: 22, username: "fixture", remoteCwd: "/work", remoteWorkspacePath: "/work", privateKey: null, knownHosts: null, strictHostKeyChecking: true },
  }])("refuses a paid login hello before process launch for target %s", async (target) => {
    const marker = "synthetic-provider-response-must-not-be-read";
    const checks = await probeClaudeAcpSandboxLogin({
      config: { engine: "acp", env: { ANTHROPIC_API_KEY: "fixture-key" } },
      target,
      env: { ANTHROPIC_API_KEY: "fixture-key" },
    });
    expect(checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
    expect(checks.some((check) => check.code === ADAPTER_AUTH_MISSING_CHECK_CODE)).toBe(false);
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
    expect(JSON.stringify(checks)).not.toContain(marker);
  });

  it("keeps configured ACP auth metadata while refusing inference", async () => {
    const secret = "oauth-configured-test-secret";
    const result = await testClaudeAcpEnvironment({
      companyId: "company-1", adapterType: "claude_local",
      config: { engine: "acp", env: { CLAUDE_CODE_OAUTH_TOKEN: secret } },
      executionTarget: null, environmentName: null,
    });
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "claude_oauth_token_configured" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
    expect(JSON.stringify(result.checks)).not.toContain(secret);
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });
});
