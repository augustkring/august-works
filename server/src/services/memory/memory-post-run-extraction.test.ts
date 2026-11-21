import { compileAuthoredAgentDefinition } from "../agents/authored-definition.js";
import { agentService } from "../agents.js";
import { agentAuthoringContentSchema, AUTHORED_AGENT_DEFINITION_KEY } from "@paperclipai/shared";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  activityLog,
  agents,
  authUsers,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
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
  memoryJobs,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService } from "./memory-service.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory-privacy.js";
import { publishActivity, type ActivityPublication } from "../activity-log.js";
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
    db = createDb(tempDb.connectionString, {maxConnections:3});
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(memoryEvidence);
    await db.delete(memoryRecords);
    await db.delete(memoryBindingTargets);
    await db.delete(memoryBindings);
    await db.delete(memoryJobs);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // This fixture exercises extraction inside an actual leased physical
  // transaction. The native enqueue/claim/settle owner is covered in memory-jobs.test.ts.
  function extraction() {
    return {extract:async(run:typeof heartbeatRuns.$inferSelect)=>{
      const publications:ActivityPublication[]=[];
      const result=await db.transaction(async tx=>{
        await lockAnalyticalCompany(tx,run.companyId);await lockMemoryPrivacy(tx,run.companyId);
        const ownerId=randomUUID();
        const [job]=await tx.insert(memoryJobs).values({companyId:run.companyId,operationType:"capture",status:"running",jobKey:randomUUID(),
          sourceHeartbeatRunId:run.id,executionOwnerId:ownerId,leaseExpiresAt:new Date(Date.now()+300000)}).returning();
        const [identity]=await tx.execute<{backendPid:number;transactionId:string}>(sql`select pg_backend_pid() as "backendPid",pg_current_xact_id()::text as "transactionId"`);
        const output=await memoryPostRunExtractionService(tx,{nativeCaptureReceipt:{jobId:job!.id,executionOwnerId:ownerId,...identity!},postCommitPublications:publications}).extract(run);
        await tx.update(memoryJobs).set({status:"succeeded",executionOwnerId:null,leaseExpiresAt:null,finishedAt:new Date()}).where(eq(memoryJobs.id,job!.id));
        return output;
      });
      publications.forEach(publishActivity);
      return result;
    }};
  }

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
    await db.insert(authUsers).values({id:userId,name:"Actual extraction Human",email:`${userId}@example.test`,createdAt:new Date(),updatedAt:new Date()});
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
      sourceProvenanceQualified: true,
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
      nativeIssueId: issue!.id,
      runtimeMode: "native",
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

  it("keeps an Original readonly authored version from automatically writing organizational Memory", async () => {
    const seeded = await seed();
    const definition = compileAuthoredAgentDefinition(agentAuthoringContentSchema.parse({ name: "Readonly preference consumer",
      ownerUserId: seeded.userId, capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }] }), randomUUID(), "a".repeat(64));
    await agentService(db).update(seeded.agent.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } },
      { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: seeded.userId } });
    expect(await extraction().extract(seeded.run)).toMatchObject({ persisted: 0, skipped: 1,
      skipReasons: { authored_memory_write_denied: 1 } });
    expect(await db.select().from(memoryRecords).where(eq(memoryRecords.companyId, seeded.companyId))).toEqual([]);
  });
  it("does not grant completed producers extraction writes without an actual native transaction receipt",async()=>{
    const seeded=await seed();
    const auditsBefore=await db.select().from(activityLog);
    await expect(memoryPostRunExtractionService(db).extract(seeded.run)).rejects.toMatchObject({status:403});
    expect(await db.select().from(memoryRecords)).toEqual([]);
    expect(await db.select().from(memoryEvidence)).toEqual([]);
    expect(await db.select().from(activityLog)).toEqual(auditsBefore);
  });

  it("creates one evidence-backed pending candidate and replays idempotently", async () => {
    const seeded = await seed();
    const svc = extraction();

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

  it("deduplicates concurrent extraction of the same run", async () => {
    const seeded = await seed();
    const svc = extraction();

    const results = await Promise.all([
      svc.extract(seeded.run),
      svc.extract(seeded.run),
    ]);

    expect(
      results.reduce((sum, result) => sum + result.persisted, 0),
    ).toBe(1);
    expect(
      results.reduce((sum, result) => sum + result.duplicates, 0),
    ).toBe(1);
    expect(
      results.reduce((sum, result) => sum + result.skipped, 0),
    ).toBe(0);
    expect(await db.select().from(memoryRecords)).toHaveLength(1);
    expect(await db.select().from(memoryEvidence)).toHaveLength(1);
  });

  it("does not cross the tenant boundary when a run references another company's task", async () => {
    const seeded = await seed();
    const foreignCompanyId = randomUUID();
    await db.insert(companies).values({
      id: foreignCompanyId,
      name: "Foreign Extraction Co",
      issuePrefix: `F${foreignCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const [foreignIssue] = await db.insert(issues).values({
      companyId: foreignCompanyId,
      title: "Foreign task",
      status: "in_progress",
      priority: "medium",
    }).returning();

    const foreignScopedRun = {
      ...seeded.run,
      nativeIssueId: foreignIssue!.id,
      contextSnapshot: {
        issueId: foreignIssue!.id,
        taskId: foreignIssue!.id,
      },
    };

    const result = await extraction().extract(
      foreignScopedRun,
    );

    expect(result).toMatchObject({
      proposed: 1,
      persisted: 0,
      duplicates: 0,
      skipped: 1,
      skipReasons: { source_task_unavailable: 1 },
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
    expect(await db.select().from(memoryEvidence)).toHaveLength(0);
  });

  it("treats zero candidates as a healthy no-op", async () => {
    const seeded = await seed({ candidates: [] });
    const result = await extraction().extract(seeded.run);

    expect(result).toMatchObject({
      proposed: 0,
      persisted: 0,
      duplicates: 0,
      skipped: 0,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("fails closed and records a safe aggregate when the candidate contract is malformed", async () => {
    const seeded = await seed({
      candidates: [{ ...BASE_CANDIDATE, content: "" }],
    });

    const result = await extraction().extract(seeded.run);

    expect(result).toMatchObject({
      proposed: 0,
      persisted: 0,
      duplicates: 0,
      skipped: 1,
      skipReasons: { candidate_contract_invalid: 1 },
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
    const activities = await db.select().from(activityLog);
    expect(activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "memory.post_run_extracted",
          entityId: seeded.run.id,
          details: expect.objectContaining({
            proposed: 0,
            persisted: 0,
            skipped: 1,
            skipReasons: { candidate_contract_invalid: 1 },
          }),
        }),
      ]),
    );
    expect(JSON.stringify(activities)).not.toContain(BASE_CANDIDATE.content);
  });

  it("does not capture from failed or yielded runs", async () => {
    const failed = await seed({ runStatus: "failed" });
    const failedResult = await extraction().extract(failed.run);
    expect(failedResult.skipReasons).toMatchObject({ run_not_succeeded: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);

    await db.delete(activityLog);
    await db.delete(memoryJobs);
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
    await db.delete(authUsers);

    const yielded = await seed({ disposition: "yielded" });
    const yieldedResult = await extraction().extract(yielded.run);
    expect(yieldedResult.skipReasons).toMatchObject({ semantic_result_yielded: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("does not fall back to stale completed candidates when the authoritative result yielded", async () => {
    const seeded = await seed();
    await db
      .update(heartbeatRuns)
      .set({
        resultJson: {
          nativeResult: {
            schema: "paperclip.run_result.v1",
            reportedWorkDisposition: "yielded",
            summary: "Waiting for the next response.",
            completionClaim: {
              contractRevision: "2",
              objectiveSatisfied: false,
              criteria: [],
              remainingWork: [
                { description: "Wait for user input.", blocksCompletion: true },
              ],
            },
            evidence: [],
            verification: [],
            attentionRequests: [],
            artifacts: [],
            continuation: {
              kind: "response_wake",
              summary: "Resume after the next response.",
              idempotencyKey: "wait-1",
            },
          },
          acceptedResult: {
            schema: "paperclip.run_result.v1",
            reportedWorkDisposition: "done",
            summary: "Stale completed result.",
            completionClaim: {
              contractRevision: "1",
              objectiveSatisfied: true,
              criteria: [],
              remainingWork: [],
            },
            evidence: [],
            verification: [],
            attentionRequests: [],
            artifacts: [],
            memoryCandidates: [BASE_CANDIDATE],
          },
        },
        updatedAt: new Date("2026-09-30T08:01:00.000Z"),
      })
      .where(eq(heartbeatRuns.id, seeded.run.id));

    const refreshed = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, seeded.run.id))
      .then((rows) => rows[0]!);

    const result = await extraction().extract(refreshed);
    expect(result).toMatchObject({
      proposed: 0,
      persisted: 0,
      skipReasons: { semantic_result_yielded: 1 },
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("persists authorized project and subject scopes through their governed binding targets", async () => {
    const seeded = await seed({
      candidates: [
        {
          ...BASE_CANDIDATE,
          title: "Project renewal playbook",
          content: "This project's renewal flow requires security review before legal review.",
          proposedScopeType: "project",
          proposedScopeId: null,
          rationale: "Durable project-local process learning.",
        },
        {
          ...BASE_CANDIDATE,
          title: "Acme renewal constraint",
          content: "Acme renewals require security review before legal review.",
          proposedScopeType: "subject",
          proposedScopeId: "customer:acme",
          rationale: "Durable customer-specific process constraint.",
        },
      ],
    });
    const [binding] = await db
      .select()
      .from(memoryBindings)
      .where(eq(memoryBindings.companyId, seeded.companyId));
    await memoryService(db).addBindingTarget(
      seeded.companyId,
      binding!.id,
      { targetType: "project", targetId: seeded.project.id },
      { principal: { type: "user", userId: seeded.userId } },
    );

    const result = await extraction().extract(seeded.run);

    expect(result).toMatchObject({
      proposed: 2,
      persisted: 2,
      duplicates: 0,
      skipped: 0,
    });
    const records = await db.select().from(memoryRecords);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "project",
          scopeId: seeded.project.id,
          subjectType: "customer",
          subjectId: "acme",
        }),
        expect.objectContaining({
          scopeType: "subject",
          scopeId: "customer:acme",
          subjectType: "customer",
          subjectId: "acme",
        }),
      ]),
    );
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
        {
          ...BASE_CANDIDATE,
          proposedScopeType: "team",
        },
        {
          ...BASE_CANDIDATE,
          proposedScopeType: "org",
          proposedScopeId: randomUUID(),
        },
        {
          ...BASE_CANDIDATE,
          content: "Authorization: Bearer example-token-12345678",
        },
      ],
    });

    const result = await extraction().extract(seeded.run);
    expect(result).toMatchObject({
      proposed: 7,
      persisted: 0,
      duplicates: 0,
      skipped: 7,
    });
    expect(result.skipReasons).toMatchObject({
      restricted_sensitivity: 1,
      protected_data_detected: 1,
      sensitive_personal_inference: 1,
      evidence_ref_unverified: 1,
      private_scope_requires_explicit_remember: 1,
      scope_unsupported: 1,
      scope_mismatch: 1,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("rejects sensitive personal classifications encoded in subject identifiers", async () => {
    const seeded = await seed({
      candidates: [{
        ...BASE_CANDIDATE,
        content: "This employee profile should be reusable later.",
        subjectType: "employee",
        subjectId: "religion-profile-1",
        proposedScopeType: "subject",
        proposedScopeId: "employee:religion-profile-1",
        rationale: "Retain the employee profile for later tasks.",
      }],
    });

    const result = await extraction().extract(seeded.run);
    expect(result).toMatchObject({
      proposed: 1,
      persisted: 0,
      skipped: 1,
      skipReasons: { sensitive_personal_inference: 1 },
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("does not treat a protected-category token embedded inside another word as a match", async () => {
    const seeded = await seed({
      candidates: [{
        ...BASE_CANDIDATE,
        title: "Trace renewal steps",
        content: "Trace each renewal step so the team can reproduce the process.",
        rationale: "Durable process traceability for future renewals.",
        evidenceRefs: ["task"],
      }],
    });

    const result = await extraction().extract(seeded.run);
    expect(result).toMatchObject({ proposed: 1, persisted: 1, skipped: 0 });
  });

  it("allows technical race and system-health terminology outside personal context", async () => {
    const seeded = await seed({
      candidates: [
        {
          ...BASE_CANDIDATE,
          title: "Race condition mitigation",
          content: "A race condition can duplicate the renewal transition unless the operation is idempotent.",
          subjectType: null,
          subjectId: null,
          rationale: "Durable technical reliability learning for future workflow changes.",
        },
        {
          ...BASE_CANDIDATE,
          title: "System health check",
          content: "The system health check must pass before the renewal workflow resumes.",
          subjectType: null,
          subjectId: null,
          rationale: "Durable operational prerequisite for this workflow class.",
        },
      ],
    });

    const result = await extraction().extract(seeded.run);

    expect(result).toMatchObject({
      proposed: 2,
      persisted: 2,
      duplicates: 0,
      skipped: 0,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(2);
  });

  it("still rejects contextual personal health inference", async () => {
    const seeded = await seed({
      candidates: [{
        ...BASE_CANDIDATE,
        title: "Employee health profile",
        content: "The employee health status should be retained for future planning.",
        subjectType: "employee",
        subjectId: "employee-2",
        proposedScopeType: "subject",
        proposedScopeId: "employee:employee-2",
        rationale: "Reuse the employee health information in later tasks.",
      }],
    });

    const result = await extraction().extract(seeded.run);

    expect(result).toMatchObject({
      proposed: 1,
      persisted: 0,
      duplicates: 0,
      skipped: 1,
      skipReasons: { sensitive_personal_inference: 1 },
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("rejects model-authored evidence and artifact refs that are not server-verified", async () => {
    const seeded = await seed({
      candidates: [
        { ...BASE_CANDIDATE, evidenceRefs: ["task-source", "artifact://renewal"] },
      ],
    });

    const result = await extraction().extract(seeded.run);
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

    const result = await extraction().extract(seeded.run);
    expect(result).toMatchObject({ proposed: 1, persisted: 1, skipped: 0 });
  });

  it("stays off behind its dedicated kill switch and fails closed without a binding", async () => {
    const disabled = await seed({ enableExtraction: false });
    const disabledResult = await extraction().extract(disabled.run);
    expect(disabledResult.skipReasons).toMatchObject({ feature_disabled: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);

    await db.delete(activityLog);
    await db.delete(memoryJobs);
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
    await db.delete(authUsers);

    const noBinding = await seed({ createBinding: false });
    const noBindingResult = await extraction().extract(noBinding.run);
    expect(noBindingResult.skipReasons).toMatchObject({ binding_unavailable: 1 });
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });
});
