import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowOptimizerEvaluations, workflowRuns, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../authorization.js";
import type { AutomationArtifactMutationActor } from "../automation-artifacts/automation-artifact-service.js";

const mocks = vi.hoisted(() => ({
  assertBinding: vi.fn(),
  candidate: vi.fn(),
  drift: vi.fn(),
  source: vi.fn(),
}));

vi.mock("./optimizer-evaluation.js", () => ({
  assertOptimizerEvaluationBinding: mocks.assertBinding,
  executeCompiledOptimizerCandidate: mocks.candidate,
  evaluateCandidateInvariant: () => true,
}));
vi.mock("./optimizer-live-drift.js", () => ({ evaluateLiveOptimizerDrift: mocks.drift }));
vi.mock("../automation-artifacts/automation-artifact-workflow-source.js", () => ({
  withNativeArtifactWorkflowSource: mocks.source,
}));
vi.mock("../analytical-privacy.js", () => ({ lockAnalyticalCompany: vi.fn() }));
vi.mock("../memory/memory-privacy.js", () => ({ assertMemoryRecordsRetained: vi.fn(), lockMemoryPrivacy: vi.fn() }));
vi.mock("../instance-settings.js", () => ({ instanceSettingsService: () => ({ getExperimental: async () => ({
  enableAutomationArtifactsV1: true, enableWorkflowOptimizerShadow: true, enableWorkflowOptimizerPromotion: true,
  enableAutomationArtifactCodeExecutionV1: false,
}) }) }));
vi.mock("../activity-log.js", () => ({ persistActivity: async () => ({ publication: null }), publishActivity: vi.fn() }));

import { executeOptimizedWorkflowTransform } from "./optimizer-workflow-runtime.js";
import { optimizerShapeHash } from "./optimizer-trace.js";

const actor: AutomationArtifactMutationActor = { principal: { type: "system", service: "test" } };

const run: typeof workflowRuns.$inferSelect = {
  id: "run-1", companyId: "company-1", workflowId: "workflow-1", workflowRevisionId: "revision-1", source: "manual",
  status: "running", executionOwnerId: "owner-1", executionPrincipal: actor.principal,
  executionAgentRunId: null, leaseExpiresAt: new Date(Date.now() + 60_000), triggerPayload: {}, memoryRecordIds: [],
  authoringSourceWorkflowIds: [], triggerId: null, responsibleUserId: null, humanCoverageId: null,
  parentWorkflowRunId: null, parentNodeId: null, idempotencyKey: null, correlationId: null,
  retryOfRunId: null, idempotencyRootRunId: null, ownerHeartbeatAt: null, startedAt: null,
  finishedAt: null, failureCode: null, failureMessage: null, createdAt: new Date(), updatedAt: new Date(),
};
const binding = (status: "shadow" | "canary" | "active") => ({
  id: "evaluation-1", companyId: run.companyId, workflowId: run.workflowId, workflowRevisionId: run.workflowRevisionId,
  nodeId: "transform-1", artifactId: "artifact-1", artifactVersionId: "version-1", status, canaryTrafficPercent: 100,
  knownInputShapes: [optimizerShapeHash({ value: 1 })!], memoryRecordIds: [], compilerResult: { status: "compiled", candidate: { kind: "artifact", artifact: {
    kind: "expression", sideEffectClass: "pure", riskClass: "C0", outputSchema: { type: "object" },
  } } }, replayEvaluation: { status: "passed", criticalInvariantFailure: false, missingCategories: [], failedCaseCount: 0, unsupportedCaseCount: 0 }, invariants: [],
});

