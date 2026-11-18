import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agentExecutionManifests,
  agentPresenceRuntimeBindings,
  agentProviderBindings,
  agents,
  billingAccountCompanies,
  billingAccounts,
  companies,
  completionContracts,
  contextManifests,
  createDb,
  environmentLeases,
  environments,
  heartbeatRunEvents,
  heartbeatRuns,
  issueThreadInteractions,
  issues,
  nativeRunResults,
  orchestrationPlans,
  orchestrationWorkerAttempts,
  orchestrationWorkers,
  runtimeCapacityProfiles,
  runtimeCells,
  runtimePolicySnapshots,
  runtimeSandboxBindings,
  runtimeVersionCatalog,
  statusDecisions,
  workAssessments,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";

// MS1h2. The managed sandbox owners admit the Task assignee or the current
// Native completion Reviewer of the exact Run. The predicate and the three
// owners below run against real rows; only the gates these owners keep
// unchanged around their owner checks (V7 authorization, run policy and write
// authority, the provider runtime qualification service and capability
// inventory, and the Native source rechecks of the preparation root) are
// replaced, so a test can show where each owner check stops.
vi.mock("../v7-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("../v7-authorization.js")>(),
  assertV7Authorization: async () => undefined,
}));
vi.mock("../../agent-run-cancellation.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../agent-run-cancellation.js")>(),
  assertAgentRunPolicyAllowed: async () => undefined,
  assertAgentRunWriteAllowed: async () => undefined,
}));
vi.mock("../agent-provider-bindings.js", async importOriginal => {
  const original = await importOriginal<typeof import("../agent-provider-bindings.js")>();
  return { ...original, agentProviderBindingService: (db: never) => ({ ...original.agentProviderBindingService(db),
    assertRuntime: async () => undefined }) };
});
vi.mock("../capability-resolver.js", async importOriginal => {
  const original = await importOriginal<typeof import("../capability-resolver.js")>();
  return { ...original, capabilityResolverService: (db: never) => ({ ...original.capabilityResolverService(db),
    search: async () => [] }) };
});
vi.mock("../native-direct-input.js", async importOriginal => ({
  ...await importOriginal<typeof import("../native-direct-input.js")>(),
  assertNativeTaskSourceOwnerCurrent: async () => undefined,
  assertNativeWorkspaceMetadataSourcesCurrent: async () => undefined,
}));

import { currentNativeReviewerRun } from "./native-review-participant.js";
import { createToolGatewayService } from "../tool-gateway.js";
import { executionSandboxService } from "../execution-sandbox/sandbox-service.js";
import { currentWorkerNativePreparationRoot, nativeManagedModelIssuer, nativeModelSessionOwnerLane,
  nativeReviewerModelCredentialExact } from "../runtime/control.js";
import { createRuntimeToolsToken } from "../../runtime-tools-token.js";
import { parseNativeExecutionInput } from "../../vendor/paperclip-runner/index.js";
import { nativeSha256 } from "./canonical.js";
import { instanceSettingsService } from "../instance-settings.js";
import { policyFixture } from "../../__tests__/helpers/sandbox-fixture.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;

