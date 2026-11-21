import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { agents, authSessions, authUsers, companies, companyMemberships, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issues } from "@paperclipai/db";
import type { LiveEvent } from "@paperclipai/shared";
import { memoryService, type MemoryMutationActor } from "../services/memory/memory-service.js";
import { canActorReadMemorySources } from "../services/memory/memory-privacy.js";
import { analyticalLiveEventForReader } from "../services/analytical-live-events.js";
import { publishLiveEvent, subscribeCompanyLiveEvents } from "../services/live-events.js";
import { setupLiveEventsWebSocketServer } from "../realtime/live-events-ws.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Native private Memory activity at live delivery", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("v10-memory-live-source-");
    db = createDb(database.connectionString, { maxConnections: 3 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30000);

  it("drops actual private Memory creation activity while delivering a subsequent authorized socket barrier", async () => {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
    const agentId = randomUUID(), runId = randomUUID(), sourceTaskId = randomUUID();
    const canary = `privatememorycopy${randomUUID().replaceAll("-", "")}`;
    await db.insert(companies).values({ id: companyId, name: "Retained Memory derivative", issuePrefix: `PM${companyId.slice(0, 6)}` });
    await db.insert(authUsers).values([aliceId, bobId].map(id => ({ id, name: "Current Human",
      email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({ companyId,
      principalType: "user", principalId, status: "active", membershipRole: "admin" })));
    await db.insert(agents).values({ id: agentId, companyId, name: "Native producer", role: "engineer",
      status: "idle", adapterType: "paperclip_runner" });
    await db.insert(companyMemberships).values({ companyId, principalType: "agent", principalId: agentId, status: "active" });
    await db.insert(issues).values({ id: sourceTaskId, companyId, title: "Public native source task",
      visibility: "open", responsibleUserId: aliceId, createdByUserId: aliceId, assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, responsibleUserId: aliceId,
      nativeIssueId: sourceTaskId, contextSnapshot: { issueId: sourceTaskId }, runtimeMode: "native", status: "running" });
    await initializeRunIdentity(db, { companyId, runId, responsibleUserId: aliceId, issueId: sourceTaskId, cause: "dispatch" });
    const memory = memoryService(db);
    const alice = { principal: { type: "user" as const, userId: aliceId } };
    const producer: MemoryMutationActor = { principal: { type: "agent", agentId, responsibleUserId: aliceId }, runId };
    const binding = await memory.createCompanyBinding(companyId, { key: randomUUID(), name: "Private source", providerKey: "local" }, alice);
    await memory.addBindingTarget(companyId, binding.id, { targetType: "agent", targetId: agentId }, alice);
    const bob = { type: "board" as const, userId: bobId, source: "session" as const };
    const sessionId = randomUUID(), now = new Date();
    await db.insert(authSessions).values({ id: sessionId, userId: bobId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 60000) });
    const http = createServer();
    const wss = setupLiveEventsWebSocketServer(http, db, { deploymentMode: "authenticated", deploymentProfile: "saas",
      resolveSessionFromHeaders: async () => ({ session: { id: sessionId, userId: bobId }, user: { id: bobId, email: null, name: null } }) });
    const activities: LiveEvent[] = [], received: LiveEvent[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(companyId, event => { if (event.type === "activity.logged") activities.push(event); });
    http.listen(0, "127.0.0.1"); await once(http, "listening");
    const address = http.address(); if (!address || typeof address === "string") throw new Error("Missing native listener");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/companies/${companyId}/events/ws`);
    const barrier = new Promise<void>(resolve => socket.on("message", data => {
      const value: LiveEvent = JSON.parse(data.toString()); received.push(value);
      if (value.payload.marker === "authorized barrier") resolve();
    }));
    try {
      await once(socket, "open");
    const source = await memory.createPrivateMemory(companyId, agentId, { bindingId: binding.id,
      memoryType: "lesson", title: "Private source lesson", content: canary, summary: null, sensitivity: "internal",
      observedAt: new Date().toISOString(), validFrom: null, validUntil: null, expiresAt: null,
      createdByOperationId: randomUUID(), evidence: [{ sourceClass: "task", sourceProvider: "fixture",
        sourceType: "verified_fixture", sourceRef: `issue://${sourceTaskId}`, sourceVersion: "1", sourceUpdatedAt: null,
        observedAt: new Date().toISOString(), excerptHash: createHash("sha256").update(canary).digest("hex"),
        citation: { label: "Verified native source" }, trustLevel: "low", relation: "supports" }] }, producer);
      const creation = activities.find(event => event.payload.action === "memory.private_created" && event.payload.entityId === source.record.id);
      expect(creation).toBeDefined();
      expect(creation!.payload.runId).toBe(runId);
      expect(creation!.payload.entityType).toBe("memory_record");
      expect(await canActorReadMemorySources(db, companyId, bob, source.record.id)).toBe(false);
      await expect(memory.get(companyId, source.record.id, { principal: { type: "user", userId: bobId } }))
        .rejects.toMatchObject({ status: 403 });
      expect((await memory.get(companyId, source.record.id, producer))?.record.content).toBe(canary);
      const agentActor = { type: "agent" as const, source: "agent_jwt" as const, agentId, runId, responsibleUserId: aliceId };
      expect(await analyticalLiveEventForReader(db, creation!, agentActor)).toEqual(creation);
      expect.soft(await analyticalLiveEventForReader(db, creation!, bob)).toBeNull();
      publishLiveEvent({ companyId, type: "agent.status", payload: { marker: "authorized barrier" } });
      await barrier;
      expect(received.at(-1)?.payload.marker).toBe("authorized barrier");
      expect.soft(received.some(event => event.payload.entityId === source.record.id)).toBe(false);
      expect.soft(JSON.stringify(received)).not.toContain(source.record.id);
    } finally {
      unsubscribe();
      if (socket.readyState !== WebSocket.CLOSED) { const closed = once(socket, "close"); socket.terminate(); await closed; }
      await new Promise<void>(resolve => wss.close(resolve));
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    }
  });
});
