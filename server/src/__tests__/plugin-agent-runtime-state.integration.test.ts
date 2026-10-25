import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { agents, companies, companySkills, companySkillVersions, createDb, heartbeatRuns, pluginConfig, plugins, toolApplications, toolConnectionInstalls, toolConnections, toolProfileBindings, toolProfiles, type Db } from "@paperclipai/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedNativePasskeySession } from "./helpers/native-authentication-fixtures.js";
import { enableV5ForTest, seedV5Companies } from "./helpers/v5-fixtures.js";
import { agentIdentityService } from "../services/agent-identities.js";
import { synchronizeCompanyAgentRuntimeOwners } from "../services/agent-runtime-owner-assignments.js";
import { pluginAgentRuntimeState } from "../services/plugin-agent-runtime-state.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { companySkillService } from "../services/company-skills.js";
import { skillLifecycleService } from "../services/skill-lifecycle.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { pluginAgentConnectionAssignments } from "../services/plugin-agent-connections.js";
import { PROVIDER_CAPABILITY_FEATURES } from "@paperclipai/shared";
import type { AuthorizationActor } from "../services/authorization.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping plugin runtime state database tests: ${support.reason}`);

describePostgres("plugin agent runtime state authorization", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let skillsHome: string;
  let oldPaperclipHome: string | undefined;
  let oldPaperclipInstanceId: string | undefined;
  let db: Db;
  let home: string;
  let guest: string;
  let userId: string;
  let pluginId: string;
  let agentId: string;
  let identityId: string;
  let humanActor: AuthorizationActor;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-plugin-runtime-state-");
    db = createDb(database.connectionString);
    oldPaperclipHome = process.env.PAPERCLIP_HOME;
    oldPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    skillsHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-plugin-runtime-state-home-"));
    process.env.PAPERCLIP_HOME = skillsHome;
    process.env.PAPERCLIP_INSTANCE_ID = "default";
  }, 90_000);
  afterAll(async () => {
    await database?.cleanup();
    await fs.rm(skillsHome, { recursive: true, force: true });
    if (oldPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = oldPaperclipHome;
    if (oldPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = oldPaperclipInstanceId;
  });

  beforeEach(async () => {
    await db.delete(plugins);
    const fixture = await seedV5Companies(db);
    home = fixture.home;
    guest = fixture.guest;
    userId = fixture.userId;
    await enableV5ForTest(db);
    const sessionId = await seedNativePasskeySession(db, userId);
    humanActor = { ...fixture.actor, sessionId };
    const created = await agentIdentityService(db).create(humanActor, { name: "Lifecycle state agent", homeCompanyId: home });
    agentId = created.presence.id;
    identityId = created.identity.id;
    pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId, pluginKey: pluginId, packageName: "runtime-state-fixture", version: "1.0.0", status: "ready",
      manifestJson: { agentLifecycle: true, resourceLifecycle: ["agent_runtime"], capabilities: ["events.subscribe", "agents.lifecycle.manage"] } as never,
    });
    await db.insert(pluginConfig).values({ pluginId, companyId: home, configJson: {} });
    await db.transaction(tx => synchronizeCompanyAgentRuntimeOwners(tx as unknown as Db, home));
    await db.update(agents).set({ adapterConfig: { apiKey: "canary-runtime-token", env: { TOKEN: { type: "plain", value: "canary-runtime-token" } } }, runtimeConfig: { providerToken: "canary-runtime-token" } }).where(eq(agents.id, agentId));
  });

  it("returns redacted metadata without inventing a Human when no standing company owner is configured", async () => {
    const state = await pluginAgentRuntimeState(db, pluginId, home, agentId);
    expect(state).toMatchObject({ agent: { id: agentId }, skillsReady: false, skills: [] });
    expect(JSON.stringify(state)).not.toContain("canary-runtime-token");
  });

  it("uses the company's current default responsible Human and denies revoked membership", async () => {
    await db.update(companies).set({ defaultResponsibleUserId: userId }).where(eq(companies.id, home));
    const state = await pluginAgentRuntimeState(db, pluginId, home, agentId);
    expect(state).toMatchObject({ agent: { id: agentId }, skillsReady: false, skills: [] });
    expect(JSON.stringify(state)).not.toContain("canary-runtime-token");

    await db.execute(sql`update company_memberships set status = 'suspended' where company_id = ${home} and principal_type = 'user' and principal_id = ${userId}`);
    await expect(pluginAgentRuntimeState(db, pluginId, home, agentId)).rejects.toThrow(/current active Human membership/);
  });

  it("does not resolve an agent across company boundaries", async () => {
    await expect(pluginAgentRuntimeState(db, pluginId, guest, agentId)).resolves.toBeNull();
  });

  it("rejects connection and profile assignment snapshots beyond their documented bounds", async () => {
    const guestAgent = await agentIdentityService(db).addPresence(humanActor, home, identityId, { companyId: guest, role: "general" });
    const [application] = await db.insert(toolApplications).values({
      companyId: guest, name: "Bounded assignment fixture", type: "mcp_http",
    }).returning();
    const connections = Array.from({ length: 513 }, (_, index) => ({
      id: randomUUID(), companyId: guest, applicationId: application!.id,
      name: `Connection ${index}`, uid: `connection-${index}-${randomUUID()}`,
      transport: "mcp_remote" as const, status: "active" as const, enabled: true,
      config: { apiKey: "must-not-be-returned" },
    }));
    await db.insert(toolConnections).values(connections);
    await db.insert(toolConnectionInstalls).values(connections.map(connection => ({
      companyId: guest, connectionId: connection.id, targetType: "agent" as const, targetId: guestAgent.id,
    })));
    await expect(pluginAgentConnectionAssignments(db, guest, guestAgent.id)).rejects.toMatchObject({ status: 422 });
    await db.delete(toolConnectionInstalls).where(eq(toolConnectionInstalls.companyId, guest));

    const profiles = Array.from({ length: 129 }, (_, index) => ({
      id: randomUUID(), companyId: guest, profileKey: `profile-${index}`, name: `Profile ${index}`, status: "active" as const,
    }));
    await db.insert(toolProfiles).values(profiles);
    await db.insert(toolProfileBindings).values(profiles.map(profile => ({
      companyId: guest, profileId: profile.id, targetType: "agent" as const, targetId: guestAgent.id,
    })));
    await expect(pluginAgentConnectionAssignments(db, guest, guestAgent.id)).rejects.toMatchObject({ status: 422 });
  });

  it("returns the effective connection and profile metadata without credentials or schemas", async () => {
    const guestAgent = await agentIdentityService(db).addPresence(humanActor, home, identityId, { companyId: guest, role: "general" });
    const [application] = await db.insert(toolApplications).values({ companyId: guest, name: "Safe assignment fixture", type: "mcp_http" }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId: guest, applicationId: application!.id, name: "CRM", uid: randomUUID(),
      transport: "mcp_remote", status: "active", enabled: true,
      config: { Authorization: "Bearer canary-connection-secret", schema: { password: "canary-connection-secret" } },
    }).returning();
    await db.insert(toolConnectionInstalls).values({ companyId: guest, connectionId: connection!.id, targetType: "agent", targetId: guestAgent.id });
    const [profile] = await db.insert(toolProfiles).values({ companyId: guest, profileKey: "safe-profile", name: "Safe profile" }).returning();
    await db.insert(toolProfileBindings).values({ companyId: guest, profileId: profile!.id, targetType: "agent", targetId: guestAgent.id });
    const state = await pluginAgentConnectionAssignments(db, guest, guestAgent.id);
    expect(state).toEqual({
      connections: [{ id: connection!.id, name: "CRM", transport: "mcp_remote", enabled: true, status: "active" }],
      profileIds: [profile!.id],
    });
    expect(JSON.stringify(state)).not.toContain("canary-connection-secret");
    expect(JSON.stringify(state)).not.toContain("schema");
  });

  it("does not report Skills ready from a native run without its immutable execution manifest", async () => {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId, companyId: home, agentId, status: "running", runtimeMode: "native",
      responsibleUserId: userId, startedAt: new Date(), invocationSource: "on_demand",
    });
    const state = await pluginAgentRuntimeState(db, pluginId, home, agentId);
    expect(state).toMatchObject({ agent: { id: agentId }, skillsReady: false, skills: [] });
  });

  it("uses only the current source manifest produced by the runtime admission path", async () => {
    const skillsService = companySkillService(db);
    const skill = await skillsService.createLocalSkill(home, {
      name: "Runtime pin fixture", slug: "runtime-pin-fixture", markdown: "# Runtime pin fixture\n\nPinned source.\n",
    }, { type: "user", userId });
    const pinnedVersionId = skill.headVersionId;
    expect(pinnedVersionId).toBeTruthy();
    await db.update(companySkillVersions).set({ state: "active", visibility: "company", activatedAt: new Date() }).where(eq(companySkillVersions.id, pinnedVersionId!));
    await db.update(companySkills).set({ activeVersionId: pinnedVersionId, currentVersionId: pinnedVersionId, lifecycleState: "active", sharingScope: "private", ownerAgentId: agentId, metadata: { triggerTerms: ["runtime pin fixture"] } }).where(eq(companySkills.id, skill.id));
    await instanceSettingsService(db).updateExperimental({ enableBetaSkills: true });
    await db.update(agents).set({ adapterConfig: { paperclipSkillSync: { desiredSkills: [{ key: skill.key, versionId: pinnedVersionId }] } } }).where(eq(agents.id, agentId));
    const providers = agentProviderBindingService(db);
    const binding = await providers.create(humanActor, home, agentId, {
      providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence",
    });
    await providers.attach(humanActor, home, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
    const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map(key => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
    await providers.recordDiscovery(home, agentId, {
      provider: "paperclip_native", version: "runtime-state-fixture", features, skills: [], tools: [], discoveredAt: new Date().toISOString(),
    }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: home, agentId, status: "running", runtimeMode: "native", responsibleUserId: userId,
      startedAt: new Date(), invocationSource: "on_demand",
    }).returning();
    await agentRuntimeFabricService(db).prepare({
      companyId: home, agentId, runId: run!.id, responsibleUserId: userId, issueId: null, query: "Prepare runtime pin fixture",
    });
    const state = await pluginAgentRuntimeState(db, pluginId, home, agentId);
    expect(state).toMatchObject({
      agent: { id: agentId }, skillsReady: true,
      skills: [expect.objectContaining({ key: skill.key, versionId: pinnedVersionId, currentVersionId: pinnedVersionId, sourceStatus: "available" })],
    });
    const candidate = await skillLifecycleService(db).propose(humanActor, home, skill.id, {
      baseActiveVersionId: pinnedVersionId!, markdown: "# Runtime pin fixture\n\nPromoted after this run started.\n",
      summary: "Later reviewed version", dependencies: [], sharing: "company_proposed",
    });
    const promotedVersionId = candidate.id;
    expect(promotedVersionId).toBeTruthy();
    expect(promotedVersionId).not.toBe(pinnedVersionId);
    await db.update(companySkillVersions).set({ state: "superseded" }).where(eq(companySkillVersions.id, pinnedVersionId!));
    await db.update(companySkillVersions).set({ state: "active", activatedAt: new Date() }).where(eq(companySkillVersions.id, promotedVersionId!));
    await db.update(companySkills).set({ activeVersionId: promotedVersionId, currentVersionId: promotedVersionId, lifecycleState: "active" }).where(eq(companySkills.id, skill.id));
    await db.update(agents).set({ adapterConfig: { paperclipSkillSync: { desiredSkills: [] } } }).where(eq(agents.id, agentId));
    const afterDesiredChange = await pluginAgentRuntimeState(db, pluginId, home, agentId);
    expect(afterDesiredChange).toMatchObject({
      skillsReady: true,
      skills: [expect.objectContaining({ key: skill.key, versionId: pinnedVersionId, currentVersionId: promotedVersionId })],
    });
    await db.update(companySkills).set({ ownerAgentId: null }).where(eq(companySkills.id, skill.id));
    await expect(pluginAgentRuntimeState(db, pluginId, home, agentId)).rejects.toThrow(/pinned Skill is no longer authorized/);
  });
});
