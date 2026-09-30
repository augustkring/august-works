import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  issues,
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
import { memoryAgentToolsService } from "./memory-agent-tools.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe : describe.skip;

function evidence(text: string) {
  return [{
    sourceClass: "task" as const,
    sourceProvider: "test",
    sourceType: "issue",
    sourceRef: "issue://seed",
    sourceVersion: "1",
    sourceUpdatedAt: "2026-09-29T12:00:00.000Z",
    observedAt: "2026-09-29T12:00:00.000Z",
    excerptHash: createHash("sha256").update(text).digest("hex"),
    citation: { label: "Seed task" },
    trustLevel: "high" as const,
    relation: "supports" as const,
  }];
}

describePg("Memory agent tools", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-tools-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Memory Tool Co",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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
      name: "Memory Tool Agent",
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
      name: "Current project",
    }).returning();
    const [otherProject] = await db.insert(projects).values({
      companyId,
      name: "Other project",
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId,
      projectId: project!.id,
      title: "Acme renewal",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent!.id,
      responsibleUserId: userId,
    }).returning();
    return {
      companyId,
      userId,
      agent: agent!,
      project: project!,
      otherProject: otherProject!,
      issue: issue!,
      runId: randomUUID(),
    };
  }

  async function binding(
    companyId: string,
    userId: string,
    key: string,
    targetType: "company" | "agent" | "project",
    targetId: string,
  ) {
    const svc = memoryService(db);
    const created = await svc.createBinding(
      companyId,
      {
        key,
        name: key,
        providerKey: "local",
        config: {},
        enabled: true,
      },
      { principal: { type: "user", userId } },
    );
    await svc.addBindingTarget(
      companyId,
      created.id,
      { targetType, targetId },
      { principal: { type: "user", userId } },
    );
    return created;
  }

  function candidate(
    bindingId: string,
    scope: { type: "company" | "project"; id: string | null },
    content: string,
  ) {
    return {
      bindingId,
      memoryType: "lesson",
      scope,
      subject: { type: "customer", id: "acme" },
      ownerAgentId: null,
      title: "Renewal lesson",
      content,
      summary: null,
      sensitivity: "internal",
      importance: 70,
      confidenceScore: 0.8,
      validFrom: null,
      validUntil: null,
      observedAt: "2026-09-29T12:00:00.000Z",
      retentionPolicy: "standard",
      expiresAt: null,
      createdByOperationId: null,
      metadata: {},
      evidence: evidence(content),
    };
  }

  function context(seeded: Awaited<ReturnType<typeof seed>>) {
    return {
      companyId: seeded.companyId,
      agentId: seeded.agent.id,
      runId: seeded.runId,
      issueId: seeded.issue.id,
      projectId: seeded.project.id,
      responsibleUserId: seeded.userId,
      allowShared: true,
      allowPrivate: true,
    };
  }

  it("recalls only company, current-project and owner-private memory", async () => {
    const seeded = await seed();
    const shared = await binding(
      seeded.companyId,
      seeded.userId,
      "shared",
      "company",
      seeded.companyId,
    );
    await memoryService(db).addBindingTarget(
      seeded.companyId,
      shared.id,
      { targetType: "project", targetId: seeded.project.id },
      { principal: { type: "user", userId: seeded.userId } },
    );
    await memoryService(db).addBindingTarget(
      seeded.companyId,
      shared.id,
      { targetType: "project", targetId: seeded.otherProject.id },
      { principal: { type: "user", userId: seeded.userId } },
    );
    const privateBinding = await binding(
      seeded.companyId,
      seeded.userId,
      "private",
      "agent",
      seeded.agent.id,
    );
    const svc = memoryService(db);
    for (const [scope, text] of [
      [{ type: "company" as const, id: null }, "Renewal company memory"],
      [{ type: "project" as const, id: seeded.project.id }, "Renewal current project"],
      [{ type: "project" as const, id: seeded.otherProject.id }, "Renewal other project"],
    ] as const) {
      const pending = await svc.createCandidate(
        seeded.companyId,
        candidate(shared.id, scope, text),
        { principal: { type: "agent", agentId: seeded.agent.id } },
      );
      await svc.reviewCandidate(
        seeded.companyId,
        pending.record.id,
        { decision: "accept" },
        { principal: { type: "user", userId: seeded.userId } },
      );
    }
    await svc.createPrivateMemory(
      seeded.companyId,
      seeded.agent.id,
      {
        bindingId: privateBinding.id,
        memoryType: "lesson",
        subject: { type: "customer", id: "acme" },
        title: "Private renewal",
        content: "Renewal private memory",
        summary: null,
        sensitivity: "internal",
        importance: 70,
        confidenceScore: 0.8,
        validFrom: null,
        validUntil: null,
        observedAt: "2026-09-29T12:00:00.000Z",
        retentionPolicy: "standard",
        expiresAt: null,
        createdByOperationId: "private-seed",
        metadata: {},
        evidence: evidence("Renewal private memory"),
      },
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );

    const result = await memoryAgentToolsService(db).recall(
      context(seeded),
      { query: "renewal", topK: 10, subjects: [] },
    );
    const contents = result.records.map((record) => record.content);
    expect(contents).toContain("Renewal company memory");
    expect(contents).toContain("Renewal current project");
    expect(contents).toContain("Renewal private memory");
    expect(contents).not.toContain("Renewal other project");
  });

  it("creates shared remember requests as pending low-trust task-backed candidates", async () => {
    const seeded = await seed();
    await binding(
      seeded.companyId,
      seeded.userId,
      "shared",
      "company",
      seeded.companyId,
    );
    const result = await memoryAgentToolsService(db).remember(
      context(seeded),
      {
        scope: "company",
        memoryType: "constraint",
        content: "Acme requires SSO before rollout.",
        idempotencyKey: randomUUID(),
      },
    );
    expect(result).toMatchObject({
      status: "pending",
      record: {
        reviewState: "pending",
        scope: { type: "company", id: null },
      },
    });
    const detail = await memoryService(db).get(
      seeded.companyId,
      result.record.id,
      { principal: { type: "agent", agentId: seeded.agent.id } },
    );
    expect(detail?.evidence[0]).toMatchObject({
      sourceClass: "task",
      sourceProvider: "august_works_memory_agent_tool",
      sourceType: "agent_run_observation",
      trustLevel: "low",
    });
  });

  it("makes private remember retry-safe and returns duplicate on semantic replay", async () => {
    const seeded = await seed();
    await binding(
      seeded.companyId,
      seeded.userId,
      "private",
      "agent",
      seeded.agent.id,
    );
    const idempotencyKey = randomUUID();
    const input = {
      scope: "private",
      memoryType: "preference",
      content: "Prefer concise status updates.",
      idempotencyKey,
    };
    const tools = memoryAgentToolsService(db);
    const first = await tools.remember(context(seeded), input);
    const replay = await tools.remember(context(seeded), input);
    expect(first.status).toBe("accepted");
    expect(replay).toMatchObject({
      status: "duplicate",
      record: { id: first.record.id },
    });
  });

  it("corrects owner-private memory atomically and shares it only through pending review", async () => {
    const seeded = await seed();
    await binding(
      seeded.companyId,
      seeded.userId,
      "shared",
      "company",
      seeded.companyId,
    );
    await binding(
      seeded.companyId,
      seeded.userId,
      "private",
      "agent",
      seeded.agent.id,
    );
    const tools = memoryAgentToolsService(db);
    const original = await tools.remember(context(seeded), {
      scope: "private",
      memoryType: "preference",
      content: "Prefer concise updates.",
      idempotencyKey: randomUUID(),
    });
    const corrected = await tools.correct(context(seeded), {
      recordId: original.record.id,
      reason: "Preference became more specific",
      content: "Prefer concise updates with explicit blockers.",
      idempotencyKey: randomUUID(),
    });
    expect(corrected).toMatchObject({
      status: "accepted",
      record: {
        content: "Prefer concise updates with explicit blockers.",
        supersedesRecordId: original.record.id,
      },
    });

    const shared = await tools.share(context(seeded), {
      recordId: corrected.record.id,
      targetScope: "company",
      reason: "Useful for team communication",
      idempotencyKey: randomUUID(),
    });
    expect(shared).toMatchObject({
      status: "pending",
      record: {
        reviewState: "pending",
        scope: { type: "company", id: null },
      },
    });
  });
});
