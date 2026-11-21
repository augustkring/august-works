import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";

describe("server telemetry startup admission", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "blentera-server-telemetry-"));
    vi.stubEnv("PAPERCLIP_HOME", root);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "telemetry-fixture");
    vi.stubEnv("PAPERCLIP_CONFIG", path.join(root, "missing.json"));
    vi.stubEnv("AW_DEPLOYMENT_PROFILE", "local");
    vi.stubEnv("AW_PLATFORM_ENV", undefined);
    vi.stubEnv("PAPERCLIP_MANAGED_CONFIG", undefined);
    vi.stubEnv("PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN", undefined);
    vi.stubEnv("PAPERCLIP_TAILNET_BIND_HOST", "127.0.0.1");
    for (const key of ["CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "GITHUB_ACTIONS", "GITLAB_CI",
      "PAPERCLIP_TELEMETRY_DISABLED", "DO_NOT_TRACK", "PAPERCLIP_TELEMETRY_ENDPOINT"]) vi.stubEnv(key, undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); fs.rmSync(root, { recursive: true, force: true }); });

  it("keeps default startup closed even when only a destination is configured", async () => {
    vi.stubEnv("PAPERCLIP_TELEMETRY_ENDPOINT", "https://telemetry.example.test/ingest");
    const config = loadConfig();
    expect(config.telemetryEnabled).toBe(false);
    const { initTelemetry } = await import("../telemetry.js");
    expect(initTelemetry({ enabled: config.telemetryEnabled })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, "instances", "telemetry-fixture", "telemetry"))).toBe(false);
  });

  it("does not create a singleton, state or transport without an explicit destination", async () => {
    const { initTelemetry, getTelemetryClient } = await import("../telemetry.js");
    expect(initTelemetry({ enabled: true })).toBeNull();
    expect(getTelemetryClient()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, "instances", "telemetry-fixture", "telemetry"))).toBe(false);
  });
});
