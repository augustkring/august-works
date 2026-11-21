import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  toolActionRequests,
  toolInvocations,
  toolPolicies,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { classifyNativeEvidence } from "./evidence-classifier.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping embedded Postgres tool_invocation evidence tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

/** `tool_invocation:<invocationId>` evidence: an executed tool call admitted by
 * a Human decision or a current standing Human grant, for invariant and
 * verification criteria only. */
describeEmbeddedPostgres("evidence classifier: tool_invocation refs", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID(), agentId = randomUUID(), userId = `user-${randomUUID()}`;
  const contract = { revision: "1", objective: "Read the projects",
    criteria: [{ id: "output_result", requirement: "Write the result" }, { id: "invariant_0", requirement: "Only a Human-admitted read" }] };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-evidence-tool-invocation-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Evidence", issuePrefix: "EVI" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", adapterType: "codex_local", status: "running" });
  }, 60_000);

  afterAll(async () => { await tempDb?.cleanup(); });

  type Options = { status?: string; approvalState?: string; sealed?: boolean; otherTask?: boolean;
    admission: "request" | "rule" | "none"; requestStatus?: string; requestByAgent?: boolean;
    ruleEnabled?: boolean; ruleRevoked?: boolean; ruleByAgent?: boolean; ruleExpiresAt?: string | null };

  async function seed(options: Options) {
    const issueId = randomUUID(), otherIssueId = randomUUID(), runId = randomUUID(), invocationId = randomUUID();
    await db.insert(issues).values([{ id: issueId, companyId, title: "Task", status: "in_progress", assigneeAgentId: agentId },
      { id: otherIssueId, companyId, title: "Other Task", status: "in_progress", assigneeAgentId: agentId }]);
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "succeeded", contextSnapshot: { issueId },
      runnerProfileJson: options.sealed === false ? {} : { nativeToolResultSourceCaptures: [{ callId: "call-1", tool: "railway",
        source: { kind: "tool_result", runId, callId: "call-1", toolName: "railway", invocationId, contentHash: "a".repeat(64) } }] } });
    let policyId: string | null = null;
    if (options.admission === "rule") {
      const [policy] = await db.insert(toolPolicies).values({ companyId, name: `Trust ${randomUUID()}`, policyType: "trust_rule",
        enabled: options.ruleEnabled ?? true, createdByUserId: options.ruleByAgent ? null : userId,
        createdByAgentId: options.ruleByAgent ? agentId : null,
        config: { trustRule: { sourceActionRequestId: randomUUID(), revokedAt: options.ruleRevoked ? new Date().toISOString() : null,
          expiresAt: options.ruleExpiresAt === undefined ? null : options.ruleExpiresAt } } }).returning();
      policyId = policy!.id;
    }
    await db.insert(toolInvocations).values({ id: invocationId, companyId, toolName: "railway", actorType: "agent", actorId: agentId,
      agentId, issueId: options.otherTask ? otherIssueId : issueId, runId, status: (options.status ?? "succeeded") as never,
      approvalState: (options.approvalState ?? (options.admission === "request" ? "approved" : "not_required")) as never,
      policyDecision: (options.admission === "request" ? "require_approval" : "allow") as never,
      matchedPolicyIds: policyId ? [policyId] : [] });
    if (options.admission === "request")
      await db.insert(toolActionRequests).values({ companyId, invocationId, issueId: options.otherTask ? otherIssueId : issueId,
        status: (options.requestStatus ?? "executed") as never, canonicalArgumentsHash: "b".repeat(64),
        canonicalArgumentsSummary: {} as never, decidedByUserId: options.requestByAgent ? null : userId,
        decidedByAgentId: options.requestByAgent ? agentId : null, decidedAt: new Date() });
    return { issueId, runId, invocationId, policyId };
  }

  async function classify(fixture: { issueId: string; runId: string; invocationId: string }, criterionId = "invariant_0") {
    const ref = `tool_invocation:${fixture.invocationId}`;
    const assessment = await classifyNativeEvidence({ db: db as never, companyId, issueId: fixture.issueId, runId: fixture.runId, contract,
      result: { reportedWorkDisposition: "done", summary: "Read", completionClaim: { contractRevision: "1", objectiveSatisfied: true,
        criteria: contract.criteria.map(criterion => ({ criterionId: criterion.id, status: "satisfied",
          evidenceRefs: criterion.id === criterionId ? [ref] : [] })), remainingWork: [] },
        verification: [{ commandOrCheck: "The Human-admitted read ran", status: "passed", artifactRef: ref }] } });
    const criterion = assessment.criterionAssessments.find(entry => entry.criterionId === criterionId)!;
    return { criterion: criterion.outcome, ref: criterion.evidenceRefs[0]?.reasonCode, verification: assessment.verificationAssessments[0]!.outcome };
  }

  it("accepts an executed call a Human approved on this Task, for an invariant and the verification", async () => {
    expect(await classify(await seed({ admission: "request" }))).toEqual({ criterion: "accepted",
      ref: "tool_invocation_human_approved", verification: "accepted" });
  });

  it("accepts an executed call admitted by a current standing Human grant", async () => {
    expect(await classify(await seed({ admission: "rule" }))).toEqual({ criterion: "accepted",
      ref: "tool_invocation_standing_human_grant", verification: "accepted" });
    expect(await classify(await seed({ admission: "rule", ruleExpiresAt: new Date(Date.now() + 3_600_000).toISOString() })))
      .toMatchObject({ criterion: "accepted" });
  });

  it("never counts it for an output criterion", async () => {
    expect(await classify(await seed({ admission: "request" }), "output_result")).toMatchObject({ criterion: "unverifiable",
      ref: "tool_invocation_evidence_not_output" });
  });

  it.each([
    ["a failed call", { admission: "request", status: "failed", requestStatus: "failed" }, "rejected", "tool_invocation_not_executed"],
    ["a pending call", { admission: "request", status: "awaiting_approval", approvalState: "pending", requestStatus: "pending" }, "missing", "tool_invocation_pending"],
    ["a declined call", { admission: "request", status: "denied", approvalState: "rejected", requestStatus: "rejected" }, "rejected", "tool_invocation_not_executed"],
    ["another Task's call", { admission: "request", otherTask: true }, "missing", "tool_invocation_missing"],
    ["an Agent's decision", { admission: "request", requestByAgent: true }, "rejected", "tool_invocation_admission_not_human"],
    ["a revoked grant", { admission: "rule", ruleRevoked: true }, "rejected", "tool_invocation_grant_not_current"],
    ["a disabled grant", { admission: "rule", ruleEnabled: false }, "rejected", "tool_invocation_grant_not_current"],
    ["an expired grant", { admission: "rule", ruleExpiresAt: new Date(Date.now() - 1000).toISOString() }, "rejected", "tool_invocation_grant_not_current"],
    ["an Agent-created grant", { admission: "rule", ruleByAgent: true }, "rejected", "tool_invocation_grant_not_current"],
    ["a call with no Human admission", { admission: "none" }, "rejected", "tool_invocation_admission_not_human"],
    ["a call without its sealed result capture", { admission: "request", sealed: false }, "unverifiable", "tool_invocation_result_not_sealed"],
  ] as const)("refuses %s", async (_name, options, outcome, reasonCode) => {
    expect(await classify(await seed(options as Options))).toMatchObject({ criterion: outcome, ref: reasonCode });
  });
});
