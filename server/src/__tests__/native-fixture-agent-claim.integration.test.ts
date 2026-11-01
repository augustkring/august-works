import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, createDb, heartbeatRuns, issues, nativeRunFinalizations } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentIdentityService } from "../services/agent-identities.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { claimManagedNativeFixtureRun } from "./helpers/managed-native-opencode-e2e-fixture.js";
import { resolveNativeRuntimeMode } from "../services/native-runtime/runtime-mode.js";

describe("manually constructed Native fixture run claim", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("native-fixture-claim-"); db = createDb(database.connectionString); await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db); }, 60_000);
  afterAll(async () => { await db?.$client.end({ timeout: 0 }); await database?.cleanup(); });
  async function fixture(status = "idle") {
    const f = await seedV5Presences(db);
    if (status === "terminated") await agentIdentityService(db).update(f.actor, f.home, f.identity.id, { status: "archived" });
    await db.update(agents).set({ status, adapterType: "paperclip_runner", adapterConfig: { provider: "opencode", model: "anthropic/fixture" } })
      .where(and(eq(agents.companyId, f.home), eq(agents.id, f.presence.id)));
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Manually claimed fixture Task",
      assigneeAgentId: f.presence.id, responsibleUserId: f.userId }).returning();
    return { companyId: f.home, agentId: f.presence.id, issueId: task!.id, responsibleUserId: f.userId,
      startedAt: new Date(), conversationSessionGeneration: null };
  }
  async function state(input: Awaited<ReturnType<typeof fixture>>) {
    const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId));
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, input.agentId));
    return { agent: agent!, runs };
  }
  it("atomically creates its exact current run and uses the current Agent for ingress", async () => {
    const input = await fixture();
    const before = await state(input);
    const run = await claimManagedNativeFixtureRun(db, input);
    const current = await state(input);
    expect(current.agent.status).toBe("running");
    expect(current.runs).toHaveLength(1);
    expect(run).toMatchObject({ companyId: input.companyId, agentId: input.agentId, nativeIssueId: input.issueId,
      responsibleUserId: input.responsibleUserId, status: "running", startedAt: input.startedAt, runtimeMode: "native" });
    const ingress = { enabled: true, runtimeConfig: {}, adapterConfig: current.agent.adapterConfig,
      issue: { id: input.issueId, workMode: "standard" }, target: { kind: "local" as const }, workspaceId: randomUUID() };
    expect(() => resolveNativeRuntimeMode({ ...ingress, agent: before.agent })).toThrow("requires an active agent");
    expect(resolveNativeRuntimeMode({ ...ingress, agent: current.agent }).kind).toBe("native");
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, input.agentId));
    const paused = await state(input);
    expect(() => resolveNativeRuntimeMode({ ...ingress, agent: paused.agent })).toThrow("requires an active agent");
  });
  for (const status of ["running", "paused", "error", "pending_approval", "terminated"]) {
    it(`does not claim or repair an Agent in ${status}`, async () => {
      const input = await fixture(status);
      await expect(claimManagedNativeFixtureRun(db, input)).rejects.toThrow("agent_run_claim_unavailable");
      const after = await state(input);
      expect(after.agent.status).toBe(status);
      expect(after.runs).toHaveLength(0);
    });
  }
  it("rejects a duplicate current run claim without another run", async () => {
    const input = await fixture();
    await claimManagedNativeFixtureRun(db, input);
    await expect(claimManagedNativeFixtureRun(db, input)).rejects.toThrow("agent_run_claim_unavailable");
    expect((await state(input)).runs).toHaveLength(1);
  });
  it("holds an idle Agent when another run is already active", async () => {
    const input = await fixture();
    await db.insert(heartbeatRuns).values({ companyId: input.companyId, agentId: input.agentId, status: "running" });
    await expect(claimManagedNativeFixtureRun(db, input)).rejects.toThrow("agent_run_claim_unavailable");
    const after = await state(input); expect(after.agent.status).toBe("idle"); expect(after.runs).toHaveLength(1);
  });
  it("holds an idle Agent with unfinished durable Native cleanup", async () => {
    const input = await fixture();
    const [prior] = await db.insert(heartbeatRuns).values({ companyId: input.companyId, agentId: input.agentId,
      nativeIssueId: input.issueId, status: "failed", runtimeMode: "native", finishedAt: new Date() }).returning();
    await db.insert(nativeRunFinalizations).values({ companyId: input.companyId, issueId: input.issueId,
      runId: prior!.id, phase: "running", leaseOwner: "prior-cleanup", leaseExpiresAt: new Date(Date.now() + 60_000) });
    await expect(claimManagedNativeFixtureRun(db, input)).rejects.toThrow("agent_run_claim_unavailable");
    const after = await state(input); expect(after.agent.status).toBe("idle"); expect(after.runs).toHaveLength(1);
  });
  it("keeps stale Task ownership unchanged and does not create a run", async () => {
    const input = await fixture();
    await db.update(issues).set({ assigneeAgentId: null }).where(eq(issues.id, input.issueId));
    await expect(claimManagedNativeFixtureRun(db, input)).rejects.toThrow("run_task_ownership_changed");
    const after = await state(input); expect(after.agent.status).toBe("idle"); expect(after.runs).toHaveLength(0);
  });
  it("rolls back the Agent claim when creating the run fails", async () => {
    const input = await fixture();
    await expect(claimManagedNativeFixtureRun(db, { ...input, startedAt: new Date(Number.NaN) })).rejects.toThrow();
    const after = await state(input); expect(after.agent.status).toBe("idle"); expect(after.runs).toHaveLength(0);
  });
});
