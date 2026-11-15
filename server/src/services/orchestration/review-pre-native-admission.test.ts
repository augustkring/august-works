import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentExecutionManifests, heartbeatRuns, issues, orchestrationPlans, orchestrationWorkerAttempts } from "@paperclipai/db";

// MS1e. Manifest admission (agent-runtime-fabric -> admitOrchestrationHeartbeat
// -> qualifyNativeReviewRun -> qualifyReviewInTransaction) runs before the
// heartbeat's Native runtime selection, so the execution-policy Reviewer Run is
// still its unresolved pre-binding row (runtime mode legacy, no Native issue).
// currentReview required runtimeMode "native" on that path too, so every
// Reviewer Run failed setup in manifest admission. The Reviewer owner, witness,
// contract and authorization services are replaced here; the gateway's own
// pre-Native admission and currentReview predicates are the real code.
const state = vi.hoisted(() => ({
  assignment: null as Record<string, unknown> | null,
  witness: null as Record<string, unknown> | null,
  contract: null as Record<string, unknown> | null,
}));
vi.mock("../v7-authorization.js", async importOriginal => ({
  ...await importOriginal<typeof import("../v7-authorization.js")>(),
  assertV7Enabled: async () => undefined,
  assertV7Authorization: async () => undefined,
}));
vi.mock("../native-runtime/native-review-participant.js", async importOriginal => ({
  ...await importOriginal<typeof import("../native-runtime/native-review-participant.js")>(),
  getNativeReviewAssignment: async () => state.assignment,
  captureNativeReviewWakeWitness: async () => state.witness,
}));
vi.mock("./orchestration-contracts.js", async importOriginal => ({
  ...await importOriginal<typeof import("./orchestration-contracts.js")>(),
  retainedOrchestrationContract: async () => state.contract,
}));

import { workerModelGateway } from "./worker-model-gateway.js";

type Row = Record<string, unknown>;

/** Table-keyed stand-in for the Drizzle client. Each read of a table returns
 * the next scripted result for it (the last one repeats). */
function fakeDb(responses: Map<unknown, Row[][]>) {
  const calls = new Map<unknown, number>();
  const chain = (table: unknown) => {
    const query: Record<string, unknown> = {};
    for (const method of ["where", "for", "limit", "orderBy", "innerJoin", "leftJoin"]) query[method] = () => query;
    query.then = (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
      const scripted = responses.get(table) ?? [[]];
      const call = calls.get(table) ?? 0;
      calls.set(table, call + 1);
      return structuredClone(scripted[Math.min(call, scripted.length - 1)]!);
    }).then(resolve, reject);
    return query;
  };
  return { select: () => ({ from: (table: unknown) => chain(table) }) };
}

