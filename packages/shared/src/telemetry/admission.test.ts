import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telemetryConfigSchema } from "../config-schema.js";
import { TelemetryClient } from "./client.js";
import { resolveTelemetryConfig } from "./config.js";
import { trackCompanyImported } from "./events.js";
import type { TelemetryConfig } from "./types.js";

describe("explicit telemetry admission", () => {
  beforeEach(() => {
    for (const key of ["CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "GITHUB_ACTIONS", "GITLAB_CI",
      "PAPERCLIP_TELEMETRY_DISABLED", "DO_NOT_TRACK", "PAPERCLIP_TELEMETRY_ENDPOINT"]) vi.stubEnv(key, undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("defaults parsed and resolved configuration off, including endpoint-only configuration", () => {
    expect(telemetryConfigSchema.parse(undefined).enabled).toBe(false);
    expect(resolveTelemetryConfig().enabled).toBe(false);
    expect(resolveTelemetryConfig({ enabled: true }).enabled).toBe(false);
    vi.stubEnv("PAPERCLIP_TELEMETRY_ENDPOINT", "https://telemetry.example.test/ingest");
    expect(resolveTelemetryConfig().enabled).toBe(false);
    expect(resolveTelemetryConfig({ enabled: true })).toMatchObject({ enabled: true,
      endpoint: "https://telemetry.example.test/ingest" });
  });

  it.each(["PAPERCLIP_TELEMETRY_DISABLED", "DO_NOT_TRACK", "CI", "GITHUB_ACTIONS"])(
    "keeps %s suppression authoritative after explicit opt-in", key => {
      vi.stubEnv("PAPERCLIP_TELEMETRY_ENDPOINT", "https://telemetry.example.test/ingest");
      vi.stubEnv(key, "1");
      expect(resolveTelemetryConfig({ enabled: true }).enabled).toBe(false);
    },
  );

  it.each([undefined, "", "ftp://telemetry.example.test/ingest", "https://user:private-credential@telemetry.example.test",
    "https://telemetry.example.test?token=private-credential", "https://telemetry.example.test#private-fragment"])(
    "never initializes state, private hashes, timers or fetch for an inadmissible endpoint: %s", async endpoint => {
      vi.useFakeTimers();
      vi.stubEnv("PAPERCLIP_TELEMETRY_ENDPOINT", endpoint);
      expect(resolveTelemetryConfig({ enabled: true }).enabled).toBe(false);
      const stateFactory = vi.fn(() => ({ installId: "fixture-install", salt: "fixture-salt",
        createdAt: "2026-10-22T00:00:00Z", firstSeenVersion: "fixture" }));
      const client = new TelemetryClient({ enabled: true, endpoint }, stateFactory, "fixture");
      client.startPeriodicFlush(1000);
      client.hashPrivateRef("private-reference");
      trackCompanyImported(client, { sourceType: "local_path", sourceRef: "/private/source", isPrivate: true });
      client.track("install.started", {});
      client.trackDynamic("plugin.fixture.event", { count: 1 });
      await client.flush();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(stateFactory).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      client.stop();
    },
  );

  it("keeps an explicitly disabled client closed even with a valid destination", async () => {
    const stateFactory = vi.fn(() => { throw new Error("Disabled telemetry opened installation state"); });
    const client = new TelemetryClient({ enabled: false, endpoint: "https://telemetry.example.test/ingest" }, stateFactory, "fixture");
    trackCompanyImported(client, { sourceType: "local_path", sourceRef: "/private/source", isPrivate: true });
    await client.flush();
    expect(stateFactory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an opted-in event only to the selected receiver and refuses its redirect", async () => {
    vi.unstubAllGlobals();
    const received: string[] = [];
    let redirected = 0;
    const receiver = createServer((req, res) => { redirected += 1; req.resume(); res.end(); });
    const listen = async (server: Server) => {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture listener unavailable");
      return `http://127.0.0.1:${address.port}`;
    };
    const receiverUrl = await listen(receiver);
    const processor = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        received.push(body);
        if (req.url === "/redirect") res.writeHead(307, { location: receiverUrl });
        else res.writeHead(202);
        res.end();
      });
    });
    try {
      const processorUrl = await listen(processor);
      for (const route of ["/ingest", "/redirect"]) {
        const config: TelemetryConfig = { enabled: true, endpoint: `${processorUrl}${route}`,
          backoff: { baseDelayMs: 1, maxDelayMs: 1, maxAttempts: 1, jitterRatio: 0 } };
        const client = new TelemetryClient(config, () => ({ installId: "fixture-install", salt: "fixture-salt",
          createdAt: "2026-10-22T00:00:00Z", firstSeenVersion: "fixture" }), "fixture");
        client.track("install.started", {});
        await client.flush();
        client.stop();
      }
      expect(received).toHaveLength(2);
      expect(JSON.parse(received[0]!).events).toEqual([expect.objectContaining({ name: "install.started", dimensions: {} })]);
      expect(redirected).toBe(0);
    } finally {
      await Promise.all([processor, receiver].map(server => new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()))));
    }
  });
});
