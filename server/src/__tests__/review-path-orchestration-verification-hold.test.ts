import { randomUUID } from "node:crypto";
import { mockedCodexAdapterConfig } from "./helpers/mocked-codex-config.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  companies,
  completionContracts,
  createDb,
  heartbeatRuns,
  issues,
  nativeRunResults,
  orchestrationPlans,
  orchestrationWorkers,
  statusDecisions,
  verificationRuns,
  workAssessments,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0, signal: null, timedOut: false, errorMessage: null,
    summary: "Acknowledged.", provider: "test", model: "test-model",
  })),
);

vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => ({ track: vi.fn() }) }));
vi.mock("@paperclipai/shared/telemetry", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/shared/telemetry")>("@paperclipai/shared/telemetry");
  return { ...actual, trackAgentFirstHeartbeat: vi.fn() };
});
vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return { ...actual, getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute: mockAdapterExecute })) };
});

import { heartbeatService } from "../services/heartbeat.ts";
import { captureOrchestrationVerificationHold } from "../services/recovery/orchestration-verification-hold.ts";
import { installHeartbeatApiUrlFixture, seedHeartbeatResponsibleHuman } from "./helpers/heartbeat-runtime-fixtures.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping embedded Postgres review-path verification hold tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

/** APR-E2E-25. Review-path recovery treats a plan verification hold as a
 * maintained review path; every other lost review path recovers as before. */
