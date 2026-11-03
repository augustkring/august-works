import { mockedCodexAdapterConfig } from "./helpers/mocked-codex-config.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  authUsers,
  companies,
  companyMemberships,
  completionContracts,
  createDb,
  heartbeatRuns,
  nativeRunFinalizations,
  nativeRunResults,
  statusDecisions,
  workAssessments,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";

const adapterExecute = vi.hoisted(() => vi.fn(async () => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  summary: "Legacy adapter completed through the flag-off heartbeat.",
  resultJson: { summary: "Legacy bytes", nested: { count: 1, ok: true } },
  provider: "test",
  model: "legacy-test",
})));

vi.mock("../adapters/index.js", () => ({
  getServerAdapter: () => ({
    type: "codex_local",
    execute: adapterExecute,
    supportsLocalAgentJwt: false,
  }),
  findActiveServerAdapter: () => ({
    type: "codex_local",
    execute: adapterExecute,
    supportsLocalAgentJwt: false,
  }),
  runningProcesses: new Map(),
}));

import { heartbeatService } from "../services/heartbeat.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { reconcileNativeFinalizations } from "../services/native-runtime/native-finalization-reconciler.js";

describe("P6-32 legacy finalization regression", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  const companyId = randomUUID();
  const agentId = randomUUID();

  beforeAll(async () => {
    if (!process.env.PAPERCLIP_API_URL?.trim()) vi.stubEnv("PAPERCLIP_API_URL", "http://127.0.0.1:3100/api");
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-native-legacy-");
    db = createDb(temporary.connectionString);
    await instanceSettingsService(db).updateExperimental({ enableNativeRunner: false });
    await db.insert(authUsers).values({ id: "responsible-user", name: "Legacy accountable Human",
      email: "responsible-user@example.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companies).values({
      id: companyId,
      name: "Legacy snapshot",
      issuePrefix: "LGC",
      status: "active",
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "responsible-user",
      status: "active", membershipRole: "admin" });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Legacy agent",
      adapterType: "codex_local",
      adapterConfig: mockedCodexAdapterConfig,
      status: "idle",
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
    });
  }, 30_000);

  afterAll(async () => {
    if (temporary) {
      await drainHeartbeatRunsToQuiescence(db, heartbeatService(db));
      await temporary.cleanup();
    }
    vi.unstubAllEnvs();
  });

  it("executes a flag-off heartbeat through the legacy adapter with byte-stable reads and zero native rows", async () => {
    const heartbeat = heartbeatService(db);
    const queued = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "system",
      contextSnapshot: { skipIssueComment: true },
    });
    expect(queued).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const runId = queued!.id;
    const publicBefore = await heartbeat.getRun(runId);

    expect(publicBefore).toMatchObject({
      id: runId,
      status: "succeeded",
      runtimeMode: "legacy",
      runtimeModeReason: "direct_adapter",
      error: null,
      resultJson: { summary: "Legacy bytes", nested: { count: 1, ok: true } },
    });
    expect(adapterExecute).toHaveBeenCalledOnce();
    await expect(reconcileNativeFinalizations(db, [runId])).resolves.toEqual([]);
    expect(JSON.stringify(await heartbeat.getRun(runId))).toBe(JSON.stringify(publicBefore));

    await expect(db.select().from(completionContracts).where(eq(completionContracts.companyId, companyId))).resolves.toHaveLength(0);
    await expect(db.select().from(nativeRunResults).where(eq(nativeRunResults.runId, runId))).resolves.toHaveLength(0);
    await expect(db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, runId))).resolves.toHaveLength(0);
    await expect(db.select().from(workAssessments).where(eq(workAssessments.runId, runId))).resolves.toHaveLength(0);
    await expect(db.select().from(statusDecisions).where(eq(statusDecisions.companyId, companyId))).resolves.toHaveLength(0);
    await expect(db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId))).resolves.toHaveLength(1);
  }, 30_000);
});
