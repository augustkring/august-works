import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentApiKeys, authUsers, authSessions, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues, principalPermissionGrants, instanceUserRoles, boardApiKeys } from "@paperclipai/db";
import { authorizationService, type AuthorizationActor } from "../services/authorization.js";
import { actorMiddleware } from "../middleware/auth.js";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import { createBetterAuthHandler, createBetterAuthInstance, resolveBetterAuthSession } from "../auth/better-auth.js";
import type { Config } from "../config.js";
import { assertAuthenticated } from "../routes/authz.js";
import { errorHandler } from "../middleware/error-handler.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function pgCode(error: unknown): string | undefined {
  for (let depth = 0; error && typeof error === "object" && depth < 8; depth++, error = (error as { cause?: unknown }).cause) {
    if (typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  }
}
function sessionCookieHeader(response: request.Response): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.filter(cookie => cookie.includes("session_token"))
    .map(cookie => cookie.split(";", 1)[0]!)
    .join("; ");
}


describe("Foundation native Source authority lifetime", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("foundation-source-authority-");
    db = createDb(database.connectionString, { maxConnections: 3 }); }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  async function seed() {
    const companyId = randomUUID(), userId = randomUUID(), agentId = randomUUID(), runId = randomUUID(), keyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Foundation Source facts", issuePrefix: randomUUID() });
    await db.insert(authUsers).values({ id: userId, name: "Actual Human", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(agents).values({ id: agentId, companyId, name: "Actual Agent", role: "engineer", status: "idle", adapterType: "process" });
    await db.insert(companyMemberships).values([{ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "member" },
      { companyId, principalType: "agent", principalId: agentId, status: "active" }]);
    await db.insert(principalPermissionGrants).values([{ companyId, principalType: "user", principalId: userId, permissionKey: "foundation:read" },
      { companyId, principalType: "agent", principalId: agentId, permissionKey: "foundation:read" }]);
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: userId, status: "running", runtimeMode: "native" });
    const keyHash = randomUUID();
    await db.insert(agentApiKeys).values({ id: keyId, companyId, agentId, responsibleUserId: userId, name: "Actual credential", keyHash });
    const actor: AuthorizationActor = { type: "agent", source: "agent_key", agentId, companyId, keyId, authenticatedKeyHash: keyHash, runId, onBehalfOfUserId: userId };
    const human: AuthorizationActor = { type: "board", source: "session", userId };
    return { companyId, userId, agentId, runId, keyId, actor, human };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  const input = (s: Seed, actor = s.actor) => ({ actor, action: "foundation:read" as const,
    resource: { type: "company" as const, companyId: s.companyId }, enforceResponsibleUserIntersection: true });
  async function scoped(s: Seed, actor = s.actor) {
    return db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [], [], owner => owner.decide(input(s, actor))));
  }
  it("admits canonical same-company Foundation permission only inside the native transaction callback", async () => {
    const s = await seed();
    expect((await authorizationService(db).decide(input(s))).allowed).toBe(true);
    expect.soft((await scoped(s)).allowed).toBe(true);
    expect.soft((await scoped(s, s.human)).allowed).toBe(true);
    expect((await authorizationService(db).withReadSources(s.companyId, [], [], owner => owner.decide(input(s)))).allowed).toBe(false);
    let escaped!: Parameters<Parameters<ReturnType<typeof authorizationService>["withReadSources"]>[3]>[0];
    await db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [], [], async owner => {
      escaped = owner;
      expect((await owner.decide({ ...input(s), resource: { type: "company", companyId: randomUUID() } })).allowed).toBe(false);
      expect((await owner.decide({ ...input(s), action: "foundation:edit" })).allowed).toBe(false);
      expect((await owner.decide({ ...input(s), resource: { type: "issue", companyId: s.companyId, issueId: randomUUID() } })).allowed).toBe(false);
    }));
    await expect(escaped.decide(input(s))).rejects.toThrow("scope has ended");
  });
  it("requires both current grants, actual Human existence, and native key scope instead of actor hints", async () => {
    const s = await seed(); expect.soft((await scoped(s)).allowed).toBe(true);
    expect((await scoped(s, { ...s.actor, authenticatedKeyHash: undefined })).allowed).toBe(false);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, s.companyId), eq(principalPermissionGrants.principalType, "user")));
    expect((await scoped(s)).allowed).toBe(false);
    await db.insert(principalPermissionGrants).values({ companyId: s.companyId, principalType: "user", principalId: s.userId, permissionKey: "foundation:read" });
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, s.companyId), eq(principalPermissionGrants.principalType, "agent")));
    expect((await scoped(s)).allowed).toBe(false);
    await db.insert(principalPermissionGrants).values({ companyId: s.companyId, principalType: "agent", principalId: s.agentId, permissionKey: "foundation:read" });
    await db.update(agentApiKeys).set({ revokedAt: new Date() }).where(eq(agentApiKeys.id, s.keyId));
    expect((await scoped(s)).allowed).toBe(false);
    await db.update(agentApiKeys).set({ revokedAt: null }).where(eq(agentApiKeys.id, s.keyId));
    await db.delete(authUsers).where(eq(authUsers.id, s.userId));
    expect((await scoped(s, { ...s.actor, onBehalfOfMemberships: [{ companyId: s.companyId, status: "active", membershipRole: "admin" }] })).allowed).toBe(false);
    expect((await scoped(s, { ...s.human, isInstanceAdmin: true })).allowed).toBe(false);
  });
  it("holds every positive Agent/Human/grant/key/run fact through the outer commit", async () => {
    const s = await seed(), ready = deferred(), release = deferred();
    const outer = db.transaction(async tx => {
      const decision = await authorizationService(tx).withReadSources(s.companyId, [], [], owner => owner.decide(input(s)));
      ready.resolve(); await release.promise; return decision;
    });
    try {
      await ready.promise;
      const probes = [sql`select id from "user" where id=${s.userId} for update nowait`,
        sql`select id from agents where id=${s.agentId} for update nowait`,
        sql`select id from heartbeat_runs where id=${s.runId} for update nowait`,
        sql`select id from agent_api_keys where id=${s.keyId} for update nowait`,
        sql`select id from company_memberships where company_id=${s.companyId} and principal_type='user' for update nowait`,
        sql`select id from company_memberships where company_id=${s.companyId} and principal_type='agent' for update nowait`,
        sql`select id from principal_permission_grants where company_id=${s.companyId} and principal_type='user' for update nowait`,
        sql`select id from principal_permission_grants where company_id=${s.companyId} and principal_type='agent' for update nowait`];
      for (const query of probes) {
        let error: unknown; try { await db.transaction(tx => tx.execute(query)); } catch (caught) { error = caught; }
        expect.soft(pgCode(error)).toBe("55P03");
      }
    } finally { release.resolve(); }
    expect((await outer).allowed).toBe(true);
    await db.transaction(tx => tx.execute(sql`select id from principal_permission_grants where company_id=${s.companyId} for update nowait`));
  });
  it("reauthorizes a grant withdrawn while native Source row acquisition is pending", async () => {
    const s = await seed(), issueId = randomUUID(), held = deferred(), release = deferred();
    await db.insert(issues).values({ id: issueId, companyId: s.companyId, title: "Held source", createdByUserId: s.userId });
    expect((await authorizationService(db).decide(input(s))).allowed).toBe(true);
    let holderPid = 0;
    const holder = db.transaction(async tx => { const result = await tx.execute(sql`select pg_backend_pid() as pid`); holderPid = Number(result[0]!.pid);
      await tx.execute(sql`select id from issues where id=${issueId} for update`); held.resolve(); await release.promise; });
    await held.promise;
    const pending = db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [issueId], [], owner => owner.decide(input(s))));
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const result = await db.execute(sql`select exists(select 1 from pg_stat_activity where ${holderPid}=any(pg_blocking_pids(pid))) as blocked`);
        blocked = result[0]!.blocked === true; if (!blocked) await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
      await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, s.companyId), eq(principalPermissionGrants.principalType, "user")));
    } finally { release.resolve(); await holder; }
    expect((await pending).allowed).toBe(false);
  });
  it("keeps canonical read status semantics and rejects actual scoped, malformed, or unsupported trust facts", async () => {
    const s = await seed();
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, s.agentId));
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, s.runId));
    expect((await authorizationService(db).decide(input(s))).allowed).toBe(true);
    expect((await scoped(s)).allowed).toBe(true);
    await db.update(agentApiKeys).set({ scopeConfig: { kind: "skill_test", issueId: randomUUID() } }).where(eq(agentApiKeys.id, s.keyId));
    expect((await scoped(s)).allowed).toBe(false);
    await db.execute(sql`update agent_api_keys set scope_config='{"kind":"unknown"}'::jsonb where id=${s.keyId}`);
    expect((await scoped(s)).allowed).toBe(false);
    await db.update(agentApiKeys).set({ scopeConfig: null }).where(eq(agentApiKeys.id, s.keyId));
    expect((await scoped(s, { ...s.actor, source: "agent_jwt", keyId: undefined, keyScope: { kind: "skill_test", issueId: randomUUID() } })).allowed).toBe(false);
    await db.update(agents).set({ permissions: { trustPreset: "unsupported_native_test_preset" } }).where(eq(agents.id, s.agentId));
    expect((await scoped(s)).allowed).toBe(false);
  });
  it("uses actual deployment profile and pinned native instance roles rather than admin DTO claims", async () => {
    const s = await seed(); vi.stubEnv("AW_DEPLOYMENT_PROFILE", "local");
    try {
      await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, s.companyId));
      expect((await scoped(s, { ...s.human, isInstanceAdmin: true })).allowed).toBe(false);
      expect((await scoped(s, { type: "board", source: "local_implicit" })).allowed).toBe(true);
      await db.insert(instanceUserRoles).values({ userId: s.userId, role: "instance_admin" });
      expect((await scoped(s, s.human)).allowed).toBe(true);
      expect((await scoped(s, { ...s.human, source: "cloud_tenant", isInstanceAdmin: true })).allowed).toBe(false);
      const ready = deferred(), release = deferred();
      const outer = db.transaction(async tx => { const decision = await authorizationService(tx).withReadSources(s.companyId, [], [], owner => owner.decide(input(s, s.human)));
        ready.resolve(); await release.promise; return decision; });
      try { await ready.promise;
        let error: unknown; try { await db.transaction(tx => tx.execute(sql`select id from instance_user_roles where user_id=${s.userId} for update nowait`)); } catch (caught) { error = caught; }
        expect.soft(pgCode(error)).toBe("55P03");
      } finally { release.resolve(); }
      expect((await outer).allowed).toBe(true);
      vi.stubEnv("AW_DEPLOYMENT_PROFILE", "saas");
      expect((await scoped(s, { type: "board", source: "local_implicit" })).allowed).toBe(false);
      expect((await scoped(s, { ...s.human, isInstanceAdmin: true })).allowed).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
  it("pins actual Board credentials and refuses expiration or revocation", async () => {
    const s = await seed(), keyId = randomUUID(), keyHash = randomUUID();
    await db.insert(boardApiKeys).values({ id: keyId, userId: s.userId, name: "Actual Board key", keyHash, expiresAt: new Date(Date.now() + 60000) });
    const actor: AuthorizationActor = { ...s.human, source: "board_key", keyId, authenticatedKeyHash: keyHash };
    expect((await scoped(s, { ...actor, authenticatedKeyHash: undefined })).allowed).toBe(false);
    const ready = deferred(), release = deferred();
    const outer = db.transaction(async tx => { const decision = await authorizationService(tx).withReadSources(s.companyId, [], [], owner => owner.decide(input(s, actor)));
      ready.resolve(); await release.promise; return decision; });
    try { await ready.promise;
      let error: unknown; try { await db.transaction(tx => tx.execute(sql`select id from board_api_keys where id=${keyId} for update nowait`)); } catch (caught) { error = caught; }
      expect.soft(pgCode(error)).toBe("55P03");
    } finally { release.resolve(); }
    expect((await outer).allowed).toBe(true);
    await db.update(boardApiKeys).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(boardApiKeys.id, keyId));
    expect((await scoped(s, actor)).allowed).toBe(false);
    await db.update(boardApiKeys).set({ expiresAt: null, revokedAt: new Date() }).where(eq(boardApiKeys.id, keyId));
    expect((await scoped(s, actor)).allowed).toBe(false);
    await db.update(boardApiKeys).set({ revokedAt: null, expiresAt: new Date(Date.now() + 1000) }).where(eq(boardApiKeys.id, keyId));
    await expect(db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [], [], async owner => {
      expect((await owner.decide(input(s, actor))).allowed).toBe(true);
      // A row lock cannot stop credential time. Do not return callback data
      // after the actual persisted expiry even though revocation is pinned.
      await new Promise(resolve => setTimeout(resolve, 1100));
      return "source payload";
    }))).rejects.toMatchObject({ status: 403 });
  });
  it("fails closed with classified contention on each inverted principal lock order", async () => {
    for (const principal of ["user", "agent", "membership"] as const) {
      const s = await seed(), ready = deferred(), release = deferred();
      const holder = db.transaction(async tx => {
        if (principal === "user") await tx.execute(sql`select id from "user" where id=${s.userId} for update`);
        else if (principal === "agent") await tx.execute(sql`select id from agents where id=${s.agentId} for update`);
        else await tx.execute(sql`select id from company_memberships where company_id=${s.companyId} for update`);
        ready.resolve(); await release.promise;
      });
      await ready.promise;
      try { await expect(scoped(s)).rejects.toMatchObject({ status: 409, details: { code: "native_source_authority_busy" } }); }
      finally { release.resolve(); await holder; }
      expect((await scoped(s)).allowed).toBe(true);
    }
  });

  it("does not broaden the original request credential while waiting for a Source row", async () => {
    const s = await seed(), issueId = randomUUID(), held = deferred(), release = deferred();
    const keyScope = { kind: "skill_test" as const, issueId };
    const actor: AuthorizationActor = { ...s.actor, keyScope };
    await db.update(agentApiKeys).set({ scopeConfig: keyScope }).where(eq(agentApiKeys.id, s.keyId));
    await db.insert(issues).values({ id: issueId, companyId: s.companyId, title: "Credential scope wait", createdByUserId: s.userId });
    expect((await authorizationService(db).decide(input(s, actor))).allowed).toBe(false);
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      const result = await tx.execute(sql`select pg_backend_pid() as pid`); holderPid = Number(result[0]!.pid);
      await tx.execute(sql`select id from issues where id=${issueId} for update`); held.resolve(); await release.promise;
    });
    await held.promise;
    const pending = db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [issueId], [], owner => owner.decide(input(s, actor))));
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const result = await db.execute(sql`select exists(select 1 from pg_stat_activity where ${holderPid}=any(pg_blocking_pids(pid))) as blocked`);
        blocked = result[0]!.blocked === true; if (!blocked) await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
      await db.update(agentApiKeys).set({ scopeConfig: { kind: "standard" } }).where(eq(agentApiKeys.id, s.keyId));
    } finally { release.resolve(); await holder; }
    expect((await pending).allowed).toBe(false);
  });
  it("does not certify a scoped canonical grant as a whole-company Foundation read", async () => {
    const s = await seed(), scope = { projectId: randomUUID() };
    await db.update(principalPermissionGrants).set({ scope }).where(and(eq(principalPermissionGrants.companyId, s.companyId), eq(principalPermissionGrants.principalType, "user")));
    const request = { ...input(s, s.human), scope };
    expect((await authorizationService(db).decide(request)).allowed).toBe(true);
    expect((await db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [], [], owner => owner.decide(request)))).allowed).toBe(false);
  });

  it.each([
    ["agent", "foundation:read"], ["board", "foundation:read"],
    ["agent", "issue:read"], ["board", "issue:read"],
  ] as const)("rechecks the authenticated %s token hash for %s after a real Source row wait", async (credentialKind, action) => {
    const s = await seed(), issueId = randomUUID();
    const token = `fixture-${credentialKind}-${randomUUID()}`;
    const keyHash = createHash("sha256").update(token).digest("hex");
    const credentialId = credentialKind === "agent" ? s.keyId : randomUUID();
    if (credentialKind === "agent") {
      await db.update(agentApiKeys).set({ keyHash }).where(eq(agentApiKeys.id, credentialId));
    } else {
      await db.insert(boardApiKeys).values({ id: credentialId, userId: s.userId, name: "Actual authenticated Board credential", keyHash });
    }
    await db.insert(issues).values({ id: issueId, companyId: s.companyId, title: "Actual authenticated Source wait", createdByUserId: s.userId });
    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/source-read", async (req, res, next) => {
      try {
        expect(req.actor.source).toBe(credentialKind === "agent" ? "agent_key" : "board_key");
        expect(req.actor.keyId).toBe(credentialId);
        const decision = await db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [issueId], [],
          owner => owner.decide(action === "foundation:read" ? input(s, req.actor) : {
            actor: req.actor, action, resource: { type: "issue", companyId: s.companyId, issueId },
            enforceResponsibleUserIntersection: true,
          })));
        res.status(decision.allowed ? 200 : 403).json({ allowed: decision.allowed });
      } catch (error) { next(error); }
    });
    app.use(errorHandler);
    const probe = (bearer = token) => request(app).get("/source-read").set("Authorization", `Bearer ${bearer}`).set("x-paperclip-run-id", s.runId);
    expect((await probe()).status).toBe(200);
    const held = deferred(), release = deferred();
    let holderPid = 0;
    const holder = db.transaction(async tx => {
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = backend!.pid;
      await tx.execute(sql`select id from issues where id=${issueId} for update`);
      held.resolve(); await release.promise;
    });
    await held.promise;
    const pending = probe().then(response => response);
    const replacementToken = `fixture-replacement-${randomUUID()}`;
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const [activity] = await db.execute<{ blocked: boolean }>(sql`select exists(
          select 1 from pg_stat_activity where ${holderPid}=any(pg_blocking_pids(pid))) as blocked`);
        blocked = activity!.blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      const replacementHash = createHash("sha256").update(replacementToken).digest("hex");
      if (credentialKind === "agent") {
        await db.update(agentApiKeys).set({ keyHash: replacementHash }).where(eq(agentApiKeys.id, credentialId));
      } else {
        await db.update(boardApiKeys).set({ keyHash: replacementHash }).where(eq(boardApiKeys.id, credentialId));
      }
    } finally { release.resolve(); await holder; }
    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.body.allowed).toBe(false);
    expect((await probe(replacementToken)).status).toBe(200);
    expect((await probe()).status).toBe(401);
  });

  it.each([
    ["foundation:read", "source_wait"], ["foundation:read", "callback_return"],
    ["issue:read", "source_wait"], ["issue:read", "callback_return"],
  ] as const)("does not outlive an actual JWT for %s across %s", async (action, phase) => {
    const s = await seed(), issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId: s.companyId, title: "Actual JWT lifetime wait", createdByUserId: s.userId });
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `fixture-${randomUUID()}`);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_TTL_SECONDS", "4");
    const entered = deferred(), release = deferred();
    let holdCallback = false;
    const app = express();
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.get("/jwt-source-read", async (req, res, next) => {
      try {
        expect(req.actor.source).toBe("agent_jwt");
        const decision = await db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [issueId], [], async owner => {
          const result = await owner.decide(action === "foundation:read" ? input(s, req.actor) : {
            actor: req.actor, action, resource: { type: "issue", companyId: s.companyId, issueId },
            enforceResponsibleUserIntersection: true,
          });
          if (holdCallback) {
            entered.resolve();
            expect(result.allowed).toBe(true);
            await release.promise;
          }
          return result;
        }));
        res.status(decision.allowed ? 200 : 403).json({ allowed: decision.allowed });
      } catch (error) { next(error); }
    });
    app.use(errorHandler);
    const mint = () => createLocalAgentJwt(s.agentId, s.companyId, "process", s.runId, s.userId)!;
    const probe = (token: string) => request(app).get("/jwt-source-read").set("Authorization", `Bearer ${token}`);
    let holder: Promise<unknown> | undefined;
    let pending: Promise<request.Response> | undefined;
    try {
      expect((await probe(mint())).status).toBe(200);
      const token = mint(), claims = verifyLocalAgentJwt(token)!;
      expect(claims).not.toBeNull();
      let holderPid = 0;
      if (phase === "source_wait") {
        holder = db.transaction(async tx => {
          const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
          holderPid = backend!.pid;
          await tx.execute(sql`select id from issues where id=${issueId} for update`);
          entered.resolve(); await release.promise;
        });
        await entered.promise;
      } else { holdCallback = true; }
      pending = probe(token).then(response => response);
      if (phase === "source_wait") {
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const [activity] = await db.execute<{ blocked: boolean }>(sql`select exists(
            select 1 from pg_stat_activity where ${holderPid}=any(pg_blocking_pids(pid))) as blocked`);
          blocked = activity!.blocked;
          if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
      } else { await entered.promise; }
      expect(verifyLocalAgentJwt(token)).not.toBeNull();
      await new Promise(resolve => setTimeout(resolve, Math.max(0, claims.exp * 1000 - Date.now() + 20)));
      expect(verifyLocalAgentJwt(token)).toBeNull();
      release.resolve(); await holder;
      const response = await pending;
      expect(response.status).toBe(403);
      expect(response.body.allowed).not.toBe(true);
      holdCallback = false;
      expect((await probe(mint())).status).toBe(200);
      expect((await probe(token)).status).toBe(401);
    } finally {
      release.resolve(); await holder; await pending;
      vi.unstubAllEnvs();
    }
  });

