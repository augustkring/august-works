import { randomUUID } from "node:crypto";
import { companySkillService } from "../services/company-skills.js";
import { preparePlatformSkillAdmission } from "../services/platform-skill-admission.js";
import { blenteraPlatformContractHashes } from "../services/tool-gateway.js";
import { writePaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, agentConfigRevisions, heartbeatRuns, createDb } from "@paperclipai/db";
import { agentAuthoringContentSchema, AUTHORED_AGENT_DEFINITION_KEY, type AuthoredAgentDefinition } from "@paperclipai/shared";
import { buildNativeRuntimeContext, readNativeRuntimeAssetText } from "../services/native-runtime/runtime-context.js";
import { agentService } from "../services/agents.js";
import { agentInstructionsService } from "../services/agent-instructions.js";
import { compileAuthoredAgentDefinition, readAuthoredAgentDefinition, authoredAgentInstructionText } from "../services/agents/authored-definition.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Authored definitions use the Original Agent configuration revision owner", () => {
  let db: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, definition: AuthoredAgentDefinition;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-authored-definition-"); db = createDb(database.connectionString); await enableV5ForTest(db); }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    f = await seedV5Presences(db);
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: { provider: "aw_text_only", model: "fixture-model" }, status: "paused", pauseReason: "manual" }).where(eq(agents.id, f.presence.id));
    definition = compileAuthoredAgentDefinition(agentAuthoringContentSchema.parse({ name: "Welcome specialist", description: "Writes an internal welcome draft",
      outcome: "Create an internal welcome message", ownerUserId: f.userId,
      capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }],
      instructions: { purpose: "Welcome teammates", responsibilities: "Write a welcome message", prohibited: "Do not contact anyone",
        missingInformation: "Ask the owner", escalation: "Ask when uncertain", communication: "Plain language" } }), randomUUID(), "a".repeat(64));
  });
  async function install(value = definition) {
    return (await agentService(db).update(f.presence.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: value } },
      { authoredPublication: value, recordRevision: { id: value.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } }))!;
  }
  it("exports the exact published definition through the Original instruction owner", async () => {
    const agent = await install();
    const [revision] = await db.select().from(agentConfigRevisions).where(and(eq(agentConfigRevisions.companyId, f.home), eq(agentConfigRevisions.id, definition.revisionId)));
    expect(revision).toMatchObject({ agentId: agent.id, source: "agent_authoring_publish", createdByUserId: f.userId });
    expect(revision!.afterConfig.runtimeConfig).toEqual(agent.runtimeConfig);
    expect(await readAuthoredAgentDefinition(db, agent)).toEqual(definition);
    expect(await agentInstructionsService(db).exportFiles(agent, { rejectSymlinks: true })).toEqual({ entryFile: "AGENTS.md", warnings: [], files: { "AGENTS.md": authoredAgentInstructionText(definition.content) } });
    expect(await agentInstructionsService(db).getBundle(agent)).toMatchObject({ editable: false, rootPath: null, files: [{ editable: false, virtual: true }] });
    expect(await agentInstructionsService(db).readFile(agent, "AGENTS.md")).toMatchObject({ content: authoredAgentInstructionText(definition.content), editable: false });
    expect(agent.status).toBe("paused");
  });
  it("materializes the Agent revision when the effective adapter config has no definition field", async () => {
    const agent = await install();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: agent.id, responsibleUserId: f.userId, status: "running" }).returning();
    const runtime = await buildNativeRuntimeContext({ db, agent, runId: run!.id,
      runtimeConfig: { provider: "aw_text_only", model: "fixture-model" }, runtimeSkillEntries: [] });
    expect(runtime.instructions.entryPath).toBe("AGENTS.md");
    expect(await readNativeRuntimeAssetText(runtime.instructions.bundle, 64000, { companyId: f.home, runId: run!.id }))
      .toEqual([{ path: "AGENTS.md", text: authoredAgentInstructionText(definition.content) }]);
    expect(runtime.mcp.bindingId).toBeNull();
    expect(runtime.skills).toEqual([]);
  });
  it("keeps the immutable platform reference bundle alongside an authored definition without granting customer tools", async () => {
    const published = await install();
    const agent = (await agentService(db).update(published.id, { status: "idle", pauseReason: null }))!;
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: agent.id,
      responsibleUserId: f.userId, status: "running", runtimeMode: "native" }).returning();
    const platform = await preparePlatformSkillAdmission(db, { companyId: f.home, agentId: agent.id,
      runId: run!.id, responsibleUserId: f.userId, requireExisting: false }, blenteraPlatformContractHashes());
    const actor = { type: "agent" as const, source: "none" as const, companyId: f.home, agentId: agent.id,
      runId: run!.id, onBehalfOfUserId: f.userId };
    const entries = await companySkillService(db).listRuntimeSkillEntries(f.home, { actor, readScope: "task",
      selectedSkillKeys: new Set([platform.pin.key]), versionSelections: new Map([[platform.pin.key, platform.pin.versionId]]) });
    const runtime = await buildNativeRuntimeContext({ db, agent, runId: run!.id,
      runtimeConfig: writePaperclipSkillSyncPreference({ provider: "aw_text_only", model: "fixture-model" },
        [{ key: platform.pin.key, versionId: platform.pin.versionId }]), runtimeSkillEntries: entries });
    expect(runtime.skills).toHaveLength(1);
    expect(runtime.skills[0]).toMatchObject({ key: "blentera-platform", versionId: platform.pin.versionId });
    const files = await readNativeRuntimeAssetText(runtime.skills[0]!.bundle, 128000, { companyId: f.home, runId: run!.id });
    expect(files).toHaveLength(14);
    expect(files.find(file => file.path === "references/work.md")?.text).toContain("Task");
    expect(await readNativeRuntimeAssetText(runtime.instructions.bundle, 64000, { companyId: f.home, runId: run!.id }))
      .toEqual([{ path: "AGENTS.md", text: authoredAgentInstructionText(definition.content) }]);
    expect(runtime.mcp.bindingId).toBeNull();
  });
  it("retains the identified old definition when another revision is installed", async () => {
    const oldAgent = await install();
    const next = compileAuthoredAgentDefinition({ ...definition.content, instructions: { ...definition.content.instructions, purpose: "A revised purpose" } }, randomUUID(), "b".repeat(64));
    const current = await install(next);
    expect(await readAuthoredAgentDefinition(db, oldAgent)).toEqual(definition);
    expect(await readAuthoredAgentDefinition(db, current)).toEqual(next);
    expect(await agentInstructionsService(db).exportFiles(oldAgent)).not.toEqual(await agentInstructionsService(db).exportFiles(current));
  });
  it("rejects a foreign or changed version and never falls back to a host prompt", async () => {
    const agent = await install();
    await expect(readAuthoredAgentDefinition(db, { ...agent, id: f.guestPresence.id })).rejects.toMatchObject({ status: 409 });
    await expect(readAuthoredAgentDefinition(db, { ...agent, runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: { ...definition, content: { ...definition.content, outcome: "Injected outcome" } } } })).rejects.toMatchObject({ status: 409 });
    await expect(agentInstructionsService().exportFiles(agent)).rejects.toMatchObject({ status: 409 });
    await expect(agentInstructionsService(db).readFile(agent, "../AGENTS.md")).rejects.toMatchObject({ status: 404 });
  });
  it("blocks generic configuration and instruction writes before filesystem effects", async () => {
    const agent = await install(), svc = agentInstructionsService(db);
    for (const patch of [{ runtimeConfig: {} }, { name: "Changed live" }, { permissions: { canCreateAgents: true } }])
      await expect(agentService(db).update(agent.id, patch)).rejects.toMatchObject({ status: 409, details: { code: "authored_agent_version_readonly" } });
    // Replacing the adapter config also removes the pinned provider/model, so
    // the routing-publication guard rejects it before the authored-version guard.
    await expect(agentService(db).update(agent.id, { adapterConfig: { promptTemplate: "Changed live" } }))
      .rejects.toMatchObject({ status: 409, details: { code: "model_migration_publication_required" } });
    await expect(svc.writeFile(agent, "AGENTS.md", "Changed live")).rejects.toMatchObject({ status: 409 });
    await expect(svc.writeFile(agent, "promptTemplate.legacy.md", "Changed live")).rejects.toMatchObject({ status: 409 });
    await expect(svc.updateBundle(agent, { mode: "managed" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.materializeManagedBundle(agent, { "AGENTS.md": "Changed live" }, { replaceExisting: true })).rejects.toMatchObject({ status: 409 });
    expect(await readAuthoredAgentDefinition(db, (await agentService(db).getById(agent.id))!)).toEqual(definition);
  });
  it("does not let a generic create or patch invent an authored revision", async () => {
    await expect(agentService(db).update(f.presence.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } })).rejects.toMatchObject({ status: 409 });
    await expect(agentService(db).create(f.home, { name: "Forged version", runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } })).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.id, definition.revisionId))).toEqual([]);
  });
});
