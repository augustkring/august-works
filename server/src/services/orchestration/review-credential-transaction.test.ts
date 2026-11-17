import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentExecutionManifests,
  agentPresenceRuntimeBindings,
  agents,
  billingAccountCompanies,
  billingAccounts,
  billingSubscriptions,
  companies,
  companySecrets,
  companySecretVersions,
  completionContracts,
  contextManifests,
  createDb,
  entitlementSnapshots,
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
  runtimeHosts,
  runtimeVersionCatalog,
  statusDecisions,
  workAssessments,
} from "@paperclipai/db";
import type { ReviewModelBinding } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";

// MS1h4. RuntimeControl's sandbox-exec check of a Reviewer model capability
// ran inside its transaction, after assertTaskExecutionContext's run write gate
// had upserted the company's entitlement snapshot, and re-minted the credential
// through issueForReviewRun on the gateway's own connection. That issuance runs
// the same write gate, so its entitlement upsert waited on the transaction and
// the transaction waited on it: a deadlock Postgres cannot detect.
//
// Real rows and locks: the Reviewer, its Run and manifest, the pending review
// (production getNativeReviewAssignment), the plan, its Worker and source
// attempt, the company's healthy runtime cell, billing and the entitlement
// snapshot (production assertAgentRunWriteAllowed and entitlement upsert).
// Replaced, as in the MS1e/MS1g unit tests: V7 authorization, authored
// procedures, the review witness capture, the retained completion contract, and
// the provider/connection/profile/quote owners of qualifyWorkerTransport.
const state = vi.hoisted(() => ({
  sourceResultId: "",
  profile: null as Record<string, unknown> | null,
  provider: null as Record<string, unknown> | null,
  selection: null as Record<string, unknown> | null,
}));
vi.mock("../v7-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("../v7-authorization.js")>(),
  assertV7Authorization: async () => undefined,
}));
vi.mock("../agents/authoring-procedures.js", async importOriginal => ({
  ...await importOriginal<typeof import("../agents/authoring-procedures.js")>(),
  assertAuthoredProceduresCurrent: async () => null,
}));
vi.mock("../native-runtime/native-review-participant.js", async importOriginal => ({
  ...await importOriginal<typeof import("../native-runtime/native-review-participant.js")>(),
  // The witness of the committed source result, derived from the current assignment it is given.
  captureNativeReviewWakeWitness: async (_db: unknown, input: { reviewerRunId: string; reviewerAgentId: string;
    assignment: { interaction: { id: string }; sourceDecision: { id: string }; sourceRun: { id: string } } }) => ({
    sourceResultId: state.sourceResultId, sourceReceiptDigest: "a".repeat(64),
    sourceResultCanonicalSha256: `sha256:${"b".repeat(64)}`, sourceRunId: input.assignment.sourceRun.id,
    interactionId: input.assignment.interaction.id, decisionId: input.assignment.sourceDecision.id,
    reviewerRunId: input.reviewerRunId, reviewerAgentId: input.reviewerAgentId,
  }),
}));
vi.mock("./orchestration-contracts.js", async importOriginal => ({
  ...await importOriginal<typeof import("./orchestration-contracts.js")>(),
  retainedOrchestrationContract: async () => ({ row: { id: "retained" } }),
}));
vi.mock("../agent-provider-bindings.js", async importOriginal => {
  const original = await importOriginal<typeof import("../agent-provider-bindings.js")>();
  return { ...original, agentProviderBindingService: (db: never) => ({ ...original.agentProviderBindingService(db),
    assertRuntime: async () => state.provider }) };
});
vi.mock("../ai-connections.js", async importOriginal => {
  const original = await importOriginal<typeof import("../ai-connections.js")>();
  return { ...original, aiConnectionService: (db: never) => ({ ...original.aiConnectionService(db),
    select: async () => state.selection }) };
});
vi.mock("./worker-model-profiles.js", async importOriginal => ({
  ...await importOriginal<typeof import("./worker-model-profiles.js")>(),
  selectWorkerModelProfile: () => state.profile,
}));
vi.mock("./model-reservations.js", async importOriginal => ({
  ...await importOriginal<typeof import("./model-reservations.js")>(),
  quoteModelReservation: () => ({ maximumMinor: 1 }),
}));