describeDb("current Native completion Reviewer sandbox owner (MS1h2)", () => {
  let db!: Db;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("native-reviewer-sandbox-owner-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => { await temporary?.cleanup(); });

  /** An active provider binding and local presence whose profile is not a
   * managed cell, so a Task context that passes every owner returns null. */
  async function presence(companyId: string, agentId: string) {
    // Agent creation already records the presence and its provider binding.
    const [existing] = await db.select().from(agentPresenceRuntimeBindings).where(and(
      eq(agentPresenceRuntimeBindings.companyId, companyId), eq(agentPresenceRuntimeBindings.agentId, agentId)));
    if (!existing) throw new Error("fixture_presence_missing");
    await db.update(agentProviderBindings).set({ status: "active", capabilitySnapshotHash: "9".repeat(64) })
      .where(eq(agentProviderBindings.id, existing.providerBindingId));
    await db.update(agentPresenceRuntimeBindings).set({ status: "active", providerProfileRef: `presence:${agentId}` })
      .where(eq(agentPresenceRuntimeBindings.id, existing.id));
  }
  async function providerPin(companyId: string, agentId: string) {
    const [runtime] = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, agentId));
    return { companyId, agentId, providerBindingId: runtime!.providerBindingId, snapshotHash: "9".repeat(64),
      profileRef: runtime!.providerProfileRef };
  }

  /** The cleanup projection may change only with its original process event
   * in the same transaction (`aw_v10_native_process_cleanup_projection`). */
  async function projectSourceCleanup(companyId: string, agentId: string, runId: string,
    eventType: "native.local_process_stopped" | "native.process_start_requested", seq: number) {
    await db.transaction(async tx => {
      await tx.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq, eventType, payload: {} });
      await tx.update(heartbeatRuns).set({ nativeProcessCleanupPending: eventType === "native.process_start_requested" })
        .where(eq(heartbeatRuns.id, runId));
    });
  }

  /** One Task in review: the executor's committed source Run, its applied
   * decision, the pending native completion review addressed to the Reviewer,
   * and the Reviewer's running Native Run holding the execution lease. The Run
   * source binding and manifests are immutable, so their variants are seeded. */
  async function seed(variant: { reviewerRunIssue?: "other"; manifest?: "none" | "other_human"; reviewIdVersion7?: true;
    decisionIdVersion7?: true } = {}) {
    const interactionId = randomUUID(), decisionId = randomUUID();
    const ids = { company: randomUUID(), otherCompany: randomUUID(), executor: randomUUID(), reviewer: randomUUID(),
      outsider: randomUUID(), issue: randomUUID(), otherIssue: randomUUID(), sourceRun: randomUUID(), reviewerRun: randomUUID(),
      decision: variant.decisionIdVersion7 ? `${decisionId.slice(0, 14)}7${decisionId.slice(15)}` : decisionId,
      // The persisted wake accepts only RFC 4122 versions 1-5 (readNativeReviewAssignmentContext).
      interaction: variant.reviewIdVersion7 ? `${interactionId.slice(0, 14)}7${interactionId.slice(15)}` : interactionId, contract: randomUUID(), result: randomUUID(), assessment: randomUUID(),
      user: `user-${randomUUID()}`, manifest: randomUUID(), contextManifest: randomUUID() };
    const prefix = (id: string) => `R${id.replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    await db.insert(companies).values([
      { id: ids.company, name: "Reviewer owner", issuePrefix: prefix(ids.company) },
      { id: ids.otherCompany, name: "Other company", issuePrefix: prefix(ids.otherCompany) },
    ]);
    await db.insert(agents).values([
      { id: ids.executor, companyId: ids.company, name: "Executor", adapterType: "paperclip_runner", status: "idle" },
      { id: ids.reviewer, companyId: ids.company, name: "Reviewer", adapterType: "paperclip_runner", status: "running" },
      { id: ids.outsider, companyId: ids.company, name: "Outsider", adapterType: "paperclip_runner", status: "running" },
    ]);
    await db.insert(issues).values([
      { id: ids.issue, companyId: ids.company, title: "Reviewed task", status: "in_review", statusVersion: 1,
        lastStatusDecisionId: ids.decision, assigneeAgentId: ids.executor },
      { id: ids.otherIssue, companyId: ids.company, title: "Other task", status: "in_progress", assigneeAgentId: ids.executor },
    ]);
    const reviewContext = { issueId: ids.issue, nativeReviewInteractionId: ids.interaction, nativeReviewDecisionId: ids.decision,
      sourceRunId: ids.sourceRun, revisionId: ids.decision };
    await db.insert(heartbeatRuns).values([
      { id: ids.sourceRun, companyId: ids.company, agentId: ids.executor, status: "succeeded", runtimeMode: "native",
        scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user,
        nativePhase: "committed", createdAt: new Date(Date.now() - 60_000) },
      { id: ids.reviewerRun, companyId: ids.company, agentId: ids.reviewer, status: "running", runtimeMode: "native",
        scopeKind: "issue", issueId: variant.reviewerRunIssue === "other" ? ids.otherIssue : ids.issue,
        nativeIssueId: variant.reviewerRunIssue === "other" ? ids.otherIssue : ids.issue, responsibleUserId: ids.user,
        startedAt: new Date(), contextSnapshot: reviewContext },
    ]);
    await db.update(issues).set({ executionRunId: ids.reviewerRun }).where(eq(issues.id, ids.issue));
    await projectSourceCleanup(ids.company, ids.executor, ids.sourceRun, "native.local_process_stopped", 1);
    await db.insert(completionContracts).values({ id: ids.contract, companyId: ids.company, issueId: ids.issue, revision: 1,
      schemaVersion: "1", policyVersion: "test", risk: "low", completionAuthority: "agent_claim_policy",
      incompleteCriteriaPolicy: "block", contractJson: {}, canonicalSha256: randomUUID(), createdByActorType: "agent",
      createdByActorId: ids.executor });
    await db.update(heartbeatRuns).set({ completionContractId: ids.contract }).where(eq(heartbeatRuns.id, ids.sourceRun));
    await db.insert(nativeRunResults).values({ id: ids.result, companyId: ids.company, issueId: ids.issue, runId: ids.sourceRun,
      completionContractId: ids.contract, serverFingerprint: randomUUID(), schemaStatus: "valid", resultJson: {},
      canonicalSha256: randomUUID() });
    await db.insert(workAssessments).values({ id: ids.assessment, companyId: ids.company, issueId: ids.issue, runId: ids.sourceRun,
      contractId: ids.contract, resultId: ids.result, triggerKind: "test", triggerActorCompanyId: ids.company,
      priorIssueStatus: "in_progress", priorStatusVersion: 0, policyVersion: "test", assessmentJson: {}, inputDigest: randomUUID() });
    await db.insert(statusDecisions).values({ id: ids.decision, companyId: ids.company, issueId: ids.issue, runId: ids.sourceRun,
      assessmentId: ids.assessment, decisionVersion: 1, policyVersion: "test", fromStatus: "in_progress", toStatus: "in_review",
      reasonCode: "completion_review", decisionJson: { projectedStatusVersion: 1 }, decisionDigest: randomUUID(),
      applicationState: "applied" });
    await db.insert(issueThreadInteractions).values({ id: ids.interaction, companyId: ids.company, issueId: ids.issue,
      kind: "request_confirmation", status: "pending", continuationPolicy: "wake_assignee", requestedResolverPolicy: "anyone",
      effectiveResolverPolicy: "anyone", resolverPolicyProvenance: "inherited", sourceRunId: ids.sourceRun,
      addresseeAgentId: ids.reviewer,
      payload: { version: 1, prompt: "Review", target: { type: "custom", key: "native_completion_review", revisionId: ids.decision } } });
    for (const agentId of [ids.executor, ids.reviewer, ids.outsider]) await presence(ids.company, agentId);
    if (variant.manifest === "none") return ids;
    const [reviewerAgent] = await db.select({ identity: agents.agentIdentityId }).from(agents).where(eq(agents.id, ids.reviewer));
    await db.insert(contextManifests).values({ id: ids.contextManifest, companyId: ids.company, runId: ids.reviewerRun,
      agentId: ids.reviewer, issueId: ids.issue, queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) });
    await db.insert(agentExecutionManifests).values({ id: ids.manifest, companyId: ids.company, runId: ids.reviewerRun,
      agentId: ids.reviewer, agentIdentityId: reviewerAgent!.identity, contextManifestId: ids.contextManifest,
      manifest: { responsibleUserId: variant.manifest === "other_human" ? `user-${randomUUID()}` : ids.user,
        capabilities: [], providers: [await providerPin(ids.company, ids.reviewer)], executionScope: { delegatedScopes: [] } } as never,
      policySnapshotHash: "c".repeat(64),
      hash: "d".repeat(64) });
    return ids;
  }
  type Ids = Awaited<ReturnType<typeof seed>>;

  const predicate = (ids: Ids, overrides: Partial<{ companyId: string; agentId: string; runId: string; issueId: string;
    manifestId: string }> = {}) => currentNativeReviewerRun(db as never, { companyId: ids.company, agentId: ids.reviewer,
    runId: ids.reviewerRun, issueId: ids.issue, manifestId: ids.manifest, ...overrides });

  /** MS1h3. The SQL mirror (`aw_v10_current_native_reviewer_run`, migration
   * 0582) that the sandbox policy guard uses, asked about the same Run. */
  const sqlPredicate = async (ids: Ids, overrides: Partial<{ companyId: string; agentId: string; runId: string;
    issueId: string; manifestId: string }> = {}) => {
    const asked = { companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun, issueId: ids.issue, ...overrides };
    const manifestId = overrides.manifestId ?? (await db.select({ id: agentExecutionManifests.id }).from(agentExecutionManifests)
      .where(eq(agentExecutionManifests.runId, asked.runId)))[0]?.id ?? randomUUID();
    const rows = await db.execute(sql`select aw_v10_current_native_reviewer_run(${asked.companyId}::uuid, ${asked.agentId}::uuid,
      ${asked.runId}::uuid, ${asked.issueId}::uuid, ${manifestId}::uuid) as admitted`);
    return (rows as unknown as Array<{ admitted: boolean }>)[0]?.admitted === true;
  };
  /** The TypeScript predicate and its SQL mirror must agree on every case. */
  const both = async (ids: Ids, overrides: Parameters<typeof sqlPredicate>[1] = {}) =>
    ({ ts: await predicate(ids, overrides), sql: await sqlPredicate(ids, overrides) });

  /** A second running Native Run of `agentId` on the same Task, carrying the
   * same persisted review wake, with its own manifest. */
  async function addRun(ids: Ids, agentId: string) {
    const runId = randomUUID(), contextManifestId = randomUUID(), manifestId = randomUUID();
    const [source] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, ids.reviewerRun));
    await db.insert(heartbeatRuns).values({ id: runId, companyId: ids.company, agentId, status: "running", runtimeMode: "native",
      scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user, startedAt: new Date(),
      contextSnapshot: source!.contextSnapshot });
    const [agent] = await db.select({ identity: agents.agentIdentityId }).from(agents).where(eq(agents.id, agentId));
    await db.insert(contextManifests).values({ id: contextManifestId, companyId: ids.company, runId, agentId, issueId: ids.issue,
      queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) });
    await db.insert(agentExecutionManifests).values({ id: manifestId, companyId: ids.company, runId, agentId,
      agentIdentityId: agent!.identity, contextManifestId, manifest: { responsibleUserId: ids.user, capabilities: [],
        providers: [await providerPin(ids.company, agentId)], executionScope: { delegatedScopes: [] } } as never,
      policySnapshotHash: "c".repeat(64), hash: "e".repeat(64) });
    return { runId, manifestId };
  }

  /** The five refusals every changed owner must keep: each returns the Run,
   * Agent and company the owner is asked about after making the case current. */
  const refusalCases: Array<[string, (ids: Ids) => Promise<{ companyId: string; agentId: string; runId: string }>]> = [
    ["an unrelated Agent", async ids => {
      const outsider = await addRun(ids, ids.outsider);
      await db.update(issues).set({ executionRunId: outsider.runId }).where(eq(issues.id, ids.issue));
      return { companyId: ids.company, agentId: ids.outsider, runId: outsider.runId };
    }],
    ["a stale review", async ids => {
      await db.update(issues).set({ statusVersion: 2 }).where(eq(issues.id, ids.issue));
      return { companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun };
    }],
    ["a different Run of the Reviewer", async ids => {
      const other = await addRun(ids, ids.reviewer);
      return { companyId: ids.company, agentId: ids.reviewer, runId: other.runId };
    }],
    ["a resolved review", async ids => {
      await db.update(issueThreadInteractions).set({ status: "accepted", resolvedByAgentId: ids.reviewer,
        resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction));
      return { companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun };
    }],
    ["a different company", async ids => ({ companyId: ids.otherCompany, agentId: ids.reviewer, runId: ids.reviewerRun })],
  ];

  describe("currentNativeReviewerRun", () => {
    it("admits the exact current Reviewer Run and nobody else on the Task", async () => {
      const ids = await seed();
      expect(await both(ids)).toEqual({ ts: true, sql: true });
      // The manifest is optional for callers that do not hold one; when given it must be this Run's.
      await expect(predicate(ids, { manifestId: undefined })).resolves.toBe(true);
      // The assignee is never the Reviewer: owners admit it through the assignee branch only.
      expect(await both(ids, { agentId: ids.executor, runId: ids.sourceRun })).toEqual({ ts: false, sql: false });
    });

    it.each(refusalCases)("refuses %s", async (_name, arrange) => {
      const ids = await seed();
      const asked = await arrange(ids);
      await expect(predicate(ids, { ...asked, manifestId: undefined })).resolves.toBe(false);
      await expect(sqlPredicate(ids, asked)).resolves.toBe(false);
    });

    // Each condition of the predicate, violated alone.
    const conditions: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      // 1. Pending review addressed to this Agent with this acting Run.
      ["the Run has no persisted review wake", ids => db.update(heartbeatRuns).set({ contextSnapshot: { issueId: ids.issue } })
        .where(eq(heartbeatRuns.id, ids.reviewerRun))],
      ["the review is addressed to another Agent", ids => db.update(issueThreadInteractions).set({ addresseeAgentId: ids.outsider })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the review is rejected", ids => db.update(issueThreadInteractions).set({ status: "rejected", resolvedByAgentId: ids.reviewer,
        resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the source decision is no longer the Task's last decision", ids => db.update(issues).set({ lastStatusDecisionId: null })
        .where(eq(issues.id, ids.issue))],
      ["the Reviewer Agent is not invokable", ids => db.update(agents).set({ status: "terminated" }).where(eq(agents.id, ids.reviewer))],
      // 2. Task in review with this Run as its execution Run.
      // A status write bumps statusVersion; restore it so only the status differs.
      ["the Task is no longer in review", async ids => {
        await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, ids.issue));
        await db.update(issues).set({ statusVersion: 1 }).where(eq(issues.id, ids.issue));
      }],
      ["the Task execution lease is released", ids => db.update(issues).set({ executionRunId: null }).where(eq(issues.id, ids.issue))],
      // 3. This Run and its manifest bound to the Reviewer.
      ["the Run is not running", ids => db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, ids.reviewerRun))],
      ["the Run is not Native", ids => db.update(heartbeatRuns).set({ runtimeMode: "legacy" }).where(eq(heartbeatRuns.id, ids.reviewerRun))],
      ["the Run has no responsible Human", ids => db.update(heartbeatRuns).set({ responsibleUserId: null })
        .where(eq(heartbeatRuns.id, ids.reviewerRun))],
      // 4. Source Run committed with cleanup done.
      ["the source Run did not succeed", ids => db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, ids.sourceRun))],
      ["the source Run is not committed", ids => db.update(heartbeatRuns).set({ nativePhase: "observed" })
        .where(eq(heartbeatRuns.id, ids.sourceRun))],
      ["the source Run cleanup is pending", ids =>
        projectSourceCleanup(ids.company, ids.executor, ids.sourceRun, "native.process_start_requested", 2)],
    ];
    it.each(conditions)("refuses when %s", async (_name, violate) => {
      const ids = await seed();
      expect(await both(ids)).toEqual({ ts: true, sql: true });
      await violate(ids);
      expect(await both(ids)).toEqual({ ts: false, sql: false });
    });

    // The review-assignment facts (getNativeReviewAssignment) the SQL mirror
    // re-implements, each violated alone; both forms must refuse.
    const assignmentFacts: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      ["the Reviewer reports to a terminated manager", async ids => {
        const manager = randomUUID();
        await db.insert(agents).values({ id: manager, companyId: ids.company, name: "Former manager", adapterType: "paperclip_runner",
          status: "terminated" });
        await db.update(agents).set({ reportsTo: manager }).where(eq(agents.id, ids.reviewer));
      }],
      ["the Reviewer's reporting chain has a cycle", async ids => {
        const manager = randomUUID();
        await db.insert(agents).values({ id: manager, companyId: ids.company, name: "Cycle manager", adapterType: "paperclip_runner",
          status: "idle", reportsTo: ids.reviewer });
        await db.update(agents).set({ reportsTo: manager }).where(eq(agents.id, ids.reviewer));
      }],
      ["the review is resolvable only by a Human", ids => db.update(issueThreadInteractions)
        .set({ effectiveResolverPolicy: "human_only" }).where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the review also names a Human addressee", ids => db.update(issueThreadInteractions)
        .set({ addresseeUserId: `user-${randomUUID()}` }).where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the review carries a tool action", ids => db.update(issueThreadInteractions).set({ payload: { version: 1, prompt: "Review",
        toolAction: { kind: "fixture" }, target: { type: "custom", key: "native_completion_review", revisionId: ids.decision } } as never })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the review targets another revision", ids => db.update(issueThreadInteractions).set({ payload: { version: 1, prompt: "Review",
        target: { type: "custom", key: "native_completion_review", revisionId: randomUUID() } } as never })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the interaction is not a confirmation request", ids => db.update(issueThreadInteractions).set({ kind: "ask_user_questions" })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the wake names another Task", async ids => {
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, ids.reviewerRun));
        await db.update(heartbeatRuns).set({ contextSnapshot: { ...run!.contextSnapshot, issueId: ids.otherIssue } })
          .where(eq(heartbeatRuns.id, ids.reviewerRun));
      }],
      ["the wake names another source Run", async ids => {
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, ids.reviewerRun));
        await db.update(heartbeatRuns).set({ contextSnapshot: { ...run!.contextSnapshot, sourceRunId: randomUUID() } })
          .where(eq(heartbeatRuns.id, ids.reviewerRun));
      }],
      ["the wake names another revision", async ids => {
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, ids.reviewerRun));
        await db.update(heartbeatRuns).set({ contextSnapshot: { ...run!.contextSnapshot, revisionId: randomUUID() } })
          .where(eq(heartbeatRuns.id, ids.reviewerRun));
      }],
      ["the Reviewer reports to a manager outside its company", async ids => {
        const manager = randomUUID();
        await db.insert(agents).values({ id: manager, companyId: ids.otherCompany, name: "Other company manager",
          adapterType: "paperclip_runner", status: "idle" });
        await db.update(agents).set({ reportsTo: manager }).where(eq(agents.id, ids.reviewer));
      }],
      ["the review carries a secret proposal", ids => db.update(issueThreadInteractions).set({ payload: { version: 1,
        prompt: "Review", secretProposal: { name: "fixture" },
        target: { type: "custom", key: "native_completion_review", revisionId: ids.decision } } as never })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the review target is not a native completion review", ids => db.update(issueThreadInteractions).set({ payload: { version: 1,
        prompt: "Review", target: { type: "custom", key: "plan_review", revisionId: ids.decision } } as never })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the review names another source Run", ids => db.update(issueThreadInteractions).set({ sourceRunId: ids.reviewerRun })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the source decision is not applied", ids => db.update(statusDecisions).set({ applicationState: "proposed" })
        .where(eq(statusDecisions.id, ids.decision))],
      ["the review target is not a custom target", ids => db.update(issueThreadInteractions).set({ payload: { version: 1,
        prompt: "Review", target: { type: "document", key: "native_completion_review", revisionId: ids.decision } } as never })
        .where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the Task is reassigned away from the source Agent", ids => db.update(issues).set({ assigneeAgentId: ids.outsider })
        .where(eq(issues.id, ids.issue))],
    ];

    it("refuses in both forms a review addressed to the source Agent's own Run", async () => {
      const ids = await seed();
      const executorRun = await addRun(ids, ids.executor);
      await db.update(issueThreadInteractions).set({ addresseeAgentId: ids.executor })
        .where(eq(issueThreadInteractions.id, ids.interaction));
      await db.update(issues).set({ executionRunId: executorRun.runId }).where(eq(issues.id, ids.issue));
      expect(await both(ids, { agentId: ids.executor, runId: executorRun.runId, manifestId: executorRun.manifestId }))
        .toEqual({ ts: false, sql: false });
    });

    it("keeps the SQL mirror stricter than JavaScript number coercion of the projected status version", async () => {
      const ids = await seed();
      // The committer writes a number. The TypeScript check coerces with
      // Number(), so it would accept the string "1"; the SQL mirror refuses it.
      const [decision] = await db.select().from(statusDecisions).where(eq(statusDecisions.id, ids.decision));
      await db.update(statusDecisions).set({ decisionJson: { ...decision!.decisionJson, projectedStatusVersion: "1" } })
        .where(eq(statusDecisions.id, ids.decision));
      expect(await both(ids)).toEqual({ ts: true, sql: false });
    });
    it.each(assignmentFacts)("refuses in both forms when %s", async (_name, violate) => {
      const ids = await seed();
      expect(await both(ids)).toEqual({ ts: true, sql: true });
      await violate(ids);
      expect(await both(ids)).toEqual({ ts: false, sql: false });
    });

    it("agrees on the falsy tool action, the legacy agent policy and a wake without optional fields", async () => {
      const ids = await seed();
      // A legacy stored alias the schema type no longer names; it canonicalizes to "anyone".
      await db.update(issueThreadInteractions).set({ effectiveResolverPolicy: "board_or_agents" as never, payload: { version: 1,
        prompt: "Review", toolAction: false, secretProposal: null,
        target: { type: "custom", key: "native_completion_review", revisionId: ids.decision } } as never })
        .where(eq(issueThreadInteractions.id, ids.interaction));
      await db.update(heartbeatRuns).set({ contextSnapshot: { nativeReviewInteractionId: ids.interaction,
        nativeReviewDecisionId: ids.decision } }).where(eq(heartbeatRuns.id, ids.reviewerRun));
      expect(await both(ids)).toEqual({ ts: true, sql: true });
    });

    // Immutable facts: the Run's Task binding, its manifest and the review id, seeded violated.
    it.each([
      ["the Run is bound to another Task", { reviewerRunIssue: "other" as const }],
      ["the Run has no manifest", { manifest: "none" as const }],
      ["the manifest names another Human", { manifest: "other_human" as const }],
      ["the review id is outside the persisted wake's UUID versions", { reviewIdVersion7: true as const }],
      ["the decision id is outside the persisted wake's UUID versions", { decisionIdVersion7: true as const }],
    ])("refuses when %s", async (_name, variant) => {
      const ids = await seed(variant);
      await expect(predicate(ids, { manifestId: undefined })).resolves.toBe(false);
      await expect(sqlPredicate(ids, { manifestId: ids.manifest })).resolves.toBe(false);
    });

    it("refuses another manifest id, another Task id and another Agent id for the same Run", async () => {
      const ids = await seed();
      expect(await both(ids, { manifestId: randomUUID() })).toEqual({ ts: false, sql: false });
      expect(await both(ids, { issueId: ids.otherIssue })).toEqual({ ts: false, sql: false });
      expect(await both(ids, { agentId: ids.outsider })).toEqual({ ts: false, sql: false });
    });
  });

  describe("tool-gateway credential broker owner", () => {
    const binding = { connectionId: randomUUID(), grantVersionHash: "0".repeat(64), hostname: "provider.example.test", port: 443,
      methods: ["POST"] as ["POST"], pathPrefixes: ["/mcp"], binary: "/usr/bin/curl", ttlSeconds: 120 };
    const resolve = (ids: Ids, asked: { companyId: string; agentId: string; runId: string }, bindings: typeof binding[] = []) =>
      createToolGatewayService(db as never).resolveSandboxCredentialBrokerPolicyBindings({ ...asked,
        responsibleUserId: ids.user, presenceId: randomUUID(), bindings });

    it("admits the current Reviewer with zero credential bindings and refuses any binding", async () => {
      const ids = await seed();
      const reviewer = { companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun };
      await expect(resolve(ids, reviewer)).resolves.toEqual({ authorizedConnectionGrantHashes: {}, bindings: [] });
      // No connection lookup or grant resolution happens: the binding never names a real connection.
      await expect(resolve(ids, reviewer, [binding])).rejects.toMatchObject({ status: 403,
        reasonCode: "sandbox_broker_reviewer_credentials_denied" });
    });

    it("keeps the assignee's existing path (zero bindings resolve; a missing connection still refuses)", async () => {
      const ids = await seed();
      const executorRun = await addRun(ids, ids.executor);
      const assignee = { companyId: ids.company, agentId: ids.executor, runId: executorRun.runId };
      await expect(resolve(ids, assignee)).resolves.toEqual({ authorizedConnectionGrantHashes: {}, bindings: [] });
      await expect(resolve(ids, assignee, [binding])).rejects.toMatchObject({ status: 409,
        reasonCode: "sandbox_broker_connection_unavailable" });
    });

    it.each(refusalCases)("refuses %s", async (name, arrange) => {
      const ids = await seed();
      const asked = await arrange(ids);
      // A run outside the asked company is not found at all; every other case reaches the owner check.
      await expect(resolve(ids, asked)).rejects.toMatchObject({ status: 409,
        reasonCode: name === "a different company" ? "sandbox_broker_run_changed" : "sandbox_broker_task_changed" });
    });
  });

  describe("sandbox-service authority and RuntimeControl task context", () => {
    /** An active environment lease for `runId`. A Task context that passes
     * both owner checks then finds no managed cell profile and returns null. */
    async function lease(ids: Ids, runId: string, companyId: string = ids.company) {
      const [environment] = await db.insert(environments).values({ name: `env-${randomUUID()}`,
        driver: "sandbox", config: { provider: "fake" } }).returning();
      const leaseId = randomUUID();
      await db.insert(environmentLeases).values({ id: leaseId, companyId: ids.company, environmentId: environment!.id,
        issueId: ids.issue, heartbeatRunId: runId, provider: "fake", providerLeaseId: `lease-${leaseId}`, status: "active",
        expiresAt: new Date(Date.now() + 60_000), metadata: { remoteCwd: "/work" } });
      return { companyId, runId, leaseId };
    }
    const context = (input: { companyId: string; runId: string; leaseId: string }) => db.transaction(tx =>
      executionSandboxService(tx as never).assertTaskExecutionContext(tx as never, input));
    const ownerRefusal = "Execution Task changed its current owner";

    it("admits the current Reviewer past the authority and Task context owner checks", async () => {
      const ids = await seed();
      await expect(context(await lease(ids, ids.reviewerRun))).resolves.toBeNull();
    });

    it("keeps the assignee's path past both owner checks", async () => {
      const ids = await seed();
      const executorRun = await addRun(ids, ids.executor);
      await db.update(issues).set({ executionRunId: executorRun.runId }).where(eq(issues.id, ids.issue));
      await expect(context(await lease(ids, executorRun.runId))).resolves.toBeNull();
    });

    it("refuses the Reviewer once the review resolves after the lease was issued", async () => {
      const ids = await seed();
      const current = await lease(ids, ids.reviewerRun);
      await expect(context(current)).resolves.toBeNull();
      await db.update(issueThreadInteractions).set({ status: "accepted", resolvedByAgentId: ids.reviewer,
        resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction));
      await expect(context(current)).rejects.toThrow(ownerRefusal);
    });

    it.each(refusalCases)("refuses %s", async (name, arrange) => {
      const ids = await seed();
      const asked = await arrange(ids);
      const current = await lease(ids, asked.runId, asked.companyId);
      if (name === "a different company") {
        // The lease, Run and manifest are company-scoped before the owner check.
        await expect(context(current)).rejects.toThrow("Current native environment lease is required");
        return;
      }
      await expect(context(current)).rejects.toThrow(ownerRefusal);
    });
  });

  describe("RuntimeControl worker preparation root", () => {
    const taskRoot = "/workspace/agents/reviewer";
    /** RuntimeControl's view of one Run after `assertTaskExecutionContext`:
     * the exact immutable Native input, workspace and Task sources, an
     * isolated credentialless policy and the lease. */
    async function source(ids: Ids, asked: { companyId: string; agentId: string; runId: string }) {
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, asked.runId)));
      const [task] = await db.select().from(issues).where(eq(issues.id, ids.issue));
      const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, asked.runId));
      const workspaceId = randomUUID(), sessionId = randomUUID(), contractId = randomUUID();
      const execution = parseNativeExecutionInput({ schema: "paperclip.native-execution-input.v2",
        binding: { companyId: asked.companyId, runId: run!.id, issueId: ids.issue, agentId: run!.agentId,
          executionWorkspaceId: workspaceId },
        task: { identifier: ids.issue, title: "Review", description: null, prompt: "Review the submitted work.", workMode: "standard" },
        workspace: { cwd: taskRoot, repoUrl: null, repoRef: null, branchName: null },
        session: { normalizedSessionId: sessionId, driverKind: "opencode_server", protocolVersion: 1,
          lifecyclePolicy: { mode: "per_turn", idleTimeoutMs: null } },
        provider: { kind: "opencode", model: "anthropic/fixture-model" },
        completionContract: { id: contractId, sha256: "a".repeat(64), schemaVersion: "paperclip.completion-contract.v1",
          contract: { revision: "1", objective: "Review.", criteria: [{ id: "objective", requirement: "Decide." }] } },
        interactionResponses: [], credentialBindings: [], executionMode: "default", planningContext: null });
      const runnerProfileJson = { nativeExecutionInput: execution,
        nativeOpenCodeSourceAuthority: { version: 1, executionInputHash: nativeSha256(execution),
          workspaceMetadataSource: { kind: "workspace_metadata", runId: run!.id, executionWorkspaceId: workspaceId,
            origin: "agent_home", sourceVersion: "1", contentHash: "f".repeat(64) },
          artifactAuthority: { installedPackRoot: "/opt/paperclip/provider-pack" } },
        nativeBootstrapTaskSource: { input: { kind: "task", issueId: ids.issue, sourceVersion: "1", contentHash: "e".repeat(64) } } };
      return {
        run: { ...run!, companyId: asked.companyId, nativeSessionId: sessionId, completionContractId: contractId,
          completionContractSha256: "a".repeat(64), runnerProfileJson },
        manifest: manifest!, source: { task: task!, agent: { adapterType: "paperclip_runner",
          adapterConfig: { provider: "opencode", model: "anthropic/fixture-model" } } },
        lease: { metadata: { remoteCwd: taskRoot } },
        policy: { compilation: { compiledPolicy: { process: { uid: 1000, noNewPrivileges: true, capabilities: [] },
          credentials: { mode: "none", bindings: [] }, filesystem: { readPaths: [taskRoot], writePaths: [taskRoot] } } } },
      } as never;
    }
    const prepare = (input: unknown) => db.transaction(tx =>
      currentWorkerNativePreparationRoot(tx as never, input as never, "native_workspace_prepare"));
    const ownerRefusal = "Worker preparation source, Human, manifest, workspace or lease changed";

    it("admits the current Reviewer's exact Run to its own preparation root", async () => {
      const ids = await seed();
      await expect(prepare(await source(ids, { companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun })))
        .resolves.toBe(taskRoot);
    });

    it("keeps the assignee's preparation root", async () => {
      const ids = await seed();
      const executorRun = await addRun(ids, ids.executor);
      await db.update(issues).set({ executionRunId: executorRun.runId }).where(eq(issues.id, ids.issue));
      await expect(prepare(await source(ids, { companyId: ids.company, agentId: ids.executor, runId: executorRun.runId })))
        .resolves.toBe(taskRoot);
    });

    it.each(refusalCases)("refuses %s", async (_name, arrange) => {
      const ids = await seed();
      const asked = await arrange(ids);
      await expect(prepare(await source(ids, asked))).rejects.toThrow(ownerRefusal);
    });
  });

  // MS1h7. The managed model-session owner lane (session start at dispatch,
  // claim persistence and Host claim; refresh at Host claim): the plan worker
  // attempt, the conformance probe, or the current Native completion Reviewer
  // without a worker attempt row.
  describe("RuntimeControl model-session owner lane (MS1h7)", () => {
    /** RuntimeControl's view of `asked` after `assertTaskExecutionContext`:
     * the persisted Run (and its review wake), its own manifest, no attempt. */
    async function laneSource(ids: Ids, asked: { companyId: string; agentId: string; runId: string }) {
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, asked.runId));
      const [manifest] = await db.select().from(agentExecutionManifests).where(eq(agentExecutionManifests.runId, asked.runId));
      return { run: { ...run!, companyId: asked.companyId }, manifest: manifest!,
        attempt: null as null | { runId: string; status: string }, providerConformanceBootstrap: false,
        source: { task: { id: ids.issue } } };
    }
    const lane = (input: Awaited<ReturnType<typeof laneSource>>) => db.transaction(tx =>
      nativeModelSessionOwnerLane(tx as never, input as never));
    const reviewer = (ids: Ids) => ({ companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun });
    /** A plan worker attempt row for the Reviewer's Run (a plan Worker Run). */
    async function workerAttempt(ids: Ids, status: "running" | "succeeded") {
      const plan = randomUUID(), worker = randomUUID(), attempt = randomUUID();
      await db.insert(orchestrationPlans).values({ id: plan, companyId: ids.company, issueId: ids.issue,
        completionContractId: ids.contract, mode: "single_worker", actionClass: "internal_draft", riskClass: "C0",
        supervisionMode: "none", verificationMode: "deterministic", humanOversightMode: "human_review", createdBy: ids.user,
        budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1, maxRetries: 0, maxWallClockSeconds: 3600,
          maxToolActions: 5, maxModelCostMinor: 1000 } });
      await db.insert(orchestrationWorkers).values({ id: worker, companyId: ids.company, planId: plan, issueId: ids.issue,
        agentId: ids.reviewer, completionContractId: ids.contract, workerKey: "reviewer-worker", dependsOn: [],
        status: status === "running" ? "running" : "completed", attemptCount: 1 });
      await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), version: 2,
        executionPrincipal: { type: "user", userId: ids.user } }).where(eq(orchestrationPlans.id, plan));
      await db.insert(orchestrationWorkerAttempts).values({ id: attempt, companyId: ids.company, planId: plan, workerId: worker,
        agentId: ids.reviewer, runId: ids.reviewerRun, attempt: 1, status, executionManifestId: ids.manifest,
        ...(status === "running" ? {} : { finishedAt: new Date() }) });
      return { id: attempt, plan, worker, runId: ids.reviewerRun, status };
    }

    it("puts the exact current Reviewer without a worker attempt on the reviewer lane", async () => {
      const ids = await seed();
      await expect(lane(await laneSource(ids, reviewer(ids)))).resolves.toBe("reviewer");
    });

    it("keeps a Run with a review wake and a running worker attempt on the worker lane", async () => {
      const ids = await seed();
      const attempt = await workerAttempt(ids, "running");
      await expect(lane({ ...await laneSource(ids, reviewer(ids)), attempt })).resolves.toBe("worker");
      // A worker attempt that is not this Run's running attempt never falls back to the reviewer lane.
      await expect(lane({ ...await laneSource(ids, reviewer(ids)), attempt: { ...attempt, status: "succeeded" } }))
        .resolves.toBeNull();
      await expect(lane({ ...await laneSource(ids, reviewer(ids)), attempt: { ...attempt, runId: ids.sourceRun } }))
        .resolves.toBeNull();
    });

    it("re-reads the worker attempt row in the caller's transaction", async () => {
      const ids = await seed();
      // A stale source snapshot without an attempt: the row, in any state, keeps the Run off the reviewer lane.
      await workerAttempt(ids, "succeeded");
      await expect(lane(await laneSource(ids, reviewer(ids)))).resolves.toBeNull();
    });

    it("keeps the conformance lane unchanged", async () => {
      const ids = await seed();
      await expect(lane({ ...await laneSource(ids, reviewer(ids)), providerConformanceBootstrap: true }))
        .resolves.toBe("conformance");
    });

    it("refuses a Run without a Native review wake in its source", async () => {
      const ids = await seed();
      const current = await laneSource(ids, reviewer(ids));
      // The persisted Run still carries the wake; the lane reads the caller's source Run.
      await expect(lane({ ...current, run: { ...current.run, contextSnapshot: { issueId: ids.issue } } })).resolves.toBeNull();
      // The assignee's own Run without an attempt and without a review wake stays refused.
      const executorRun = await addRun(ids, ids.executor);
      await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: ids.issue } }).where(eq(heartbeatRuns.id, executorRun.runId));
      await db.update(issues).set({ executionRunId: executorRun.runId }).where(eq(issues.id, ids.issue));
      await expect(lane(await laneSource(ids, { companyId: ids.company, agentId: ids.executor, runId: executorRun.runId })))
        .resolves.toBeNull();
    });

    it.each(refusalCases)("refuses %s", async (_name, arrange) => {
      const ids = await seed();
      const asked = await arrange(ids);
      await expect(lane(await laneSource(ids, asked))).resolves.toBeNull();
    });

    // A stale review, each fact changed alone after the Reviewer was admitted.
    const staleReviews: Array<[string, (ids: Ids) => Promise<unknown>]> = [
      ["the Task is no longer in review", async ids => {
        await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, ids.issue));
        await db.update(issues).set({ statusVersion: 1 }).where(eq(issues.id, ids.issue));
      }],
      ["the Task execution Run changed", async ids => {
        const other = await addRun(ids, ids.reviewer);
        await db.update(issues).set({ executionRunId: other.runId }).where(eq(issues.id, ids.issue));
      }],
      ["the review resolved", ids => db.update(issueThreadInteractions).set({ status: "accepted", resolvedByAgentId: ids.reviewer,
        resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction))],
      ["the source Run cleanup is pending again", ids =>
        projectSourceCleanup(ids.company, ids.executor, ids.sourceRun, "native.process_start_requested", 2)],
    ];
    it.each(staleReviews)("refuses the Reviewer once %s", async (_name, change) => {
      const ids = await seed();
      const current = await laneSource(ids, reviewer(ids));
      await expect(lane(current)).resolves.toBe("reviewer");
      await change(ids);
      // The same source snapshot, read again on a new transaction.
      await expect(lane(current)).resolves.toBeNull();
    });

    it("refuses another manifest for the Reviewer's Run", async () => {
      const ids = await seed();
      const current = await laneSource(ids, reviewer(ids));
      await expect(lane({ ...current, manifest: { ...current.manifest, id: randomUUID() } })).resolves.toBeNull();
    });

    describe("Reviewer model capability on the reviewer lane", () => {
      const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
      beforeAll(() => { process.env.PAPERCLIP_AGENT_JWT_SECRET = `ms1h7-${randomUUID()}`; });
      afterAll(() => {
        if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
        else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
      });
      const reviewBinding = (ids: Ids, overrides: Partial<{ reviewerAgentId: string; reviewerRunId: string;
        executionManifestId: string }> = {}) => ({ planId: randomUUID(), issueId: ids.issue, interactionId: ids.interaction,
        decisionId: ids.decision, sourceRunId: ids.sourceRun, sourceWorkerId: randomUUID(), sourceAgentId: ids.executor,
        sourceAttemptId: randomUUID(), sourceResultId: ids.result, sourceReceiptDigest: "a".repeat(64),
        sourceResultCanonicalSha256: "b".repeat(64), reviewerAgentId: ids.reviewer, reviewerRunId: ids.reviewerRun,
        executionManifestId: ids.manifest, expectedPlanVersion: 2, ...overrides });
      const reviewToken = (ids: Ids, overrides: Partial<{ companyId: string; agentId: string; runId: string;
        responsibleUserId: string; executionManifestId: string }> = {}) => {
        const agentId = overrides.agentId ?? ids.reviewer, runId = overrides.runId ?? ids.reviewerRun;
        const minted = createRuntimeToolsToken({ agentId, companyId: overrides.companyId ?? ids.company, runId,
          responsibleUserId: overrides.responsibleUserId ?? ids.user, scope: "review_model",
          reviewModelBinding: reviewBinding(ids, { reviewerAgentId: agentId, reviewerRunId: runId,
            ...(overrides.executionManifestId ? { executionManifestId: overrides.executionManifestId } : {}) }) });
        if (!minted) throw new Error("fixture_review_token_unavailable");
        return { capabilityToken: minted.token };
      };
      const workerToken = (ids: Ids) => {
        const minted = createRuntimeToolsToken({ agentId: ids.reviewer, companyId: ids.company, runId: ids.reviewerRun,
          responsibleUserId: ids.user, scope: "worker_model", workerModelBinding: { planId: randomUUID(), workerId: randomUUID(),
            workerAttemptId: randomUUID(), executionManifestId: ids.manifest, expectedPlanVersion: 2 } });
        if (!minted) throw new Error("fixture_worker_token_unavailable");
        return { capabilityToken: minted.token };
      };
      const conversationToken = (ids: Ids) => {
        const minted = createRuntimeToolsToken({ agentId: ids.reviewer, companyId: ids.company, runId: ids.reviewerRun,
          responsibleUserId: ids.user, scope: "conversation_model", conversationModelBinding: { issueId: ids.issue,
            conversationSessionGeneration: 0, executionManifestId: ids.manifest, executionManifestHash: "d".repeat(64) } });
        if (!minted) throw new Error("fixture_conversation_token_unavailable");
        return { capabilityToken: minted.token };
      };

      it("admits only the Reviewer's own review_model capability", async () => {
        const ids = await seed();
        const current = await laneSource(ids, reviewer(ids));
        expect(nativeReviewerModelCredentialExact(current, reviewToken(ids))).toBe(true);
        expect(nativeReviewerModelCredentialExact(current, undefined)).toBe(false);
        expect(nativeReviewerModelCredentialExact(current, workerToken(ids))).toBe(false);
        expect(nativeReviewerModelCredentialExact(current, conversationToken(ids))).toBe(false);
      });

      it.each([
        ["another company", (ids: Ids) => ({ companyId: ids.otherCompany })],
        ["another Agent", (ids: Ids) => ({ agentId: ids.outsider })],
        ["another Run", () => ({ runId: randomUUID() })],
        ["another Human", () => ({ responsibleUserId: `user-${randomUUID()}` })],
        ["another manifest", () => ({ executionManifestId: randomUUID() })],
      ])("refuses a review_model capability for %s", async (_name, change) => {
        const ids = await seed();
        const current = await laneSource(ids, reviewer(ids));
        expect(nativeReviewerModelCredentialExact(current, reviewToken(ids, change(ids)))).toBe(false);
      });

      it("never mints or admits worker_model for a Reviewer refresh", async () => {
        const ids = await seed();
        const current = await laneSource(ids, reviewer(ids));
        // The dispatch issuer is the same for a session start, a refresh and a plain command.
        expect(nativeManagedModelIssuer({ providerConformanceBootstrap: false, contextSnapshot: current.run.contextSnapshot,
          hasWorkerAttempt: false, hasConversationIdentity: false })).toBe("review");
        // The Host claim of the refresh is on the reviewer lane and refuses a worker capability.
        await expect(lane(current)).resolves.toBe("reviewer");
        expect(nativeReviewerModelCredentialExact(current, workerToken(ids))).toBe(false);
        expect(nativeReviewerModelCredentialExact(current, reviewToken(ids))).toBe(true);
      });
    });

    it("keeps the dispatch issuer of every other lane unchanged", () => {
      const review = { nativeReviewInteractionId: randomUUID(), nativeReviewDecisionId: randomUUID() };
      const issuer = (input: Partial<Parameters<typeof nativeManagedModelIssuer>[0]>) => nativeManagedModelIssuer({
        providerConformanceBootstrap: false, contextSnapshot: {}, hasWorkerAttempt: false, hasConversationIdentity: false, ...input });
      expect(issuer({ contextSnapshot: review })).toBe("review");
      expect(issuer({ contextSnapshot: review, hasWorkerAttempt: true })).toBe("worker");
      expect(issuer({ contextSnapshot: review, hasConversationIdentity: true })).toBe("review");
      expect(issuer({ hasConversationIdentity: true })).toBe("conversation");
      expect(issuer({ hasConversationIdentity: true, hasWorkerAttempt: true })).toBe("worker");
      expect(issuer({ hasWorkerAttempt: true })).toBe("worker");
      expect(issuer({})).toBe("worker");
      expect(issuer({ providerConformanceBootstrap: true, contextSnapshot: review })).toBe("conformance");
    });
  });
  describe("sandbox policy guard trigger (migration 0582)", () => {
    const image = "fixture.invalid/reviewer-policy@sha256:" + "b".repeat(64);
    let runtimeCatalogReady = false;
    /** A stopped company cell with a stopped OpenShell binding and an
     * unexpired capability snapshot: the state in which a qualified policy
     * snapshot may be written. The guard's other clauses are unchanged. */
    async function policyRuntime(ids: Ids) {
      if (!runtimeCatalogReady) {
        await db.insert(runtimeVersionCatalog).values({ imageDigest: image, providerVersion: "fixture", stateFormat: "v1",
          hostAgentMinimumVersion: "6.0.0", conformance: { fixtureOnly: true }, status: "approved" }).onConflictDoNothing();
        await db.insert(runtimeCapacityProfiles).values({ key: "reviewer-policy-fixture", cpuMillis: 1000, memoryBytes: 1073741824n,
          diskBytes: 10737418240n, pidsLimit: 128, qualified: false }).onConflictDoNothing();
        await instanceSettingsService(db as never).updateExperimental({ sandbox_abstraction_v7: true });
        runtimeCatalogReady = true;
      }
      const [account] = await db.insert(billingAccounts).values({ displayName: "Reviewer policy", payerUserId: ids.user }).returning();
      await db.insert(billingAccountCompanies).values({ companyId: ids.company, billingAccountId: account!.id });
      const [cell] = await db.insert(runtimeCells).values({ companyId: ids.company, billingAccountId: account!.id,
        capacityProfile: "reviewer-policy-fixture", desiredImageDigest: image, status: "STOPPED", isolationMode: "company_cell" }).returning();
      const capabilitySnapshot = { fixture: "reviewer-policy", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
      const boundaryPolicy = policyFixture();
      const [binding] = await db.insert(runtimeSandboxBindings).values({ companyId: ids.company, runtimeCellId: cell!.id,
        cellGeneration: cell!.generation.toString(), backend: "openshell", profile: "development", boundaryPolicy,
        boundaryPolicyHash: nativeSha256(boundaryPolicy), capabilitySnapshot: capabilitySnapshot as never,
        capabilitySnapshotHash: nativeSha256(capabilitySnapshot), status: "stopped", createdByUserId: ids.user }).returning();
      let version = 0;
      /** Write one qualified policy snapshot for `asked`'s manifest. */
      const qualify = (asked: { companyId: string; agentId: string; manifestId: string }) => db.insert(runtimePolicySnapshots).values({
        companyId: asked.companyId, bindingId: binding!.id, runtimeCellId: cell!.id, agentId: asked.agentId,
        executionManifestId: asked.manifestId, policyVersion: ++version, policyHash: "f".repeat(64),
        capabilitySnapshotHash: binding!.capabilitySnapshotHash, compilation: { proverResult: "pass",
          compiledPolicy: { riskClass: "C2", credentials: { mode: "none", bindings: [] } } } as never,
        authorityHash: "a".repeat(64), sourcePolicyRefs: [], status: "qualified",
        expiresAt: new Date(Date.now() + 600_000) }).returning().then(rows => rows[0]!.id, (error: { cause?: { code?: string; message?: string } }) =>
          ({ code: error.cause?.code, message: error.cause?.message }));
      return { qualify };
    }
    const reviewer = (ids: Ids) => ({ companyId: ids.company, agentId: ids.reviewer, manifestId: ids.manifest });
    const refused = { code: "23514", message: expect.stringContaining("sandbox_policy_current_execution_required") };

    it("admits the exact current Native completion Reviewer", async () => {
      const ids = await seed();
      const { qualify } = await policyRuntime(ids);
      await expect(qualify(reviewer(ids))).resolves.toEqual(expect.any(String));
    });

    it("keeps the assignee path unchanged, with or without a pending review", async () => {
      const ids = await seed();
      const { qualify } = await policyRuntime(ids);
      const executorRun = await addRun(ids, ids.executor);
      const assignee = { companyId: ids.company, agentId: ids.executor, manifestId: executorRun.manifestId };
      await expect(qualify(assignee)).resolves.toEqual(expect.any(String));
      await db.update(issueThreadInteractions).set({ status: "accepted", resolvedByAgentId: ids.reviewer,
        resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction));
      await expect(qualify(assignee)).resolves.toEqual(expect.any(String));
      // The assignee's Human binding is unchanged.
      await db.update(heartbeatRuns).set({ responsibleUserId: `user-${randomUUID()}` }).where(eq(heartbeatRuns.id, executorRun.runId));
      await expect(qualify(assignee)).resolves.toEqual(refused);
    });

    // Each refusal is shown against a guard that admitted the Reviewer first.
    const triggerRefusals: Array<[string, (ids: Ids) => Promise<{ companyId: string; agentId: string; manifestId: string }>]> = [
      ["an unrelated Agent", async ids => {
        const outsider = await addRun(ids, ids.outsider);
        await db.update(issues).set({ executionRunId: outsider.runId }).where(eq(issues.id, ids.issue));
        return { companyId: ids.company, agentId: ids.outsider, manifestId: outsider.manifestId };
      }],
      ["a stale review", async ids => {
        await db.update(issues).set({ statusVersion: 2 }).where(eq(issues.id, ids.issue));
        return reviewer(ids);
      }],
      ["a resolved review", async ids => {
        await db.update(issueThreadInteractions).set({ status: "accepted", resolvedByAgentId: ids.reviewer,
          resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction));
        return reviewer(ids);
      }],
      ["a different Run of the Reviewer", async ids => {
        const other = await addRun(ids, ids.reviewer);
        return { companyId: ids.company, agentId: ids.reviewer, manifestId: other.manifestId };
      }],
      ["a different company", async ids => ({ ...reviewer(ids), companyId: ids.otherCompany })],
      ["a Task that is not in review", async ids => {
        await db.update(issues).set({ status: "in_progress" }).where(eq(issues.id, ids.issue));
        await db.update(issues).set({ statusVersion: 1 }).where(eq(issues.id, ids.issue));
        return reviewer(ids);
      }],
      ["a source Run that is not committed", async ids => {
        await db.update(heartbeatRuns).set({ nativePhase: "observed" }).where(eq(heartbeatRuns.id, ids.sourceRun));
        return reviewer(ids);
      }],
      ["a source Run whose cleanup is pending", async ids => {
        await projectSourceCleanup(ids.company, ids.executor, ids.sourceRun, "native.process_start_requested", 2);
        return reviewer(ids);
      }],
      ["a hidden Task", async ids => {
        await db.update(issues).set({ hiddenAt: new Date() }).where(eq(issues.id, ids.issue));
        return reviewer(ids);
      }],
    ];
    it.each(triggerRefusals)("refuses %s", async (_name, arrange) => {
      const ids = await seed();
      const { qualify } = await policyRuntime(ids);
      await expect(qualify(reviewer(ids))).resolves.toEqual(expect.any(String));
      const asked = await arrange(ids);
      await expect(qualify(asked)).resolves.toEqual(refused);
    });
  });
});
