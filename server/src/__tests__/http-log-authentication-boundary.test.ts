import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";
import { createHttpLogger } from "../middleware/logger.js";
import { redactSensitive } from "../middleware/redact-sensitive.js";

describe("HTTP authentication metadata boundary", () => {
  it.each([200, 302, 403, 500])("keeps credential sentinels out of HTTP %s logs", async status => {
    const headers = {
      "x-paperclip-cloud-tenant-token": "tenant-credential-canary",
      "x-paperclip-cloud-session-id": "session-credential-canary",
      "x-paperclip-cloud-runtime-identity": "runtime-assertion-canary",
      "x-paperclip-cloud-control": "control-assertion-canary",
      "x-paperclip-cloud-inspection": "inspection-assertion-canary",
      "x-paperclip-tool-gateway-token": "tool-gateway-credential-canary",
      "x-paperclip-workspace-readiness-token": "readiness-credential-canary",
      "x-paperclip-dev-server-status-token": "dev-status-credential-canary",
      "x-openclaw-token": "openclaw-credential-canary",
      "x-openclaw-auth": "legacy-openclaw-credential-canary",
      "x-aw-relay-token": "runtime-relay-credential-canary",
    };
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) { chunks.push(chunk.toString()); done(); },
    });
    const app = express();
    app.use(createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)));
    const location = "https://client.example/callback?ticket=redirect-credential-canary#private-fragment-canary";
    app.get("/api/companies", (_req, res) => {
      res.setHeader("location", location);
      res.status(status).end();
    });
    const response = await request(app).get("/api/companies").set(headers);
    expect(response.status).toBe(status);
    expect(response.headers.location).toBe(location);
    const output = chunks.join("");
    const log = JSON.parse(output.trim());
    for (const [name, sentinel] of Object.entries(headers)) {
      expect(output).not.toContain(sentinel);
      expect(log.req.headers[name]).toBe("[Redacted]");
    }
    // Error/support serializers use the same recursive owner for nested metadata.
    expect(redactSensitive({ cause: [{ headers }] })).toEqual({
      cause: [{ headers: Object.fromEntries(Object.keys(headers).map(name => [name, "[REDACTED]"])) }],
    });
    expect(output).not.toContain("redirect-credential-canary");
    expect(output).not.toContain("private-fragment-canary");
    expect(log.res.headers.location).toBe("[Redacted]");
    expect(log.req.method).toBe("GET");
    expect(log.req.url).toBe("/api/companies");
    expect(log.res.statusCode).toBe(status);
    expect(log.level).toBe(status === 500 ? 50 : status === 403 ? 40 : 30);
  });
});
