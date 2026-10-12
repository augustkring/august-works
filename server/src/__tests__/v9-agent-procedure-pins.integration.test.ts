import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companySkills, companySkillVersions, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { agentAuthoringContentSchema, AUTHORED_AGENT_DEFINITION_KEY } from "@paperclipai/shared";
import { resolveAuthoringProcedures } from "../services/agents/authoring-procedures.js";
import { compileAuthoredAgentDefinition } from "../services/agents/authored-definition.js";
import { agentService } from "../services/agents.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import { buildNativeRuntimeContext, readNativeRuntimeAssetText } from "../services/native-runtime/runtime-context.js";
import { seedRequiredAuthoringProcedures } from "./helpers/authoring-procedures.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Canonical text-only Role Pack procedure pins", () => {
  let db: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-procedure-pins-");
    db = createDb(database.connectionString); await enableV5ForTest(db); }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  const input = (f: Awaited<ReturnType<typeof seedV5Presences>>) => ({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId });
  async function installed() {
    const f = await seedV5Presences(db), pins = await seedRequiredAuthoringProcedures(db, f.actor, f.home, f.presence.id);
    const procedures = await resolveAuthoringProcedures(db, input(f));
    const config = { provider: "aw_text_only", model: "fixture-model", workerModelProfileId: randomUUID(), maxOutputTokens: 256 };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: config, status: "paused", pauseReason: "manual" }).where(eq(agents.id, f.presence.id));
    const providers = agentProviderBindingService(db);
    const binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id,
      providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    const runtime = await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config }));
    // Actual metadata owner, with explicitly synthetic conformance evidence.
    await providers.recordDiscovery(f.home, f.presence.id, snapshot,
      Object.fromEntries(providerConformanceRequirements(snapshot, binding.isolationMode).map(check => [check, true])),
      { configurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }),
        runtimeId: runtime.id, profileRef: runtime.providerProfileRef, bindingId: binding.id, accountingComplete: true });
    const content = agentAuthoringContentSchema.parse({ name: "Welcome specialist", description: "Creates internal drafts", outcome: "Draft an internal welcome",
      ownerUserId: f.userId, capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }],
      instructions: { purpose: "Welcome teammates", responsibilities: "Write a welcome", prohibited: "Do not contact anyone",
        missingInformation: "Ask the owner", escalation: "Ask when uncertain" } });
    const definition = compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64), procedures.hash);
    await agentService(db).update(f.presence.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } },
      { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } });
    const agent = (await agentService(db).update(f.presence.id, { status: "idle", pauseReason: null }))!;
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Draft the internal welcome",
      description: "Only current approved Task input", assigneeAgentId: agent.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: agent.id, responsibleUserId: f.userId, status: "running" }).returning();
    return { f, pins, procedures, agent, config, run: run!, task: task!, execution: { ...input(f), runId: run!.id, issueId: task!.id, query: task!.title } };
  }
  it("refuses missing required procedures without installing a catalog or disabling the Role Pack", async () => {
    const f = await seedV5Presences(db);
    await expect(resolveAuthoringProcedures(db, input(f))).rejects.toThrow("Required Skill unavailable");
    expect(await db.select().from(companySkills).where(eq(companySkills.companyId, f.home))).toEqual([]);
  });
  it("uses all default required procedures in a pinned Task-only runtime without executable capabilities", async () => {
    const f = await installed(), prepared = await agentRuntimeFabricService(db).prepare(f.execution);
    expect(prepared!.manifest.skills.map(pin => pin.versionId).sort()).toEqual(f.pins.map(pin => pin.versionId).sort());
    expect(prepared!.manifest.skills.every(pin => pin.selection === "required" && pin.loadPoint === "always")).toBe(true);
    expect(prepared!.manifest.rolePack?.systemKey).toBe("ops");
    expect(prepared!.manifest.playbooks).toEqual([]); expect(prepared!.manifest.capabilities).toEqual([]);
    expect(prepared!.contextMarkdown).toContain(f.task.description);
    const context = await buildNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] });
    expect(context.mcp.bindingId).toBeNull(); expect(context.skills).toHaveLength(f.pins.length);
    for (const pin of f.pins) {
      const asset = context.skills.find(skill => skill.versionId === pin.versionId)!;
      expect(await readNativeRuntimeAssetText(asset.bundle, 32000, { companyId: f.f.home, runId: f.run.id }))
        .toEqual([{ path: "SKILL.md", text: pin.body }]);
    }
  });
  it("refuses a resumed run after an approved procedure is revoked", async () => {
    const f = await installed(); await agentRuntimeFabricService(db).prepare(f.execution);
    await db.update(companySkills).set({ lifecycleState: "revoked" }).where(eq(companySkills.id, f.pins[0]!.skillId));
    await expect(agentRuntimeFabricService(db).prepare(f.execution)).rejects.toMatchObject({ status: 409 });
    await expect(buildNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] }))
      .rejects.toMatchObject({ status: 409 });
  });
  it("does not load unrelated optional catalog procedures", async () => {
    const f = await installed();
    await db.insert(companySkills).values({ companyId: f.f.home, key: "unrelated", slug: "unrelated", name: "Unrelated procedure",
      markdown: "Must not enter the candidate envelope", lifecycleState: "active", metadata: { triggerTerms: ["welcome"] } });
    const result = await resolveAuthoringProcedures(db, input(f.f));
    expect(result.hash).toBe(f.procedures.hash); expect(result.markdown).not.toContain("Must not enter");
  });
  it("pins procedure bodies and refuses an actual active version replacement", async () => {
    const f = await installed(), pin = f.pins[0]!;
    await expect(db.update(companySkillVersions).set({ fileInventory: [{ path: "SKILL.md", kind: "skill", content: "Mutable changed body" }] })
      .where(eq(companySkillVersions.id, pin.versionId))).rejects.toThrow();
    await db.update(companySkillVersions).set({ state: "superseded" }).where(eq(companySkillVersions.id, pin.versionId));
    const [replacement] = await db.insert(companySkillVersions).values({ companyId: f.f.home, companySkillId: pin.skillId,
      revisionNumber: 2, state: "active", visibility: "company", fileInventory: [{ path: "SKILL.md", kind: "skill", content: "Changed approved procedure" }] }).returning();
    await db.update(companySkills).set({ activeVersionId: replacement!.id, currentVersionId: replacement!.id, headVersionId: replacement!.id }).where(eq(companySkills.id, pin.skillId));
    expect((await resolveAuthoringProcedures(db, input(f.f))).hash).not.toBe(f.procedures.hash);
    await expect(agentRuntimeFabricService(db).prepare(f.execution)).rejects.toThrow("procedures changed");
  });
});
