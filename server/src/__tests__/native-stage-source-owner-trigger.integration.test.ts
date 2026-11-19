import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issueComments, issueExecutionDecisions, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// MS1f phase 4 (migration 0586). A Native stage Reviewer's approving comment
// transforms the Task source (`native_stage_policy`, owner `native_stage_comment`).
// The deferred trigger `issues_native_stage_source_owner` must accept the actual
// decision of the stage that was current before the update; in 0571 its
// `d.stage_id IS NOT DISTINCT FROM OLD.execution_state->>'currentStageId'`
// compared uuid with text and PostgreSQL refused the statement.
const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

const migrationsDir = fileURLToPath(new URL("../../../packages/db/src/migrations/", import.meta.url));
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const cause = (error: unknown): { code?: string; message?: string } => {
  let current = error as { code?: string; message?: string; cause?: unknown } | undefined;
  while (current && typeof current === "object") {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) return current;
    current = current.cause as typeof current;
  }
  return {};
};

describeDb("issues_native_stage_source_owner: Stage approval-comment source transform (MS1f phase 4, 0586)", () => {
  let db!: Db;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("native-stage-source-owner-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => { await temporary?.cleanup(); });

  /** One Task under a pending review stage with a sealed manual source
   * snapshot, the stage Reviewer's Native Run, its approving stage decision and
   * comment, and every receipt the trigger binds. Returns the exact update. */
  async function seed(variant: { decisionStageId?: "other"; commentRun?: "other" } = {}) {
    const ids = { company: randomUUID(), reviewer: randomUUID(), executor: randomUUID(), issue: randomUUID(), run: randomUUID(),
      otherRun: randomUUID(), stage: randomUUID(), decision: randomUUID(), comment: randomUUID(), transition: randomUUID(),
      user: `user-${randomUUID()}` };
    await db.insert(companies).values({ id: ids.company, name: "Stage source", issuePrefix: `T${ids.company.slice(0, 6).toUpperCase()}` });
    await db.insert(agents).values([
      { id: ids.reviewer, companyId: ids.company, name: "Reviewer", adapterType: "paperclip_runner", status: "running", adapterConfig: {} },
      { id: ids.executor, companyId: ids.company, name: "Executor", adapterType: "paperclip_runner", status: "idle", adapterConfig: {} },
    ]);
    const fromState = { status: "pending", currentStageId: ids.stage, currentStageIndex: 0, currentStageType: "review",
      currentParticipant: { type: "agent", agentId: ids.reviewer, userId: null },
      returnAssignee: { type: "agent", agentId: ids.executor, userId: null }, reviewRequest: null,
      completedStageIds: [], lastDecisionId: null, lastDecisionOutcome: null };
    const toState = { ...fromState, status: "completed", currentStageId: null, currentStageIndex: null, currentStageType: null,
      currentParticipant: null, completedStageIds: [ids.stage], lastDecisionId: ids.decision, lastDecisionOutcome: "approved" };
    await db.insert(issues).values({ id: ids.issue, companyId: ids.company, title: "Planned task", description: "Review it",
      status: "in_review", assigneeAgentId: ids.reviewer, payloadSourceProtocolVersion: 1, executionState: fromState });
    // Seal the manual Task snapshot over the current body (digest over the JSONB text).
    await db.execute(sql`with s as (select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','issue',
        'companyId',i.company_id::text,'id',i.id::text,'contentHash',public.aw_native_payload_body_hash('issue',to_jsonb(i))),
        'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,
        'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as snap from issues i where i.id=${ids.issue}::uuid)
      update issues set payload_source_snapshot = s.snap || jsonb_build_object('digest',encode(sha256(convert_to(s.snap::text,'UTF8')),'hex'))
      from s where issues.id=${ids.issue}::uuid`);
    const [hashes] = await db.execute<{ oldSnapshot: Record<string, unknown>; oldHash: string; newHash: string }>(sql`select
      i.payload_source_snapshot as "oldSnapshot", public.aw_native_payload_body_hash('issue',to_jsonb(i)) as "oldHash",
      public.aw_native_payload_body_hash('issue',to_jsonb(i) || jsonb_build_object('execution_state',${JSON.stringify(toState)}::jsonb)) as "newHash"
      from issues i where i.id=${ids.issue}::uuid`);
    const { oldSnapshot, oldHash, newHash } = hashes!;
    const effect = { callId: `stage-comment-${ids.run}`, turnId: "turn-1" };
    const receiptKey = sha256(effect.callId);
    // The Run's sealed Native input receipt (its own binding trigger checks the
    // shape and digests over the JSONB text, so both are computed in SQL).
    const executionInput = { schema: "native-stage-source-owner-test" };
    const unsealed = (runId: string) => ({ version: 1, binding: { companyId: ids.company, runId, agentId: ids.reviewer,
      responsibleUserId: ids.user, issueId: ids.issue }, bootstrap: { executionInputDigest: "", policy: { issueIds: [],
      projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [] }, dispatches: [], additionalInputs: [] });
    const sealReceipt = async (runId: string) => {
      const [digests] = await db.execute<{ input: string }>(sql`select encode(sha256(convert_to(${JSON.stringify(executionInput)}::jsonb::text,'UTF8')),'hex') as input`);
      const body = unsealed(runId);
      body.bootstrap.executionInputDigest = digests!.input;
      const [sealed] = await db.execute<{ digest: string }>(sql`select encode(sha256(convert_to(${JSON.stringify(body)}::jsonb::text,'UTF8')),'hex') as digest`);
      return { ...body, digest: sealed!.digest };
    };
    const inputReceipt = await sealReceipt(ids.run);
    const otherInputReceipt = await sealReceipt(ids.otherRun);
    const receipt = { version: 1, companyId: ids.company, issueId: ids.issue, runId: ids.run, agentId: ids.reviewer,
      responsibleUserId: ids.user, transitionId: ids.transition,
      owner: { kind: "native_stage_comment", runId: ids.run, decisionId: ids.decision, commentId: ids.comment, effect },
      originalInputReceiptDigest: inputReceipt.digest, originalDispatchCount: 0, originalAdditionalInputCount: 0,
      executionInputDigest: inputReceipt.bootstrap.executionInputDigest, originalSnapshot: oldSnapshot,
      previousOwnerContentHash: oldHash, nextOwnerContentHash: newHash, fromExecutionState: fromState, toExecutionState: toState,
      fromUnblockDescriptor: null, toUnblockDescriptor: null, ownerFingerprint: "c".repeat(64) };
    const policyTransition = { version: 1, origin: {}, companyId: ids.company, issueId: ids.issue, runId: ids.run,
      agentId: ids.reviewer, responsibleUserId: ids.user, originalReceiptDigest: inputReceipt.digest, originalDispatchCount: 0,
      originalAdditionalInputCount: 0, executionInputDigest: inputReceipt.bootstrap.executionInputDigest, stageSource: {}, effect,
      fromState, toState, stageDecisionId: ids.decision, stageDecisionHash: "d".repeat(64), commentId: ids.comment,
      commentHash: "e".repeat(64) };
    await db.insert(heartbeatRuns).values([ids.run, ids.otherRun].map(id => ({ id, companyId: ids.company, agentId: ids.reviewer,
      status: "running", runtimeMode: "native", scopeKind: "issue", issueId: ids.issue, nativeIssueId: ids.issue,
      responsibleUserId: ids.user, startedAt: new Date(),
      resultJson: id === ids.run ? { nativeStageTaskBodyTransitions: { [ids.transition]: receipt },
        nativeStagePolicyTransitions: { [receiptKey]: policyTransition } } : {},
      nativeInputSourceProtocolVersion: 1,
      runnerProfileJson: { nativeExecutionInput: executionInput,
        nativeInputSourceReceipt: id === ids.run ? inputReceipt : otherInputReceipt,
        nativeBootstrapTaskSource: { payloadSourceSnapshot: oldSnapshot, input: { kind: "task", issueId: ids.issue, contentHash: oldHash } } } })));
    await db.insert(issueExecutionDecisions).values({ id: ids.decision, companyId: ids.company, issueId: ids.issue,
      stageId: variant.decisionStageId === "other" ? randomUUID() : ids.stage, stageType: "review", actorAgentId: ids.reviewer,
      outcome: "approved", body: "## Review: APPROVED", createdByRunId: ids.run });
    await db.insert(issueComments).values({ id: ids.comment, companyId: ids.company, issueId: ids.issue, authorAgentId: ids.reviewer,
      authorType: "agent", body: "## Review: APPROVED", createdByRunId: variant.commentRun === "other" ? ids.otherRun : ids.run });
    const [stored] = await db.execute<{ receiptHash: string }>(sql`select encode(sha256(convert_to((result_json->'nativeStageTaskBodyTransitions'->${ids.transition}::text)::text,'UTF8')),'hex') as "receiptHash"
      from heartbeat_runs where id=${ids.run}::uuid`);
    const step = { kind: "native_stage_policy", transitionId: ids.transition, runId: ids.run, ownerKind: "native_stage_comment",
      decisionId: ids.decision, receiptHash: stored!.receiptHash, previousSnapshotDigest: oldSnapshot.digest,
      previousOwnerContentHash: oldHash, nextOwnerContentHash: newHash };
    const transform = () => db.transaction(async tx => {
      await tx.execute(sql`with s as (select (i.payload_source_snapshot - 'digest') || jsonb_build_object(
          'owner',(i.payload_source_snapshot->'owner') || jsonb_build_object('contentHash',${newHash}::text),
          'transforms',jsonb_build_array(${JSON.stringify(step)}::jsonb)) as snap from issues i where i.id=${ids.issue}::uuid)
        update issues set execution_state=${JSON.stringify(toState)}::jsonb,
          payload_source_snapshot = s.snap || jsonb_build_object('digest',encode(sha256(convert_to(s.snap::text,'UTF8')),'hex'))
        from s where issues.id=${ids.issue}::uuid`);
    });
    return { ids, transform };
  }

  it("accepts the stage Reviewer's actual approval comment for the stage that was current", async () => {
    const { ids, transform } = await seed();
    await expect(transform()).resolves.toBeUndefined();
    const [task] = await db.execute<{ transforms: number; status: string }>(sql`select
      jsonb_array_length(payload_source_snapshot->'transforms') as transforms, execution_state->>'status' as status
      from issues where id=${ids.issue}::uuid`);
    expect(task).toEqual({ transforms: 1, status: "completed" });
  });

  it("refuses a decision of another stage and a comment of another Run", async () => {
    for (const variant of [{ decisionStageId: "other" as const }, { commentRun: "other" as const }]) {
      const { transform } = await seed(variant);
      const error = await transform().then(() => null, (value: unknown) => value);
      expect(cause(error)).toMatchObject({ code: "23514", message: "Native Stage source lacks its actual approval-comment effect" });
    }
  });

  it("fails with the 0571 definition (uuid = text) and passes again with 0586", async () => {
    const original = readFileSync(`${migrationsDir}0571_issue_native_stage_source_transform.sql`, "utf8");
    const fixed = readFileSync(`${migrationsDir}0586_native_stage_source_owner_stage_id_text.sql`, "utf8");
    const definition = (source: string) => source.slice(source.indexOf("FUNCTION public.aw_issue_native_stage_source_owner()"),
      source.indexOf("$$;", source.indexOf("FUNCTION public.aw_issue_native_stage_source_owner()")) + 3);
    expect(definition(fixed).replace("d.stage_id::text IS NOT DISTINCT FROM", "d.stage_id IS NOT DISTINCT FROM"))
      .toBe(definition(original));
    try {
      await db.execute(sql.raw(`CREATE OR REPLACE ${definition(original)}`));
      const { transform } = await seed();
      const error = await transform().then(() => null, (value: unknown) => value);
      expect(cause(error)).toMatchObject({ code: "42883" });
    } finally {
      await db.execute(sql.raw(`CREATE OR REPLACE ${definition(fixed)}`));
    }
    const { transform } = await seed();
    await expect(transform()).resolves.toBeUndefined();
  });
});
