import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createDb, agents, heartbeatRuns, orchestrationModelReservations, orchestrationWorkerAttempts,
  issueDocuments, documents, environmentLeases } from "@paperclipai/db";
import { verifyNativeCleanupRuntimeState } from "../services/execution-sandbox/run-lease-cleanup.js";
import { issueService } from "../services/issues.js";
import { orchestrationService } from "../services/orchestration/orchestration-service.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "heartbeat-managed-scheduler-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  database = await startEmbeddedPostgresTestDatabase("heartbeat-managed-scheduler-");
  db = createDb(database.connectionString);
}, 60000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) { await makeFixtureTreeWritable(home); await rm(home, { recursive: true, force: true }); }
}, 30000);

it("dispatches an ordinary scheduler-created capped Worker through current Sandbox admission and model reservation", async () => {
  const terminalDeadlineAt = Date.now() + 600_000;
  // Serial fixture transport authenticates each incoming model channel; the production scheduler still creates one ordinary Worker Run.
  await withManagedNativeHeartbeatFixture({ db, root: home, opencodeBinary: qualifiedOpenCodeBinary(), timeoutSec: 300,
    schedulerMode: "serial",
    providerReply: ({ body, callIndex, execution }) => {
      const tools = body.tools as Array<{ name: string }>;
      const tool = (name: string) => {
        const found = tools.find(value => value.name === name || ["paperclip__", "paperclip_", "paperclip."].some(prefix => value.name === `${prefix}${name}`));
        if (!found) throw new Error(`scheduler_fixture_tool_missing_${name}`);
        return found.name;
      };
      if (callIndex === 1) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "scheduler-write",
        name: tool("write_document"), input: { idempotencyKey: "scheduler-real-draft-output", key: "result",
          title: "Scheduler result", body: "A real scheduler-owned bounded result for Human review.", baseRevisionId: null } }] };
      if (callIndex === 2) return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "scheduler-finish",
        name: tool("paperclip_finish"), input: { schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
          summary: "Retained the scheduler's bounded result.", completionClaim: {
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
      expect(manifest.runId).toBe(run.id);
      expect(sourceReceipt).toBeTruthy();
    },
    driveScheduler: async ({ actor, companyId, agentId, gateway, heartbeat, facts, factsForRun }) => {
      const human = actor; // Reuse the factory's current session; a new passkey would revoke it.
      await db.update(agents).set({ runtimeConfig: { timeoutSec: 300,
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).where(eq(agents.id, agentId));
      const task = await issueService(db).create(companyId, { title: "Ordinary scheduler bounded draft",
        description: "Retain one result document for Human review; make no external changes.",
        status: "todo", responsibleUserId: human.userId!, createdByUserId: human.userId!, assigneeAgentId: agentId },
        db, undefined, { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
      const plan = await orchestrationService(db).create(human, companyId, { issueId: task.id,
        expectedIssueUpdatedAt: task.updatedAt.toISOString(), workload: "semantic", riskClass: "C0",
        completionContract: { objective: "Retain one bounded scheduler result for review",
          requiredOutputs: [{ kind: "task_document", key: "result" }], businessInvariants: ["Human review required"] },
        budgets: { maxModelCostMinor: 10, maxToolActions: 3 }, workers: [{ key: "writer", issueId: task.id }] });
      // The ordinary Worker entry cannot broaden first-party draft authority.
      await expect(gateway.qualifyDraft(db, { companyId, agentId,
        responsibleUserId: human.userId! })).rejects.toThrow("installed worker model transport");
      await expect(gateway.qualifyManagedWorker(db, { companyId, agentId,
        responsibleUserId: "missing-current-human" })).rejects.toThrow();
      await expect(gateway.qualifyManagedWorker(db, { companyId, agentId,
        responsibleUserId: human.userId! })).resolves.toMatchObject({
          providerKind: "opencode", maximumEnvelopeBytes: expect.any(Number),
        });
      const [originalAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (!originalAgent) throw new Error("scheduler_fixture_agent_missing");
      for (const drift of [{ model: "anthropic/unselected-model" }, { provider: "codex" }]) {
        await db.update(agents).set({ adapterConfig: { ...originalAgent.adapterConfig, ...drift } })
          .where(eq(agents.id, agentId));
        await expect(gateway.qualifyManagedWorker(db, { companyId, agentId,
          responsibleUserId: human.userId! })).rejects.toThrow();
      }
      await db.update(agents).set({ adapterConfig: originalAgent.adapterConfig }).where(eq(agents.id, agentId));
      expect(facts().providerCallCount).toBe(0);
      expect(await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id))).toEqual([]);
      await orchestrationService(db).decide(human, companyId, plan.id, { expectedVersion: plan.version,
        action: "start", rationale: "Run the actual supported, capped Native scheduler route" });
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toEqual([]);
      const wake = await heartbeat.wakeup(agentId, { source: "assignment", triggerDetail: "system", reason: "issue_assigned",
        requestedByActorType: "user", requestedByActorId: human.userId!, payload: { issueId: task.id },
        contextSnapshot: { issueId: task.id } });
      expect(wake).not.toBeNull();
      // A drain clears delayed session-resume timers; observe this Run's terminal state first.
      const remainingTerminalMs = terminalDeadlineAt - Date.now();
      if (remainingTerminalMs <= 0) throw new Error("scheduler_fixture_terminal_deadline_exhausted");
      await expect.poll(async () => {
        const [current] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, wake!.id)));
        return current ? ["succeeded", "failed", "cancelled", "interrupted", "timed_out"].includes(current.status) : false;
      }, { timeout: remainingTerminalMs }).toBe(true);
      await heartbeat.drainActiveRunExecutions();
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, wake!.id));
      expect(run, JSON.stringify({ code: run?.errorCode, error: run?.error })).toMatchObject({ status: "succeeded",
        runtimeMode: "native", nativeIssueId: task.id, responsibleUserId: human.userId });
      const attempts = await db.select().from(orchestrationWorkerAttempts).where(eq(orchestrationWorkerAttempts.runId, wake!.id));
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ planId: plan.id, agentId, attempt: 1 });
      expect(attempts[0]!.executionManifestId).toBeTruthy();
      const reservations = await db.select().from(orchestrationModelReservations).where(eq(orchestrationModelReservations.planId, plan.id));
      expect(reservations.length).toBeGreaterThanOrEqual(2);
      expect(reservations.every(row => row.purpose === "worker_model" && row.status === "completed" && row.workerAttemptId === attempts[0]!.id)).toBe(true);
      const outputs = await db.select({ body: documents.latestBody }).from(issueDocuments).innerJoin(documents,
        and(eq(documents.companyId, issueDocuments.companyId), eq(documents.id, issueDocuments.documentId)))
        .where(and(eq(issueDocuments.companyId, companyId), eq(issueDocuments.issueId, task.id), eq(issueDocuments.key, "result")));
      expect(outputs).toHaveLength(1);
      expect(outputs[0]?.body).toContain("real scheduler-owned bounded result");
      expect(run!.nativeProcessCleanupPending).toBe(false);
      const leases = await db.select().from(environmentLeases).where(and(eq(environmentLeases.companyId, companyId),
        eq(environmentLeases.heartbeatRunId, wake!.id)));
      expect(leases).toHaveLength(1);
      expect(leases[0]).toMatchObject({ status: "expired", leasePolicy: "ephemeral", cleanupStatus: "success", failureReason: "paperclip_runner_destroy_after_turn" });
      expect(leases[0]!.releasedAt).toBeInstanceOf(Date);
      const cleanup = await verifyNativeCleanupRuntimeState(db, { companyId, runId: wake!.id, leaseId: leases[0]!.id },
        leases[0]!.metadata?.remoteExecutionTermination);
      expect(cleanup).toMatchObject({ runId: wake!.id, leaseId: leases[0]!.id, state: "stopped" });
      const observed = facts();
      const runtime = factsForRun(wake!.id).sandboxRuntimeFacts;
      expect(observed.providerCallCount).toBe(reservations.length);
      expect(observed.issuerFacts).toEqual([{ scope: "worker_model", runId: wake!.id,
        manifestId: attempts[0]!.executionManifestId }]);
      expect(runtime?.relayAuthenticated).toBe(true);
      // These are observations of the actual authenticated ingress and its signed session, not the nonserial fixture transport.
      expect(observed.sandboxRuntimeFacts?.authenticatedModelTunnels).toBeGreaterThan(0);
      const injections = runtime?.appliedModelProfileInjections as Array<{ runId: string; leaseId: string; sessionKey: string }>;
      const sessionReceipts = runtime?.modelBrokerSessionReceipts as Array<{ phase: string; sessionKey: string }>;
      const starts = sessionReceipts.filter(row => row.phase === "start");
      expect(starts).toHaveLength(1);
      expect(typeof starts[0]?.sessionKey).toBe("string");
      expect(starts[0]?.sessionKey.length).toBeGreaterThan(0);
      expect(injections.length).toBeGreaterThan(0);
      expect(injections.every(row => row.runId === wake!.id && row.leaseId === leases[0]!.id && row.sessionKey === starts[0]?.sessionKey)).toBe(true);
      expect(sessionReceipts.at(-1)).toMatchObject({ phase: "stop", sessionKey: starts[0]?.sessionKey });
      expect(runtime?.attachedModelBrokerProviderCount).toBe(0);
      expect((runtime?.modelBrokerSessionReceipts as Array<{ phase: string }>).at(-1)?.phase).toBe("stop");
    },
  });
}, 600000);
