import { createRequire } from "node:module";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// Resolve the parser Express actually loads, not an unrelated workspace copy.
const require = createRequire(import.meta.url);
const qs = createRequire(require.resolve("express"))("qs");

describe("HTTP parser dependency security regressions", () => {
  it("enforces array limits for bracketed comma-separated query values", () => {
    expect(() => qs.parse("a[]=1,2,3,4", {
      comma: true, arrayLimit: 3, throwOnLimitExceeded: true,
    })).toThrow(RangeError);
    expect(qs.parse("a[]=1,2,3", {
      comma: true, arrayLimit: 3, throwOnLimitExceeded: true,
    })).toEqual({ a: [["1", "2", "3"]] });
  });

  it("serializes null entries without crashing", () => {
    expect(() => qs.stringify({ a: [null, undefined, "value"] }, {
      arrayFormat: "comma", encodeValuesOnly: true,
    })).not.toThrow();
  });

  it("rejects invalid body limits instead of silently removing the limit", () => {
    expect(() => express.json({ limit: "not-a-size" })).toThrow();
    expect(() => express.urlencoded({ limit: "not-a-size", extended: true })).toThrow();
  });

  it("keeps valid JSON intact and rejects an oversized body before the handler", async () => {
    const app = express();
    const handler = vi.fn((req: express.Request, res: express.Response) => res.json(req.body));
    app.use(express.json({ limit: "1kb" }));
    app.post("/", handler);
    const valid = await request(app).post("/").send({ value: "ok" });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ value: "ok" });
    const oversized = await request(app).post("/").send({ value: "x".repeat(1024) });
    expect(oversized.status).toBe(413);
    expect(handler).toHaveBeenCalledOnce();
  });
});