describeEmbeddedPostgres("review-path recovery: orchestration verification hold", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let restoreApiUrl: (() => void) | null = null;

  beforeAll(async () => {
    restoreApiUrl = installHeartbeatApiUrlFixture();
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-review-path-verification-hold-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterAll(async () => {
    await heartbeatService(db).drainActiveRunExecutions();
    restoreApiUrl?.();
    await tempDb?.cleanup();
  }, 60_000);

  async function seedReviewTask(hold: "held" | "verified" | "none") {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    const userId = "responsible-user";
    const issuePrefix = `V${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({ id: companyId, name: "Verification Hold Co", issuePrefix,
      defaultResponsibleUserId: userId, requireBoardApprovalForNewAgents: false });
    await seedHeartbeatResponsibleHuman(db, companyId, userId, "owner");
    await db.insert(agents).values({ id: agentId, companyId, name: "Plan Worker", role: "engineer", status: "idle",
      adapterType: "codex_local", adapterConfig: mockedCodexAdapterConfig,
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } }, permissions: {} });
    await db.insert(issues).values({ id: issueId, companyId, title: "Plan-covered Task", status: "in_review",
      priority: "medium", assigneeAgentId: agentId, responsibleUserId: userId, issueNumber: 1,
      identifier: `${issuePrefix}-1`, workMode: "standard" });
    if (hold === "none") return { companyId, agentId, issueId, planId: null };
    const contractId = randomUUID(), sourceRunId = randomUUID(), resultId = randomUUID(), assessmentId = randomUUID();
    await db.insert(completionContracts).values({ id: contractId, companyId, issueId, revision: 1,
      schemaVersion: "paperclip.completion-contract.v1", policyVersion: "hold-v1", risk: "standard",
      completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: { revision: "hold-v1", objective: "Finish", criteria: [{ id: "objective", requirement: "Complete" }] },
      canonicalSha256: `contract-${contractId}`, createdByActorType: "system", createdByActorId: "test" });
    await db.insert(heartbeatRuns).values({ id: sourceRunId, companyId, agentId, status: "succeeded", runtimeMode: "native",
      nativeIssueId: issueId, nativeSessionId: randomUUID(), runnerInstanceId: randomUUID(), completionContractId: contractId,
      completionContractSha256: `contract-${contractId}`, contextSnapshot: { issueId } });
    await db.insert(nativeRunResults).values({ id: resultId, companyId, issueId, runId: sourceRunId, completionContractId: contractId,
      serverFingerprint: `fp-${resultId}`, schemaStatus: "accepted", resultJson: {}, canonicalSha256: `sha-${resultId}` });
    await db.insert(workAssessments).values({ id: assessmentId, companyId, issueId, runId: sourceRunId, contractId, resultId,
      triggerKind: "native_result", triggerActorCompanyId: companyId, priorIssueStatus: "in_progress", priorStatusVersion: 0,
      policyVersion: "hold-v1", assessmentJson: {}, inputDigest: `digest-${assessmentId}` });
    const appliedAt = new Date(Date.now() - 60_000);
    await db.insert(statusDecisions).values({ companyId, issueId, runId: sourceRunId, assessmentId, decisionVersion: 1,
      policyVersion: "hold-v1", fromStatus: "in_progress", toStatus: "in_review", reasonCode: "orchestration_verification_required",
      decisionJson: {}, decisionDigest: `decision-${assessmentId}`, applicationState: "applied", appliedAt, createdAt: appliedAt });
    const planId = randomUUID();
    await db.insert(orchestrationPlans).values({ id: planId, companyId, issueId, completionContractId: contractId,
      mode: "single_worker", actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none", verificationMode: "deterministic",
      humanOversightMode: "human_review", createdBy: userId, budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1,
        maxRetries: 0, maxWallClockSeconds: 3600, maxToolActions: 5, maxModelCostMinor: 1000 } });
    await db.insert(orchestrationWorkers).values({ companyId, planId, issueId, agentId, completionContractId: contractId,
      workerKey: "writer", dependsOn: [], status: "running", attemptCount: 1 });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), version: 2,
      executionPrincipal: { type: "user", userId } }).where(eq(orchestrationPlans.id, planId));
    if (hold === "verified") {
      await db.insert(verificationRuns).values({ companyId, planId, issueId, completionContractId: contractId,
        completionContractHash: `contract-${contractId}`, expectedPlanVersion: 2, resultHash: "a".repeat(64),
        inputArtifactRefs: [], evidenceRefs: [], reviewerType: "human", reviewerId: userId, result: "needs_human",
        failedInvariants: [], uncertainties: [], review: {}, recommendation: "ESCALATE_HUMAN" });
    }
    return { companyId, agentId, issueId, planId };
  }

  async function runFollowUpAndListRecoveryWakes(fixture: { companyId: string; agentId: string; issueId: string }) {
    const heartbeat = heartbeatService(db);
    const run = await heartbeat.wakeup(fixture.agentId, {
      source: "automation", triggerDetail: "system", reason: "issue_commented",
      payload: { issueId: fixture.issueId, interactionId: "consumed-card", reviewPathLost: true, reviewPathConsumedRef: "consumed-card" },
      requestedByActorType: "user", requestedByActorId: "responsible-user",
      contextSnapshot: { issueId: fixture.issueId, taskId: fixture.issueId, wakeReason: "issue_commented",
        interactionId: "consumed-card", reviewPathLost: true, reviewPathConsumedRef: "consumed-card" },
    });
    expect(run).not.toBeNull();
    await heartbeat.drainActiveRunExecutions();
    return db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, fixture.companyId),
      eq(agentWakeupRequests.reason, "issue_review_path_lost")));
  }

  it("does not wake the assignee while the Task is held for its plan's verification", async () => {
    const fixture = await seedReviewTask("held");
    expect(await captureOrchestrationVerificationHold(db, fixture)).toMatchObject({ planId: fixture.planId });
    expect(await runFollowUpAndListRecoveryWakes(fixture)).toHaveLength(0);
  });

  it("recovers as before once the plan's verification for the Task is recorded", async () => {
    const fixture = await seedReviewTask("verified");
    expect(await captureOrchestrationVerificationHold(db, fixture)).toBeNull();
    expect(await runFollowUpAndListRecoveryWakes(fixture)).toHaveLength(1);
  });

  it("recovers as before for an in-review Task without that hold", async () => {
    const fixture = await seedReviewTask("none");
    expect(await captureOrchestrationVerificationHold(db, fixture)).toBeNull();
    expect(await runFollowUpAndListRecoveryWakes(fixture)).toHaveLength(1);
  });
});
