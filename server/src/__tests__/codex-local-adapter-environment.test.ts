import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testEnvironment } from "@paperclipai/adapter-codex-local/server";

const itWindows = process.platform === "win32" ? it : it.skip;
const itPosix = process.platform === "win32" ? it.skip : it;

async function runProbeFixture(options: { failCleanup?: boolean; error?: string } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-probe-result-"));
  const capture = path.join(root, "capture.json");
  const command = path.join(root, "codex");
  await fs.writeFile(command, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.PROBE_CAPTURE, JSON.stringify({ args: process.argv.slice(2), home: process.env.CODEX_HOME }));
console.error('WARN codex_core_plugins::manager: remote installed plugin bundle sync failed error=chatgpt authentication required for remote plugin catalog');
const error = process.env.PROBE_ERROR;
if (error) { console.error(error); process.exit(1); }
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'hello'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`, { mode: 0o755 });
  if (options.failCleanup) {
    // Deterministic equivalent of rm observing a concurrent plugin writer.
    await fs.writeFile(path.join(root, "rm"), '#!/bin/sh\nif [ "$1" = "-rf" ]; then echo "rm: Directory not empty" >&2; exit 1; fi\nexec /bin/rm "$@"\n', { mode: 0o755 });
  }
  try {
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "codex_local",
      config: { engine: "cli", command, cwd: root, env: {
        OPENAI_API_KEY: "fixture-key", PROBE_CAPTURE: capture,
        PROBE_ERROR: options.error ?? "", PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
      } },
    });
    return { result, capture: await fs.readFile(capture, "utf8").then(JSON.parse).catch(() => null) };
  } finally {
    const recorded = await fs.readFile(capture, "utf8").then(JSON.parse).catch(() => null);
    if (recorded?.home) await fs.rm(recorded.home, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("codex_local environment diagnostics", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  itPosix.each([
    { failCleanup: true },
    { error: "Unable to start turn: disk is full" },
    { error: "Invalid API key" },
    {},
  ])("rejects paid inference before starting the CLI (%j)", async (options) => {
    const { result, capture } = await runProbeFixture(options);
    expect(result.status).toBe("fail");
    expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified", level: "error" }));
    expect(result.checks.some((check) => check.code.startsWith("codex_hello_probe_"))).toBe(false);
    expect(capture).toBeNull();
  });

  it("creates a missing working directory when cwd is absolute", async () => {
    const cwd = path.join(
      os.tmpdir(),
      `paperclip-codex-local-cwd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      "workspace",
    );

    await fs.rm(path.dirname(cwd), { recursive: true, force: true });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {
        engine: "cli",
        command: process.execPath,
        cwd,
      },
    });

    expect(result.checks.some((check) => check.code === "codex_cwd_valid")).toBe(true);
    expect(result.checks.filter((check) => check.level === "error").map((check) => check.code)).toEqual(["paid_transport_unqualified"]);
    const stats = await fs.stat(cwd);
    expect(stats.isDirectory()).toBe(true);
    await fs.rm(path.dirname(cwd), { recursive: true, force: true });
  });

  it("emits codex_native_auth_present when ~/.codex/auth.json exists and OPENAI_API_KEY is unset", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-codex-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const codexHome = path.join(root, ".codex");
    const cwd = path.join(root, "workspace");

    try {
      await fs.mkdir(codexHome, { recursive: true });
      await fs.writeFile(
        path.join(codexHome, "auth.json"),
        JSON.stringify({ accessToken: "fake-token", accountId: "acct-1" }),
      );

      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "codex_local",
        config: {
          engine: "cli",
          command: process.execPath,
          cwd,
          env: { CODEX_HOME: codexHome },
        },
      });

      expect(result.checks.some((check) => check.code === "codex_native_auth_present")).toBe(true);
      expect(result.checks.some((check) => check.code === "codex_openai_api_key_missing")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("emits codex_openai_api_key_missing when neither env var nor native auth exists", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-codex-noauth-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const codexHome = path.join(root, ".codex");
    const cwd = path.join(root, "workspace");

    try {
      await fs.mkdir(codexHome, { recursive: true });
      // No auth.json written

      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "codex_local",
        config: {
          engine: "cli",
          command: process.execPath,
          cwd,
          env: { CODEX_HOME: codexHome },
        },
      });

      expect(result.checks.some((check) => check.code === "codex_openai_api_key_missing")).toBe(true);
      expect(result.checks.some((check) => check.code === "codex_native_auth_present")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  itWindows("rejects paid inference after resolving a Windows .cmd wrapper", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-codex-local-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const binDir = path.join(root, "bin");
    const cwd = path.join(root, "workspace");
    const fakeCodex = path.join(binDir, "codex.cmd");
    const script = [
      "@echo off",
      "echo {\"type\":\"thread.started\",\"thread_id\":\"test-thread\"}",
      "echo {\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}",
      "echo {\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1}}",
      "exit /b 0",
      "",
    ].join("\r\n");

    try {
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(fakeCodex, script, "utf8");

      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "codex_local",
        config: {
          engine: "cli",
          command: "codex",
          cwd,
          env: {
            OPENAI_API_KEY: "test-key",
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      });

      expect(result.status).toBe("fail");
      expect(result.checks).toContainEqual(expect.objectContaining({ code: "paid_transport_unqualified" }));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
