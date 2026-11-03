import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";

const {
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
  prepareAdapterExecutionTargetRuntime,
  prepareManagedCodexHome,
  restoreWorkspace,
  capturedHomeAssetFiles,
  capturedHomeAssetAuthJson,
} = vi.hoisted(() => {
  const restoreWorkspace = vi.fn(async () => {});
  // Records the files staged in the uploaded "home" asset at call time, before
  // the probe's cleanup deletes the temp dir. Lets tests assert the upload is a
  // minimal credentials-only home and not the full managed CODEX_HOME.
  const capturedHomeAssetFiles: { value: string[] | null } = { value: null };
  // Records the staged auth.json content, so tests can assert WHICH home's
  // credential the probe uploaded (the effective home a run would use).
  const capturedHomeAssetAuthJson: { value: string | null } = { value: null };
  return {
    capturedHomeAssetFiles,
    capturedHomeAssetAuthJson,
    ensureAdapterExecutionTargetDirectory: vi.fn(async () => {}),
    ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => {}),
    maybeRunSandboxInstallCommand: vi.fn(async () => null),
    runAdapterExecutionTargetProcess: vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}",
        "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}",
        "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1}}",
      ].join("\n"),
      stderr: "",
      pid: 123,
      startedAt: new Date().toISOString(),
    })),
    describeAdapterExecutionTarget: vi.fn(() => "QA SSH"),
    resolveAdapterExecutionTargetCwd: vi.fn((target, configuredCwd, fallbackCwd) => {
      if (typeof configuredCwd === "string" && configuredCwd.trim().length > 0) return configuredCwd;
      if (target && typeof target === "object" && "remoteCwd" in target && typeof target.remoteCwd === "string") {
        return target.remoteCwd;
      }
      return fallbackCwd;
    }),
    prepareAdapterExecutionTargetRuntime: vi.fn(async (input: { assets?: Array<{ key: string; localDir: string }> }) => {
      const homeAsset = input?.assets?.find((asset) => asset.key === "home");
      if (homeAsset) {
        capturedHomeAssetFiles.value = (await fs.readdir(homeAsset.localDir)).sort();
        capturedHomeAssetAuthJson.value = await fs
          .readFile(`${homeAsset.localDir}/auth.json`, "utf8")
          .catch(() => null);
      }
      return {
        target: null,
        workspaceRemoteDir: "/remote/workspace/.paperclip-runtime/runs/test/workspace",
        runtimeRootDir: "/remote/workspace/.paperclip-runtime/runs/test/workspace/.paperclip-runtime/codex",
        assetDirs: {
          home: "/remote/workspace/.paperclip-runtime/runs/test/workspace/.paperclip-runtime/codex/home",
        },
        restoreWorkspace,
      };
    }),
    prepareManagedCodexHome: vi.fn(async () => {
      // Return a real managed home seeded with credentials so the probe's
      // minimal-home copy step (auth.json/config.toml) has something to read.
      const dir = await fs.mkdtemp(`${os.tmpdir()}/paperclip-managed-codex-home-`);
      await fs.writeFile(`${dir}/auth.json`, JSON.stringify({ OPENAI_API_KEY: "sk-managed" }));
      await fs.writeFile(`${dir}/config.toml`, "model = \"gpt-5\"\n");
      return dir;
    }),
    restoreWorkspace,
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
    prepareAdapterExecutionTargetRuntime,
  };
});

vi.mock("./codex-home.js", async () => {
  const actual = await vi.importActual<typeof import("./codex-home.js")>("./codex-home.js");
  return {
    ...actual,
    prepareManagedCodexHome,
  };
});

import { testEnvironment } from "./test.js";

