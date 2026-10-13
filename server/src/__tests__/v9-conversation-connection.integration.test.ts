import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, companyMemberships, createDb, heartbeatRuns, issues, issueThreadInteractions,
  memoryDeletionMarkers, principalPermissionGrants, toolConnections, toolConnectionInstalls } from "@paperclipai/db";
import { connectionIntentService } from "../services/connection-intents.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("Conversation connection intent retains Original authority and current sources", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, issueId: string, runId: string;
  const claims = () => ({ sub: f.presence.id, company_id: f.home, run_id: runId, responsible_user_id: f.userId });
  const create = () => issueThreadInteractionService(db).createConnectionIntent({ id: issueId, companyId: f.home }, {
    sourceRunId: runId, addresseeUserId: f.userId, idempotencyKey: `connection-intent:${runId}:notion`,
    payload: { version: 1, serviceSlug: "notion", serviceName: "Notion", serviceLogoUrl: null, serviceDarkLogoUrl: null,
      requestingAgentId: f.presence.id, requestingAgentName: "Fox", phase: "requested" },
  });
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-conversation-connection-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true });
    f = await seedV5Presences(db);
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      permissionKey: "tasks:assign" }).onConflictDoNothing();
    const conversation = await issueService(db).create(f.home, { title: "Owned connection conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "active", status: "in_progress", createdByUserId: f.userId });
    issueId = conversation.id;
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      nativeIssueId: issueId, runtimeMode: "native", status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    runId = run!.id; await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
  });
  it("accepts an actual Native conversation identity and creates one Human-only setup proposal without installing access", async () => {
    expect(await connectionIntentService(db).validate(claims())).toMatchObject({ issue: { id: issueId }, run: { id: runId } });
    const [a, b] = await Promise.all([create(), create()]);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ kind: "connection_intent", status: "pending", effectiveResolverPolicy: "human_only",
      sourceRunId: runId, addresseeUserId: f.userId, payload: { serviceSlug: "notion", phase: "requested" } });
    expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, issueId))).toHaveLength(1);
    expect(await db.select().from(toolConnections).where(eq(toolConnections.companyId, f.home))).toEqual([]);
    expect(await db.select().from(toolConnectionInstalls).where(eq(toolConnectionInstalls.companyId, f.home))).toEqual([]);
  });
  it.each(["generation", "retired", "unverified", "membership", "agent", "stopped", "flag", "source"])(
    "refuses %s withdrawal at the Original interaction boundary and runtime entry", async kind => {
      if (kind === "generation") await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, issueId));
      if (kind === "retired") await db.update(issues).set({ conversationRetiredAt: new Date(), hiddenAt: new Date(),
        conversationAgentId: null, conversationUserId: null, conversationState: null, status: "cancelled",
        assigneeAgentId: null, assigneeUserId: null, executionRunId: null, checkoutRunId: null }).where(eq(issues.id, issueId));
      if (kind === "unverified") await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
      if (kind === "membership") await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
      if (kind === "agent") await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.presence.id));
      if (kind === "stopped") await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, runId));
      if (kind === "flag") await instanceSettingsService(db).updateExperimental({ ambient_commands_v9: false });
      if (kind === "source") await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
      await expect(create()).rejects.toMatchObject({ status: kind === "flag" ? 404 : 403 });
      await expect(connectionIntentService(db).validate(claims())).rejects.toThrow();
      expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.issueId, issueId))).toEqual([]);
    },
  );
  it("refuses an idempotent proposal replay after its generation changes", async () => {
    const saved = await create();
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, issueId));
    await expect(create()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, saved.id))).toHaveLength(1);
  });
});
