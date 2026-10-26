import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  authUsers,
  authSessions,
  heartbeatRuns,
  companies,
  companyMemberships,
  createDb,
  instanceSettings,
  issues,
  memoryBindings,
  memoryBindingTargets,
  memoryEvidence,
  memoryRecords,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { memoryRoutes } from "../routes/memory.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { memoryService } from "../services/memory/memory-service.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

function supportingEvidence(text: string, sourceIssueId: string, sourceVersion: string) {
  return [{
    sourceClass: "task" as const,
    sourceProvider: "august_works_tasks",
    sourceType: "issue",
    sourceRef: `issue://${sourceIssueId}`,
    sourceVersion,
    sourceUpdatedAt: sourceVersion,
    observedAt: "2026-09-29T12:00:00.000Z",
    excerptHash: createHash("sha256").update(text).digest("hex"),
    citation: { label: "Task evidence" },
    trustLevel: "high" as const,
    relation: "supports" as const,
  }];
}

describePg("Memory routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(companyMemberships);
    await db.delete(issues);
    await db.delete(authSessions);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(authUsers);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function app(actor: Express.Request["actor"]) {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    instance.use("/api", memoryRoutes(db));
    instance.use(errorHandler);
    return instance;
  }

  async function seed() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Actual Memory Human", email: `${userId}@example.test`,
      createdAt: now, updatedAt: now });
    const sessionId = randomUUID();
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60_000) });
    await db.insert(companies).values({
      id: companyId,
      name: "Memory Route Co",
      issuePrefix: `MR${companyId.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      defaultResponsibleUserId: userId,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const [sourceIssue] = await db.insert(issues).values({
      companyId,
      title: "Current Memory evidence task",
      description: "A public human-authored source for the route fixture.",
      createdByUserId: userId,
      responsibleUserId: userId,
      payloadSourceProtocolVersion: 1,
    }).returning();
    await db.execute(sql`update issues target set payload_source_snapshot=(
      select body || jsonb_build_object('digest',encode(sha256(convert_to(body::text,'UTF8')),'hex')) from (
        select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','issue','companyId',target.company_id,'id',target.id,
          'contentHash',public.aw_native_payload_body_hash('issue',to_jsonb(target))),
          'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
            'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as body
      ) actual_body
    ) where target.id=${sourceIssue!.id}::uuid`);
    const [agent] = await db.insert(agents).values({
      companyId,
      name: "Memory Route Agent",
      role: "analyst",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "agent",
      principalId: agent!.id,
      status: "active",
      membershipRole: "member",
    });
    return { companyId, userId, sessionId, sourceIssue: sourceIssue!, agent: agent! };
  }

  function board(userId: string, companyId: string, sessionId: string): Express.Request["actor"] {
    return {
      type: "board",
      userId,
      source: "session",
      sessionId,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    };
  }

  it("keeps the Memory API behind the experimental gate", async () => {
    const seeded = await seed();
    await request(app(board(seeded.userId, seeded.companyId, seeded.sessionId)))
      .get(`/api/companies/${seeded.companyId}/memory/records`)
      .expect(404);
  });

  it("supports shared binding, candidate review, detail and revocation", async () => {
    const seeded = await seed();
    await db.insert(instanceSettings).values({
      experimental: { enableCollectiveMemoryV1: true },
    });
    const http = request(app(board(seeded.userId, seeded.companyId, seeded.sessionId)));

    const binding = await http
      .post(`/api/companies/${seeded.companyId}/memory/bindings/company`)
      .send({
        key: "local-memory",
        name: "Local memory",
        providerKey: "local",
        config: {},
        enabled: true,
      })
      .expect(201);

    const content = "Acme procurement requires a security review.";
    const candidate = await http
      .post(`/api/companies/${seeded.companyId}/memory/candidates`)
      .send({
        bindingId: binding.body.id,
        memoryType: "lesson",
        scope: { type: "company", id: null },
        subject: { type: "customer", id: "acme" },
        ownerAgentId: null,
        title: "Acme procurement",
        content,
        summary: "Security review first.",
        sensitivity: "internal",
        importance: 80,
        confidenceScore: 0.8,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:00:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: supportingEvidence(content, seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString()),
      })
      .expect(201);
    expect(candidate.body.resolution).toMatchObject({
      kind: "new",
      targetRecordId: null,
    });

    const duplicate = await http
      .post(`/api/companies/${seeded.companyId}/memory/candidates`)
      .send({
        bindingId: binding.body.id,
        memoryType: "lesson",
        scope: { type: "company", id: null },
        subject: { type: "customer", id: "acme" },
        ownerAgentId: null,
        title: "Acme procurement",
        content,
        summary: "Security review first.",
        sensitivity: "internal",
        importance: 80,
        confidenceScore: 0.8,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:00:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: supportingEvidence(content, seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString()),
      })
      .expect(200);
    expect(duplicate.body).toMatchObject({
      resolution: {
        kind: "duplicate",
        targetRecordId: candidate.body.record.id,
      },
      record: { id: candidate.body.record.id },
    });

    const contradiction = await http
      .post(`/api/companies/${seeded.companyId}/memory/candidates`)
      .send({
        bindingId: binding.body.id,
        memoryType: "lesson",
        scope: { type: "company", id: null },
        subject: { type: "customer", id: "acme" },
        ownerAgentId: null,
        title: "Acme procurement",
        content,
        summary: "Security review first.",
        sensitivity: "internal",
        importance: 80,
        confidenceScore: 0.8,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:00:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: [
          ...supportingEvidence(content, seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString()),
          {
            ...supportingEvidence(content, seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString())[0]!,
            relation: "contradicts",
          },
        ],
      })
      .expect(200);
    expect(contradiction.body).toMatchObject({
      resolution: {
        kind: "contradiction",
        reasonCode: "contradicting_evidence_against_pending_equivalent_claim",
        targetRecordId: candidate.body.record.id,
      },
      record: { id: candidate.body.record.id, reviewState: "pending" },
    });

    const pending = await http
      .get(`/api/companies/${seeded.companyId}/memory/records?reviewState=pending`)
      .expect(200);
    expect(pending.body).toEqual([
      expect.objectContaining({ id: candidate.body.record.id, reviewState: "pending" }),
    ]);

    const detail = await http
      .get(`/api/companies/${seeded.companyId}/memory/records/${candidate.body.record.id}`)
      .expect(200);
    expect(detail.body.evidence).toHaveLength(2);
    expect(detail.body.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportsOrContradicts: "supports" }),
        expect.objectContaining({ supportsOrContradicts: "contradicts" }),
      ]),
    );

    await http
      .post(`/api/companies/${seeded.companyId}/memory/records/${candidate.body.record.id}/accept`)
      .send({})
      .expect(200);

    const accepted = await http
      .get(`/api/companies/${seeded.companyId}/memory/records?reviewState=accepted`)
      .expect(200);
    expect(accepted.body[0]).toMatchObject({
      id: candidate.body.record.id,
      verificationState: "human_verified",
    });

    await http
      .post(`/api/companies/${seeded.companyId}/memory/records/${candidate.body.record.id}/revoke`)
      .send({ reason: "Customer corrected the information" })
      .expect(200);
  });

  it("does not expose private agent memory through the board lifecycle API", async () => {
    const seeded = await seed();
    await db.insert(instanceSettings).values({
      experimental: { enableCollectiveMemoryV1: true },
    });
    const svc = memoryService(db);
    const systemActor = {
      principal: { type: "system" as const, service: "memory-route-seed" },
    };
    const binding = await svc.createBinding(
      seeded.companyId,
      {
        key: "private-memory",
        name: "Private memory",
        providerKey: "local",
        config: {},
        enabled: true,
      },
      systemActor,
    );
    await svc.addBindingTarget(
      seeded.companyId,
      binding.id,
      { targetType: "agent", targetId: seeded.agent.id },
      systemActor,
    );
    const [run] = await db.insert(heartbeatRuns).values({ companyId: seeded.companyId, agentId: seeded.agent.id,
      responsibleUserId: seeded.userId, runtimeMode: "native", scopeKind: "company", status: "running" }).returning();
    await initializeRunIdentity(db, { companyId: seeded.companyId, runId: run!.id, responsibleUserId: seeded.userId, cause: "dispatch" });
    const privateCandidate = await svc.createCandidate(
      seeded.companyId,
      {
        bindingId: binding.id,
        memoryType: "preference",
        scope: { type: "agent", id: seeded.agent.id },
        subject: null,
        ownerAgentId: seeded.agent.id,
        title: "Private preference",
        content: "Prefer concise status updates.",
        summary: null,
        sensitivity: "internal",
        importance: 50,
        confidenceScore: 0.7,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:00:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: supportingEvidence("Prefer concise status updates.", seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString()),
      },
      { principal: { type: "agent", agentId: seeded.agent.id, responsibleUserId: seeded.userId }, runId: run!.id },
    );

    const http = request(app(board(seeded.userId, seeded.companyId, seeded.sessionId)));
    const list = await http
      .get(`/api/companies/${seeded.companyId}/memory/records`)
      .expect(200);
    expect(list.body).toEqual([]);
    await http
      .get(`/api/companies/${seeded.companyId}/memory/records/${privateCandidate.record.id}`)
      .expect(404);

    await http
      .post(`/api/companies/${seeded.companyId}/memory/records/${privateCandidate.record.id}/accept`)
      .send({})
      .expect(404);

    await http
      .post(`/api/companies/${seeded.companyId}/memory/records/${privateCandidate.record.id}/reject`)
      .send({ reason: "Board must not review private agent memory" })
      .expect(404);

    await http
      .post(`/api/companies/${seeded.companyId}/memory/records/${privateCandidate.record.id}/revoke`)
      .send({ reason: "Board must not revoke private agent memory" })
      .expect(404);

    await http
      .post(`/api/companies/${seeded.companyId}/memory/records/${privateCandidate.record.id}/correct`)
      .send({
        memoryType: "preference",
        subject: null,
        title: "Private preference",
        content: "Prefer detailed status updates.",
        summary: null,
        sensitivity: "internal",
        importance: 50,
        confidenceScore: 0.7,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:05:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: supportingEvidence("Prefer detailed status updates.", seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString()),
        reason: "Private correction must remain agent-scoped",
      })
      .expect(404);

    await http
      .post(`/api/companies/${seeded.companyId}/memory/candidates`)
      .send({
        bindingId: binding.id,
        memoryType: "preference",
        scope: { type: "agent", id: seeded.agent.id },
        subject: null,
        ownerAgentId: seeded.agent.id,
        title: "Board-created private preference",
        content: "Do not allow this through the shared board API.",
        summary: null,
        sensitivity: "internal",
        importance: 50,
        confidenceScore: 0.7,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:10:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: supportingEvidence("Do not allow this through the shared board API.", seeded.sourceIssue.id, seeded.sourceIssue.updatedAt.toISOString()),
      })
      .expect(422);

    await http
      .post(`/api/companies/${seeded.companyId}/memory/bindings/${binding.id}/targets`)
      .send({ targetType: "agent", targetId: seeded.agent.id })
      .expect(422);
  });
});
