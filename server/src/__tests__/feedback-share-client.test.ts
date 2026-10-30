import { gunzipSync } from "node:zlib";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedbackTraceShareClientFromConfig } from "../services/feedback-share-client.js";
import { loadConfig } from "../config.js";

describe("feedback trace share client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ objectKey: "feedback-traces/test.json" }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([undefined, "https://feedback.example.test"])(
    "does not authorize private feedback with telemetry settings (feedback destination: %s)", async destination => {
      vi.stubEnv("PAPERCLIP_CONFIG", `/tmp/blentera-feedback-missing-config-${process.pid}.json`);
      vi.stubEnv("AW_DEPLOYMENT_PROFILE", "local");
      vi.stubEnv("AW_PLATFORM_ENV", undefined);
      vi.stubEnv("PAPERCLIP_MANAGED_CONFIG", undefined);
      vi.stubEnv("PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN", undefined);
      vi.stubEnv("PAPERCLIP_TAILNET_BIND_HOST", "127.0.0.1");
      vi.stubEnv("PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL", destination);
      vi.stubEnv("PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN", undefined);
      vi.stubEnv("PAPERCLIP_TELEMETRY_BACKEND_URL", "https://telemetry.example.test");
      vi.stubEnv("PAPERCLIP_TELEMETRY_BACKEND_TOKEN", "synthetic-telemetry-only-token");
      const config = loadConfig();
      expect(config.feedbackExportBackendUrl).toBe(destination);
      expect(config.feedbackExportBackendToken).toBeUndefined();
      const client = createFeedbackTraceShareClientFromConfig(config);
      const result = client.uploadTraceBundle({
        traceId: "trace-1", exportId: "export-1", companyId: "company-1",
        issueId: "issue-1", issueIdentifier: "PAP-1", adapterType: "codex_local",
        captureStatus: "full", notes: [], envelope: {}, surface: null, paperclipRun: null,
        rawAdapterTrace: null, normalizedAdapterTrace: null, privacy: null, integrity: {}, files: [],
      });
      if (!destination) {
        await expect(result).rejects.toThrow("Feedback export is not configured");
        expect(fetch).not.toHaveBeenCalled();
      } else {
        await result;
        expect(fetch).toHaveBeenCalledWith(`${destination}/feedback-traces`, expect.objectContaining({
          headers: { "content-type": "application/json" },
        }));
      }
    },
  );

  it.each(["ftp://feedback.example.test", "https://user:synthetic-secret@feedback.example.test", "https://feedback.example.test?token=synthetic-secret", "https://feedback.example.test#synthetic-secret"])(
    "rejects an unsafe destination without sending or echoing its credentials: %s", destination => {
      expect(() => createFeedbackTraceShareClientFromConfig({
        feedbackExportBackendUrl: destination, feedbackExportBackendToken: undefined,
      })).toThrow(/^Invalid feedback export destination$/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([400, 500])("keeps a processor's private error body out of HTTP %s diagnostics", async status => {
    const response = new Response("synthetic-private-trace-and-credential-canary", { status });
    const text = vi.spyOn(response, "text");
    vi.mocked(fetch).mockResolvedValueOnce(response);
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: "https://feedback.example.test", feedbackExportBackendToken: undefined,
    });
    await expect(client.uploadTraceBundle({
      traceId: "trace-1", exportId: "export-1", companyId: "company-1",
      issueId: "issue-1", issueIdentifier: "PAP-1", adapterType: "codex_local",
      captureStatus: "full", notes: [], envelope: {}, surface: null, paperclipRun: null,
      rawAdapterTrace: null, normalizedAdapterTrace: null, privacy: null, integrity: {}, files: [],
    })).rejects.toThrow(new RegExp(`^Feedback trace upload failed with HTTP ${status}$`));
    expect(text).not.toHaveBeenCalled();
  });

  it("does not export to an unconfigured processor", async () => {
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: undefined,
      feedbackExportBackendToken: undefined,
    });

    await expect(client.uploadTraceBundle({
      traceId: "trace-1",
      exportId: "export-1",
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      adapterType: "codex_local",
      captureStatus: "full",
      notes: [],
      envelope: {},
      surface: null,
      paperclipRun: null,
      rawAdapterTrace: null,
      normalizedAdapterTrace: null,
      privacy: null,
      integrity: {},
      files: [],
    })).rejects.toThrow("Feedback export is not configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("wraps the feedback trace payload as gzip+base64 json before upload", async () => {
    const client = createFeedbackTraceShareClientFromConfig({
      feedbackExportBackendUrl: "https://feedback.example.test",
      feedbackExportBackendToken: "test-token",
    });

    await client.uploadTraceBundle({
      traceId: "trace-1",
      exportId: "export-1",
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      adapterType: "codex_local",
      captureStatus: "full",
      notes: [],
      envelope: { hello: "world" },
      surface: null,
      paperclipRun: null,
      rawAdapterTrace: null,
      normalizedAdapterTrace: null,
      privacy: null,
      integrity: {},
      files: [],
    });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe("https://feedback.example.test/feedback-traces");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
    });

    const body = JSON.parse(String(call?.[1]?.body ?? "{}")) as {
      encoding?: string;
      payload?: string;
    };
    expect(body.encoding).toBe("gzip+base64+json");
    expect(typeof body.payload).toBe("string");

    const decoded = gunzipSync(Buffer.from(body.payload ?? "", "base64")).toString("utf8");
    const parsed = JSON.parse(decoded) as {
      objectKey: string;
      bundle: { envelope: { hello: string } };
    };
    expect(parsed.objectKey).toContain("feedback-traces/company-1/");
    expect(parsed.objectKey.endsWith("/export-1.json")).toBe(true);
    expect(parsed.bundle.envelope).toEqual({ hello: "world" });
  });

  it("does not follow a configured processor redirect to another receiver", async () => {
    vi.unstubAllGlobals();
    let redirectedRequests = 0;
    const receiver = createServer((req, res) => {
      redirectedRequests += 1;
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ objectKey: "unexpected-receiver" }));
    });
    const listen = async (server: Server) => {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture listener unavailable");
      return `http://127.0.0.1:${address.port}`;
    };
    const receiverUrl = await listen(receiver);
    const processor = createServer((req, res) => {
      req.resume();
      res.writeHead(307, { location: receiverUrl });
      res.end();
    });
    try {
      const processorUrl = await listen(processor);
      const client = createFeedbackTraceShareClientFromConfig({
        feedbackExportBackendUrl: processorUrl,
        feedbackExportBackendToken: "synthetic-test-token",
      });
      await expect(client.uploadTraceBundle({
        traceId: "trace-1", exportId: "export-1", companyId: "company-1",
        issueId: "issue-1", issueIdentifier: "PAP-1", adapterType: "codex_local",
        captureStatus: "full", notes: [], envelope: { text: "synthetic-private-content" },
        surface: null, paperclipRun: null, rawAdapterTrace: null,
        normalizedAdapterTrace: null, privacy: null, integrity: {}, files: [],
      })).rejects.toThrow();
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all([processor, receiver].map(server => new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()))));
    }
  });
});
