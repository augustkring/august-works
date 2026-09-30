import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
    expect(created.resolution).toMatchObject({
      kind: "new",
      targetRecordId: null,
    });
    expect(await svc.get(other.companyId, created.record.id, userActor(other.userId))).toBeNull();
  });

  it("deduplicates an equivalent shared claim without creating another record", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const input = candidate(b.id, {
      memoryType: "fact",
      title: "Procurement owner",
      content: "Acme procurement owner is Anna.",
      summary: null,
      evidence: evidence("Acme procurement owner is Anna."),
    });

    const first = await svc.createCandidate(
      seeded.companyId,
      input,
      agentActor(seeded.agent.id, seeded.userId),
    );
    const duplicate = await svc.createCandidate(
      seeded.companyId,
      input,
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(first.resolution.kind).toBe("new");
    expect(duplicate.resolution).toMatchObject({
      kind: "duplicate",
      targetRecordId: first.record.id,
      novelEvidenceCount: 0,
    });
    expect(duplicate.record.id).toBe(first.record.id);
    expect(
      await db
        .select()
        .from(memoryRecords)
        .where(eq(memoryRecords.companyId, seeded.companyId)),
    ).toHaveLength(1);
  });

  it("corroborates an equivalent claim by attaching only novel evidence", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const text = "Acme procurement owner is Anna.";
    const first = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: text,
        summary: null,
        evidence: [{ ...evidence(text)[0]!, sourceRef: "issue://first" }],
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    const corroborated = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: text,
        summary: null,
        evidence: [{ ...evidence(text)[0]!, sourceRef: "issue://second" }],
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(corroborated.resolution).toMatchObject({
      kind: "corroboration",
      targetRecordId: first.record.id,
      novelEvidenceCount: 1,
    });
    expect(corroborated.record.id).toBe(first.record.id);
    expect(corroborated.record.verificationState).toBe(
      first.record.verificationState,
    );
    expect(corroborated.evidence).toHaveLength(2);

    const replay = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: text,
        summary: null,
        evidence: [{ ...evidence(text)[0]!, sourceRef: "issue://second" }],
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(replay.resolution.kind).toBe("duplicate");
    expect(replay.evidence).toHaveLength(2);
  });

  it("creates a pending temporal update and supersedes only after acceptance", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const originalCandidate = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: "Acme procurement owner is Anna.",
        summary: null,
        validFrom: "2026-01-01T00:00:00.000Z",
        observedAt: "2026-01-01T00:00:00.000Z",
        evidence: evidence("Acme procurement owner is Anna."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    const original = await svc.reviewCandidate(
      seeded.companyId,
      originalCandidate.record.id,
      { decision: "accept" },
      userActor(seeded.userId),
    );

    const update = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: "Acme procurement owner is Peter.",
        summary: null,
        validFrom: "2026-09-01T00:00:00.000Z",
        observedAt: "2026-09-01T00:00:00.000Z",
        evidence: evidence("Acme procurement owner is Peter."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(update.resolution).toMatchObject({
      kind: "update",
      targetRecordId: original.record.id,
    });
    expect(update.record).toMatchObject({
      reviewState: "pending",
      supersedesRecordId: original.record.id,
    });

    const beforeAccept = await svc.get(
      seeded.companyId,
      original.record.id,
      userActor(seeded.userId),
    );
    expect(beforeAccept?.record).toMatchObject({
      retentionState: "active",
      supersededByRecordId: null,
    });

    const accepted = await svc.reviewCandidate(
      seeded.companyId,
      update.record.id,
      { decision: "accept" },
      userActor(seeded.userId),
    );
    const superseded = await svc.get(
      seeded.companyId,
      original.record.id,
      userActor(seeded.userId),
    );

    expect(accepted.record.reviewState).toBe("accepted");
    expect(superseded?.record).toMatchObject({
      retentionState: "superseded",
      supersededByRecordId: update.record.id,
    });
  });

  it("keeps overlapping single-value claims pending as contradictions", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const originalCandidate = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: "Acme procurement owner is Anna.",
        summary: null,
        evidence: evidence("Acme procurement owner is Anna."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    const original = await svc.reviewCandidate(
      seeded.companyId,
      originalCandidate.record.id,
      { decision: "accept" },
      userActor(seeded.userId),
    );

    const contradiction = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        memoryType: "fact",
        title: "Procurement owner",
        content: "Acme procurement owner is Peter.",
        summary: null,
        evidence: evidence("Acme procurement owner is Peter."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(contradiction.resolution).toMatchObject({
      kind: "contradiction",
      targetRecordId: original.record.id,
      reasonCode: "overlapping_single_value_claim",
    });
    expect(contradiction.record).toMatchObject({
      reviewState: "pending",
      supersedesRecordId: original.record.id,
    });
    const stillCurrent = await svc.get(
      seeded.companyId,
      original.record.id,
      userActor(seeded.userId),
    );
    expect(stillCurrent?.record).toMatchObject({
      retentionState: "active",
      supersededByRecordId: null,
    });
  });

  it("does not force additive lessons into single-value contradiction semantics", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const first = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        title: "Procurement lesson",
        content: "Security review reduces procurement delays.",
        evidence: evidence("Security review reduces procurement delays."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    const second = await svc.createCandidate(
      seeded.companyId,
      candidate(b.id, {
        title: "Procurement lesson",
        content: "Legal review should start after security review.",
        evidence: evidence("Legal review should start after security review."),
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    expect(first.resolution.kind).toBe("new");
    expect(second.resolution.kind).toBe("new");
    expect(second.record.supersedesRecordId).toBeNull();
    expect(
      await db
        .select()
        .from(memoryRecords)
        .where(eq(memoryRecords.companyId, seeded.companyId)),
    ).toHaveLength(2);
  });

  it("serializes concurrent equivalent claims into one record", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const input = candidate(b.id, {
      memoryType: "fact",
      title: "Procurement owner",
      content: "Acme procurement owner is Anna.",
      summary: null,
      evidence: evidence("Acme procurement owner is Anna."),
    });

    const outcomes = await Promise.all([
      svc.createCandidate(
        seeded.companyId,
        input,
        agentActor(seeded.agent.id, seeded.userId),
      ),
      svc.createCandidate(
        seeded.companyId,
        input,
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ]);

    expect(outcomes.map((outcome) => outcome.resolution.kind).sort()).toEqual([
      "duplicate",
      "new",
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.record.id)).size).toBe(1);
    expect(
      await db
        .select()
        .from(memoryRecords)
        .where(eq(memoryRecords.companyId, seeded.companyId)),
    ).toHaveLength(1);
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

  it("keeps special metadata keys in private-memory idempotency fingerprints", async () => {
    const seeded = await seed();
    const agentBinding = await privateBinding(
      seeded.companyId,
      seeded.userId,
      seeded.agent.id,
    );
    const svc = memoryService(db);
    const firstMetadata = JSON.parse('{"__proto__":{"version":"one"}}') as Record<string, unknown>;
    const secondMetadata = JSON.parse('{"__proto__":{"version":"two"}}') as Record<string, unknown>;

    const first = await svc.createPrivateMemory(
      seeded.companyId,
      seeded.agent.id,
      privateInput(agentBinding.id, {
        createdByOperationId: "private-special-key-op",
        metadata: firstMetadata,
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(first.record.id).toEqual(expect.any(String));

    await expect(
      svc.createPrivateMemory(
        seeded.companyId,
        seeded.agent.id,
        privateInput(agentBinding.id, {
          createdByOperationId: "private-special-key-op",
          metadata: secondMetadata,
        }),
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "memory_operation_conflict" }),
    });
  });

  it("serializes generic candidate writers on the same operation id", async () => {
    const seeded = await seed();
    const b = await binding(seeded.companyId, seeded.userId);
    const svc = memoryService(db);
    const input = candidate(b.id, {
      createdByOperationId: "generic-memory-operation",
    });

    const outcomes = await Promise.allSettled([
      svc.createCandidate(
        seeded.companyId,
        input,
        agentActor(seeded.agent.id, seeded.userId),
      ),
      svc.createCandidate(
        seeded.companyId,
        input,
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "memory_operation_conflict" }),
    });
    expect(
      await db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.companyId, seeded.companyId),
            eq(memoryRecords.createdByOperationId, "generic-memory-operation"),
          ),
        ),
    ).toHaveLength(1);
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

  it("corrects private memory atomically without entering shared review", async () => {
    const seeded = await seed();
    const agentBinding = await privateBinding(
      seeded.companyId,
      seeded.userId,
      seeded.agent.id,
    );
    const svc = memoryService(db);
    const original = await svc.createPrivateMemory(
      seeded.companyId,
      seeded.agent.id,
      privateInput(agentBinding.id, {
        memoryType: "preference",
        title: "Status style",
        content: "Prefer concise status updates.",
        summary: null,
        evidence: evidence("Prefer concise status updates."),
        createdByOperationId: "private-correction-source",
      }),
      agentActor(seeded.agent.id, seeded.userId),
    );

    const correctionInput = {
      memoryType: "preference",
      subject: null,
      title: "Status style",
      content: "Prefer concise updates with explicit blockers.",
      summary: null,
      sensitivity: "internal",
      importance: 70,
      confidenceScore: 0.9,
      validFrom: null,
      validUntil: null,
      observedAt: "2026-09-29T13:00:00.000Z",
      retentionPolicy: "standard",
      expiresAt: null,
      createdByOperationId: "private-correction-1",
      metadata: {},
      evidence: evidence("Prefer concise updates with explicit blockers."),
      reason: "Preference became more specific",
    };

    const corrected = await svc.correctPrivateMemory(
      seeded.companyId,
      original.record.id,
      correctionInput,
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(corrected.record).toMatchObject({
      scopeType: "agent",
      ownerAgentId: seeded.agent.id,
      reviewState: "accepted",
      verificationState: "unverified",
      supersedesRecordId: original.record.id,
      content: "Prefer concise updates with explicit blockers.",
    });

    const prior = await svc.get(
      seeded.companyId,
      original.record.id,
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(prior?.record).toMatchObject({
      supersededByRecordId: corrected.record.id,
      retentionState: "superseded",
    });
    expect(
      await svc.listEligible(
        seeded.companyId,
        { scopeType: "agent", scopeId: seeded.agent.id },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).toEqual([expect.objectContaining({ id: corrected.record.id })]);

    const replay = await svc.correctPrivateMemory(
      seeded.companyId,
      original.record.id,
      correctionInput,
      agentActor(seeded.agent.id, seeded.userId),
    );
    expect(replay.record.id).toBe(corrected.record.id);

    await expect(
      svc.correctPrivateMemory(
        seeded.companyId,
        original.record.id,
        { ...correctionInput, content: "Different correction" },
        agentActor(seeded.agent.id, seeded.userId),
      ),
    ).rejects.toMatchObject({
      status: 409,
      details: expect.objectContaining({ code: "memory_operation_conflict" }),
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
    // Activity history, project, membership, and agent identity are separate
    // lifecycle owners and are not part of the Memory-owned cascade being
    // verified here.
    await db.delete(activityLog).where(eq(activityLog.companyId, seeded.companyId));
    await db.delete(projects).where(eq(projects.companyId, seeded.companyId));
    await db.delete(companyMemberships).where(eq(companyMemberships.companyId, seeded.companyId));
    await db.delete(agents).where(eq(agents.companyId, seeded.companyId));
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
