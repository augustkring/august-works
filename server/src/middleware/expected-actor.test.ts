import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { expectedActorGuard } from "./expected-actor.js";
import { boardMutationGuard } from "./board-mutation-guard.js";

function fixture(actor: Express.Request["actor"]) {
  const app = express();
  const effect = vi.fn();
  app.use((req, _res, next) => { req.actor = actor; next(); });
  app.use(expectedActorGuard());
  app.use(boardMutationGuard());
  app.all("/resource", (_req, res) => { effect(); res.status(204).end(); });
  return { app, effect };
}

describe("expected board actor binding", () => {
  it("removes the transport binding before strict domain query validation without changing originalUrl", async () => {
    const app = express();
    app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: "a" }; next(); });
    app.use("/api", expectedActorGuard());
    app.get("/api/records", (req, res) => res.json({ query: req.query, originalUrl: req.originalUrl }));
    const originalUrl = "/api/records?reviewState=accepted&limit=100&expectedActorId=user%3Aa";
    const result = await request(app).get(originalUrl);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ query: { reviewState: "accepted", limit: "100" }, originalUrl });
  });
  it.each(["get", "post", "put", "patch", "delete"] as const)("rejects an old account's %s before any domain effect", async method => {
    const { app, effect } = fixture({ type: "board", source: "session", userId: "new" });
    const response = await request(app)[method]("/resource?expectedActorId=user%3Aold");
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACCOUNT_CHANGED");
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(["session", "cloud_tenant"] as const)("allows the resolved %s user while preserving origin checks", async source => {
    const { app, effect } = fixture({ type: "board", source, userId: "current" });
    expect((await request(app).post("/resource?expectedActorId=user%3Acurrent").set("Origin", "http://localhost:3100")).status).toBe(204);
    expect(effect).toHaveBeenCalledOnce();
  });
  it("does not elevate a matching session binding past CSRF", async () => {
    const { app, effect } = fixture({ type: "board", source: "session", userId: "current" });
    expect((await request(app).post("/resource?expectedActorId=user%3Acurrent")).status).toBe(403);
    expect(effect).not.toHaveBeenCalled();
  });
  it("accepts local board only with actual local implicit authority", async () => {
    const local = fixture({ type: "board", source: "local_implicit" });
    expect((await request(local.app).post("/resource?expectedActorId=local-board")).status).toBe(204);
    for (const actor of [{ type: "none" }, { type: "board", source: "session", userId: "local-board" }, { type: "agent", onBehalfOfUserId: "local-board" }] as Express.Request["actor"][]) {
      const { app, effect } = fixture(actor);
      expect((await request(app).get("/resource?expectedActorId=local-board")).status).toBe(409);
      expect(effect).not.toHaveBeenCalled();
    }
  });
  it("does not let an agent impersonate its responsible user", async () => {
    const { app, effect } = fixture({ type: "agent", agentId: "agent", onBehalfOfUserId: "current" });
    expect((await request(app).get("/resource?expectedActorId=user%3Acurrent")).status).toBe(409);
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(["expectedActorId=", "expectedActorId=user%3Aa&expectedActorId=user%3Aa", `expectedActorId=${"a".repeat(513)}`])("rejects malformed binding %s", async query => {
    const { app, effect } = fixture({ type: "board", source: "session", userId: "a" });
    expect((await request(app).get(`/resource?${query}`)).status).toBe(400);
    expect(effect).not.toHaveBeenCalled();
  });
  it.each([{ type: "agent", agentId: "agent" }, { type: "board", source: "local_implicit" }, { type: "board", source: "board_key" }] as Express.Request["actor"][])("keeps unbound native callers compatible: $source $type", async actor => {
    const { app, effect } = fixture(actor);
    expect((await request(app).post("/resource")).status).toBe(204);
    expect(effect).toHaveBeenCalledOnce();
  });
});
