import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  memoryBindings,
  memoryBindingTargets,
  memoryEvidence,
  memoryRecords,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { memoryService } from "./memory-service.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe : describe.skip;

function evidence(text: string) {
  return [{
    sourceClass: "task" as const,
    sourceProvider: "august_works_tasks",
    sourceType: "issue",
    sourceRef: "issue://test",
    sourceVersion: "1",
    sourceUpdatedAt: "2026-09-29T12:00:00.000Z",
    observedAt: "2026-09-29T12:00:00.000Z",
    excerptHash: createHash("sha256").update(text).digest("hex"),
    citation: { label: "Task evidence" },
    trustLevel: "high" as const,
    relation: "supports" as const,
  }];
}

describePg("Memory Core service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-core-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed(name = "Memory Co") {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `M${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: userId,
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    const [agent] = await db.insert(agents).values({
      companyId,
      name: "Memory Agent",
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
    const [project] = await db.insert(projects).values({
      companyId,
      name: "Memory Project",
    }).returning();
    return { companyId, userId, agent: agent!, project: project! };
  }

  async function binding(companyId: string, userId: string) {
    const svc = memoryService(db);
    const created = await svc.createBinding(
      companyId,
      {
        key: "local-memory",
        name: "Local memory",
        providerKey: "local",
        config: {},
        enabled: true,
      },
      { principal: { type: "user", userId } },
    );
    await svc.addBindingTarget(
      companyId,
      created.id,
      { targetType: "company", targetId: companyId },
      { principal: { type: "user", userId } },
    );
    return created;
  }

  function candidate(bindingId: string, overrides: Record<string, unknown> = {}) {
    return {
      bindingId,
      memoryType: "lesson",
      scope: { type: "company", id: null },
      subject: { type: "customer", id: "acme" },
      ownerAgentId: null,
      title: "Procurement lesson",
      content: "Acme requires security review before procurement.",
      summary: "Security review precedes procurement.",
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
      evidence: evidence("Acme requires security review before procurement."),
      ...overrides,
    };
  }

  it("creates an evidence-backed pending candidate and keeps it company-scoped", async () => {
    const seeded = await seed();
    const other = await seed("Other Co");
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);

    const created = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id),
      { principal: { type: "agent", agentId: seeded.agent.id, responsibleUserId: seeded.userId } },
    );

    expect(created.record).toMatchObject({
      companyId: seeded.companyId,
      reviewState: "pending",
      verificationState: "unverified",
      memoryType: "lesson",
      scopeType: "company",
      ownerAgentId: null,
    });
    expect(created.evidence).toHaveLength(1);
    expect(await svc.get(other.companyId, created.record.id)).toBeNull();
  });

  it("enforces the private-agent memory boundary at validation and tenant scope", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);

    await expect(
      svc.createCandidate(
        seeded.companyId,
        candidate(b.id, {
          scope: { type: "agent", id: seeded.agent.id },
          ownerAgentId: null,
        }),
        { principal: { type: "agent", agentId: seeded.agent.id } },
      ),
    ).rejects.toMatchObject({ status: 422 });

    const [otherAgent] = await db.insert(agents).values({
      companyId: seeded.companyId,
      name: "Other Agent",
      role: "analyst",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();

    await expect(
      svc.createCandidate(
        seeded.companyId,
        candidate(b.id, {
          scope: { type: "agent", id: otherAgent!.id },
          ownerAgentId: otherAgent!.id,
        }),
        { principal: { type: "agent", agentId: seeded.agent.id } },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("requires human or system review before a candidate becomes active memory", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const created = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id),
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );

    await expect(
      svc.reviewCandidate(
        seeded.companyId,
        created.record.id,
        { decision: "accept" },
        { principal: { type: "agent", agentId: seeded.agent.id } },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const accepted = await svc.reviewCandidate(
      seeded.companyId,
      created.record.id,
      { decision: "accept" },
      { principal: { type: "user", userId: seeded.userId } },
    );
    expect(accepted.record).toMatchObject({
      reviewState: "accepted",
      verificationState: "human_verified",
    });
    expect(await svc.listEligible(seeded.companyId)).toEqual([
      expect.objectContaining({ id: created.record.id }),
    ]);
  });

  it("does not supersede accepted memory until its correction candidate is accepted", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const originalCandidate = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id),
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );
    const original = await svc.reviewCandidate(
      seeded.companyId,
      originalCandidate.record.id,
      { decision: "accept" },
      { principal: { type: "user", userId: seeded.userId } },
    );

    const correction = await svc.createCorrectionCandidate(
      seeded.companyId,
      original.record.id,
      {
        memoryType: "lesson",
        subject: { type: "customer", id: "acme" },
        title: "Updated procurement lesson",
        content: "Acme now requires legal and security review before procurement.",
        summary: null,
        sensitivity: "internal",
        importance: 90,
        confidenceScore: 0.95,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T13:00:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: null,
        metadata: {},
        evidence: evidence("Acme now requires legal and security review before procurement."),
        reason: "Customer process changed",
      },
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );

    expect(correction.record).toMatchObject({
      reviewState: "pending",
      supersedesRecordId: original.record.id,
    });
    expect((await svc.get(seeded.companyId, original.record.id))?.record.supersededByRecordId).toBeNull();
    expect(await svc.listEligible(seeded.companyId)).toEqual([
      expect.objectContaining({ id: original.record.id }),
    ]);

    const acceptedCorrection = await svc.reviewCandidate(
      seeded.companyId,
      correction.record.id,
      { decision: "accept" },
      { principal: { type: "user", userId: seeded.userId } },
    );
    expect(
      (await svc.get(seeded.companyId, original.record.id))?.record.supersededByRecordId,
    ).toBe(acceptedCorrection.record.id);
    expect(await svc.listEligible(seeded.companyId)).toEqual([
      expect.objectContaining({ id: acceptedCorrection.record.id }),
    ]);
  });

  it("revokes accepted memory durably and excludes it from eligible recall", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const created = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id),
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );
    const accepted = await svc.reviewCandidate(
      seeded.companyId,
      created.record.id,
      { decision: "accept" },
      { principal: { type: "user", userId: seeded.userId } },
    );

    const revoked = await svc.revoke(
      seeded.companyId,
      accepted.record.id,
      { reason: "Customer corrected the information" },
      { principal: { type: "user", userId: seeded.userId } },
    );

    expect(revoked.record).toMatchObject({
      revocationReason: "Customer corrected the information",
      revokedByActorType: "user",
      revokedByActorId: seeded.userId,
    });
    expect(revoked.record.revokedAt).toBeInstanceOf(Date);
    expect(await svc.listEligible(seeded.companyId)).toEqual([]);
  });
});
