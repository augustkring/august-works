import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ensureDirectoryMock = vi.hoisted(() => vi.fn(async () => {}));
const ensureCommandMock = vi.hoisted(() => vi.fn(async () => {}));
const maybeInstallMock = vi.hoisted(() => vi.fn(async () => null));
const runProcessMock = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/adapter-utils/execution-target", () => ({
  describeAdapterExecutionTarget: () => "local",
  ensureAdapterExecutionTargetCommandResolvable: ensureCommandMock,
  ensureAdapterExecutionTargetDirectory: ensureDirectoryMock,
  maybeRunSandboxInstallCommand: maybeInstallMock,
  resolveAdapterExecutionTargetCwd: (_target: unknown, configuredCwd: string, fallbackCwd: string) =>
    configuredCwd || fallbackCwd,
  runAdapterExecutionTargetProcess: runProcessMock,
}));

import { testEnvironment } from "./test.js";

let unexpectedCommandEntries = 0;
function expectPaidHelloUnavailable(result: Awaited<ReturnType<typeof testEnvironment>>) {
  expect(result.status).toBe("fail");
  expect(result.checks.filter(check => check.level === "error").map(check => check.code))
    .toEqual(["paid_transport_unqualified"]);
  expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
  expect(result.checks.some(check => check.code.startsWith("kimi_hello_probe_"))).toBe(false);
  expect(result.checks.map(check => check.code)).toEqual(expect.arrayContaining([
    "kimi_cwd_valid", "kimi_command_resolvable", "kimi_version_detected",
  ]));
  expect(unexpectedCommandEntries).toBe(0);
  expect(runProcessMock).toHaveBeenCalledTimes(1);
  expect(runProcessMock).toHaveBeenCalledWith(expect.any(String), null, "kimi", ["--version"], expect.any(Object));
}

describe("kimi_local testEnvironment", () => {
  beforeEach(() => {
    ensureDirectoryMock.mockClear();
    ensureCommandMock.mockClear();
    maybeInstallMock.mockClear();
    unexpectedCommandEntries = 0;
    runProcessMock.mockReset().mockImplementation(async (_runId, _target, _command, args) => {
      if (JSON.stringify(args) !== JSON.stringify(["--version"])) {
        unexpectedCommandEntries++;
        throw new Error("unexpected paid or non-version command entry");
      }
      return { exitCode: 0, signal: null, timedOut: false, stdout: "kimi 0.27.0\n", stderr: "" };
    });
    // Keep auth detection deterministic on hosts that really have kimi set up.
    vi.stubEnv("KIMI_MODEL_NAME", "");
    vi.stubEnv("KIMI_MODEL_API_KEY", "");
    vi.stubEnv("KIMI_CODE_HOME", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps command, version and auth metadata while refusing an unqualified paid hello", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "kimi_local",
      config: {
        engine: "cli",
        command: "kimi",
        cwd: "/tmp/project",
        env: {
          KIMI_MODEL_NAME: "kimi-code/kimi-for-coding",
          KIMI_MODEL_API_KEY: "test-key",
        },
      },
    });

    expectPaidHelloUnavailable(result);
    expect(result.checks.map((check: { code: string }) => check.code)).toEqual(
      expect.arrayContaining([
        "kimi_command_resolvable",
        "kimi_version_detected",
        "kimi_auth_detected",
        "paid_transport_unqualified",
      ]),
    );
    expect(runProcessMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      null,
      "kimi",
      ["--version"],
      expect.any(Object),
    );
  });

  it("keeps configured model credentials in the version check without entering a paid hello", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "kimi_local",
      config: {
        engine: "cli",
        command: "kimi",
        cwd: "/tmp/project",
        model: "kimi-code/k3",
        env: { KIMI_MODEL_NAME: "kimi-code/k3", KIMI_MODEL_API_KEY: "test-key" },
      },
    });

    expectPaidHelloUnavailable(result);
    expect(runProcessMock).toHaveBeenCalledWith(
      expect.any(String), null, "kimi", ["--version"],
      expect.objectContaining({ env: { KIMI_MODEL_NAME: "kimi-code/k3", KIMI_MODEL_API_KEY: "test-key" } }),
    );
  });

  it("keeps missing-auth metadata as a warning while refusing the unqualified paid hello", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "kimi_local",
      config: {
        engine: "cli",
        command: "kimi",
        cwd: "/tmp/project",
        env: { KIMI_CODE_HOME: "/nonexistent-kimi-home-for-test" },
      },
    });

    expectPaidHelloUnavailable(result);
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "kimi_auth_missing", level: "warn" }));
    expect(result.checks.map((check: { code: string }) => check.code)).toEqual(
      expect.arrayContaining([
        "kimi_auth_missing",
        "paid_transport_unqualified",
      ]),
    );
  });
});
