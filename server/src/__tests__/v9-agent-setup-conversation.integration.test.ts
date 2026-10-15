import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, agentConfigurationDrafts, agents, companyAgentPackageInstallations, companyMemberships, createDb,
  heartbeatRuns, issues, memoryDeletionMarkers, principalPermissionGrants, toolPolicies } from "@paperclipai/db";
import { agentSetupAuthoringToolsService } from "../services/agent-setup-authoring-tools.js";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { conversationAuthoringService } from "../services/experience/conversation-authoring.js";
import { createToolGatewayService } from "../services/tool-gateway.js";
import { issueService } from "../services/issues.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { authorizationService } from "../services/authorization.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("Conversation Agent setup uses Native drafts and explicit Human preparation", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, conversationId: string, runId: string;
  const create = (raw: unknown = { idempotencyKey: "new-specialist" }) => agentSetupAuthoringToolsService(db).create({
    companyId: f.home, agentId: f.presence.id, runId }, raw);
  const view = () => conversationAuthoringService(db).get(f.actor, f.home, conversationId);
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-agent-setup-conversation-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, ambient_commands_v9: true,
      saas_deployment_profile_v6: true, billing_v6: true, agent_packages_v7: true, hire_agent_v9: true });
    f = await seedV5Presences(db);
    // Explicitly qualified fixture trust, with the legacy creator fallback
    // disabled. Low-trust Agents must still fail this Native privileged gate.
    await db.update(agents).set({ permissions: { trustPreset: "standard", canCreateAgents: false } }).where(eq(agents.id, f.presence.id));
    await db.insert(companyMemberships).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      status: "active", membershipRole: "member" }).onConflictDoNothing();
    await db.insert(principalPermissionGrants).values({ companyId: f.home, principalType: "agent", principalId: f.presence.id,
      permissionKey: "agents:create" }).onConflictDoNothing();
    const conversation = await issueService(db).create(f.home, { title: "Owned Agent setup conversation", assigneeAgentId: f.presence.id,
      conversationAgentId: f.presence.id, conversationUserId: f.userId, conversationState: "active", status: "in_progress", createdByUserId: f.userId });
    conversationId = conversation.id;
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId,
      nativeIssueId: conversationId, runtimeMode: "native", status: "running", contextSnapshot: { conversationSessionGeneration: 0 } }).returning();
    runId = run!.id; await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, conversationId));
  });
  it("creates one empty owned draft under concurrency and records the actual Agent writer without live effects", async () => {
    const admission = await authorizationService(db).decide({ actor: { type: "agent", source: "agent_jwt", companyId: f.home,
      agentId: f.presence.id, runId, onBehalfOfUserId: f.userId }, action: "agents:create",
      resource: { type: "company", companyId: f.home }, enforceResponsibleUserIntersection: true });
    if (!admission.allowed) throw new Error(`Fixture Native admission refused: ${admission.reason}: ${admission.explanation}`);
    const before = await db.select().from(agents).where(eq(agents.companyId, f.home));
    const [a, b] = await Promise.all([create(), create()]);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ kind: "custom", currentVersion: 1, currentStatus: "draft", packageVersionId: null,
      creationCreatedAgent: false, creationInstalledPackage: false, creationGrantedAuthority: false, creationStartedExecution: false,
      requiresHumanReview: true, href: `/agents/custom/${a.draftId}` });
    const drafts = await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.companyId, f.home));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ createdByUserId: f.userId, agentId: null, preparedAgentId: null,
      content: { name: "", outcome: "", ownerUserId: f.userId, capabilities: [], knowledgeDocumentIds: [] } });
    const journal = await db.select().from(activityLog).where(and(eq(activityLog.entityId, a.draftId), eq(activityLog.action, "agent_configuration.draft_created")));
    expect(journal).toHaveLength(1); expect(journal[0]).toMatchObject({ actorType: "agent", actorId: f.presence.id, agentId: f.presence.id, runId });
    expect(await db.select().from(agents).where(eq(agents.companyId, f.home))).toEqual(before);
    expect(await db.select().from(companyAgentPackageInstallations).where(eq(companyAgentPackageInstallations.companyId, f.home))).toEqual([]);
  });
  it.each(["name", "outcome", "instructions", "ownerUserId", "agentId", "runtimeBindingId", "permissions"])(
    "refuses copied or authority-bearing field %s", async field => {
      await expect(create({ idempotencyKey: "new-specialist", [field]: "PRIVATE conversation text" })).rejects.toThrow();
      expect(await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.companyId, f.home))).toEqual([]);
    },
  );
  it("refuses an invented package pin instead of substituting a capability", async () => {
    await expect(create({ idempotencyKey: "package", packageVersionId: randomUUID() })).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.companyId, f.home))).toEqual([]);
  });
  it("keeps Native low-trust and revoked Agent-grant refusals even for a Human owner", async () => {
    await db.update(agents).set({ permissions: { trustPreset: "low_trust_review", canCreateAgents: false } }).where(eq(agents.id, f.presence.id));
    await expect(create()).rejects.toMatchObject({ status: 403 });
    await db.update(agents).set({ permissions: { trustPreset: "standard", canCreateAgents: false } }).where(eq(agents.id, f.presence.id));
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, f.home),
      eq(principalPermissionGrants.principalId, f.presence.id), eq(principalPermissionGrants.permissionKey, "agents:create")));
    await expect(create()).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.companyId, f.home))).toEqual([]);
  });
  it("does not return later Human-edited private fields to the proposing Agent and shows only Native setup state", async () => {
    const saved = await create(), owner = agentAuthoringService(db), initial = await owner.get(f.actor, f.home, saved.draftId);
    await owner.save(f.actor, f.home, saved.draftId, { requestId: randomUUID(), expectedVersion: initial.version, step: "identity",
      content: { ...initial.content!, name: "PRIVATE Human identity", outcome: "PRIVATE Human outcome" } });
    expect(await create()).toMatchObject({ draftId: saved.draftId, currentVersion: 2 });
    expect(JSON.stringify(await create())).not.toContain("PRIVATE");
    const preview = await view();
    expect(preview.savedAgentDrafts).toEqual([{ kind: "agent_setup", id: saved.draftId, setupKind: "custom", version: 2, status: "draft", href: saved.href }]);
    expect(JSON.stringify(preview)).not.toMatch(/PRIVATE|ownerUserId|instructions|content/);
    await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
    expect((await view()).savedAgentDrafts).toHaveLength(1);
    await expect(create()).rejects.toMatchObject({ status: 404 });
  });
  it("excludes prior-generation proposals and refuses a revoked Original source", async () => {
    await create();
    await db.update(issues).set({ conversationSessionGeneration: 1 }).where(eq(issues.id, conversationId));
    expect((await view()).savedAgentDrafts).toEqual([]);
    await expect(create()).rejects.toMatchObject({ status: 403 });
    await db.update(issues).set({ conversationSessionGeneration: 0 }).where(eq(issues.id, conversationId));
    await db.insert(memoryDeletionMarkers).values({ companyId: f.home, kind: "source", key: `memory-run-source-erasure:v1:${runId}` });
    await expect(create()).rejects.toMatchObject({ status: 403 });
    await expect(view()).rejects.toMatchObject({ status: 403 });
  });
  it("rolls back the Native draft and journal after a late membership withdrawal", async () => {
    await db.execute(sql`create function aw_v9_test_withdraw_setup_author() returns trigger language plpgsql as $$
      begin delete from company_memberships where company_id=NEW.company_id and principal_type='user'
        and principal_id=NEW.created_by_user_id; return NEW; end $$`);
    await db.execute(sql`create trigger aw_v9_test_late_setup_author after insert on agent_configuration_drafts
      for each row execute function aw_v9_test_withdraw_setup_author()`);
    try {
      await expect(create()).rejects.toMatchObject({ status: 403 });
      expect(await db.select().from(agentConfigurationDrafts).where(eq(agentConfigurationDrafts.companyId, f.home))).toEqual([]);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "agent_configuration.draft_created")))).toEqual([]);
      expect(await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)))).toHaveLength(1);
    } finally {
      await db.execute(sql`drop trigger aw_v9_test_late_setup_author on agent_configuration_drafts`);
      await db.execute(sql`drop function aw_v9_test_withdraw_setup_author()`);
    }
  });
  it("discovers and invokes the governed SDK tool only under both authoring feature gates", async () => {
    const name = "paperclip-self:create_agent_setup_draft";
    const catalogName = "paperclip-self:list_agent_setup_capabilities";
    await db.insert(toolPolicies).values({ companyId: f.home, name: "Agent setup software fixture", policyType: "allow", selectors: { toolName: name } });
    await db.insert(toolPolicies).values({ companyId: f.home, name: "Agent catalog software fixture", policyType: "allow", selectors: { toolName: catalogName } });
    const gateway = createToolGatewayService(db, { toolActionSigningSecret: "agent-setup-test-only-signing-secret" });
    const session = await gateway.createSession({ companyId: f.home, agentId: f.presence.id, runId, issueId: conversationId });
    expect((await gateway.listToolsForSession(session.token)).map(tool => tool.name)).toContain(name);
    expect((await gateway.listToolsForSession(session.token)).map(tool => tool.name)).toContain(catalogName);
    expect(await gateway.executeTool({ sessionToken: session.token, tool: catalogName, parameters: {} })).toMatchObject({
      status: "completed", result: { data: { coverage: "bounded", modelCalled: false, capabilities: [] } } });
    const result = await gateway.executeTool({ sessionToken: session.token, tool: name, parameters: { idempotencyKey: "sdk-setup" } });
    expect(result).toMatchObject({ status: "completed", result: { data: { kind: "custom", creationCreatedAgent: false } } });
    await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
    expect((await gateway.listToolsForSession(session.token)).map(tool => tool.name)).not.toContain(name);
    expect((await gateway.listToolsForSession(session.token)).map(tool => tool.name)).not.toContain(catalogName);
  });
});
