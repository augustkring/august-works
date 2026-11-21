import { describe, expect, it, vi, beforeEach } from "vitest";

const ensureDirectoryMock = vi.hoisted(() => vi.fn(async () => {}));
const ensureCommandMock = vi.hoisted(() => vi.fn(async () => {}));
const runProcessMock = vi.hoisted(() => vi.fn());
const prepareRuntimeMock = vi.hoisted(() => vi.fn());
const stageGrokHomeMock = vi.hoisted(() => vi.fn(async () => "/tmp/staged-grok-home"));

vi.mock("@paperclipai/adapter-utils/execution-target", () => ({
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: ensureCommandMock,
  ensureAdapterExecutionTargetDirectory: ensureDirectoryMock,
  prepareAdapterExecutionTargetRuntime: prepareRuntimeMock,
  resolveAdapterExecutionTargetCwd: (_target: unknown, configuredCwd: string, fallbackCwd: string) =>
    configuredCwd || fallbackCwd,
  runAdapterExecutionTargetProcess: runProcessMock,
}));

vi.mock("./grok-home.js", () => ({ stageGrokHomeForSync: stageGrokHomeMock }));
vi.mock("./grok-auth-copyback.js", () => ({ copyBackGrokAuth: vi.fn(async () => {}) }));

import { existsSync } from "node:fs";
import { parseGrokModelsOutput, testEnvironment } from "./test.js";

function expectPaidHelloProbeUnavailable(result: Awaited<ReturnType<typeof testEnvironment>>) {
  expect(result.status).toBe("fail");
  expect(result.checks).toContainEqual(
    expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }),
  );
  expect(result.checks.some((check: { code: string }) => check.code.startsWith("grok_hello_probe_"))).toBe(false);
  expect(runProcessMock).toHaveBeenCalledTimes(1);
  expect(runProcessMock.mock.calls[0]?.[3]).toEqual(["models"]);
}

describe("parseGrokModelsOutput", () => {
  it("extracts auth state and models from `grok models` output", () => {
    expect(parseGrokModelsOutput([
      "You are logged in with grok.com.",
      "",
      "Default model: grok-build",
      "",
      "Available models:",
      "  * grok-build (default)",
      "  * grok-code",
    ].join("\n"))).toEqual({
      authenticated: true,
      defaultModel: "grok-build",
      models: ["grok-build", "grok-code"],
    });
  });
});