import { workerModelGateway } from "./worker-model-gateway.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import { createRuntimeToolsToken, verifyRuntimeToolsToken, type RuntimeToolsTokenClaims } from "../../runtime-tools-token.js";
import { instanceSettingsService } from "../instance-settings.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

describeDb("Reviewer model credential read inside the sandbox-exec transaction (MS1h4)", () => {
  let db!: Db;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  const image = "fixture.invalid/ms1h4-runtime@sha256:" + "e".repeat(64);
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("review-credential-transaction-");
    db = createDb(temporary.connectionString);
    await instanceSettingsService(db as never).updateExperimental({ enableFoundationV1: true, enableContextEngineV1: true,
      enableWorkflowsV1: true, agent_identities_v5: true, agent_provider_bindings_v5: true, agent_runtime_fabric_v5: true,
      readiness_engine_v7: true, orchestration_v7: true });
    await db.insert(runtimeVersionCatalog).values({ imageDigest: image, providerVersion: "fixture", stateFormat: "v1",
      hostAgentMinimumVersion: "6.0.0", conformance: { fixtureOnly: true } });
    await db.insert(runtimeCapacityProfiles).values({ key: "ms1h4-fixture", cpuMillis: 1000, memoryBytes: 1073741824n,
      diskBytes: 10737418240n, pidsLimit: 128 });
  }, 60_000);
  afterAll(async () => { await temporary?.cleanup(); });
  beforeEach(() => { process.env.PAPERCLIP_AGENT_JWT_SECRET = `ms1h4-${randomUUID()}`; });
  afterEach(() => {
    if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
  });

  const models = () => workerModelGateway(db as never, { profiles: [], sourceSha: "f".repeat(40),
    protectedEvidenceOrigin: "https://protected.test.invalid" });

  /** The cleanup projection may change only with its process event in the same transaction. */
  async function projectSourceCleanup(companyId: string, agentId: string, runId: string) {
    await db.transaction(async tx => {
      await tx.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 1, eventType: "native.local_process_stopped",
        payload: {} });
      await tx.update(heartbeatRuns).set({ nativeProcessCleanupPending: false }).where(eq(heartbeatRuns.id, runId));
    });
  }

  async function manifestFor(companyId: string, agentId: string, runId: string, issueId: string, responsibleUserId: string) {
    const [agent] = await db.select({ identity: agents.agentIdentityId }).from(agents).where(eq(agents.id, agentId));
    const contextManifestId = randomUUID(), manifestId = randomUUID();
    await db.insert(contextManifests).values({ id: contextManifestId, companyId, runId, agentId, issueId,
      queryHash: "a".repeat(64), policySnapshotHash: "b".repeat(64) });
    await db.insert(agentExecutionManifests).values({ id: manifestId, companyId, runId, agentId,
      agentIdentityId: agent!.identity, contextManifestId,
      manifest: { responsibleUserId, capabilities: [], providers: [], executionScope: { delegatedScopes: [] } } as never,
      policySnapshotHash: "c".repeat(64), hash: "d".repeat(64) });
    return manifestId;
  }

  /** One Task in review under a running single-worker plan: the executor's
   * committed source Run and succeeded attempt, its applied decision, the
   * pending native completion review addressed to the Reviewer, and the
   * Reviewer's running Native Run holding the execution lease, on a healthy
   * managed runtime cell with current commercial capacity. */
  async function seed() {
    const ids = { company: randomUUID(), otherCompany: randomUUID(), executor: randomUUID(), reviewer: randomUUID(),
      issue: randomUUID(), sourceRun: randomUUID(), reviewerRun: randomUUID(), decision: randomUUID(),
      interaction: randomUUID(), contract: randomUUID(), result: randomUUID(), assessment: randomUUID(),
      user: `user-${randomUUID()}`, plan: randomUUID(), worker: randomUUID(), attempt: randomUUID(),
      manifest: "", sourceManifest: "", secret: randomUUID() };
    const prefix = (id: string) => `R${id.replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    await db.insert(companies).values([
      { id: ids.company, name: "Reviewer credential", issuePrefix: prefix(ids.company) },
      { id: ids.otherCompany, name: "Other company", issuePrefix: prefix(ids.otherCompany) },
    ]);
    const adapterConfig = { provider: "opencode", model: "anthropic/claude-fixture" };
    await db.insert(agents).values([
      { id: ids.executor, companyId: ids.company, name: "Executor", adapterType: "paperclip_runner", status: "idle", adapterConfig },
      { id: ids.reviewer, companyId: ids.company, name: "Reviewer", adapterType: "paperclip_runner", status: "running", adapterConfig },
    ]);
    await db.insert(issues).values({ id: ids.issue, companyId: ids.company, title: "Reviewed task", status: "in_review",
      statusVersion: 1, lastStatusDecisionId: ids.decision, assigneeAgentId: ids.executor });
    await db.insert(completionContracts).values({ id: ids.contract, companyId: ids.company, issueId: ids.issue, revision: 1,
      schemaVersion: "1", policyVersion: "test", risk: "low", completionAuthority: "agent_claim_policy",
      incompleteCriteriaPolicy: "block", contractJson: {}, canonicalSha256: "c".repeat(64), createdByActorType: "agent",
      createdByActorId: ids.executor });
    const reviewContext = { issueId: ids.issue, nativeReviewInteractionId: ids.interaction, nativeReviewDecisionId: ids.decision,
      sourceRunId: ids.sourceRun, revisionId: ids.decision };
    await db.insert(heartbeatRuns).values([
      { id: ids.sourceRun, companyId: ids.company, agentId: ids.executor, status: "succeeded", runtimeMode: "native",
        scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user,
        nativePhase: "committed", completionContractId: ids.contract, createdAt: new Date(Date.now() - 60_000) },
      { id: ids.reviewerRun, companyId: ids.company, agentId: ids.reviewer, status: "running", runtimeMode: "native",
        scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user,
        completionContractId: ids.contract, completionContractSha256: "c".repeat(64),
        startedAt: new Date(), contextSnapshot: reviewContext },
    ]);
    await db.update(issues).set({ executionRunId: ids.reviewerRun }).where(eq(issues.id, ids.issue));
    await projectSourceCleanup(ids.company, ids.executor, ids.sourceRun);
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
    ids.manifest = await manifestFor(ids.company, ids.reviewer, ids.reviewerRun, ids.issue, ids.user);
    ids.sourceManifest = await manifestFor(ids.company, ids.executor, ids.sourceRun, ids.issue, ids.user);
    // The accepted single-worker plan, its Worker and the succeeded source attempt.
    await db.insert(orchestrationPlans).values({ id: ids.plan, companyId: ids.company, issueId: ids.issue,
      completionContractId: ids.contract, mode: "single_worker", actionClass: "internal_draft", riskClass: "C0",
      supervisionMode: "none", verificationMode: "deterministic", humanOversightMode: "human_review", createdBy: ids.user,
      budgets: { maxWorkerCount: 1, maxParallelWorkers: 1, maxDelegationDepth: 1, maxRetries: 0, maxWallClockSeconds: 3600,
        maxToolActions: 5, maxModelCostMinor: 1000 } });
    await db.insert(orchestrationWorkers).values({ id: ids.worker, companyId: ids.company, planId: ids.plan, issueId: ids.issue,
      agentId: ids.executor, completionContractId: ids.contract, workerKey: "writer", dependsOn: [], status: "completed",
      attemptCount: 1 });
    await db.update(orchestrationPlans).set({ status: "running", startedAt: new Date(), version: 2,
      executionPrincipal: { type: "user", userId: ids.user } }).where(eq(orchestrationPlans.id, ids.plan));
    await db.insert(orchestrationWorkerAttempts).values({ id: ids.attempt, companyId: ids.company, planId: ids.plan,
      workerId: ids.worker, agentId: ids.executor, runId: ids.sourceRun, attempt: 1, status: "succeeded",
      executionManifestId: ids.sourceManifest, finishedAt: new Date() });
    // The Reviewer's managed runtime: a healthy company cell bound to its presence, with current capacity.
    const [account] = await db.insert(billingAccounts).values({ displayName: "Reviewer credential", payerUserId: ids.user }).returning();
    await db.insert(billingAccountCompanies).values({ companyId: ids.company, billingAccountId: account!.id });
    await db.insert(billingSubscriptions).values({ billingAccountId: account!.id, providerSubscriptionId: `sub_${ids.company}`,
      status: "active", productKeys: ["platform", "runtime_standard"], currentPeriodEnd: new Date(Date.now() + 86_400_000),
      graceUntil: new Date(Date.now() + 8 * 86_400_000), providerUpdatedAt: new Date(), sourceHash: "fixture" });
    const [host] = await db.insert(runtimeHosts).values({ environment: "staging", region: "dk-cph1", capacityClass: "fixture",
      status: "READY", cpuTotalMillis: 4000, memoryTotalBytes: 8_000_000_000n, diskTotalBytes: 40_000_000_000n }).returning();
    const [presence] = await db.select().from(agentPresenceRuntimeBindings).where(and(
      eq(agentPresenceRuntimeBindings.companyId, ids.company), eq(agentPresenceRuntimeBindings.agentId, ids.reviewer)));
    if (!presence) throw new Error("fixture_presence_missing");
    const [cell] = await db.insert(runtimeCells).values({ companyId: ids.company, billingAccountId: account!.id,
      runtimeHostId: host!.id, providerBindingId: presence.providerBindingId, capacityProfile: "ms1h4-fixture",
      isolationMode: "company_cell", desiredImageDigest: image, status: "HEALTHY" }).returning();
    const providerProfileRef = `aw:cell:${cell!.id}:generation:${cell!.generation}`;
    await db.update(agentPresenceRuntimeBindings).set({ status: "active", providerProfileRef })
      .where(eq(agentPresenceRuntimeBindings.id, presence.id));
    // The Reviewer's qualified managed transport and its current credential version.
    await db.insert(companySecrets).values({ id: ids.secret, companyId: ids.company, key: `ms1h4-${ids.secret}`,
      name: "Reviewer model credential" });
    await db.insert(companySecretVersions).values({ secretId: ids.secret, version: 1, material: {},
      valueSha256: "1".repeat(64), fingerprintSha256: "2".repeat(64) });
    state.sourceResultId = ids.result;
    state.profile = { id: randomUUID(), transport: "server-anthropic-messages-v1", tariff: { model: "claude-fixture" },
      providerBindingId: presence.providerBindingId, providerSnapshotHash: "3".repeat(64),
      qualifiedConfigurationHash: "4".repeat(64), providerProfileRef, binding: { mode: "explicit" },
      inputTokensUpperBound: 1000, maxOutputTokens: 1024, maximumEnvelopeBytes: 100_000 };
    state.provider = { provider: { id: presence.providerBindingId, capabilitySnapshotHash: "3".repeat(64) },
      runtime: { conformanceSnapshotHash: "3".repeat(64), qualifiedConfigurationHash: "4".repeat(64), providerProfileRef } };
    state.selection = { connection: { id: randomUUID(), config: {}, updatedAt: new Date(0) },
      grant: { id: randomUUID(), updatedAt: new Date(0), credentialSecretRefs: [{ configPath: "ai.credential", secretId: ids.secret }] },
      attribution: { method: "api_key" } };
    return ids;
  }
  type Ids = Awaited<ReturnType<typeof seed>>;

  const mintInput = (ids: Ids) => ({ companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun,
    responsibleUserId: ids.user });
  /** The Run RuntimeControl's transaction gated in assertTaskExecutionContext. */
  const gate = (ids: Ids) => ({ companyId: ids.company, agentId: ids.reviewer, runId: ids.reviewerRun });
  /** Dispatch-time issuance (the production minting path, outside any transaction). */
  async function issued(ids: Ids) {
    const minted = await models().issueForReviewRun(mintInput(ids));
    const claims = verifyRuntimeToolsToken(minted.token, "review_model");
    if (!claims?.review_model) throw new Error("fixture_review_token_invalid");
    return claims;
  }
  /** A signed Reviewer capability for an arbitrary (possibly stale) binding. */
  function presented(input: { companyId: string; agentId: string; runId: string; responsibleUserId: string;
    binding: ReviewModelBinding }) {
    const minted = createRuntimeToolsToken({ ...input, reviewModelBinding: input.binding, scope: "review_model" });
    const claims = minted && verifyRuntimeToolsToken(minted.token, "review_model");
    if (!claims?.review_model) throw new Error("fixture_review_token_invalid");
    return claims;
  }
  /** The sandbox-exec shape: the run write gate first (sandbox-service.ts
   * assertTaskExecutionContext), then the credential read, in one transaction. */
  const readInTransaction = (claims: RuntimeToolsTokenClaims, writeGate: ReturnType<typeof gate>,
    before?: (tx: Tx) => Promise<unknown>) => db.transaction(async tx => {
    await assertAgentRunWriteAllowed(tx as never, writeGate.companyId, { agentId: writeGate.agentId, runId: writeGate.runId });
    await before?.(tx);
    return models().currentReviewBinding(tx as never, claims, writeGate);
  });
  /** Rows this transaction has inserted, updated or deleted so far. */
  const transactionWrites = async (tx: Tx) => Number((await tx.execute<{ writes: string }>(sql`
    select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::text as writes from pg_stat_xact_user_tables`))[0]!.writes);
  /** Backends waiting on a lock held by `pid` while writing the entitlement snapshot. */
  const entitlementWaitersOn = async (pid: number) => Number((await db.execute<{ waiting: string }>(sql`
    select count(*)::text as waiting from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))
      and query ilike '%entitlement_snapshots%'`))[0]!.waiting);
  const within = <T>(promise: Promise<T>, ms: number, label: string) => Promise.race([promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(label)), ms))]);

  it("verifies the presented Reviewer capability inside the transaction that holds the entitlement snapshot", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    let issuance: Promise<string> | undefined;
    await db.transaction(async tx => {
      // sandbox-service.ts assertTaskExecutionContext: the run write gate upserts
      // the company's entitlement snapshot and keeps its row lock until commit.
      await assertAgentRunWriteAllowed(tx as never, ids.company, { agentId: ids.reviewer, runId: ids.reviewerRun });
      const [{ pid }] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const writes = await transactionWrites(tx);
      const current = await within(models().currentReviewBinding(tx as never, claims, gate(ids)), 10_000,
        "ms1h4_review_credential_read_blocked_inside_transaction");
      expect(current?.binding).toEqual(claims.review_model);
      // The read wrote nothing: no entitlement upsert and no minting record.
      expect(await transactionWrites(tx)).toBe(writes);
      // The pre-MS1h4 check re-minted on the gateway's own connection. Its run
      // write gate waits on this transaction's entitlement row (the deadlock).
      issuance = models().issueForReviewRun(mintInput(ids)).then(() => "issued", (error: Error) => `refused:${error.message}`);
      await expect.poll(() => entitlementWaitersOn(pid), { timeout: 10_000, interval: 50 }).toBe(1);
      expect(await Promise.race([issuance, new Promise(resolve => setTimeout(() => resolve("waiting"), 250))])).toBe("waiting");
    });
    // Once the transaction ends, the minting path proceeds unchanged.
    await expect(issuance).resolves.toBe("issued");
  });

  it("keeps the commercial write gate and entitlement refresh on the minting path", async () => {
    const ids = await seed();
    await issued(ids);
    const [first] = await db.select().from(entitlementSnapshots).where(eq(entitlementSnapshots.companyId, ids.company));
    expect(first).toBeTruthy();
    await issued(ids);
    const [second] = await db.select().from(entitlementSnapshots).where(eq(entitlementSnapshots.companyId, ids.company));
    expect(second!.computedAt.getTime()).toBeGreaterThan(first!.computedAt.getTime());
    // A refused commercial capacity still refuses issuance.
    await db.update(billingSubscriptions).set({ status: "canceled" }).where(eq(billingSubscriptions.providerSubscriptionId,
      `sub_${ids.company}`));
    await expect(models().issueForReviewRun(mintInput(ids)))
      .rejects.toThrow("This managed runtime needs current commercial capacity and healthy runtime authority");
  });

  it("refuses a stale review", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    // The Task moved on since the review was opened (owner test "a stale review").
    await db.update(issues).set({ statusVersion: 2 }).where(eq(issues.id, ids.issue));
    await expect(readInTransaction(claims, gate(ids)))
      .rejects.toThrow("One exact current assigned completion review and committed source are required");
  });

  it("refuses a review this Run resolved in the caller's transaction, which dispatch rechecks still admit", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    const resolve = (tx: Tx) => tx.update(issueThreadInteractions).set({ status: "accepted", resolvedByAgentId: ids.reviewer,
      resolvedByRunId: ids.reviewerRun, resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids.interaction));
    // The issuance facts (pending review, read through the caller's
    // transaction) refuse it, though currentReview alone admits a review
    // resolved by this Run for its later model-call rechecks.
    await expect(readInTransaction(claims, gate(ids), resolve))
      .rejects.toThrow("One exact current assigned completion review and committed source are required");
  });

  it("refuses a capability issued before the plan advanced", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    await db.update(orchestrationPlans).set({ version: 3 }).where(eq(orchestrationPlans.id, ids.plan));
    await expect(readInTransaction(claims, gate(ids))).resolves.toBeNull();
  });

  it("refuses another Run of the Reviewer", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    const otherRun = randomUUID();
    await db.insert(heartbeatRuns).values({ id: otherRun, companyId: ids.company, agentId: ids.reviewer, status: "running",
      runtimeMode: "native", scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue, responsibleUserId: ids.user,
      completionContractId: ids.contract, completionContractSha256: "c".repeat(64), startedAt: new Date(),
      contextSnapshot: { issueId: ids.issue, nativeReviewInteractionId: ids.interaction, nativeReviewDecisionId: ids.decision,
        sourceRunId: ids.sourceRun, revisionId: ids.decision } });
    const otherManifest = await manifestFor(ids.company, ids.reviewer, otherRun, ids.issue, ids.user);
    const other = presented({ ...mintInput(ids), runId: otherRun,
      binding: { ...claims.review_model!, reviewerRunId: otherRun, executionManifestId: otherManifest } });
    // RuntimeControl gated this Run, not the other one.
    await expect(readInTransaction(other, gate(ids))).rejects.toThrow("The caller's run write gate must cover this exact Reviewer Run");
    // Gated as itself, the other Run is not the Task's execution Run.
    await expect(readInTransaction(other, { ...gate(ids), runId: otherRun }))
      .rejects.toThrow("The exact current assigned review and committed source are required");
  });

  it("refuses another manifest", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    const wrongManifest = presented({ ...mintInput(ids), binding: { ...claims.review_model!, executionManifestId: ids.sourceManifest } });
    await expect(readInTransaction(wrongManifest, gate(ids))).resolves.toBeNull();
  });

  it("refuses another company", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    const foreign = presented({ ...mintInput(ids), companyId: ids.otherCompany, binding: claims.review_model! });
    await expect(readInTransaction(foreign, gate(ids))).rejects.toThrow("The caller's run write gate must cover this exact Reviewer Run");
    await expect(readInTransaction(foreign, { ...gate(ids), companyId: ids.otherCompany }))
      .rejects.toThrow("The persisted Native review wake must bind this exact Task");
  });

  it("refuses a capability of another scope", async () => {
    const ids = await seed();
    const claims = await issued(ids);
    await expect(readInTransaction({ ...claims, scope: "worker_model" }, gate(ids)))
      .rejects.toThrow("Current run-scoped assigned Reviewer model capability required");
    await expect(readInTransaction({ ...claims, review_model: undefined }, gate(ids)))
      .rejects.toThrow("Current run-scoped assigned Reviewer model capability required");
  });
});
