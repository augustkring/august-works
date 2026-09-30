import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  companyMemberships,
  createDb,
  heartbeatRuns,
  instanceSettings,
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
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService } from "./memory-service.js";
import { memoryPostRunExtractionService } from "./memory-post-run-extraction.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

const BASE_CANDIDATE = {
  memoryType: "lesson" as const,
  title: "Security review first",
  content: "Acme procurement requires a security review before legal review.",
  subjectType: "customer",
  subjectId: "acme",
  proposedScopeType: "org" as const,
  proposedScopeId: null,
  sensitivity: "internal" as const,
  validFrom: null,
  validUntil: null,
  evidenceRefs: ["task"],
  rationale: "Durable customer-process learning that is useful for future renewals.",
};

describePg("Memory post-run extraction", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-post-run-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed(input: {
    candidates?: unknown[];
    disposition?: "done" | "needs_review" | "yielded";
    runStatus?: string;
    enableExtraction?: boolean;
    createBinding?: boolean;
  } = {}) {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Extraction Co",
      issuePrefix: `X${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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
      name: "Extraction Agent",
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
      name: "Extraction Project",
    }).returning();
    const [issue] = await db.insert(issues).values({
      companyId,
      projectId: project!.id,
      title: "Renew Acme",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agent!.id,
      responsibleUserId: userId,
    }).returning();

    if (input.createBinding !== false) {
      const memory = memoryService(db);
      const binding = await memory.createBinding(
        companyId,
        {
          key: "collective-memory",
          name: "Collective memory",
          providerKey: "local",
          config: {},
          enabled: true,
        },
        { principal: { type: "user", userId } },
      );
      await memory.addBindingTarget(
        companyId,
        binding.id,
        { targetType: "company", targetId: companyId },
        { principal: { type: "user", userId } },
      );
    }

    if (input.enableExtraction !== false) {
      await instanceSettingsService(db).updateExperimental({
        enableCollectiveMemoryV1: true,
        enableMemoryPostRunExtractionV1: true,
      });
    }

    const now = new Date("2026-09-30T08:00:00.000Z");
    const [run] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId: agent!.id,
      status: input.runStatus ?? "succeeded",
      responsibleUserId: userId,
      startedAt: new Date(now.getTime() - 60_000),
      finishedAt: input.runStatus === "running" ? null : now,
      contextSnapshot: {
        issueId: issue!.id,
        taskId: issue!.id,
        projectId: project!.id,
      },
      resultJson: {
        acceptedResult: {
          schema: "paperclip.run_result.v1",
          reportedWorkDisposition: input.disposition ?? "done",
          summary: "Completed the renewal work.",
          completionClaim: {
            contractRevision: "1",
            objectiveSatisfied: true,
            criteria: [],
            remainingWork: [],
          },
          evidence: [{ ref: "task-source" }],
          verification: [],
          attentionRequests: [],
          artifacts: [{ kind: "document", ref: "artifact://renewal" }],
          memoryCandidates: input.candidates ?? [BASE_CANDIDATE],
        },
      },
    }).returning();

    return {
      companyId,
      userId,
      agent: agent!,
      project: project!,
      issue: issue!,
      run: run!,
    };
  }

  it("creates one evidence-backed pending candidate and replays idempotently", async () => {
    const seeded = await seed();
    const svc = memoryPostRunExtractionService(db);

    const first = await svc.extract(seeded.run);
    expect(first).toMatchObject({
      proposed: 1,
      persisted: 1,
      duplicates: 0,
      skipped: 0,
    });

    const records = await db.select().from(memoryRecords);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      companyId: seeded.companyId,
      memoryType: "lesson",
      scopeType: "company",
      scopeId: null,
      reviewState: "pending",
      verificationState: "unverified",
      content: BASE_CANDIDATE.content,
    });
    expect(records[0]!.metadata).toMatchObject({
      createdVia: "post_run_extraction",
      sourceRunId: seeded.run.id,
      sourceIssueId: seeded.issue.id,
      sourceCandidateIndex: 0,
      proposedEvidenceRefs: ["task"],
      rationale: BASE_CANDIDATE.rationale,
    });

    const evidenceRows = await db.select().from(memoryEvidence);
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      companyId: seeded.companyId,
      memoryRecordId: records[0]!.id,
      sourceClass: "task",
      sourceProvider: "august_works_post_run_extraction",
      sourceRef: `run://${seeded.run.id}/issue/${seeded.issue.id}`,
      trustLevel: "low",
      supportsOrContradicts: "supports",
      excerptHash: createHash("sha256")
        .update(BASE_CANDIDATE.content)
        .digest("hex"),
    });

    const replay = await svc.extract(seeded.run);
    expect(replay).toMatchObject({
      proposed: 1,
      persisted: 0,
      duplicates: 1,
      skipped: 0,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(1);
  });

  it("treats zero candidates as a healthy no-op", async () => {
    const seeded = await seed({ candidates: [] });
    const result = await memoryPostRunExtractionService(db).extract(seeded.run);

    expect(result).toMatchObject({
      proposed: 0,
      persisted: 0,
      duplicates: 0,
      skipped: 0,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("does not capture from failed or yielded runs", async () => {
    const failed = await seed({ runStatus: "failed" });
    const failedResult = await memoryPostRunExtractionService(db).extract(failed.run);
    expect(failedResult.skipReasons).toMatchObject({ run_not_succeeded: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);

    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);

    const yielded = await seed({ disposition: "yielded" });
    const yieldedResult = await memoryPostRunExtractionService(db).extract(yielded.run);
    expect(yieldedResult.skipReasons).toMatchObject({ semantic_result_yielded: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("fails closed on restricted, sensitive-personal, invented-evidence and private proposals", async () => {
    const seeded = await seed({
      candidates: [
        { ...BASE_CANDIDATE, sensitivity: "restricted" },
        {
          ...BASE_CANDIDATE,
          content: "The employee plans to resign after the renewal.",
          subjectType: "employee",
          subjectId: "employee-1",
        },
        {
          ...BASE_CANDIDATE,
          evidenceRefs: ["invented://evidence"],
        },
        {
          ...BASE_CANDIDATE,
          proposedScopeType: "agent",
        },
      ],
    });

    const result = await memoryPostRunExtractionService(db).extract(seeded.run);
    expect(result).toMatchObject({
      proposed: 4,
      persisted: 0,
      duplicates: 0,
      skipped: 4,
    });
    expect(result.skipReasons).toMatchObject({
      restricted_sensitivity: 1,
      sensitive_personal_inference: 1,
      evidence_ref_unverified: 1,
      private_scope_requires_explicit_remember: 1,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("rejects model-authored evidence and artifact refs that are not server-verified", async () => {
    const seeded = await seed({
      candidates: [
        { ...BASE_CANDIDATE, evidenceRefs: ["task-source", "artifact://renewal"] },
      ],
    });

    const result = await memoryPostRunExtractionService(db).extract(seeded.run);
    expect(result).toMatchObject({
      proposed: 1,
      persisted: 0,
      skipped: 1,
      skipReasons: { evidence_ref_unverified: 1 },
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("accepts the server-verifiable current task evidence ref", async () => {
    const seeded = await seed({
      candidates: [{ ...BASE_CANDIDATE, evidenceRefs: ["task"] }],
    });

    const result = await memoryPostRunExtractionService(db).extract(seeded.run);
    expect(result).toMatchObject({ proposed: 1, persisted: 1, skipped: 0 });
  });

  it("stays off behind its dedicated kill switch and fails closed without a binding", async () => {
    const disabled = await seed({ enableExtraction: false });
    const disabledResult = await memoryPostRunExtractionService(db).extract(disabled.run);
    expect(disabledResult.skipReasons).toMatchObject({ feature_disabled: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);

    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);

    const noBinding = await seed({ createBinding: false });
    const noBindingResult = await memoryPostRunExtractionService(db).extract(noBinding.run);
    expect(noBindingResult.skipReasons).toMatchObject({ binding_unavailable: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });
});