function expectUnavailableBeforePaidEffects(result: Awaited<ReturnType<typeof testEnvironment>>) {
  expect(result.status).toBe("fail");
  for (const code of ["codex_cwd_valid", "codex_command_resolvable", "paid_transport_unqualified"])
    expect(result.checks.some(check => check.code === code)).toBe(true);
  for (const code of ["adapter_auth_missing", "codex_hello_probe_auth_required", "codex_hello_probe_passed",
    "codex_hello_probe_error", "codex_hello_probe_unexpected_output"])
    expect(result.checks.some(check => check.code === code)).toBe(false);
  expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  expect(prepareManagedCodexHome).not.toHaveBeenCalled();
  expect(prepareAdapterExecutionTargetRuntime).not.toHaveBeenCalled();
  expect(restoreWorkspace).not.toHaveBeenCalled();
  expect(capturedHomeAssetFiles.value).toBeNull();
  expect(capturedHomeAssetAuthJson.value).toBeNull();
}

describe("codex remote environment diagnostics", () => {
  const scratchDirs: string[] = [];

  async function makeScratchDir(prefix: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    scratchDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    // Isolate credential-bearing configuration even if a future regression
    // enters home preparation. These diagnostics must refuse the paid phase
    // before reading/staging credentials or spawning a hello process.
    vi.stubEnv("CODEX_HOME", await makeScratchDir("paperclip-test-shared-codex-"));
    vi.stubEnv("PAPERCLIP_HOME", await makeScratchDir("paperclip-test-instance-"));
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    delete process.env.OPENAI_API_KEY;
    capturedHomeAssetFiles.value = null;
    capturedHomeAssetAuthJson.value = null;
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("keeps SSH setup diagnostics and refuses paid hello before managed home staging", async () => {
    const remoteTarget: AdapterExecutionTarget = {
      kind: "remote",
      transport: "ssh",
      remoteCwd: "/remote/workspace",
      spec: {
        host: "127.0.0.1",
        port: 22,
        username: "agent",
        privateKey: "PRIVATE KEY",
        knownHosts: "KNOWN HOSTS",
        remoteCwd: "/remote/workspace",
        remoteWorkspacePath: "/remote/workspace",
        strictHostKeyChecking: false,
      },
    };

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        engine: "cli",
        command: "codex",
      },
      executionTarget: remoteTarget,
      environmentName: "QA SSH",
    });

    expectUnavailableBeforePaidEffects(result);
  });

  it("keeps configured API-key metadata but refuses paid sandbox hello before probe home creation", async () => {
    const remoteTarget: AdapterExecutionTarget = {
      kind: "remote",
      transport: "sandbox",
      providerKey: "cloudflare",
      remoteCwd: "/remote/workspace",
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

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        engine: "cli",
        command: "codex",
        env: {
          OPENAI_API_KEY: "sk-test",
        },
      },
      executionTarget: remoteTarget,
      environmentName: "QA Cloudflare",
    });


    expectUnavailableBeforePaidEffects(result);
    expect(result.checks.some(check => check.code === "codex_openai_api_key_present")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sk-test");

  });

  it("does not infer adapter_auth_missing from an unexecuted sandbox hello", async () => {
    // Even a configured upstream auth failure cannot stand in for an actual
    // hello result: the paid phase is refused before any process runs.
    prepareManagedCodexHome.mockImplementationOnce(async () => {
      const dir = await fs.mkdtemp(`${os.tmpdir()}/paperclip-managed-codex-home-noauth-`);
      await fs.writeFile(`${dir}/config.toml`, "model = \"gpt-5\"\n");
      return dir;
    });
    runAdapterExecutionTargetProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Not logged in. Please run `codex login` to authenticate.",
      pid: 321,
      startedAt: new Date().toISOString(),
    });

    const remoteTarget: AdapterExecutionTarget = {
      kind: "remote",
      transport: "sandbox",
      providerKey: "daytona",
      remoteCwd: "/remote/workspace",
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

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: { engine: "cli", command: "codex" },
      executionTarget: remoteTarget,
      environmentName: "QA Daytona",
    });

    // The paid probe never runs, so its configured authentication failure
    // cannot produce a login warning or override the admission refusal.
    expectUnavailableBeforePaidEffects(result);
  });

  it("refuses paid sandbox hello without creating or overriding an unseeded home", async () => {
    // An image-local login cannot authorize the unavailable paid phase.
    // No empty home may be uploaded and no CODEX_HOME override is produced.
    prepareManagedCodexHome.mockImplementationOnce(async () => {
      const dir = await fs.mkdtemp(`${os.tmpdir()}/paperclip-managed-codex-home-noauth-`);
      // No auth.json — only a config file.
      await fs.writeFile(`${dir}/config.toml`, "model = \"gpt-5\"\n");
      return dir;
    });

    const remoteTarget: AdapterExecutionTarget = {
      kind: "remote",
      transport: "sandbox",
      providerKey: "daytona",
      remoteCwd: "/remote/workspace",
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

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: { engine: "cli", command: "codex" },
      executionTarget: remoteTarget,
      environmentName: "QA Daytona",
    });

    expectUnavailableBeforePaidEffects(result);
  });

  const subscriptionAuth = (accountId: string, marker: string, lastRefresh: string) =>
    JSON.stringify({
      tokens: {
        id_token: `synthetic-id-token-${marker}`,
        access_token: `synthetic-access-token-${marker}`,
        refresh_token: `synthetic-refresh-token-${marker}`,
        account_id: accountId,
      },
      last_refresh: lastRefresh,
    });

  function sandboxTarget(): AdapterExecutionTarget {
    return {
      kind: "remote",
      transport: "sandbox",
      providerKey: "daytona",
      remoteCwd: "/remote/workspace",
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
  }

  it("does not stage or mutate a configured managed per-agent home for an unqualified hello", async () => {
    // A configured managed home supplies no permission for a paid hello.
    // Its original regular-file credential must remain unchanged.
    const perAgentHome = path.join(
      process.env.PAPERCLIP_HOME!,
      "instances",
      "default",
      "companies",
      "company-1",
      "agents",
      "agent-x",
      "codex-home",
    );
    const promoted = subscriptionAuth("acct-agent", "promoted", "2026-07-09T02:00:00Z");
    await fs.mkdir(perAgentHome, { recursive: true });
    await fs.writeFile(path.join(perAgentHome, "auth.json"), promoted, "utf8");
    await fs.writeFile(path.join(perAgentHome, "config.toml"), 'model = "gpt-5"\n', "utf8");

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        engine: "cli",
        command: "codex",
        env: { CODEX_HOME: perAgentHome },
      },
      executionTarget: sandboxTarget(),
      environmentName: "QA Daytona",
    });

    expectUnavailableBeforePaidEffects(result);
    // The unavailable probe must not seed or stage the selected home.
    expect(prepareManagedCodexHome).not.toHaveBeenCalled();
    // The original credential remains a regular file with the same bytes.
    const stat = await fs.lstat(path.join(perAgentHome, "auth.json"));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(perAgentHome, "auth.json"), "utf8")).toBe(promoted);
  });

  it("does not stage or mutate external-home credentials for an unqualified hello", async () => {
    const externalHome = await makeScratchDir("paperclip-test-external-codex-");
    const external = subscriptionAuth("acct-ext", "external", "2026-07-09T01:00:00Z");
    await fs.writeFile(path.join(externalHome, "auth.json"), external, "utf8");
    // Plant a same-identity, strictly-fresher credential in the shared source
    // home: if the probe wrongly ran the managed seeding pass on the external
    // home, the heal would swap its auth.json for a symlink to this file. The
    // regular-file assertion below is therefore proof no seeding happened.
    await fs.writeFile(
      path.join(process.env.CODEX_HOME!, "auth.json"),
      subscriptionAuth("acct-ext", "shared", "2026-07-09T02:00:00Z"),
      "utf8",
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        engine: "cli",
        command: "codex",
        env: { CODEX_HOME: externalHome },
      },
      executionTarget: sandboxTarget(),
      environmentName: "QA Daytona",
    });

    expectUnavailableBeforePaidEffects(result);
    expect(prepareManagedCodexHome).not.toHaveBeenCalled();
    // Neither the external credential nor the fresher shared one is staged;
    // the external override remains unchanged and independently managed.
    const stat = await fs.lstat(path.join(externalHome, "auth.json"));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(externalHome, "auth.json"), "utf8")).toBe(external);
  });
});
