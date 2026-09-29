import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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

  async function privateBinding(
    companyId: string,
    userId: string,
    agentId: string,
    key = "private-memory",
  ) {
    const svc = memoryService(db);
    const created = await svc.createBinding(
      companyId,
      {
        key,
        name: "Private memory",
        providerKey: "local",
        config: {},
        enabled: true,
      },
      { principal: { type: "user", userId } },
    );
    await svc.addBindingTarget(
      companyId,
      created.id,
      { targetType: "agent", targetId: agentId },
      { principal: { type: "user", userId } },
    );
    return created;
  }

  const userActor = (userId: string) => ({
    principal: { type: "user" as const, userId },
  });
  const agentActor = (agentId: string, responsibleUserId?: string) => ({
    principal: {
      type: "agent" as const,
      agentId,
      responsibleUserId: responsibleUserId ?? null,
    },
  });
  const systemActor = {
    principal: { type: "system" as const, service: "memory-test" },
  };

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

  function privateInput(
    bindingId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const value = candidate(bindingId, {
      createdByOperationId: "private-operation-1",
      ...overrides,
    });
    const { scope: _scope, ownerAgentId: _ownerAgentId, ...input } = value;
    return input;
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
    expect(await svc.get(other.companyId, created.record.id, userActor(other.userId))).toBeNull();
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

    await expect(
      svc.reviewCandidate(
        seeded.companyId,
        created.record.id,
        { decision: "accept", verificationState: "system_verified" },
        { principal: { type: "user", userId: seeded.userId } },
      ),
    ).rejects.toMatchObject({ status: 422 });

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
    expect(await svc.listEligible(seeded.companyId, {}, userActor(seeded.userId))).toEqual([
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
    expect((await svc.get(seeded.companyId, original.record.id, userActor(seeded.userId)))?.record.supersededByRecordId).toBeNull();
    expect(await svc.listEligible(seeded.companyId, {}, userActor(seeded.userId))).toEqual([
      expect.objectContaining({ id: original.record.id }),
    ]);

    const acceptedCorrection = await svc.reviewCandidate(
      seeded.companyId,
      correction.record.id,
      { decision: "accept" },
      { principal: { type: "user", userId: seeded.userId } },
    );
    expect(
      (await svc.get(seeded.companyId, original.record.id, userActor(seeded.userId)))?.record.supersededByRecordId,
    ).toBe(acceptedCorrection.record.id);
    expect(await svc.listEligible(seeded.companyId, {}, userActor(seeded.userId))).toEqual([
      expect.objectContaining({ id: acceptedCorrection.record.id }),
    ]);
  });

  it("excludes private agent memory from unscoped eligibility and requires explicit owner scope", async () => {
    const seeded = await seed();
    const b = await privateBinding(
      seeded.companyId,
      seeded.userId,
      seeded.agent.id,
    );
    const svc = memoryService(db);

    const privateCandidate = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        scope: { type: "agent", id: seeded.agent.id },
        ownerAgentId: seeded.agent.id,
      }),
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );
    await svc.reviewCandidate(
      seeded.companyId,
      privateCandidate.record.id,
      { decision: "accept" },
      { principal: { type: "user", userId: seeded.userId } },
    );

    expect(await svc.listEligible(seeded.companyId, {}, userActor(seeded.userId))).toEqual([]);
    expect(
      await svc.listEligible(
        seeded.companyId,
        {
          scopeType: "agent",
          scopeId: seeded.agent.id,
        },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).toEqual([expect.objectContaining({ id: privateCandidate.record.id })]);

    await expect(
      svc.listEligible(
        seeded.companyId,
        { scopeType: "agent" },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      svc.listEligible(
        seeded.companyId,
        { scopeId: seeded.agent.id },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("denies private memory detail and recall to same-company non-owner principals", async () => {
    const seeded = await seed();
    const b = await privateBinding(
      seeded.companyId,
      seeded.userId,
      seeded.agent.id,
    );
    const svc = memoryService(db);
    const privateCandidate = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        scope: { type: "agent", id: seeded.agent.id },
        ownerAgentId: seeded.agent.id,
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    await svc.reviewCandidate(
      seeded.companyId,
      privateCandidate.record.id,
      { decision: "accept" },
      userActor(seeded.userId),
    );

    const [otherAgent] = await db.insert(agents).values({
      companyId: seeded.companyId,
      name: "Memory Reader",
      role: "analyst",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    await db.insert(companyMemberships).values({
      companyId: seeded.companyId,
      principalType: "agent",
      principalId: otherAgent!.id,
      status: "active",
      membershipRole: "member",
    });

    await expect(
      svc.get(
        seeded.companyId,
        privateCandidate.record.id,
        agentActor(otherAgent!.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "private_memory_read_denied" }),
    });
    await expect(
      svc.get(
        seeded.companyId,
        privateCandidate.record.id,
        userActor(seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "private_memory_read_denied" }),
    });
    await expect(
      svc.listEligible(
        seeded.companyId,
        { scopeType: "agent", scopeId: seeded.agent.id },
        agentActor(otherAgent!.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "private_memory_read_denied" }),
    });

    await expect(
      svc.get(
        seeded.companyId,
        privateCandidate.record.id,
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).resolves.toMatchObject({
      record: expect.objectContaining({ id: privateCandidate.record.id }),
    });
    await expect(
      svc.get(seeded.companyId, privateCandidate.record.id, systemActor),
    ).resolves.toMatchObject({
      record: expect.objectContaining({ id: privateCandidate.record.id }),
    });
  });

  it("creates active owner-bound private memory only through an agent-targeted binding", async () => {
    const seeded = await seed();
    const sharedBinding = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);

    await expect(
      svc.createPrivateMemory(
        seeded.companyId,
        seeded.agent.id,
        privateInput(sharedBinding.id),
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).rejects.toMatchObject({ status: 403 });

    const agentBinding = await privateBinding(
      seeded.companyId,
      seeded.userId,
      seeded.agent.id,
    );
    const created = await svc.createPrivateMemory(
      seeded.companyId,
      seeded.agent.id,
      privateInput(agentBinding.id, {
        memoryType: "preference",
        title: "Status style",
        content: "Prefer concise status updates.",
        summary: null,
        evidence: evidence("Prefer concise status updates."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(created.record).toMatchObject({
      scopeType: "agent",
      scopeId: seeded.agent.id,
      ownerAgentId: seeded.agent.id,
      reviewState: "accepted",
      verificationState: "unverified",
    });
    const retriedPrivate = await svc.createPrivateMemory(
      seeded.companyId,
      seeded.agent.id,
      privateInput(agentBinding.id, {
        memoryType: "preference",
        title: "Status style",
        content: "Prefer concise status updates.",
        summary: null,
        evidence: evidence("Prefer concise status updates."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(retriedPrivate.record.id).toBe(created.record.id);
    await expect(
      svc.listEligible(
        seeded.companyId,
        { scopeType: "agent", scopeId: seeded.agent.id },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).resolves.toEqual([expect.objectContaining({ id: created.record.id })]);
    await expect(
      svc.createPrivateMemory(
        seeded.companyId,
        seeded.agent.id,
        privateInput(agentBinding.id),
        userActor(seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "private_memory_write_denied" }),
    });
  });

  it("promotes private memory by creating a separate pending shared candidate", async () => {
    const seeded = await seed();
    const sharedBinding = await binding(seeded.companyId, seeded.userId);
    const agentBinding = await privateBinding(
      seeded.companyId,
      seeded.userId,
      seeded.agent.id,
    );
    const svc = memoryService(db);

    const privateRecord = await svc.createPrivateMemory(
      seeded.companyId,
      seeded.agent.id,
      privateInput(agentBinding.id, {
        memoryType: "lesson",
        title: "Procurement heuristic",
        content: "Security review should happen before procurement.",
        summary: "Review security first.",
        evidence: evidence("Security review should happen before procurement."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    const [otherAgent] = await db.insert(agents).values({
      companyId: seeded.companyId,
      name: "Other Memory Agent",
      role: "analyst",
      adapterType: "paperclip_runner",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    }).returning();
    await db.insert(companyMemberships).values({
      companyId: seeded.companyId,
      principalType: "agent",
      principalId: otherAgent!.id,
      status: "active",
      membershipRole: "member",
    });

    await expect(
      svc.sharePrivateMemory(
        seeded.companyId,
        privateRecord.record.id,
        {
          targetBindingId: sharedBinding.id,
          targetScope: { type: "company", id: null },
          reason: "Useful across the company",
          createdByOperationId: "share-operation-other-agent",
        },
        agentActor(otherAgent!.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "private_memory_read_denied" }),
    });

    const sharedCandidate = await svc.sharePrivateMemory(
      seeded.companyId,
      privateRecord.record.id,
      {
        targetBindingId: sharedBinding.id,
        targetScope: { type: "company", id: null },
        reason: "Useful across the company",
        createdByOperationId: "share-operation-1",
      },
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(sharedCandidate.record).toMatchObject({
      scopeType: "company",
      scopeId: null,
      ownerAgentId: null,
      reviewState: "pending",
      verificationState: "unverified",
      metadata: expect.objectContaining({
        promotedFromPrivateRecordId: privateRecord.record.id,
        promotedFromOwnerAgentId: seeded.agent.id,
        promotionReason: "Useful across the company",
      }),
    });
    expect(sharedCandidate.evidence).toEqual([
      expect.objectContaining({
        sourceClass: "private_memory",
        sourceProvider: "august_works_memory",
        sourceType: "memory_record",
        sourceRef: `memory://private/${privateRecord.record.id}`,
        trustLevel: "low",
        supportsOrContradicts: "supports",
        citationJson: { label: "Agent-private memory" },
      }),
    ]);

    const retriedShare = await svc.sharePrivateMemory(
      seeded.companyId,
      privateRecord.record.id,
      {
        targetBindingId: sharedBinding.id,
        targetScope: { type: "company", id: null },
        reason: "Useful across the company",
        createdByOperationId: "share-operation-1",
      },
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(retriedShare.record.id).toBe(sharedCandidate.record.id);

    await expect(
      svc.sharePrivateMemory(
        seeded.companyId,
        privateRecord.record.id,
        {
          targetBindingId: sharedBinding.id,
          targetScope: { type: "subject", id: "different-target" },
          reason: "Changed target",
          createdByOperationId: "share-operation-1",
        },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "memory_operation_conflict" }),
    });

    const sourceAfterShare = await svc.get(
      seeded.companyId,
      privateRecord.record.id,
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(sourceAfterShare?.record).toMatchObject({
      scopeType: "agent",
      ownerAgentId: seeded.agent.id,
      reviewState: "accepted",
      supersededByRecordId: null,
      revokedAt: null,
    });

    expect(
      await svc.listEligible(
        seeded.companyId,
        {},
        agentActor(otherAgent!.id, seeded.userId),
      ),
    ).toEqual([]);

    const accepted = await svc.reviewCandidate(
      seeded.companyId,
      sharedCandidate.record.id,
      { decision: "accept" },
      userActor(seeded.userId),
    );
    expect(accepted.record.reviewState).toBe("accepted");

    expect(
      await svc.listEligible(
        seeded.companyId,
        {},
        agentActor(otherAgent!.id, seeded.userId),
      ),
    ).toEqual([expect.objectContaining({ id: accepted.record.id })]);
    await expect(
      svc.get(
        seeded.companyId,
        privateRecord.record.id,
        agentActor(otherAgent!.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 403,
      details: expect.objectContaining({ code: "private_memory_read_denied" }),
    });
  });

  it("allows company deletion to cascade through bindings, records, and evidence", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const created = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id),
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );

    expect(created.evidence).toHaveLength(1);
    await db.delete(companies).where(eq(companies.id, seeded.companyId));

    expect(
      await db.select().from(memoryBindings).where(eq(memoryBindings.companyId, seeded.companyId)),
    ).toEqual([]);
    expect(
      await db.select().from(memoryRecords).where(eq(memoryRecords.companyId, seeded.companyId)),
    ).toEqual([]);
    expect(
      await db.select().from(memoryEvidence).where(eq(memoryEvidence.companyId, seeded.companyId)),
    ).toEqual([]);
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
    expect(await svc.listEligible(seeded.companyId, {}, userActor(seeded.userId))).toEqual([]);
  });
});
