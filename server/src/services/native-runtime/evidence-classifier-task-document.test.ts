import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  completionContracts,
  createDb,
  documentRevisions,
  documents,
  heartbeatRuns,
  issueDocuments,
  issues,
  orchestrationPlans,
  orchestrationToolCharges,
  toolInvocations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { nativeSha256 } from "./canonical.js";
import { classifyNativeEvidence } from "./evidence-classifier.js";
import { nativeExecutionStageHandoffClaimed } from "./status-arbiter.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping embedded Postgres Task document evidence tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

const resultSchema = { type: "object", required: ["approved"], properties: { approved: { const: true } }, additionalProperties: false };

function contract(options: { jsonSchema?: Record<string, unknown> | null; v7?: boolean } = {}) {
  const v7 = {
    objective: "Write the declared result document for the stage review",
    requiredOutputs: [{ kind: "task_document", key: "result", jsonSchema: options.jsonSchema ?? null }],
    businessInvariants: ["The assigned Reviewer records the stage decision"],
    evidenceRequirements: [], prohibitedOutcomes: [], requiredPostconditions: [],
  };
  return {
    revision: "1",
    objective: v7.objective,
    criteria: [
      { id: "output_result", requirement: "Save the required result document on this canonical Task" },
      { id: "invariant_0", requirement: v7.businessInvariants[0] },
    ],
    ...(options.v7 === false ? {} : { v7 }),
  };
}

function result(outputRefs: string[], options: { invariantRefs?: string[]; verificationRef?: string } = {}) {
  return {
    reportedWorkDisposition: "done",
    summary: "Saved the result for the stage review",
    completionClaim: {
      contractRevision: "1",
      objectiveSatisfied: true,
      criteria: [
        { criterionId: "output_result", status: "satisfied", evidenceRefs: outputRefs },
        options.invariantRefs
          ? { criterionId: "invariant_0", status: "satisfied", evidenceRefs: options.invariantRefs }
          : { criterionId: "invariant_0", status: "unknown", evidenceRefs: [] },
      ],
      remainingWork: [],
    },
    verification: options.verificationRef
      ? [{ commandOrCheck: "Review the saved result", status: "passed", artifactRef: options.verificationRef }]
      : [],
  };
}

/** MS1f decision 2. `document:<docId>:<revisionId>` is accepted only for the
 * current declared output this Run wrote through a charged write_document. */
