import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { publicOriginGuard, publicOriginRejection, setupPublicOriginUpgradeGuard } from "../middleware/public-origin-guard.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";

const ORIGIN = "https://ai.augustworks.dk";
const NEW_ORIGIN = "https://app.augustworks.ai";
const trustLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function app(origins = [ORIGIN]) {
  const app = express();
  app.set("trust proxy", "loopback");
  app.locals.publicAppOrigins = origins;
  app.use(publicOriginGuard(origins));
  app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: "user-1", companyIds: ["company-1"] }; next(); });
  app.use(boardMutationGuard());
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/mutate", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("SaaS origin ingress", () => {
  it("accepts same-origin proxied API calls and rejects attacker origin even with valid Referer", async () => {
    const target = app();
    const post = (origin: string) => request(target).post("/api/mutate").set("Host", "ai.augustworks.dk")
      .set("X-Forwarded-Proto", "https").set("Cookie", "session=opaque").set("Origin", origin).set("Referer", `${ORIGIN}/dashboard`);
    expect((await post(ORIGIN)).status).toBe(200);
    expect((await post("https://attacker.example")).status).toBe(403);
    expect((await post("null")).status).toBe(403);
    expect((await post("http://ai.augustworks.dk")).status).toBe(403);
  });

  it("does not let trusted proxy fields introduce an unconfigured host or protocol", async () => {
    expect((await request(app()).get("/api/health").set("Host", "attacker.example").set("X-Forwarded-Proto", "https")).status).toBe(403);
    expect((await request(app()).get("/api/health").set("Host", "ai.augustworks.dk").set("X-Forwarded-Proto", "http")).status).toBe(403);
    expect((await request(app()).get("/api/health").set("Host", "127.0.0.1").set("X-Forwarded-Host", "attacker.example").set("X-Forwarded-Proto", "https")).status).toBe(403);
    expect((await request(app()).get("/api/health").set("Host", "127.0.0.1").set("X-Forwarded-Host", "ai.augustworks.dk").set("X-Forwarded-Proto", "https")).status).toBe(200);
  });

  it("ignores forged forwarding authority from an untrusted immediate peer", () => {
    const req = { headers: { host: "attacker.example", "x-forwarded-host": "ai.augustworks.dk", "x-forwarded-proto": "https" }, socket: { remoteAddress: "203.0.113.9", encrypted: true }, method: "GET" };
    expect(publicOriginRejection(req as never, [ORIGIN], trustLoopback)).not.toBeNull();
    req.headers.host = "ai.augustworks.dk";
    req.headers["x-forwarded-host"] = "attacker.example";
    expect(publicOriginRejection(req as never, [ORIGIN], trustLoopback)).toBeNull();
  });

  it("requires same-origin evidence for browser mutations without an Origin", async () => {
    const post = () => request(app()).post("/api/mutate").set("Host", "ai.augustworks.dk").set("X-Forwarded-Proto", "https").set("Cookie", "session=opaque");
    expect((await post()).status).toBe(403);
    expect((await post().set("Referer", `${ORIGIN}/settings`)).status).toBe(200);
    expect((await post().set("Referer", "https://attacker.example/settings")).status).toBe(403);
  });

  it("dual-serves old/new origins without allowing cross-origin session mutations", async () => {
    const target = app([ORIGIN, NEW_ORIGIN]);
    const post = (host: string, origin: string) => request(target).post("/api/mutate").set("Host", host).set("X-Forwarded-Proto", "https").set("Cookie", "session=opaque").set("Origin", origin);
    expect((await post("app.augustworks.ai", NEW_ORIGIN)).status).toBe(200);
    expect((await post("ai.augustworks.dk", ORIGIN)).status).toBe(200);
    expect((await post("app.augustworks.ai", ORIGIN)).status).toBe(403);
  });

  it("guards real WebSocket upgrades before session lookup and retains company authorization", async () => {
    const target = app();
    const server = createServer(target);
    let sessionLookups = 0;
    setupPublicOriginUpgradeGuard(server, [ORIGIN], trustLoopback);
    const db = { select: (fields: Record<string, unknown>) => ({ from: () => ({ where: () =>
      Promise.resolve("id" in fields ? [{ id: "instance-admin" }] : [{ companyId: "company-1" }]),
    }) }) };
    const wss = setupLiveEventsWebSocketServer(server, db as never, {
      deploymentMode: "authenticated",
      deploymentProfile: "saas",
      resolveSessionFromHeaders: async () => { sessionLookups++; return { session: { id: "s1", userId: "user-1" }, user: { id: "user-1" } }; },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    cleanup.push(async () => { wss.clients.forEach((client) => client.terminate()); wss.emit("close"); await new Promise<void>((resolve) => server.close(() => resolve())); });
    const connect = (companyId: string, origin?: string) => new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/companies/${companyId}/events/ws`, { headers: {
        Host: "ai.augustworks.dk", "X-Forwarded-Proto": "https", Cookie: "session=opaque", ...(origin === undefined ? {} : { Origin: origin }),
      } });
      ws.on("open", () => { ws.close(); resolve(101); });
      ws.on("unexpected-response", (_req: unknown, res: { statusCode: number; resume: () => void }) => { res.resume(); ws.terminate(); resolve(res.statusCode); });
      ws.on("error", (error: Error) => { if (!error.message.includes("before the connection was established")) reject(error); });
    });
    expect(await connect("company-1", "https://attacker.example")).toBe(403);
    expect(await connect("company-1")).toBe(403);
    expect(sessionLookups).toBe(0);
    expect(await connect("company-1", ORIGIN)).toBe(101);
    // Instance-admin status cannot bypass SaaS company membership.
    expect(await connect("company-2", ORIGIN)).toBe(403);
  });
});
