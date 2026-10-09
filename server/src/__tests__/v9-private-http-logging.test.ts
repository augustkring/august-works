import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHttpLogger } from "../middleware/logger.js";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";
import {
  isPrivateExperienceHttpRequest,
  privateExperienceLogUrl,
} from "../middleware/http-log-policy.js";

describe("V9 private HTTP purpose", () => {
  it.each([
    [
      "POST",
      "/api/saas/companies/private-company/activation?expectedUserId=private-principal",
    ],
    ["POST", "/api/companies//customer-feedback"],
    ["POST", "/api/companies/private-company/agent-configuration-drafts/private-record/save?expectedUserId=private-principal"],
    ["PATCH", "/api/companies//agent-configuration-drafts/private-record"],
    [
      "POST",
      "/api/companies/private-company/customer-feedback?expectedUserId=private-principal",
    ],
    [
      "POST",
      "/api/internal/customer-feedback/private-company/private-record/triage",
    ],
    ["GET", "/api/internal/customer-feedback/private-company/private-record"],
    [
      "GET",
      "/api/companies/private-company/experience/commands?q=private-command",
    ],
    ["DELETE", "/API/INTERNAL/CUSTOMER-FEEDBACK/private-record"],
  ])("keeps rejected %s %s requests content-free", async (method, url) => {
    const chunks: string[] = [],
      canary = "private-free-text-and-note-canary";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const app = express();
    app.use(
      createHttpLogger(pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream)),
    );
    app.use(express.json());
    app.use((req, res) => {
      (res as unknown as { err: Error }).err = new Error(canary);
      (res as unknown as { __errorContext: unknown }).__errorContext = {
        error: { message: canary },
        reqBody: req.body,
        reqParams: { note: canary },
      };
      res.setHeader("x-private-prose", canary);
      res.status(405).end();
    });
    const call =
      method === "POST"
        ? request(app).post(url)
        : method === "PATCH" ? request(app).patch(url)
        : method === "DELETE"
          ? request(app).delete(url)
          : request(app).get(url);
    await call.send({ body: canary, internalNote: canary }).expect(405);
    const output = chunks.join("");
    expect(output).not.toContain(canary);
    expect(output).not.toContain("private-principal");
    expect(output).not.toContain("private-record");
    expect(output).not.toContain("private-command");
    const log = JSON.parse(output.trim());
    expect(log.req).toEqual({
      id: expect.any(Number),
      method,
      url: privateExperienceLogUrl(url),
    });
    expect(log.reqBody).toBe("[REDACTED]");
    expect(log.res).toEqual({ statusCode: 405 });
    expect(log.err.message).toBe("Private experience request failed");
  });
  it("does not classify adjacent namespaces as private feedback", () => {
    for (const path of [
      "/api/customer-feedback/policy",
      "/api/companies/id/customer-feedback-extra",
      "/api/internal/customer-feedback-extra",
      "/api/companies/id/experience/profile",
    ])
      expect(isPrivateExperienceHttpRequest("GET", path)).toBe(false);
  });
});