describe("grok_local testEnvironment", () => {
  beforeEach(() => {
    ensureDirectoryMock.mockClear();
    ensureCommandMock.mockClear();
    runProcessMock.mockReset();
    prepareRuntimeMock.mockReset();
    stageGrokHomeMock.mockClear();
  });

  it("reports non-paid model diagnostics without starting an unqualified hello probe", async () => {
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          "You are logged in with grok.com.",
          "",
          "Default model: grok-build",
          "",
          "Available models:",
          "  * grok-build (default)",
        ].join("\n"),
        stderr: "",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: {
        command: "grok",
        cwd: "/tmp/project",
        model: "grok-build",
      },
    });

    expectPaidHelloProbeUnavailable(result);
    expect(result.checks.map((check: { code: string }) => check.code)).toEqual(
      expect.arrayContaining([
        "grok_command_resolvable",
        "grok_models_probe_passed",
        "grok_model_configured",
        "paid_transport_unqualified",
      ]),
    );
  });

  it("does not warn about the default sentinel while refusing the paid hello probe", async () => {
    // Real grok never lists the "grok-build" sentinel; execute.ts never sends
    // it. The probe must treat the default as valid (info), not warn.
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          "You are logged in with grok.com.",
          "",
          "Default model: grok-4.20-0309-non-reasoning",
          "",
          "Available models:",
          "  * grok-4.20-0309-non-reasoning (default)",
          "  * grok-4",
        ].join("\n"),
        stderr: "",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" }, // no model → default sentinel
    });

    const codes = result.checks.map((check: { code: string }) => check.code);
    expect(codes).toContain("grok_model_configured");
    expect(codes).not.toContain("grok_model_not_found");
    expectPaidHelloProbeUnavailable(result);
  });

  it("warns when an explicitly configured model is missing without a paid hello", async () => {
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          "You are logged in with grok.com.",
          "",
          "Default model: grok-4",
          "",
          "Available models:",
          "  * grok-4",
        ].join("\n"),
        stderr: "",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project", model: "grok-nonexistent" },
    });

    expect(result.checks.map((check: { code: string }) => check.code)).toContain("grok_model_not_found");
    expectPaidHelloProbeUnavailable(result);
  });

  it("reports auth failure as a warning and keeps paid hello unavailable", async () => {
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: {
        command: "grok",
        cwd: "/tmp/project",
      },
    });

    expectPaidHelloProbeUnavailable(result);
    expect(result.checks.map((check: { code: string }) => check.code)).toEqual(
      expect.arrayContaining([
        "grok_auth_required",
        "paid_transport_unqualified",
      ]),
    );
  });

  it("emits the canonical adapter_auth_missing check for a sandbox target with missing authentication", async () => {
    // The user interface reads this neutral canonical code to decide login
    // eligibility for the sandbox; it does not parse the message text.
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(result.checks.some((check: { code: string }) => check.code === "adapter_auth_missing")).toBe(
      true,
    );
    expectPaidHelloProbeUnavailable(result);
  });

  it("stages the managed account through a host temp workspace, never the remote cwd, then refuses paid hello", async () => {
    // The remote cwd is a path inside the sandbox. Handing it to the runtime
    // as `workspaceLocalDir` made the host-side ignore scan fail on a
    // directory that does not exist (git-ignore-scan-failed in production).
    let workspaceLocalDirAtCall: string | undefined;
    let workspaceExistedAtCall: boolean | undefined;
    prepareRuntimeMock.mockImplementationOnce(async (input: { workspaceLocalDir: string }) => {
      workspaceLocalDirAtCall = input.workspaceLocalDir;
      workspaceExistedAtCall = existsSync(input.workspaceLocalDir);
      return { assetDirs: { home: "/sandbox/assets/home" }, restoreWorkspace: async () => {} };
    });
    runProcessMock
      .mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, stdout: "You are logged in with grok.com.\n\nDefault model: grok-4\n\nAvailable models:\n  * grok-4", stderr: "" });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/sandbox/workspace", managedAiConnection: { provider: "xai" } },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(prepareRuntimeMock).toHaveBeenCalledOnce();
    expect(prepareRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRemoteDir: "/sandbox/workspace" }),
    );
    expect(workspaceLocalDirAtCall).not.toBe("/sandbox/workspace");
    expect(workspaceExistedAtCall).toBe(true);
    // The staged home dir the runtime uploaded is what the probe must use.
    expect(runProcessMock.mock.calls[0]?.[4]).toMatchObject({ env: expect.objectContaining({ GROK_HOME: "/sandbox/assets/home" }) });
    expectPaidHelloProbeUnavailable(result);
  });

  it("reports a failed runtime preparation as a check instead of crashing", async () => {
    prepareRuntimeMock.mockRejectedValueOnce(
      new Error("Workspace ignore scan failed: git-ignore-scan-failed"),
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/sandbox/workspace", managedAiConnection: { provider: "xai" } },
      executionTarget: { kind: "remote", transport: "sandbox" } as never,
    });

    expect(result.status).toBe("fail");
    const unprepared = result.checks.find((check: { code: string }) => check.code === "grok_environment_unprepared");
    expect(unprepared).toMatchObject({ level: "error" });
    // A failed staging means there is no environment worth probing.
    expect(runProcessMock).not.toHaveBeenCalled();
  });

  it("emits no adapter_auth_missing check for a local target with missing authentication", async () => {
    // The canonical check gates sandbox login eligibility only. A local target
    // has no sandbox login to offer, so the check must not appear.
    runProcessMock
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Not logged in. Run `grok login`.",
      });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "grok_local",
      config: { command: "grok", cwd: "/tmp/project" },
    });

    expect(result.checks.some((check: { code: string }) => check.code === "adapter_auth_missing")).toBe(
      false,
    );
    expectPaidHelloProbeUnavailable(result);
  });
});
