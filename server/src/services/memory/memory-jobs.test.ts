import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
  memoryJobs,
  memoryRecords,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { instanceSettingsService } from "../instance-settings.js";
import { memoryService } from "./memory-service.js";
import { memoryJobService } from "./memory-jobs.js";

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
  rationale: "Durable customer-process learning for future renewals.",
};

describePg("Memory jobs", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-jobs-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(memoryJobs);
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

  async function seedCaptureRun() {
    const companyId = randomUUID();
    const userId = `user-${companyId}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Memory Job Co",
      issuePrefix: `J${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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
      name: "Memory Job Agent",
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
      name: "Memory Job Project",
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

    await instanceSettingsService(db).updateExperimental({
      enableCollectiveMemoryV1: true,
      enablePrivateAgentMemoryV1: true,
      enableMemoryPostRunExtractionV1: true,
    });

    const now = new Date("2026-09-30T15:00:00.000Z");
    const [run] = await db.insert(heartbeatRuns).values({
      companyId,
      agentId: agent!.id,
      status: "succeeded",
      responsibleUserId: userId,
      startedAt: new Date(now.getTime() - 60_000),
      finishedAt: now,
      contextSnapshot: {
        issueId: issue!.id,
        taskId: issue!.id,
        projectId: project!.id,
      },
      resultJson: {
        acceptedResult: {
          schema: "paperclip.run_result.v1",
          reportedWorkDisposition: "done",
          summary: "Completed renewal work.",
          completionClaim: {
            contractRevision: "1",
            objectiveSatisfied: true,
            criteria: [],
            remainingWork: [],
          },
          evidence: [{ ref: "task" }],
          verification: [],
          attentionRequests: [],
          artifacts: [],
          memoryCandidates: [BASE_CANDIDATE],
        },
      },
    }).returning();

    return {
      companyId,
      userId,
      agent: agent!,
      issue: issue!,
      run: run!,
      binding,
    };
  }

  it("enqueues one idempotent capture attempt per successful run", async () => {
    const seeded = await seedCaptureRun();
    const svc = memoryJobService(db, { ownerId: "worker-a" });

    const first = await svc.enqueuePostRunCapture(seeded.run);
    const replay = await svc.enqueuePostRunCapture(seeded.run);

    expect(first?.id).toBeTruthy();
    expect(replay?.id).toBe(first?.id);
    const jobs = await db.select().from(memoryJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      companyId: seeded.companyId,
      operationType: "capture",
      status: "queued",
      attemptNumber: 1,
      sourceHeartbeatRunId: seeded.run.id,
    });
  });

  it("rejects cross-company source provenance at the database boundary", async () => {
    const alpha = await seedCaptureRun();
    const beta = await seedCaptureRun();

    await expect(
      db.insert(memoryJobs).values({
        companyId: alpha.companyId,
        operationType: "capture",
        status: "queued",
        jobKey: `cross-company:${randomUUID()}`,
        attemptNumber: 1,
        sourceHeartbeatRunId: beta.run.id,
        sourceRefJson: { kind: "heartbeat_run", runId: beta.run.id },
      }),
    ).rejects.toBeTruthy();

    expect(
      await db
        .select()
        .from(memoryJobs)
        .where(eq(memoryJobs.companyId, alpha.companyId)),
    ).toHaveLength(0);
  });

  it("rejects malformed retry lineage and invalid lease state at the database boundary", async () => {
    const seeded = await seedCaptureRun();

    await expect(
      db.insert(memoryJobs).values({
        companyId: seeded.companyId,
        operationType: "capture",
        status: "queued",
        jobKey: `invalid-retry:${randomUUID()}`,
        attemptNumber: 2,
        retryOfJobId: null,
        sourceHeartbeatRunId: seeded.run.id,
        sourceRefJson: { kind: "heartbeat_run", runId: seeded.run.id },
      }),
    ).rejects.toBeTruthy();

    await expect(
      db.insert(memoryJobs).values({
        companyId: seeded.companyId,
        operationType: "capture",
        status: "running",
        jobKey: `invalid-running-lease:${randomUUID()}`,
        attemptNumber: 1,
        executionOwnerId: null,
        leaseExpiresAt: null,
        sourceHeartbeatRunId: seeded.run.id,
        sourceRefJson: { kind: "heartbeat_run", runId: seeded.run.id },
      }),
    ).rejects.toBeTruthy();

    await expect(
      db.insert(memoryJobs).values({
        companyId: seeded.companyId,
        operationType: "capture",
        status: "queued",
        jobKey: `invalid-queued-lease:${randomUUID()}`,
        attemptNumber: 1,
        executionOwnerId: "unexpected-owner",
        leaseExpiresAt: new Date("2026-09-30T15:05:00.000Z"),
        sourceHeartbeatRunId: seeded.run.id,
        sourceRefJson: { kind: "heartbeat_run", runId: seeded.run.id },
      }),
    ).rejects.toBeTruthy();

    expect(await db.select().from(memoryJobs)).toHaveLength(0);
  });

  it("records disabled capture admission so later enable cannot retroactively backfill it", async () => {
    const seeded = await seedCaptureRun();
    await instanceSettingsService(db).updateExperimental({
      enableMemoryPostRunExtractionV1: false,
    });
    const svc = memoryJobService(db, { ownerId: "disabled-admission-worker" });

    const firstTick = await svc.tick({
      now: new Date("2026-09-30T15:01:00.000Z"),
      limit: 10,
    });

    expect(firstTick.backfilled).toBe(0);
    expect(firstTick.processed).toBe(0);
    const [admission] = await db.select().from(memoryJobs);
    expect(admission).toMatchObject({
      companyId: seeded.companyId,
      operationType: "capture",
      status: "cancelled",
      attemptNumber: 1,
      sourceHeartbeatRunId: seeded.run.id,
      errorCode: "feature_disabled_at_admission",
      sourceRefJson: expect.objectContaining({
        runId: seeded.run.id,
        extractionEnabledAtAdmission: false,
      }),
    });
    expect(admission!.finishedAt).toBeTruthy();
    expect(await db.select().from(memoryRecords)).toHaveLength(0);

    await instanceSettingsService(db).updateExperimental({
      enableMemoryPostRunExtractionV1: true,
    });
    const afterEnable = await svc.tick({
      now: new Date("2026-09-30T15:02:00.000Z"),
      limit: 10,
    });

    expect(afterEnable.backfilled).toBe(0);
    expect(afterEnable.processed).toBe(0);
    expect(await db.select().from(memoryJobs)).toHaveLength(1);
    expect(await db.select().from(memoryRecords)).toHaveLength(0);
  });

  it("allows only one worker to claim one queued attempt", async () => {
    const seeded = await seedCaptureRun();
    const enqueueSvc = memoryJobService(db, { ownerId: "enqueue-worker" });
    await enqueueSvc.enqueuePostRunCapture(seeded.run);

    const workerA = memoryJobService(db, { ownerId: "worker-a" });
    const workerB = memoryJobService(db, { ownerId: "worker-b" });
    const claims = await Promise.all([
      workerA.claimNext(new Date("2026-09-30T15:01:00.000Z")),
      workerB.claimNext(new Date("2026-09-30T15:01:00.000Z")),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
  });

  it("executes queued capture through the existing governed extraction service", async () => {
    const seeded = await seedCaptureRun();
    const svc = memoryJobService(db, { ownerId: "capture-worker" });
    await svc.enqueuePostRunCapture(seeded.run);

    const result = await svc.tick({
      now: new Date("2026-09-30T15:02:00.000Z"),
      limit: 10,
    });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    const [job] = await db.select().from(memoryJobs);
    expect(job).toMatchObject({
      operationType: "capture",
      status: "succeeded",
      sourceHeartbeatRunId: seeded.run.id,
      errorCode: null,
    });
    expect(job!.finishedAt).toBeTruthy();

    const records = await db.select().from(memoryRecords);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      reviewState: "pending",
      content: BASE_CANDIDATE.content,
    });
  });

  it("recovers an expired lease into immutable failed history and a new retry attempt", async () => {
    const seeded = await seedCaptureRun();
    const svc = memoryJobService(db, {
      ownerId: "recovery-worker",
      leaseMs: 1_000,
      maxAttempts: 3,
    });
    const queued = await svc.enqueuePostRunCapture(seeded.run);
    expect(queued).toBeTruthy();
    const claimed = await svc.claimNext(
      new Date("2026-09-30T15:01:00.000Z"),
    );
    expect(claimed?.status).toBe("running");

    const recovered = await svc.recoverExpiredLeases(
      new Date("2026-09-30T15:01:02.000Z"),
    );

    expect(recovered).toEqual({ recovered: 1, retried: 1 });
    const jobs = await db
      .select()
      .from(memoryJobs)
      .orderBy(memoryJobs.attemptNumber);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: claimed!.id,
      status: "failed",
      attemptNumber: 1,
      errorCode: "worker_lost",
    });
    expect(jobs[1]).toMatchObject({
      status: "queued",
      attemptNumber: 2,
      retryOfJobId: claimed!.id,
      sourceHeartbeatRunId: seeded.run.id,
    });
    expect(jobs[0]!.finishedAt).toBeTruthy();
  });

  it("backfills a missed post-run enqueue and processes it on the scheduler tick", async () => {
    const seeded = await seedCaptureRun();
    const svc = memoryJobService(db, { ownerId: "backstop-worker" });

    expect(await db.select().from(memoryJobs)).toHaveLength(0);
    const result = await svc.tick({
      now: new Date("2026-09-30T15:03:00.000Z"),
      limit: 10,
    });

    expect(result.backfilled).toBe(1);
    const jobs = await db.select().from(memoryJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      operationType: "capture",
      status: "succeeded",
      sourceHeartbeatRunId: seeded.run.id,
    });
    expect(await db.select().from(memoryRecords)).toHaveLength(1);
  });

  it("honors the Memory kill switch at retention execution time", async () => {
    const seeded = await seedCaptureRun();
    const now = new Date("2026-09-30T16:00:00.000Z");
    const [record] = await db.insert(memoryRecords).values({
      companyId: seeded.companyId,
      bindingId: seeded.binding.id,
      providerKey: "local",
      memoryType: "lesson",
      scopeType: "company",
      scopeId: null,
      ownerAgentId: null,
      title: "Kill-switch protected",
      content: "This due record must not mutate after Memory is disabled.",
      reviewState: "accepted",
      verificationState: "human_verified",
      sensitivityLabel: "internal",
      observedAt: new Date("2026-09-30T14:00:00.000Z"),
      expiresAt: new Date("2026-09-30T15:30:00.000Z"),
      createdByActorType: "system",
      createdByActorId: "memory-job-test",
      metadata: {},
    }).returning();

    const svc = memoryJobService(db, { ownerId: "kill-switch-worker" });
    expect(await svc.enqueueDueRetentionJobs(now)).toBe(1);
    await instanceSettingsService(db).updateExperimental({
      enableCollectiveMemoryV1: false,
      enablePrivateAgentMemoryV1: false,
    });

    const claimed = await svc.claimNext(now);
    expect(claimed?.operationType).toBe("retention");
    await svc.executeClaimed(claimed!);

    const stored = await db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.id, record!.id))
      .then((rows) => rows[0]!);
    expect(stored.retentionState).toBe("active");

    const job = await db
      .select()
      .from(memoryJobs)
      .where(eq(memoryJobs.id, claimed!.id))
      .then((rows) => rows[0]!);
    expect(job).toMatchObject({
      status: "succeeded",
      errorCode: null,
    });
    expect(job.resultJson).toMatchObject({
      expiredRecordCount: 0,
      disabled: true,
    });
  });

  it("runs retention maintenance durably and expires only due records", async () => {
    const seeded = await seedCaptureRun();
    const now = new Date("2026-09-30T16:00:00.000Z");
    await db.insert(memoryRecords).values([
      {
        companyId: seeded.companyId,
        bindingId: seeded.binding.id,
        providerKey: "local",
        memoryType: "lesson",
        scopeType: "company",
        scopeId: null,
        ownerAgentId: null,
        title: "Expired",
        content: "Expired durable memory.",
        reviewState: "accepted",
        verificationState: "human_verified",
        sensitivityLabel: "internal",
        observedAt: new Date("2026-09-30T14:00:00.000Z"),
        expiresAt: new Date("2026-09-30T15:30:00.000Z"),
        createdByActorType: "system",
        createdByActorId: "memory-job-test",
        metadata: {},
      },
      {
        companyId: seeded.companyId,
        bindingId: seeded.binding.id,
        providerKey: "local",
        memoryType: "lesson",
        scopeType: "company",
        scopeId: null,
        ownerAgentId: null,
        title: "Current",
        content: "Current durable memory.",
        reviewState: "accepted",
        verificationState: "human_verified",
        sensitivityLabel: "internal",
        observedAt: new Date("2026-09-30T14:00:00.000Z"),
        expiresAt: new Date("2026-10-01T15:30:00.000Z"),
        createdByActorType: "system",
        createdByActorId: "memory-job-test",
        metadata: {},
      },
    ]);

    const svc = memoryJobService(db, { ownerId: "retention-worker" });
    const result = await svc.tick({ now, limit: 10 });

    expect(result.retentionQueued).toBe(1);
    const stored = await db
      .select()
      .from(memoryRecords)
      .orderBy(memoryRecords.title);
    expect(stored.find((row) => row.deletedAt !== null)).toMatchObject({
      retentionState: "expired", content: "", title: null, summary: null, metadata: {},
    });
    expect(stored.find((row) => row.title === "Current")?.retentionState)
      .toBe("active");

    const retentionJobs = (await db.select().from(memoryJobs)).filter(
      (job) => job.operationType === "retention",
    );
    expect(retentionJobs).toHaveLength(1);
    expect(retentionJobs[0]).toMatchObject({
      status: "succeeded",
      companyId: seeded.companyId,
      resultJson: {
        expiredRecordCount: 1,
        asOf: now.toISOString(),
      },
    });
  });
});
