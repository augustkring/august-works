import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, agents, issues, heartbeatRuns, orchestrationModelReservations, orchestrationWorkerAttempts,
  issueDocuments, documents, environmentLeases } from "@paperclipai/db";
import { verifyNativeCleanupRuntimeState } from "../services/execution-sandbox/run-lease-cleanup.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { verificationService } from "../services/supervision/verification-service.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
let completed = false;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "heartbeat-managed-serial-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("heartbeat-managed-serial-", { preserveDataOnFailure: () => !completed });
  db = createDb(database.connectionString);
}, 60000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home && completed) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
  else if (home) console.info("managed_serial_failure_root_retained", JSON.stringify({ path: home }));
}, 30000);

it("keeps two real serial Plan/Run lifecycles on one Task isolated after actual Stop and denies unowned model origins", async () => {
  vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
  const providerRuns: string[] = [];
  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial", observeModelOriginDenials: true,
    providerReply: ({ body, callIndex, execution, runId }) => {
      if (!providerRuns.includes(runId)) providerRuns.push(runId);
      const ordinal = providerRuns.indexOf(runId) + 1;
      const tools = body.tools as Array<{ name: string }>;
      const tool = (name: string) => {
        const found = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${name}`));
        if (!found) throw new Error(`serial_fixture_tool_missing_${name}`);
        return found.name;
      };
      if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `serial-write-${ordinal}`,
        name: tool("write_document"), input: { idempotencyKey: `serial-result-${ordinal}`, key: `serial-result-${ordinal}`,
          title: `Serial result ${ordinal}`, body: `Actual serial lifecycle ${ordinal} retained result.`, baseRevisionId: null } }] };
      if (callIndex === 2) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `serial-finish-${ordinal}`,
        name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
          summary: `Retained serial lifecycle ${ordinal}.`, completionClaim: {
            contractRevision: execution.completionContract.contract.revision, objectiveSatisfied: true,
            criteria: execution.completionContract.contract.criteria.map(criterion => ({ criterionId: criterion.id,
              status: "satisfied", evidenceRefs: [] })), remainingWork: [] },
          evidence: [], verification: [], attentionRequests: [], artifacts: [] } }] };
      return { stop_reason: "end_turn", content: [{ type: "text", text: "The bounded result is ready for review." }] };
    },
    beforeProviderResponse: async ({ reservation, run, manifest, request, sourceReceipt }) => {
      expect(reservation).toMatchObject({ status: "dispatched", purpose: "worker_model" });
      expect(reservation.maximumMinor).toBeGreaterThan(0);
      expect(reservation.workerAttemptId).toBeTruthy();
      expect(reservation.providerWireReceipt).toMatchObject({ bodySha256: request.wireBodySha256 });
      expect(manifest.runId).toBe(run.id); expect(sourceReceipt).toBeTruthy();
    },
    driveScheduler: async ({ actor, companyId, agentId, heartbeat, facts, factsForRun }) => {
      await instanceSettingsService(db).updateExperimental({ supervision_v7: true, verifier_v7: true });
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
      const task = await issueService(db).create(companyId, { title: "Two bounded serial lifecycles",
        description: "Retain bounded documents for Human review; make no external changes.", status: "todo",
        responsibleUserId: actor.userId!, createdByUserId: actor.userId!, assigneeAgentId: agentId },
        db, undefined, { manualInputActor: actor, privacyActor: actor, sourceAccessActor: actor });
      const observed: Array<{ runId: string; leaseId: string; attemptId: string; manifestId: string;
        sourceHash: string; artifactHash: string; reservationsHash: string; providerCount: number; issuerHash: string; sessionKey: string;
        hostId: unknown; cellId: unknown; environmentId: unknown }> = [];
      for (const ordinal of [1, 2]) {
        let [current] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
        if (!current) throw new Error("serial_fixture_task_missing");
        expect(current.executionRunId).toBeNull(); expect(current.checkoutRunId).toBeNull();
        if (ordinal === 2 && current.status === "done") {
          await issueService(db).update(task.id, { status: "todo", actorUserId: actor.userId!, privacyActor: actor, companyGuard: companyId });
          [current] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
          if (!current) throw new Error("serial_fixture_reopened_task_missing");
        }
        const plan = await orchestrationService(db).create(actor, companyId, { issueId: task.id,
          expectedIssueUpdatedAt: current.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
          completionContract: { objective: `Retain bounded serial result ${ordinal}`,
            requiredOutputs: [{ kind: "task_document", key: `serial-result-${ordinal}` }], businessInvariants: ["Human review required"] },
          budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId: task.id }] });
        await orchestrationService(db).decide(actor, companyId, plan.id, { expectedVersion: plan.version,
          action: "start", rationale: `Human authorizes capped serial lifecycle ${ordinal}` });
        const beforeRuns = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
        expect(beforeRuns).toHaveLength(ordinal - 1);
        const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
          requestedByActorType: "user", requestedByActorId: actor.userId!, payload: { issueId: task.id }, contextSnapshot: { issueId: task.id } });
        expect(wake).not.toBeNull(); await heartbeat.drainActiveRunExecutions();
        const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake!.id));
        expect(run, JSON.stringify({ code: run?.errorCode })).toMatchObject({ status: "succeeded", runtimeMode: "native",
          nativeIssueId: task.id, responsibleUserId: actor.userId, nativeProcessCleanupPending: false });
        const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, wake!.id));
        expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ planId: plan.id, agentId, attempt: 1 });
        expect(attempts[0]!.executionManifestId).toBeTruthy();
        const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
        expect(reservations.length).toBeGreaterThanOrEqual(2);
        expect(reservations.every(row => row.purpose === "worker_model" && row.status === "completed" && row.workerAttemptId === attempts[0]!.id)).toBe(true);
        const output = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
          and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
          .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, `serial-result-${ordinal}`)));
        expect(output).toEqual([{ body: `Actual serial lifecycle ${ordinal} retained result.` }]);
        const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId), eq(environmentLeases.heartbeatRunId, wake!.id)));
        expect(leases).toHaveLength(1); expect(leases[0]).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
        expect(leases[0]!.releasedAt).toBeInstanceOf(Date);
        expect(await verifyNativeCleanupRuntimeState(db, { companyId, runId: wake!.id, leaseId: leases[0]!.id }, leases[0]!.metadata?.remoteExecutionTermination))
          .toMatchObject({ runId: wake!.id, leaseId: leases[0]!.id, state: "stopped" });
        const perRun = factsForRun(wake!.id), runtime = perRun.sandboxRuntimeFacts!;
        expect(perRun.providerCallCount).toBe(reservations.length);
        expect(perRun.issuerFacts).toEqual([{ scope: "worker_model", runId: wake!.id, manifestId: attempts[0]!.executionManifestId }]);
        expect(runtime.originHttpDenials).toEqual({ directDenied: true, unownedConnectDenied: true, noAdditionalEffects: true });
        expect(runtime.modelOriginDenialFacts).toMatchObject({ wrongNonceDenied: true, wrongImageDenied: true });
        expect(runtime.attachedModelBrokerProviderCount).toBe(0);
        expect((runtime.modelBrokerSessionReceipts as Array<{ phase: string }>).at(-1)?.phase).toBe("stop");
        const injections = runtime.appliedModelProfileInjections as Array<{ runId: string; leaseId: string; sessionKey: string }>;
        expect(injections.length).toBeGreaterThan(0); expect(injections.every(row => row.runId === wake!.id && row.leaseId === leases[0]!.id)).toBe(true);
        observed.push({ runId: wake!.id, leaseId: leases[0]!.id, attemptId: attempts[0]!.id, manifestId: attempts[0]!.executionManifestId!,
          sourceHash: nativeSha256((run!.runnerProfileJson as Record<string, unknown>).nativeInputSourceReceipt),
          artifactHash: nativeSha256(((run!.runnerProfileJson as Record<string, any>).nativeOpenCodeSourceAuthority).artifactAuthority),
          reservationsHash: nativeSha256(reservations.sort((a,b) => a.id.localeCompare(b.id))), providerCount: perRun.providerCallCount,
          issuerHash: nativeSha256(perRun.issuerFacts), sessionKey: injections[0]!.sessionKey,
          hostId: runtime.hostId, cellId: runtime.cellId, environmentId: runtime.environmentId });
        // A successful provider Run retains a result; the initiating Human must
        // independently verify that result before this Task can have a new Plan.
        const [awaitingHumanReview] = await db.select({ status: issues.status }).from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
        expect(awaitingHumanReview?.status).not.toBe("done");
        const verifier = verificationService(db);
        const packet = await verifier.packet(actor, companyId, plan.id);
        expect(packet.deterministicFailures).toEqual([]);
        expect(packet.policy.workerSelfCertification).toBe(false);
        const resultEvidence = packet.evidence.filter(item => item.type === "task_document"
          && item.hash === nativeSha256(`Actual serial lifecycle ${ordinal} retained result.`));
        expect(resultEvidence).toHaveLength(1);
        const evidenceRefs = resultEvidence.map(item => item.ref);
        const judgement = (_: unknown, index: number) => ({ index, satisfied: true, evidenceRefs });
        const review = await verifier.review(actor, companyId, plan.id, {
          expectedPlanVersion: packet.planVersion, expectedResultHash: packet.resultHash,
          workerId: packet.workerId, result: "pass", objectiveSatisfied: true,
          rationale: `Human checked the exact retained document for serial lifecycle ${ordinal}`,
          businessInvariants: packet.contract.businessInvariants.map(judgement),
          evidenceRequirements: packet.contract.evidenceRequirements.map(judgement),
          prohibitedOutcomes: packet.contract.prohibitedOutcomes.map(judgement),
        });
        expect(review.result).toBe("pass");
        expect(review.workerAttemptId).toBe(attempts[0]!.id);
        expect((await orchestrationService(db).get(actor, companyId, plan.id)).status).toBe("completed");
        const [reviewedTask] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, task.id)));
        expect(reviewedTask?.status).toBe("done");
      }
      expect(providerRuns).toEqual(observed.map(row => row.runId));
      for (const key of ["runId", "leaseId", "attemptId", "manifestId", "sessionKey"] as const) expect(observed[0]![key]).not.toBe(observed[1]![key]);
      for (const key of ["hostId", "cellId", "environmentId", "artifactHash"] as const) expect(observed[0]![key]).toBe(observed[1]![key]);
      const a = observed[0]!, first = factsForRun(a.runId);
      expect(first.providerCallCount).toBe(a.providerCount); expect(nativeSha256(first.issuerFacts)).toBe(a.issuerHash);
      expect(first.sandboxRuntimeFacts).toMatchObject({ serialContextRetired: true, modelOriginDenialFacts: { retiredChannelDenied: true } });
      const [original] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, a.runId));
      expect(nativeSha256((original!.runnerProfileJson as Record<string, unknown>).nativeInputSourceReceipt)).toBe(a.sourceHash);
      const originalReservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.workerAttemptId, a.attemptId));
      expect(nativeSha256(originalReservations.sort((x,y) => x.id.localeCompare(y.id)))).toBe(a.reservationsHash);
      expect(facts().providerCallCount).toBe(observed.reduce((sum,row) => sum + row.providerCount, 0));
    },
  });
  completed = true;
}, 900000);