describe("pre-Native Reviewer admission (MS1e)", () => {
  const previousSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  beforeEach(() => { process.env.PAPERCLIP_AGENT_JWT_SECRET = `ms1e-${randomUUID()}`; });
  afterEach(() => {
    if (previousSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousSecret;
  });

  function fixture() {
    const ids = { company: randomUUID(), reviewerAgent: randomUUID(), reviewerRun: randomUUID(), sourceAgent: randomUUID(),
      sourceRun: randomUUID(), issue: randomUUID(), interaction: randomUUID(), decision: randomUUID(), plan: randomUUID(),
      worker: randomUUID(), attempt: randomUUID(), manifest: randomUUID(), user: randomUUID(), contract: randomUUID(),
      result: randomUUID() };
    const run: Row = { id: ids.reviewerRun, companyId: ids.company, agentId: ids.reviewerAgent, status: "running",
      runtimeMode: "legacy", runtimeModeResolvedAt: null, nativeIssueId: null, responsibleUserId: ids.user,
      completionContractId: null, completionContractSha256: null,
      contextSnapshot: { issueId: ids.issue, nativeReviewInteractionId: ids.interaction, nativeReviewDecisionId: ids.decision,
        sourceRunId: ids.sourceRun, revisionId: ids.decision } };
    const task: Row = { id: ids.issue, companyId: ids.company, status: "in_review", executionRunId: ids.reviewerRun,
      assigneeAgentId: ids.sourceAgent };
    const manifest: Row = { id: ids.manifest, companyId: ids.company, runId: ids.reviewerRun, agentId: ids.reviewerAgent,
      hash: "d".repeat(64), manifest: { responsibleUserId: ids.user } };
    const plan: Row = { id: ids.plan, companyId: ids.company, issueId: ids.issue, version: 3, mode: "single_worker" };
    const source: Row = { attempt: { id: ids.attempt, agentId: ids.sourceAgent, planId: ids.plan, workerId: ids.worker,
      runId: ids.sourceRun, status: "succeeded", executionManifestId: randomUUID() },
      worker: { id: ids.worker, issueId: ids.issue, agentId: ids.sourceAgent }, plan };
    const assignment: Row = { interaction: { id: ids.interaction, status: "pending" }, sourceDecision: { id: ids.decision },
      sourceRun: { id: ids.sourceRun, agentId: ids.sourceAgent, status: "succeeded", nativePhase: "committed",
        nativeProcessCleanupPending: false } };
    const witness: Row = { sourceResultId: ids.result, sourceReceiptDigest: "a".repeat(64),
      sourceResultCanonicalSha256: `sha256:${"b".repeat(64)}` };
    const contract: Row = { row: { id: ids.contract, canonicalSha256: "c".repeat(64) } };
    return { ids, run, task, manifest, plan, source, assignment, witness, contract };
  }
  type Fixture = ReturnType<typeof fixture>;

  /** The admission preflight reads the source attempt once; currentReview
   * reads it again right after its run-mode gate. That second read returns no
   * row, so a Run past the gate stops there with a different, known refusal. */
  function gateway(f: Fixture) {
    state.assignment = f.assignment;
    state.witness = f.witness;
    state.contract = f.contract;
    const db = fakeDb(new Map<unknown, Row[][]>([
      [heartbeatRuns, [[f.run]]], [issues, [[f.task]]], [agentExecutionManifests, [[f.manifest]]],
      [orchestrationPlans, [[f.plan]]], [orchestrationWorkerAttempts, [[f.source], []]],
    ]));
    return { db, gateway: workerModelGateway(db as never, { profiles: [], sourceSha: "e".repeat(40),
      protectedEvidenceOrigin: "https://protected.test.invalid" }) };
  }
  const admit = (f: Fixture) => {
    const { db, gateway: models } = gateway(f);
    return models.qualifyReviewInTransaction(db as never, { companyId: f.ids.company, agentId: f.ids.reviewerAgent,
      runId: f.ids.reviewerRun, issueId: f.ids.issue, responsibleUserId: f.ids.user });
  };
  const pastRunModeGate = "The committed source must belong to its exact successful plan attempt";
  const runModeGate = "The exact current assigned review and committed source are required";

  it("admits the exact assigned pre-binding Reviewer Run past the run-mode gate", async () => {
    // Before the fix this stopped at the run-mode gate (runtimeMode legacy).
    await expect(admit(fixture())).rejects.toThrow(pastRunModeGate);
  });

  it("refuses another Run, issue, interaction, decision or manifest on the pre-Native admission path", async () => {
    const cases: Array<[string, (f: Fixture) => void, string]> = [
      ["the Task execution lease held by another Run", f => { f.task.executionRunId = randomUUID(); }, runModeGate],
      ["another Run's manifest", f => { f.manifest.runId = randomUUID(); }, runModeGate],
      ["another Agent's manifest", f => { f.manifest.agentId = randomUUID(); }, runModeGate],
      ["a wake for another interaction", f => {
        f.run.contextSnapshot = { ...(f.run.contextSnapshot as Row), nativeReviewInteractionId: randomUUID() }; }, runModeGate],
      ["a wake for another decision", f => {
        f.run.contextSnapshot = { ...(f.run.contextSnapshot as Row), nativeReviewDecisionId: randomUUID() }; }, runModeGate],
      ["a wake naming another source Run", f => {
        f.run.contextSnapshot = { ...(f.run.contextSnapshot as Row), sourceRunId: randomUUID() }; }, runModeGate],
      ["a wake naming another revision", f => {
        f.run.contextSnapshot = { ...(f.run.contextSnapshot as Row), revisionId: randomUUID() }; }, runModeGate],
      ["a review that is no longer pending", f => {
        f.assignment.interaction = { id: f.ids.interaction, status: "accepted" }; }, runModeGate],
      ["a Run already resolved to the legacy runtime", f => { f.run.runtimeModeResolvedAt = new Date(); }, runModeGate],
      ["a Run in another runtime mode", f => { f.run.runtimeMode = "external"; }, runModeGate],
      ["a stopped Run", f => { f.run.status = "cancelled"; }, runModeGate],
      ["a wake for another issue", f => {
        f.run.contextSnapshot = { ...(f.run.contextSnapshot as Row), issueId: randomUUID() }; },
        "The persisted pre-Native Reviewer wake must bind this exact Task"],
      ["a Run already bound to a Native issue", f => { f.run.nativeIssueId = f.ids.issue; },
        "The persisted pre-Native Reviewer wake must bind this exact Task"],
    ];
    for (const [name, change, refusal] of cases) {
      const f = fixture();
      change(f);
      await expect(admit(f), name).rejects.toThrow(refusal);
    }
  });

  it("keeps requiring a Native Run outside the admission path", async () => {
    // Issuance with the pre-binding selector is not the admission preflight: the
    // same legacy Reviewer Run is refused at the run-mode gate.
    const f = fixture();
    f.run.completionContractId = f.ids.contract;
    f.run.completionContractSha256 = "c".repeat(64);
    const { gateway: models } = gateway(f);
    await expect(models.issueForReviewRun({ companyId: f.ids.company, agentId: f.ids.reviewerAgent, runId: f.ids.reviewerRun,
      responsibleUserId: f.ids.user, issueId: f.ids.issue, preNativeBinding: true })).rejects.toThrow(runModeGate);
  });
});
