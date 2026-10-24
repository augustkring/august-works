import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authUsers,
  companyMemberships,
  createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  heartbeatRuns,
  issuePrivacySources,
  issues,
  memoryDeletionMarkers,
  principalPermissionGrants,
  routineRuns,
} from "@paperclipai/db";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { issueService } from "../services/issues.js";
import { lockMemoryPrivacy, purgeDerivedWorkflowMemory } from "../services/memory/memory-privacy.js";
import { routineAuthoringToolsService } from "../services/routine-authoring-tools.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("typed routine Task private source graph", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  let bobId: string;
  let conversationId: string;
  let authoringRunId: string;

  const routineInput = () => ({ idempotencyKey: "private-typed-task-source", title: "Private saved routine", description: "PRIVATE routine body", priority: "medium" });
  const authoringContext = () => ({ companyId: f.home, agentId: f.presence.id, runId: authoringRunId });

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("typed-task-private-sources-");
    db = createDb(database.connectionString, { maxConnections: 8 });
    await enableV5ForTest(db);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true });
    f = await seedV5Presences(db);
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      permissionKey: "tasks:assign" }).onConflictDoNothing();
    const bob = `user-${randomUUID()}`;
    const now = new Date();
    await db.insert(authUsers).values({ id: bob, name: "Second routine reader", email: `${bob}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "user", principalId: bob,
      membershipRole: "owner", status: "active" });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({ companyId: f.home,
      principalType: "user" as const, principalId: bob, ...grant })));
    bobId = bob;

    const conversation = await issueService(db).create(f.home, { title: "Private routine authoring conversation",
      assigneeAgentId: f.presence.id, conversationAgentId: f.presence.id, conversationUserId: f.userId,
      conversationState: "active", status: "in_progress", createdByUserId: f.userId });
    conversationId = conversation.id;
    const [authoringRun] = await db.insert(heartbeatRuns).values({ companyId: f.home,
      agentId: f.presence.id, responsibleUserId: f.userId, nativeIssueId: conversationId, runtimeMode: "native",
      status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    authoringRunId = authoringRun!.id;
    await db.update(issues).set({ executionRunId: authoringRunId }).where(eq(issues.id, conversationId));
  });

  async function createRoutineAndRun() {
    const created = await routineAuthoringToolsService(db).create(authoringContext(), routineInput());
    const [run] = await db.insert(routineRuns).values({ companyId: f.home, routineId: created.routineId,
      routineRevisionId: created.currentRevisionId!, source: "api", status: "received", responsibleUserId: f.userId }).returning();
    return { routineId: created.routineId, revisionId: created.currentRevisionId!, run: run! };
  }

  async function createTypedTask(source: Awaited<ReturnType<typeof createRoutineAndRun>>) {
    return issueService(db).create(f.home, { title: "PRIVATE copied execution Task", description: "PRIVATE execution detail",
      originKind: "routine_execution", originId: source.routineId, originRunId: source.run.id,
      createdByUserId: f.userId, responsibleUserId: f.userId, actorResponsibleUserId: f.userId,
      trustExplicitResponsibleUserId: true });
  }

  const ownerActor = () => f.actor;
  const bobActor = () => ({ type: "board" as const, source: "session" as const, userId: bobId });

  it("retains the exact typed RoutineRun edge and limits its private Task to the actual routine owner", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    expect(task.visibility).toBe("private");
    expect(await db.select().from(issuePrivacySources).where(and(eq(issuePrivacySources.issueId, task.id),
      eq(issuePrivacySources.sourceKind, "routine_run"), eq(issuePrivacySources.sourceId, source.run.id)))).toHaveLength(1);
    expect(await canActorReadIssuePrivacy(db, ownerActor(), task)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor(), task)).toBe(false);
  }, 90_000);

  it("withdraws the copied Task for both readers when its actual authoring source is erased", async () => {
    const source = await createRoutineAndRun();
    const task = await createTypedTask(source);
    expect(await canActorReadIssuePrivacy(db, ownerActor(), task)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor(), task)).toBe(false);
    await db.transaction(async rawTx => {
      const tx = rawTx as unknown as typeof db;
      await lockMemoryPrivacy(tx, f.home);
      await tx.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source",
        key: `memory-run-source-erasure:v1:${authoringRunId}` });
      await purgeDerivedWorkflowMemory(tx, f.home, [], new Date(), {
        workflowRevisionIds: [], artifactVersionIds: [], runIds: [authoringRunId],
      });
    });
    const [stored] = await db.select().from(issues).where(eq(issues.id, task.id));
    expect(await canActorReadIssuePrivacy(db, ownerActor(), stored!)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, bobActor(), stored!)).toBe(false);
  }, 90_000);

  it("denies a second company owner a structurally stored open Task from the private typed source", async () => {
    const source = await createRoutineAndRun();
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Private source stored as open",
      visibility: "open", originKind: "routine_execution", originId: source.routineId, originRunId: source.run.id,
      createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
    expect(await canActorReadIssuePrivacy(db, bobActor(), task!)).toBe(false);
  }, 90_000);

  it("keeps an unrelated public manual Task readable by both company owners", async () => {
    const task = await issueService(db).create(f.home, { title: "Public manual control", visibility: "open",
      createdByUserId: f.userId, responsibleUserId: f.userId });
    expect(await canActorReadIssuePrivacy(db, ownerActor(), task)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor(), task)).toBe(true);
  }, 90_000);
});
