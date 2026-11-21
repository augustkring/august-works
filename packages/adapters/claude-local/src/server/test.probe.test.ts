import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const probeResult: {
    value: { exitCode: number; stdout: string; stderr: string };
    throwError: Error | null;
  } = {
    value: { exitCode: 1, stdout: "", stderr: "" },
    throwError: null,
  };
  return {
    probeResult,
    ensureAdapterExecutionTargetDirectory: vi.fn(async () => {}),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => {}),
    maybeRunSandboxInstallCommand: vi.fn(async () => null),
    runAdapterExecutionTargetProcess: vi.fn(async () => {
      if (probeResult.throwError) throw probeResult.throwError;
      return {
        exitCode: probeResult.value.exitCode,
        signal: null,
        timedOut: false,
        stdout: probeResult.value.stdout,
        stderr: probeResult.value.stderr,
        pid: 123,
        startedAt: new Date().toISOString(),
      };
    }),
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

const initLine =
  '{"type":"system","subtype":"init","cwd":"/home/daytona/paperclip-workspace","session_id":"abc","tools":["Bash","Read"]}';

afterEach(() => {
  vi.clearAllMocks();
  probeResult.throwError = null;
});

describe("Claude CLI paid hello probe admission", () => {
  it("refuses inference before launching the resolved CLI", async () => {
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "claude_local",
      config: { engine: "cli", command: "claude", model: "claude-opus-4-8" },
      executionTarget: sandboxTarget, environmentName: "Daytona",
    });
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
    expect(result.checks.some((check) => check.code === "claude_hello_probe_passed")).toBe(false);
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });

  it("does not consume a synthetic provider failure or expose its credential marker", async () => {
    const marker = "sk-ant-provider-response-marker";
    probeResult.value = { exitCode: 1, stdout: `API Error: 401 ${marker}`, stderr: `failed ${marker}` };
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "claude_local",
      config: { engine: "cli", command: "claude", env: { ANTHROPIC_API_KEY: marker } },
      executionTarget: sandboxTarget, environmentName: "Daytona",
    });
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
    expect(JSON.stringify(result.checks)).not.toContain(marker);
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });
});

describe("claude auth mode hints", () => {
  const successStdout = [
    initLine,
    '{"type":"result","subtype":"success","is_error":false,"result":"hello","session_id":"abc"}',
  ].join("\n");

  it("reports the configured subscription token for remote targets", async () => {
    probeResult.value = { exitCode: 0, stdout: successStdout, stderr: "" };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: "claude",
        env: { CLAUDE_CODE_OAUTH_TOKEN: "oauth-test-token" },
      },
      executionTarget: sandboxTarget,
      environmentName: "Daytona",
    });

    const hint = result.checks.find((check) => check.code === "claude_oauth_token_configured");
    expect(hint).toBeTruthy();
    expect(hint?.level).toBe("info");
    expect(hint?.detail).toContain("configured environment variables");
    expect(
      result.checks.some((check) => check.code === "claude_anthropic_api_key_overrides_subscription"),
    ).toBe(false);
  });

  it("reports an intentionally selected managed API account without a subscription warning", async () => {
    probeResult.value = { exitCode: 0, stdout: successStdout, stderr: "" };
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { engine: "cli", command: "claude", managedAiConnection: { provider: "anthropic", method: "api_key" }, env: { ANTHROPIC_API_KEY: "api-test-key" } },
      executionTarget: sandboxTarget, environmentName: "Daytona",
    });
    expect(result.checks.find(check => check.code === "claude_anthropic_api_key_overrides_subscription")).toMatchObject({ level: "info", message: "Using the selected Claude API connection." });
    expect(JSON.stringify(result.checks)).not.toContain("Unset ANTHROPIC_API_KEY");
  });

  it("keeps the API-key warning authoritative when both ANTHROPIC_API_KEY and the token are set", async () => {
    probeResult.value = { exitCode: 0, stdout: successStdout, stderr: "" };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: "claude",
        env: {
          ANTHROPIC_API_KEY: "api-test-key",
          CLAUDE_CODE_OAUTH_TOKEN: "oauth-test-token",
        },
      },
      executionTarget: sandboxTarget,
      environmentName: "Daytona",
    });

    expect(
      result.checks.some((check) => check.code === "claude_anthropic_api_key_overrides_subscription"),
    ).toBe(true);
    expect(result.checks.some((check) => check.code === "claude_oauth_token_configured")).toBe(false);
  });
});

