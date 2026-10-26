import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issuePrivacySources, issues } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { makeFixtureTreeWritable, runManagedNativeOpenCodeFixture } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { instanceSettingsService } from "../instance-settings.js";
import { canActorReadIssuePrivacy } from "../authorization.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../memory/memory-privacy.js";

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

describe.skipIf(!hasPinnedOpenCodeProfile())("managed OpenCode conversation Task output erasure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-opencode-conversation-task-e2e-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `managed-opencode-conversation-task-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-conversation-task-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-opencode-conversation-task-e2e-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true,
      enableContextEngineV1: true, enableCollectiveMemoryV1: true, enablePrivateAgentMemoryV1: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database?.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (root) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("binds an actual conversation dispatch to its created Task and scrubs that Task when the producing Run is erased", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const taskTitle = `Conversation output Task ${suffix}`;
    const result = await runManagedNativeOpenCodeFixture({ db, connectionString: database.connectionString,
      root, instanceId, steps: [
        { tool: "create_task", id: `conversation-task-${suffix}`, input: {
          idempotencyKey: randomUUID(), title: taskTitle,
          description: "Created from the authenticated conversation model response.",
        } },
        { tool: "paperclip_finish", id: `conversation-task-finish-${suffix}` },
      ],
    });

    const companyId = result.companyId, runId = result.runId, agentId = result.agentId,
      issueId = result.issueId, aliceActor = result.aliceActor;
    const childTasks = result.childTasks;
    if (!companyId || !runId || !agentId || !issueId || !aliceActor || !Array.isArray(childTasks))
      throw new Error("The actual conversation fixture did not return its owner and Task evidence");
    expect(result.completedRun?.status).toBe("succeeded");
    expect(childTasks).toHaveLength(1);
    const child = childTasks[0]!;
    const snapshot = nativePayloadSourceSnapshotSchema.parse(child.payloadSourceSnapshot);
    const dispatches = snapshot.inputs.filter(source => source.kind === "conversation_model_dispatch");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({ kind: "conversation_model_dispatch", runId, agentId, issueId });
    expect(snapshot.owner).toMatchObject({ kind: "issue", id: child.id, companyId });
    const edges = await db.select({ sourceKind: issuePrivacySources.sourceKind, sourceId: issuePrivacySources.sourceId })
      .from(issuePrivacySources).where(and(eq(issuePrivacySources.companyId, companyId), eq(issuePrivacySources.issueId, child.id)));
    expect(edges).toContainEqual({ sourceKind: "run_copy", sourceId: runId });
    expect(edges).not.toContainEqual({ sourceKind: "run", sourceId: runId });
    expect(await canActorReadIssuePrivacy(db, aliceActor, { id: child.id, companyId })).toBe(true);

    await db.transaction(async tx => {
      await lockAnalyticalCompany(tx as unknown as typeof db, companyId);
      await lockMemoryPrivacy(tx as unknown as typeof db, companyId);
      await purgeDerivedWorkflowMemory(tx as unknown as typeof db, companyId, [], new Date(), {
        workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId],
      });
    });
    const [erasedTask] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, child.id)));
    expect(erasedTask).toMatchObject({ title: "Erased workflow task", description: null,
      payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
    expect(await canActorReadIssuePrivacy(db, aliceActor, { id: child.id, companyId })).toBe(false);
  }, 240_000);
});