function harness(mode: "shadow" | "canary" | "active", options: { withdraw?: boolean } = {}) {
  const pinned = { id: "step-1", nodeId: "transform-1", status: "running" };
  const observation = { id: "observation-1" };
  const selects: unknown[] = [];
  const update = () => ({ set: () => ({ where: () => ({ returning: async () => [pinned] }) }) });
  const insert = () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [observation] }) }) });
  type Query = {
    from(value: unknown): Query;
    where(...args: unknown[]): Query;
    orderBy(...args: unknown[]): Query;
    limit(...args: unknown[]): Query;
    for(...args: unknown[]): Query;
    then<TResult1 = unknown[], TResult2 = never>(resolve?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
  };
  type TestDb = {
    select: (...args: unknown[]) => Query;
    update: typeof update;
    insert: typeof insert;
    transaction: (fn: (tx: TestDb) => Promise<unknown>) => Promise<unknown>;
  };
  const fixtureDb: TestDb = {
    select: (..._args: unknown[]): Query => {
      let table: unknown;
      let query: Query;
      query = {
        from(value) { table = value; return query; },
        where() { return query; }, orderBy() { return query; }, limit() { return query; }, for() { return query; },
        then(resolve, reject) {
          const index = selects.length;
          selects.push(table);
          let rows: unknown[];
          if (table === workflowOptimizerEvaluations) {
            rows = index === 0 ? [binding(mode)] : [{ ...binding(options.withdraw ? "shadow" : mode), status: options.withdraw ? "shadow" : mode }];
            if (index === 3 && options.withdraw) rows = [{ ...binding("shadow"), status: "shadow" }];
          } else if (table === workflowRuns) rows = [run];
          else rows = [];
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
    update,
    insert,
    transaction: async (fn) => fn(fixtureDb),
  };
  mocks.assertBinding.mockResolvedValue({ evaluation: binding(mode), artifact: { status: mode === "canary" ? "shadow" : mode } });
  mocks.drift.mockResolvedValue(null);
  mocks.source.mockImplementation((_db: Db, _company: string, _version: string, _actor: AutomationArtifactMutationActor, _consumer: unknown, use: (tx: Db, reader: AuthorizationActor | undefined) => Promise<unknown>) => use(_db, undefined));
  return { fixtureDb };
}

async function execute(mode: "shadow" | "canary" | "active", trusted: () => unknown | Promise<unknown>, options?: { withdraw?: boolean }) {
  const { fixtureDb } = harness(mode, options);
  return executeOptimizedWorkflowTransform(fixtureDb as unknown as Db, run, "transform-1", { value: 1 }, [], trusted, "step-1", actor);
}

afterEach(() => vi.clearAllMocks());

describe("executeOptimizedWorkflowTransform trusted fallback", () => {
  it.each(["shadow", "canary"] as const)("preserves the first trusted rejection in %s mode", async (mode) => {
    const originalError = new Error("trusted failed once");
    const trusted = vi.fn().mockRejectedValueOnce(originalError).mockResolvedValue({ recovered: true });
    await expect(execute(mode, trusted)).rejects.toBe(originalError);
    expect(trusted).toHaveBeenCalledTimes(1);
  });

  it("reuses the exact trusted object after a canary mismatch", async () => {
    const trustedOutput = { trusted: true };
    mocks.candidate.mockResolvedValue({ candidate: true });
    const trusted = vi.fn().mockResolvedValue(trustedOutput);
    await expect(execute("canary", trusted)).resolves.toBe(trustedOutput);
    expect(trusted).toHaveBeenCalledTimes(1);
    expect(mocks.candidate).toHaveBeenCalledTimes(1);
  });

  it("uses the original trusted output once when shadow candidate execution fails", async () => {
    const trustedOutput = { champion: "shadow" };
    mocks.candidate.mockRejectedValue(new Error("candidate failed"));
    const trusted = vi.fn().mockResolvedValue(trustedOutput);
    await expect(execute("shadow", trusted)).resolves.toBe(trustedOutput);
    expect(trusted).toHaveBeenCalledTimes(1);
    expect(mocks.candidate).toHaveBeenCalledTimes(1);
  });

  it("uses the original trusted output once when persisted mode is withdrawn", async () => {
    const trustedOutput = { champion: "canary withdrawal" };
    const trusted = vi.fn().mockResolvedValue(trustedOutput);
    mocks.candidate.mockResolvedValue(trustedOutput);
    await expect(execute("canary", trusted, { withdraw: true })).resolves.toBe(trustedOutput);
    expect(trusted).toHaveBeenCalledTimes(1);
    expect(mocks.candidate).toHaveBeenCalledTimes(1);
  });

  it("uses the trusted output once after an active candidate failure", async () => {
    const trustedOutput = { champion: "active" };
    mocks.candidate.mockRejectedValue(new Error("candidate failed"));
    const trusted = vi.fn().mockResolvedValue(trustedOutput);
    await expect(execute("active", trusted)).resolves.toBe(trustedOutput);
    expect(trusted).toHaveBeenCalledTimes(1);
    expect(mocks.candidate).toHaveBeenCalledTimes(1);
  });
});