describeEmbeddedPostgres("Native evidence classifier: Task document evidence (MS1f)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID();
  const agentId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-task-document-evidence-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({ id: companyId, name: "Document evidence", issuePrefix: "DOC" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Plan Worker", adapterType: "codex_local", status: "running" });
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function task() {
    const [row] = await db.insert(issues).values({ companyId, title: "Planned Task", status: "in_progress", assigneeAgentId: agentId,
      workMode: "standard" }).returning();
    return row!.id;
  }

  async function nativeRun(issueId: string, existingContractId?: string) {
    const runId = randomUUID(), contractId = existingContractId ?? randomUUID();
    if (!existingContractId) await db.insert(completionContracts).values({ id: contractId, companyId, issueId, revision: 1, schemaVersion: "aw.completion-contract.v7",
      policyVersion: "aw-orchestration-v7.1", risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
      contractJson: contract(), canonicalSha256: `contract-${contractId}`, createdByActorType: "user", createdByActorId: "test" });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId,
      nativeSessionId: randomUUID(), runnerInstanceId: randomUUID(), completionContractId: contractId,
      completionContractSha256: `contract-${contractId}`, contextSnapshot: { issueId } });
    return { runId, contractId };
  }

  async function fixture() {
    const issueId = await task();
    const { runId, contractId } = await nativeRun(issueId);
    const planId = randomUUID();
    await db.insert(orchestrationPlans).values({ id: planId, companyId, issueId, completionContractId: contractId, mode: "single_worker",
      actionClass: "internal_draft", riskClass: "C0", supervisionMode: "none", verificationMode: "deterministic",
      humanOversightMode: "human_review", createdBy: "user-test", budgets: { maxWorkerCount: 1, maxParallelWorkers: 1,
        maxDelegationDepth: 1, maxRetries: 0, maxWallClockSeconds: 3600, maxToolActions: 5, maxModelCostMinor: 1000 } });
    return { issueId, runId, planId, contractId };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  /** A write_document by `runId`: the semantic receipt, its tool invocation and the plan charge. */
  async function recordWrite(f: Fixture, written: { documentId: string; key: string; revisionId: string },
    options: { runId?: string; status?: string; charged?: boolean; receipt?: boolean; operationId?: string;
      invocation?: { runId?: string; issueId?: string; toolName?: string } } = {}) {
    const runId = options.runId ?? f.runId;
    const invocationRunId = options.invocation?.runId ?? runId;
    const args = { idempotencyKey: `write-${randomUUID()}`, key: written.key, title: "Result", body: "retained body" };
    const [invocation] = await db.insert(toolInvocations).values({ companyId, runId: invocationRunId,
      issueId: options.invocation?.issueId ?? f.issueId, agentId, actorType: "agent",
      actorId: agentId, idempotencyKey: `aw-native-tool:${invocationRunId}:${randomUUID()}`, toolName: options.invocation?.toolName ?? "write_document",
      argumentsHash: nativeSha256(args), riskLevel: "low", policyDecision: "allow", approvalState: "not_required",
      status: (options.status ?? "succeeded") as "succeeded" }).returning();
    if (options.charged !== false)
      await db.insert(orchestrationToolCharges).values({ invocationId: invocation!.id, companyId, planId: f.planId });
    if (options.receipt === false) return;
    const [run] = await db.select({ resultJson: heartbeatRuns.resultJson }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    const resultJson = (run?.resultJson ?? {}) as Record<string, unknown>;
    const receipts = (resultJson.semanticToolReceipts ?? {}) as Record<string, unknown>;
    receipts[args.idempotencyKey] = { operationId: options.operationId ?? "write_document", input: args,
      result: { disposition: "applied", created: true, document: { id: written.documentId, key: written.key, latestRevisionId: written.revisionId } } };
    await db.update(heartbeatRuns).set({ resultJson: { ...resultJson, semanticToolReceipts: receipts } }).where(eq(heartbeatRuns.id, runId));
  }

  /** The declared output document on `issueId`, its first revision created by `revisionRunId`. */
  async function saveOutput(f: Fixture, options: { key?: string; issueId?: string; body?: string; revisionRunId?: string;
    write?: Parameters<typeof recordWrite>[2] | false } = {}) {
    const body = options.body ?? "The result the stage Reviewer will check";
    const key = options.key ?? "result";
    const [doc] = await db.insert(documents).values({ companyId, title: "Result", latestBody: body, createdByAgentId: agentId }).returning();
    const [revision] = await db.insert(documentRevisions).values({ companyId, documentId: doc!.id, revisionNumber: 1, body,
      createdByAgentId: agentId, createdByRunId: options.revisionRunId ?? f.runId }).returning();
    await db.update(documents).set({ latestRevisionId: revision!.id }).where(eq(documents.id, doc!.id));
    await db.insert(issueDocuments).values({ companyId, issueId: options.issueId ?? f.issueId, documentId: doc!.id, key });
    if (options.write !== false) await recordWrite(f, { documentId: doc!.id, key, revisionId: revision!.id }, options.write ?? {});
    return { documentId: doc!.id, revisionId: revision!.id, ref: `document:${doc!.id}:${revision!.id}` };
  }

  async function classify(f: Fixture, value: Record<string, unknown>, contractJson: Record<string, unknown> = contract()) {
    return classifyNativeEvidence({ db, companyId, issueId: f.issueId, runId: f.runId, contract: contractJson, result: value });
  }

  async function outputRef(f: Fixture, ref: string, contractJson?: Record<string, unknown>) {
    const assessment = await classify(f, result([ref]), contractJson);
    return { assessment, criterion: assessment.criterionAssessments[0]!, evidence: assessment.criterionAssessments[0]!.evidenceRefs[0]! };
  }

  it("accepts the current declared output this Run wrote through a charged write_document", async () => {
    const f = await fixture();
    const output = await saveOutput(f);
    const { assessment, criterion, evidence } = await outputRef(f, output.ref);
    expect(evidence).toEqual({ ref: output.ref, kind: "document", outcome: "accepted", reasonCode: "task_document_output_current",
      durableRecordId: output.revisionId, outputKey: "result" });
    expect(criterion).toMatchObject({ criterionId: "output_result", outcome: "accepted", reasonCode: "criterion_evidence_accepted" });
    // The Reviewer's later decision stays unknown: not complete, but a stage handoff claim.
    expect(assessment.allCriteriaSatisfied).toBe(false);
    expect(nativeExecutionStageHandoffClaimed(assessment)).toBe(true);
    // A model may annotate the ref, as for the other durable references.
    expect((await outputRef(f, `${output.ref} (result document)`)).evidence)
      .toMatchObject({ outcome: "accepted", reasonCode: "task_document_output_current" });
    // A declared schema that validates is accepted.
    const g = await fixture();
    const valid = await saveOutput(g, { body: '{"approved":true}' });
    expect((await outputRef(g, valid.ref, contract({ jsonSchema: resultSchema }))).evidence).toMatchObject({ outcome: "accepted" });
  });

  it("refuses a stale revision and a revision whose body is not the document's latest body", async () => {
    const f = await fixture();
    const output = await saveOutput(f);
    const [second] = await db.insert(documentRevisions).values({ companyId, documentId: output.documentId, revisionNumber: 2,
      body: "A later result", createdByAgentId: agentId, createdByRunId: f.runId }).returning();
    await db.update(documents).set({ latestBody: "A later result", latestRevisionId: second!.id, latestRevisionNumber: 2 })
      .where(eq(documents.id, output.documentId));
    await recordWrite(f, { documentId: output.documentId, key: "result", revisionId: second!.id });
    const stale = await outputRef(f, output.ref);
    expect(stale.evidence).toMatchObject({ kind: "document", outcome: "rejected", reasonCode: "document_revision_not_latest" });
    expect(stale.criterion).toMatchObject({ outcome: "rejected", reasonCode: "criterion_evidence_rejected" });
    expect(nativeExecutionStageHandoffClaimed(stale.assessment)).toBe(false);
    expect((await outputRef(f, `document:${output.documentId}:${second!.id}`)).evidence).toMatchObject({ outcome: "accepted" });

    const g = await fixture();
    const changed = await saveOutput(g);
    await db.update(documents).set({ latestBody: "Edited without a revision" }).where(eq(documents.id, changed.documentId));
    expect((await outputRef(g, changed.ref)).evidence).toMatchObject({ outcome: "rejected", reasonCode: "document_revision_not_current" });
  });

  it("refuses a revision another Run created", async () => {
    const f = await fixture();
    const other = await nativeRun(f.issueId, f.contractId);
    const output = await saveOutput(f, { revisionRunId: other.runId });
    const { evidence, criterion } = await outputRef(f, output.ref);
    expect(evidence).toMatchObject({ outcome: "unverifiable", reasonCode: "document_revision_not_from_run" });
    expect(evidence).not.toHaveProperty("outputKey");
    expect(criterion).toMatchObject({ outcome: "unverifiable", reasonCode: "criterion_evidence_unverifiable" });
  });

  it("refuses a document under an undeclared key or without a V7 contract", async () => {
    const f = await fixture();
    const notes = await saveOutput(f, { key: "notes" });
    expect((await outputRef(f, notes.ref)).evidence).toMatchObject({ outcome: "unverifiable", reasonCode: "document_output_not_declared" });
    const output = await saveOutput(f);
    expect((await outputRef(f, output.ref, contract({ v7: false }))).evidence)
      .toMatchObject({ outcome: "unverifiable", reasonCode: "document_output_not_declared" });
    const project = contract();
    project.v7!.requiredOutputs = [{ kind: "private_project", key: "result", jsonSchema: null }];
    expect((await outputRef(f, output.ref, project)).evidence)
      .toMatchObject({ outcome: "unverifiable", reasonCode: "document_output_not_declared" });
  });

  it("resolves the cited document, not another document of the Task", async () => {
    const f = await fixture();
    const output = await saveOutput(f);
    const notes = await saveOutput(f, { key: "notes" });
    expect((await outputRef(f, output.ref)).evidence).toMatchObject({ outcome: "accepted", outputKey: "result" });
    expect((await outputRef(f, notes.ref)).evidence).toMatchObject({ outcome: "unverifiable", reasonCode: "document_output_not_declared" });
    expect((await outputRef(f, `document:${notes.documentId}:${output.revisionId}`)).evidence)
      .toMatchObject({ outcome: "unverifiable", reasonCode: "document_output_not_declared" });
  });

  it("refuses an empty declared output", async () => {
    const f = await fixture();
    const output = await saveOutput(f, { body: "   " });
    expect((await outputRef(f, output.ref)).evidence).toMatchObject({ outcome: "missing", reasonCode: "document_output_missing" });
  });

  it("refuses a document of another Task", async () => {
    const f = await fixture();
    const otherTask = await task();
    const output = await saveOutput(f, { issueId: otherTask });
    expect((await outputRef(f, output.ref)).evidence).toMatchObject({ outcome: "missing", reasonCode: "document_missing", durableRecordId: null });
  });

  it("refuses an output without a succeeded, charged write_document of this Run for that revision and key", async () => {
    const cases: Array<[string, (f: Fixture) => Promise<string>]> = [
      ["no plan charge", async (f) => (await saveOutput(f, { write: { charged: false } })).ref],
      ["a failed invocation", async (f) => (await saveOutput(f, { write: { status: "failed" } })).ref],
      ["no semantic receipt", async (f) => (await saveOutput(f, { write: { receipt: false } })).ref],
      ["no write at all", async (f) => (await saveOutput(f, { write: false })).ref],
      ["another Run's charged write", async (f) => {
        const other = await nativeRun(f.issueId, f.contractId);
        return (await saveOutput(f, { write: { runId: other.runId } })).ref;
      }],
      ["this Run's receipt with another Run's charged invocation", async (f) => {
        const other = await nativeRun(f.issueId, f.contractId);
        return (await saveOutput(f, { write: { invocation: { runId: other.runId } } })).ref;
      }],
      ["a charged invocation on another Task", async (f) => (await saveOutput(f, { write: { invocation: { issueId: await task() } } })).ref],
      ["a charged invocation of another tool", async (f) => (await saveOutput(f, { write: { invocation: { toolName: "create_task" } } })).ref],
      ["a receipt of another operation", async (f) => (await saveOutput(f, { write: { operationId: "create_task" } })).ref],
      ["another charged write_document of this Run", async (f) => {
        const output = await saveOutput(f, { write: { charged: false } });
        const notes = await saveOutput(f, { key: "notes", write: false });
        await recordWrite(f, { documentId: notes.documentId, key: "notes", revisionId: notes.revisionId });
        return output.ref;
      }],
      ["a write of another revision", async (f) => {
        const output = await saveOutput(f, { write: false });
        await recordWrite(f, { documentId: output.documentId, key: "result", revisionId: randomUUID() });
        return output.ref;
      }],
      ["a write under another key", async (f) => {
        const output = await saveOutput(f, { write: false });
        await recordWrite(f, { documentId: output.documentId, key: "notes", revisionId: output.revisionId });
        return output.ref;
      }],
    ];
    for (const [name, arrange] of cases) {
      const f = await fixture();
      const ref = await arrange(f);
      const { evidence } = await outputRef(f, ref);
      expect({ name, outcome: evidence.outcome, reasonCode: evidence.reasonCode })
        .toEqual({ name, outcome: "unverifiable", reasonCode: "document_write_not_charged" });
    }
  });

  it("refuses a body that does not validate against the declared schema", async () => {
    const f = await fixture();
    const output = await saveOutput(f, { body: '{"approved":false}' });
    expect((await outputRef(f, output.ref, contract({ jsonSchema: resultSchema }))).evidence)
      .toMatchObject({ outcome: "rejected", reasonCode: "document_schema_mismatch" });
  });

  it("is evidence for its own output criterion only, never for another criterion or a verification", async () => {
    const f = await fixture();
    const output = await saveOutput(f);
    const assessment = await classify(f, result([output.ref], { invariantRefs: [output.ref], verificationRef: output.ref }));
    expect(assessment.criterionAssessments[0]).toMatchObject({ criterionId: "output_result", outcome: "accepted" });
    expect(assessment.criterionAssessments[1]).toMatchObject({ criterionId: "invariant_0", outcome: "unverifiable",
      evidenceRefs: [expect.objectContaining({ outcome: "unverifiable", reasonCode: "document_evidence_other_criterion" })] });
    expect(assessment.verificationAssessments[0]).toMatchObject({ outcome: "unverifiable", reasonCode: "document_evidence_not_verification" });
    expect(assessment.allCriteriaSatisfied).toBe(false);
    expect(assessment.verificationPassed).toBe(false);
    // Accepted for its own output criterion: listed once as accepted evidence.
    expect(assessment.acceptedEvidenceRefs).toEqual([output.ref]);
  });

  it("does not list a document ref cited only for another criterion or a verification as accepted evidence (MS1f phase 2 finding 3)", async () => {
    const f = await fixture();
    const output = await saveOutput(f);
    const assessment = await classify(f, result([], { invariantRefs: [output.ref], verificationRef: output.ref }));
    expect(assessment.criterionAssessments[1]).toMatchObject({ criterionId: "invariant_0",
      evidenceRefs: [expect.objectContaining({ outcome: "unverifiable", reasonCode: "document_evidence_other_criterion" })] });
    expect(assessment.verificationAssessments[0]).toMatchObject({ reasonCode: "document_evidence_not_verification" });
    expect(assessment.acceptedEvidenceRefs).toEqual([]);
  });
});
