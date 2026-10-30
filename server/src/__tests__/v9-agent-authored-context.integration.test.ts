import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, agents, heartbeatRuns } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { agentAuthoringContentSchema, AUTHORED_AGENT_DEFINITION_KEY } from "@paperclipai/shared";
import { instanceSettingsService } from "../services/instance-settings.js";
import { agentService } from "../services/agents.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import { compileAuthoredAgentDefinition } from "../services/agents/authored-definition.js";
import * as cognitive from "../services/memory/cognitive-context.js";
import * as derived from "../services/memory/derived-context.js";
import { contextEngineService } from "../services/context/context-engine.js";
import { issueService } from "../services/issues.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedCurrentHumanSourceActor } from "./helpers/current-human-source-fixture.js";
const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Instruction-only authored context keeps the current task boundary", () => {
  let db: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-authored-context-"); db = createDb(database.connectionString); await enableV5ForTest(db); }, 60000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await database?.cleanup(); }, 30000);
  it("retrieves the authorized current Task without opening persistent-memory providers", async () => {
    const f = await seedV5Presences(db);
    const human = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
    const task = await issueService(db).create(f.home, { title: "Draft the internal welcome", description: "Current approved input for a teammate",
      assigneeAgentId: f.presence.id, createdByUserId: f.userId, responsibleUserId: f.userId }, db, undefined,
    { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, issueId: task.id,
      nativeIssueId: task.id, scopeKind: "issue", responsibleUserId: f.userId, status: "running" }).returning();
    const cognitiveProvider = vi.spyOn(cognitive, "cognitiveContextProvider").mockImplementation(() => { throw new Error("Broader memory provider opened"); });
    const derivedProvider = vi.spyOn(derived, "derivedMemoryContextProvider").mockImplementation(() => { throw new Error("Broader memory provider opened"); });
    const input = { companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId,
      enforceResponsibleUserIntersection: true, issueId: task.id, query: "Draft the internal welcome", includeFoundation: true };
    const result = await contextEngineService(db).assemble({ ...input, sourceScope: "task_only" });
    expect(result.packet.taskContext.length).toBeGreaterThan(0);
    expect(result.markdown).toContain(task.description);
    expect(result.packet.foundation).toEqual([]); expect(result.packet.sharedMemory).toEqual([]);
    expect(result.packet.privateMemory).toEqual([]); expect(result.packet.connectedEvidence).toEqual([]);
    expect(result.packet.manifest?.id).toBeTruthy();
    expect(cognitiveProvider).not.toHaveBeenCalled(); expect(derivedProvider).not.toHaveBeenCalled();
    // A positive control proves these hooks would stop the broader default path.
    await expect(contextEngineService(db).assemble(input)).rejects.toThrow("Broader memory provider opened");
    expect(cognitiveProvider).toHaveBeenCalledOnce();
  });
  it("keeps the task boundary in the actual V5 runtime manifest", async () => {
    const f = await seedV5Presences(db), providers = agentProviderBindingService(db);
    const config = { provider: "aw_text_only", model: "fixture-model", workerModelProfileId: randomUUID(), maxOutputTokens: 256 };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: config, status: "paused", pauseReason: "manual" }).where(eq(agents.id, f.presence.id));
    const binding = await providers.create(f.actor, f.home, f.presence.id, { providerType: "paperclip_native", providerAgentRef: f.presence.id, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    const runtime = await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: f.presence.id });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config }));
    // Actual metadata writer with a software fixture; no live provider claim.
    await providers.recordDiscovery(f.home, f.presence.id, snapshot,
      Object.fromEntries(providerConformanceRequirements(snapshot, binding.isolationMode).map(check => [check, true])),
      { configurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }), runtimeId: runtime.id,
        profileRef: runtime.providerProfileRef, bindingId: binding.id, accountingComplete: true });
    const content = agentAuthoringContentSchema.parse({ name: "Welcome specialist", description: "Creates internal welcome drafts", outcome: "Draft an internal welcome",
      ownerUserId: f.userId, capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }],
      instructions: { purpose: "Welcome teammates", responsibilities: "Write a welcome", prohibited: "Do not contact anyone", missingInformation: "Ask the owner", escalation: "Ask when uncertain" } });
    const definition = compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64));
    await agentService(db).update(f.presence.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } },
      { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } });
    await agentService(db).update(f.presence.id, { status: "idle", pauseReason: null });
    const human = await seedCurrentHumanSourceActor(db, [f.home], f.userId);
    const sourceTask = await issueService(db).create(f.home, { title: "Draft the internal welcome", description: "Use the current approved task input",
      assigneeAgentId: f.presence.id, createdByUserId: f.userId, responsibleUserId: f.userId }, db, undefined,
    { manualInputActor: human, privacyActor: human, sourceAccessActor: human });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, issueId: sourceTask.id,
      nativeIssueId: sourceTask.id, scopeKind: "issue", responsibleUserId: f.userId, status: "running" }).returning();
    const cognitiveProvider = vi.spyOn(cognitive, "cognitiveContextProvider").mockImplementation(() => { throw new Error("Persistent memory opened"); });
    const derivedProvider = vi.spyOn(derived, "derivedMemoryContextProvider").mockImplementation(() => { throw new Error("Persistent memory opened"); });
    const input = { companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: sourceTask.id, query: sourceTask.title };
    // The default system Role Pack contains additional required Skills. Its
    // obligations must block this narrower mapping rather than being dropped.
    await expect(agentRuntimeFabricService(db).prepare(input)).rejects.toThrow("requires review before using additional Role Pack behavior");
    const settings = instanceSettingsService(db);
    await settings.updateExperimental({ role_packs_v5: false });
    const result = await agentRuntimeFabricService(db).prepare(input);
    expect(result?.manifest.skills).toEqual([expect.objectContaining({ key: "blentera-platform", selection: "required" })]); expect(result?.manifest.playbooks).toEqual([]); expect(result?.manifest.capabilities).toEqual([]);
    expect(result?.manifest.executionScope.delegatedScopes).toEqual([]);
    expect(result?.contextMarkdown).toContain(sourceTask.description);
    expect(result?.contextMarkdown).not.toContain("Explicit scoped actions: POST");
    expect(cognitiveProvider).not.toHaveBeenCalled(); expect(derivedProvider).not.toHaveBeenCalled();
    const changed = compileAuthoredAgentDefinition({ ...content, instructions: { ...content.instructions, purpose: "A changed purpose" } }, randomUUID(), "b".repeat(64));
    await agentService(db).update(f.presence.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: changed } },
      { authoredPublication: changed, recordRevision: { id: changed.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } });
    await expect(agentRuntimeFabricService(db).prepare({ companyId: f.home, agentId: f.presence.id, runId: run!.id, responsibleUserId: f.userId, issueId: sourceTask.id, query: sourceTask.title }))
      .rejects.toThrow("The identified Agent version changed");
    await settings.updateExperimental({ role_packs_v5: true });
  });
  it("fails closed on an unknown source scope instead of selecting broader context", async () => {
    const f = await seedV5Presences(db);
    await expect(contextEngineService(db).assemble({ companyId: f.home, agentId: f.presence.id,
      query: "Draft an internal welcome", sourceScope: "unknown" as "task_only" }))
      .rejects.toMatchObject({ status: 422 });
  });
});
