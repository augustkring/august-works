import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  companyDeletionOperations,
  createDb,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const cancelRun = vi.hoisted(() => vi.fn());
vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: () => ({ cancelRun }),
}));

import { companyService } from "../services/companies.js";
import { saasOffboardingService } from "../services/saas/offboarding.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("company offboarding revoke lease fencing", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-company-offboarding-revoke-lease-");
    db = createDb(database.connectionString);
  }, 60_000);

  afterAll(async () => {
    await database?.cleanup();
  }, 30_000);

  it.each(["late stop completion", "late stop error"])(
    "does not let a stale worker overwrite the newer claim after a %s",
    async (lateOutcome) => {
      const companyId = randomUUID();
      const agentId = randomUUID();
      const runId = randomUUID();
      const operationId = randomUUID();
      const start = new Date(Date.now() - 10_000);
      const workerANow = new Date(start.getTime() + 1_000);
      const leaseA = new Date(workerANow.getTime() + 60_000);
      const workerBNow = new Date(leaseA.getTime() + 1_000);
      const calls: string[] = [];
      let releaseWorkerA!: () => void;
      let workerAStarted!: () => void;
      const workerAStartedPromise = new Promise<void>((resolve) => { workerAStarted = resolve; });
      const workerAGate = new Promise<void>((resolve) => { releaseWorkerA = resolve; });

      await db.insert(companies).values({
        id: companyId,
        name: "Offboarding Revoke Lease Fixture",
        status: "archived",
        pauseReason: "company_deletion",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      });
      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "Stopped fixture agent",
        role: "engineer",
        status: "paused",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "timer",
        status: "running",
      });
      await db.insert(companyDeletionOperations).values({
        id: operationId,
        companyId,
        requestedByUserId: "offboarding-worker",
        idempotencyKey: randomUUID(),
        status: "processing",
        stage: "revoke_finalizing",
        notBefore: start,
      });

      cancelRun.mockReset().mockImplementation(async (cancelledRunId: string) => {
        calls.push(cancelledRunId);
        if (calls.length === 1) {
          workerAStarted();
          await workerAGate;
          if (lateOutcome === "late stop error") throw new Error("stale stop failed after newer claim");
          return;
        }
        if (calls.length === 2) {
          await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: workerBNow })
            .where(eq(heartbeatRuns.id, cancelledRunId));
          return;
        }
        throw new Error("unexpected duplicate stop call");
      });

      const offboarding = saasOffboardingService(db, {} as never, {} as never,
        { targets: () => ({ fixture: true }) } as never);
      const workerA = offboarding.processOne(workerANow);
      await workerAStartedPromise;
      const [claimedByA] = await db.select({ stage: companyDeletionOperations.stage,
        notBefore: companyDeletionOperations.notBefore }).from(companyDeletionOperations)
        .where(eq(companyDeletionOperations.id, operationId));
      expect(claimedByA).toEqual({ stage: "revoke_finalizing", notBefore: leaseA });

      // A's stop is still blocked; after its lease expires, worker B claims
      // the same phase and completes the canonical stop first.
      expect(await offboarding.processOne(workerBNow)).toBe(true);
      const [completedByB] = await db.select({ stage: companyDeletionOperations.stage,
        status: companyDeletionOperations.status, notBefore: companyDeletionOperations.notBefore })
        .from(companyDeletionOperations).where(eq(companyDeletionOperations.id, operationId));
      expect(completedByB).toMatchObject({ stage: "runtimes", status: "processing", notBefore: workerBNow });

      releaseWorkerA();
      expect(await workerA).toBe(true);
      const [afterStaleA] = await db.select({ stage: companyDeletionOperations.stage,
        status: companyDeletionOperations.status, notBefore: companyDeletionOperations.notBefore })
        .from(companyDeletionOperations).where(eq(companyDeletionOperations.id, operationId));
      expect(afterStaleA).toEqual(completedByB);
      expect(calls).toEqual([runId, runId]);

      await db.delete(companyDeletionOperations).where(eq(companyDeletionOperations.id, operationId));
      await db.delete(activityLog).where(eq(activityLog.companyId, companyId));
      await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      await db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId));
      await db.delete(agents).where(eq(agents.id, agentId));
      await db.delete(companies).where(eq(companies.id, companyId));
    },
  );
});