describe("claude CLI local hello probe hardening", () => {
  // Clear the host proxy and host auth variables so a local probe reads a
  // deterministic env regardless of the machine that runs the suite.
  const CLEARED_HOST_ENV_KEYS = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "ANTHROPIC_BEDROCK_BASE_URL",
  ];
  const successStdout = [
    initLine,
    '{"type":"result","subtype":"success","is_error":false,"result":"hello","session_id":"abc"}',
  ].join("\n");

  let tempDir: string | null = null;
  let claudePath = "";
  let savedPath: string | undefined;
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-cli-localprobe-"));
    claudePath = path.join(tempDir, "claude");
    await writeFile(claudePath, "#!/bin/sh\nexit 0\n");
    await chmod(claudePath, 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = tempDir;
    savedEnv = {};
    for (const key of CLEARED_HOST_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // The mocked cwd resolver returns a sandbox path; the local probe reads it
    // as the cwd, so no host directory is touched.
    resolveAdapterExecutionTargetCwd.mockReturnValue("/home/daytona/paperclip-workspace");
  });

  afterEach(async () => {
    process.env.PATH = savedPath;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    tempDir = null;
  });

  it("blocks a local paid hello before process launch even with hostile caller env", async () => {
    probeResult.value = { exitCode: 0, stdout: successStdout, stderr: "" };
    process.env.HTTPS_PROXY = "http://trusted-proxy:8443";

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        engine: "cli",
        command: "/tmp/evil/claude",
        env: {
          ANTHROPIC_API_KEY: "keep-this-key",
          NODE_OPTIONS: "--require /hostile/evil.js",
          PATH: "/hostile/bin",
          LD_PRELOAD: "/hostile/evil.so",
          HTTP_PROXY: "http://caller-proxy:8080",
        },
      },
      executionTarget: null,
      environmentName: null,
    });

    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
    expect(result.checks.some((check) => check.code === "claude_hello_probe_passed")).toBe(false);
  });

  it.each([
    ["claude-fable-5-1", "2.1.251"],
    ["claude-opus-5-5", "2.1.280"],
  ])("warns without executing %s when runtime PATH selects a different executable", async (model, minimumVersion) => {
    const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-cli-runtime-path-"));
    const runtimeClaudePath = path.join(runtimeDir, "claude");
    await writeFile(runtimeClaudePath, "#!/bin/sh\nexit 0\n");
    await chmod(runtimeClaudePath, 0o755);

    try {
      probeResult.value = { exitCode: 0, stdout: `${minimumVersion} (Claude Code)\n`, stderr: "" };

      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "claude_local",
        config: {
          engine: "cli",
          command: "claude",
          model,
          env: { PATH: runtimeDir },
        },
        executionTarget: null,
        environmentName: null,
      });

      expect(result.status).toBe("warn");
      expect(result.checks).toContainEqual(expect.objectContaining({
        code: "claude_cli_version_probe_mismatch",
        hint: `Ensure the runtime-selected Claude Code is ${minimumVersion} or newer. Execution will verify that exact executable before launch.`,
        level: "warn",
      }));
      expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
    } finally {
      await rm(runtimeDir, { recursive: true, force: true });
    }
  });

  it("names the local host target on every result", async () => {
    probeResult.value = { exitCode: 0, stdout: successStdout, stderr: "" };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: { engine: "cli", command: "claude" },
      executionTarget: null,
      environmentName: null,
    });

    const targetCheck = result.checks.find((check) => check.code === "claude_environment_target");
    expect(targetCheck).toBeTruthy();
    expect(targetCheck?.message).toContain("Paperclip host");
  });
});
