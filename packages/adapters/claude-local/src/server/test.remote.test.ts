import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";

const {
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
  probeResult,
} = vi.hoisted(() => {
  const probeResult: { value: { exitCode: number; stdout: string; stderr: string } } = {
    value: { exitCode: 1, stdout: "", stderr: "" },
  };
  return {
    probeResult,
    ensureAdapterExecutionTargetDirectory: vi.fn(async () => {}),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => {}),
    maybeRunSandboxInstallCommand: vi.fn(async () => null),
    runAdapterExecutionTargetProcess: vi.fn(async () => ({
      exitCode: probeResult.value.exitCode,
      signal: null,
      timedOut: false,
      stdout: probeResult.value.stdout,
      stderr: probeResult.value.stderr,
      pid: 123,
      startedAt: new Date().toISOString(),
    })),
    describeAdapterExecutionTarget: vi.fn(() => "Daytona"),
    resolveAdapterExecutionTargetCwd: vi.fn(() => "/home/daytona/paperclip-workspace"),
  };
});

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetDirectory,
    ensureAdapterExecutionTargetCommandResolvable,
    maybeRunSandboxInstallCommand,
    runAdapterExecutionTargetProcess,
    describeAdapterExecutionTarget,
    resolveAdapterExecutionTargetCwd,
  };
});

import { testEnvironment } from "./test.js";
import { ADAPTER_AUTH_MISSING_CHECK_CODE } from "./auth-check.js";
import { resetClaudeCliCapabilitiesCacheForTests } from "./cli-capabilities.js";

const sandboxTarget: AdapterExecutionTarget = {
  kind: "remote",
  transport: "sandbox",
  providerKey: "daytona",
  remoteCwd: "/home/daytona/paperclip-workspace",
  runner: {
    execute: async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      pid: null,
      startedAt: new Date().toISOString(),
    }),
  },
};

const sshTarget: AdapterExecutionTarget = {
  kind: "remote",
  transport: "ssh",
  remoteCwd: "/home/agent/paperclip-workspace",
  spec: {
    host: "ssh.example.test",
    port: 22,
    username: "agent",
    remoteCwd: "/home/agent/paperclip-workspace",
    remoteWorkspacePath: "/home/agent/paperclip-workspace",
    privateKey: null,
    knownHosts: null,
    strictHostKeyChecking: true,
  },
};

afterEach(() => {
  vi.clearAllMocks();
  resetClaudeCliCapabilitiesCacheForTests();
});

describe("claude remote paid hello admission", () => {
  it.each([
    ["sandbox", sandboxTarget, "Daytona"],
    ["SSH", sshTarget, "Remote host"],
  ] as const)("preserves static %s diagnostics and denies the paid hello before execution", async (_name, executionTarget, environmentName) => {
    // A successful/high-enough version check is static setup evidence. The
    // configured token remains visible as metadata, but must not authorize a
    // paid hello probe on an unqualified runtime.
    probeResult.value = { exitCode: 0, stdout: "2.1.300 (Claude Code)\n", stderr: "" };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: "claude",
        model: "claude-fable-5-1",
        env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-test-token" },
      },
      executionTarget,
      environmentName,
    });

    expect(result.status).toBe("fail");
    for (const code of [
      "claude_cwd_valid",
      "claude_command_resolvable",
      "claude_oauth_token_configured",
      "paid_transport_unqualified",
    ]) {
      expect(result.checks.some((check) => check.code === code)).toBe(true);
    }
    for (const code of [
      ADAPTER_AUTH_MISSING_CHECK_CODE,
      "claude_hello_probe_auth_required",
      "claude_hello_probe_passed",
      "claude_hello_probe_error",
    ]) {
      expect(result.checks.some((check) => check.code === code)).toBe(false);
    }

    // The only remote process may be the free static --version diagnostic;
    // there must be no `--print` model hello invocation.
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    const versionCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
      string,
      AdapterExecutionTarget,
      string,
      string[],
    ];
    expect(versionCall[3]).toEqual(["--version"]);
  });
});

describe("claude CLI model compatibility check", () => {
  it.each([
    ["claude-fable-5-1", "2.1.251", "2.1.247"],
    ["claude-opus-5-5", "2.1.280", "2.1.279"],
  ])("fails before the hello probe for %s below CLI %s", async (model, minimumVersion, detectedVersion) => {
    probeResult.value = {
      exitCode: 0,
      stdout: `${detectedVersion} (Claude Code)\n`,
      stderr: "",
    };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: "claude",
        model,
      },
      executionTarget: sandboxTarget,
      environmentName: "Daytona",
    });

    expect(result.status).toBe("fail");
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: "claude_cli_version_incompatible",
      level: "error",
      message: `${model} requires Claude Code ${minimumVersion} or newer on the CLI lane.`,
      detail: `Detected Claude Code ${detectedVersion}.`,
    }));
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    const versionCall = runAdapterExecutionTargetProcess.mock.calls[0] as unknown as [
      string,
      AdapterExecutionTarget,
      string,
      string[],
    ];
    expect(versionCall[3]).toEqual(["--version"]);
  });
});