it.each(["foundation:read", "issue:read"] as const)("denies a %s Source read whose cookie session is signed out while a Source row is locked", async action => {
  const s = await seed();
  const issueId = randomUUID();
  await db.insert(issues).values({ id: issueId, companyId: s.companyId, title: "Cookie session Source wait" });

  vi.stubEnv("BETTER_AUTH_SECRET", `fixture-${randomUUID()}`);
  vi.stubEnv("PAPERCLIP_AUTH_RATE_LIMIT_ENABLED", "false");
  const held = deferred();
  const release = deferred();
  let holder: Promise<unknown> | undefined;
  let pending: Promise<request.Response> | undefined;
  try {
    const origin = "http://127.0.0.1:41999";
    const config = {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: origin,
      authDisableSignUp: false,
      allowedHostnames: ["127.0.0.1"],
      port: 41999,
    } as unknown as Config;
    const auth = createBetterAuthInstance(db, config, [origin]);
    const app = express();
    // Mirror app.ts: resolve the actual cookie actor before mounting Better Auth.
    app.use(actorMiddleware(db, {
      deploymentMode: "authenticated",
      resolveSession: req => resolveBetterAuthSession(auth, req),
    }));
    app.all("/api/auth/{*authPath}", createBetterAuthHandler(auth));
    app.get("/authenticated-probe", (req, res, next) => {
      try {
        assertAuthenticated(req);
        res.json({ userId: req.actor.userId, sessionId: req.actor.sessionId });
      } catch (error) { next(error); }
    });
    app.get("/source-read", async (req, res, next) => {
      try {
        assertAuthenticated(req);
        expect(req.actor.source).toBe("session");
        const decision = await db.transaction(tx => authorizationService(tx).withReadSources(
          s.companyId,
          [issueId],
          [],
          owner => owner.decide(action === "foundation:read" ? input(s, req.actor) : {
            actor: req.actor, action, resource: { type: "issue", companyId: s.companyId, issueId },
            enforceResponsibleUserIntersection: true,
          }),
        ));
        res.status(decision.allowed ? 200 : 403).json({ allowed: decision.allowed, sessionId: req.actor.sessionId });
      } catch (error) { next(error); }
    });
    app.use(errorHandler);

    const email = `foundation-${randomUUID()}@example.test`;
    const password = "correct-horse-battery-staple";
    const signup = await request(app).post("/api/auth/sign-up/email").set("origin", origin)
      .send({ email, password, name: "Actual Cookie Human" });
    expect(signup.status).toBe(200);
    const userId = signup.body.user.id as string;
    await db.insert(companyMemberships).values({ companyId: s.companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "member" });
    await db.insert(principalPermissionGrants).values({ companyId: s.companyId, principalType: "user", principalId: userId,
      permissionKey: "foundation:read" });

    const signIn = () => request(app).post("/api/auth/sign-in/email").set("origin", origin).send({ email, password });
    const firstSignin = await signIn();
    expect(firstSignin.status).toBe(200);
    const oldCookie = sessionCookieHeader(firstSignin);
    expect(oldCookie).toContain("session_token");
    const authenticatedProbe = (cookie: string) => request(app).get("/authenticated-probe").set("cookie", cookie);
    const sourceProbe = (cookie: string) => request(app).get("/source-read").set("cookie", cookie);
    const initialSource = await sourceProbe(oldCookie);
    expect(initialSource.status).toBe(200);
    const sessionId = initialSource.body.sessionId as string;
    expect(typeof sessionId).toBe("string");

    let holderPid = 0;
    holder = db.transaction(async tx => {
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      holderPid = backend!.pid;
      await tx.execute(sql`select id from issues where id=${issueId} for update`);
      held.resolve();
      await release.promise;
    });
    await held.promise;
    pending = sourceProbe(oldCookie).then(response => response);

    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      const [activity] = await db.execute<{ blocked: boolean }>(sql`select exists(
        select 1 from pg_stat_activity
        where pid <> pg_backend_pid() and state='active' and wait_event_type='Lock'
          and ${holderPid}=any(pg_blocking_pids(pid)) and query ilike '%issues%'
      ) as blocked`);
      blocked = activity!.blocked;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);

    const signedOut = await request(app).post("/api/auth/sign-out").set("origin", origin).set("cookie", oldCookie).send({});
    expect(signedOut.status).toBe(200);
    expect(await db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.id, sessionId))).toHaveLength(0);

    release.resolve();
    await holder;
    expect((await pending).status).toBe(403);
    const secondSignin = await signIn();
    expect(secondSignin.status).toBe(200);
    const freshCookie = sessionCookieHeader(secondSignin);
    expect(freshCookie).not.toBe(oldCookie);
    expect((await authenticatedProbe(freshCookie)).body.userId).toBe(userId);
    expect((await sourceProbe(freshCookie)).status).toBe(200);
    expect((await authenticatedProbe(oldCookie)).status).toBe(401);
  } finally {
    release.resolve();
    try {
      await holder;
      await pending;
    } finally {
      vi.unstubAllEnvs();
    }
  }
});

  it("refuses an unlisted same-company Task as pinned native Source authority", async () => {
    const s = await seed(), capturedId = randomUUID(), unlistedId = randomUUID();
    await db.insert(issues).values([capturedId, unlistedId].map(id => ({ id, companyId: s.companyId,
      title: "Actual Source scope", createdByUserId: s.userId })));
    const read = { actor: s.actor, action: "issue:read" as const,
      resource: { type: "issue" as const, companyId: s.companyId, issueId: unlistedId }, enforceResponsibleUserIntersection: true };
    expect((await authorizationService(db).decide(read)).allowed).toBe(true);
    expect((await db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [capturedId], [],
      owner => owner.decide(read)))).allowed).toBe(false);
    expect((await db.transaction(tx => authorizationService(tx).withReadSources(s.companyId, [unlistedId], [],
      owner => owner.decide(read)))).allowed).toBe(true);
    // Preserve the original outside-transaction per-call behavior. It supplies
    // no locked Source facts or reusable authority proof.
    expect((await authorizationService(db).withReadSources(s.companyId, [], [], owner => owner.decide(read))).allowed).toBe(true);
  });

});
