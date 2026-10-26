import { seedApprovedAuthoringPreference } from "./helpers/authoring-memory.js";
import { memoryService } from "../services/memory/memory-service.js";
import { grantAuthoringKnowledgeReadFixture } from "./helpers/authoring-procedures.js";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companySkills, companySkillVersions, contextManifestMemoryRoots, createDb, heartbeatRuns, issues, documents, documentRevisions, memoryJobs, principalPermissionGrants } from "@paperclipai/db";
import { agentAuthoringContentSchema, AUTHORED_AGENT_DEFINITION_KEY } from "@paperclipai/shared";
import { resolveAuthoringProcedures } from "../services/agents/authoring-procedures.js";
import { assertAuthoredAgentManifestCurrent, compileAuthoredAgentDefinition } from "../services/agents/authored-definition.js";
import { agentService } from "../services/agents.js";
import { initializeRunIdentity } from "../services/run-identity.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { agentRuntimeFabricService } from "../services/agent-runtime-fabric.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot, providerConformanceRequirements } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import { buildNativeRuntimeContext, buildRetainedNativeRuntimeContext, readNativeRuntimeAssetText, type NativeRuntimeAuthoredSourceCapture } from "../services/native-runtime/runtime-context.js";
import { nativeRuntimeAssetsRoot } from "../services/native-runtime/runtime-asset-retention.js";
import { seedRequiredAuthoringProcedures, seedApprovedAuthoringPlaybook, bindAuthoringPlaybook, grantAuthoringPlaybookReadFixture } from "./helpers/authoring-procedures.js";
import { playbookService } from "../services/playbooks.js";
import { foundationService } from "../services/foundation/foundation-service.js";
import { memoryJobService } from "../services/memory/memory-jobs.js";
import { heartbeatMemoryPayloadRetained } from "../services/memory/memory-privacy.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("Canonical text-only Role Pack procedure pins", () => {
  let db: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v9-procedure-pins-");
    db = createDb(database.connectionString); await enableV5ForTest(db); }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  const input = (f: Awaited<ReturnType<typeof seedV5Presences>>) => ({ companyId: f.home, agentId: f.presence.id, responsibleUserId: f.userId });
  async function installed(withPlaybook = false, withKnowledge = false, withMemory = false) {
    const f = await seedV5Presences(db), pins = await seedRequiredAuthoringProcedures(db, f.actor, f.home, f.presence.id);
    const playbook = withPlaybook ? await seedApprovedAuthoringPlaybook(db, f.actor, f.home) : null;
    if (playbook) {
      await bindAuthoringPlaybook(db, f.actor, f.home, f.presence.id, playbook);
      await expect(resolveAuthoringProcedures(db, input(f))).rejects.toMatchObject({ status: 403 });
      await grantAuthoringPlaybookReadFixture(db, f.home, f.presence.id);
    }
    let knowledge: Awaited<ReturnType<ReturnType<typeof foundationService>["approve"]>> | null = null;
    if (withKnowledge) {
      const owner = foundationService(db), actor = { principal: { type: "user" as const, userId: f.userId } };
      const draft = await owner.createDraft(f.home, { foundationKey: `knowledge-${randomUUID()}`, category: "company",
        documentType: "company_profile", title: "Selected company facts", body: "Approved knowledge for this Agent only", sensitivity: "internal" }, actor);
      await owner.submitForReview(f.home, draft.id, draft.latestRevisionId!, actor); knowledge = await owner.approve(f.home, draft.id, draft.latestRevisionId!, actor);
      await grantAuthoringKnowledgeReadFixture(db, f.home, f.presence.id, f.userId);
    }
    const preference = withMemory ? await seedApprovedAuthoringPreference(db, f.home, f.presence.id, f.userId) : null;
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
      ...(preference ? { memory: "approved_work_preferences", memoryRecordIds: [preference.id] } : {}),
      ownerUserId: f.userId, knowledgeDocumentIds: knowledge ? [knowledge.id] : [],
      capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }, ...(knowledge ? [{ operation: "read_approved_knowledge", autonomy: "automatic" }] : [])],
      instructions: { purpose: "Welcome teammates", responsibilities: "Write a welcome", prohibited: "Do not contact anyone",
        missingInformation: "Ask the owner", escalation: "Ask when uncertain" } });
    const procedures = await resolveAuthoringProcedures(db, { ...input(f), knowledgeContent: content });
    const definition = compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64), procedures.hash);
    await agentService(db).update(f.presence.id, { runtimeConfig: { [AUTHORED_AGENT_DEFINITION_KEY]: definition } },
      { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: f.userId } });
    const agent = (await agentService(db).update(f.presence.id, { status: "idle", pauseReason: null }))!;
    const [task] = await db.insert(issues).values({ companyId: f.home, title: "Draft the internal welcome",
      description: "Only current approved Task input", assigneeAgentId: agent.id,
      responsibleUserId: f.userId, createdByUserId: f.userId }).returning();
    const [createdRun] = await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: agent.id,
      responsibleUserId: f.userId, status: "running", runtimeMode: "native", scopeKind: "issue",
      issueId: task!.id, nativeIssueId: task!.id, contextSnapshot: { issueId: task!.id } }).returning();
    await db.update(issues).set({ executionRunId: createdRun!.id }).where(eq(issues.id, task!.id));
    await initializeRunIdentity(db, { companyId: f.home, runId: createdRun!.id, issueId: task!.id,
      responsibleUserId: f.userId, cause: "dispatch" });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, createdRun!.id));
    return { f, pins, playbook, knowledge, preference, procedures, definition, agent, config, run: run!, task: task!, execution: { ...input(f), runId: run!.id, issueId: task!.id, query: task!.title } };
  }
  async function replaceVersion(f: Awaited<ReturnType<typeof installed>>) {
    // Exercise the existing trusted internal publication owner. Customer C3
    // separately blocks replacing a version while its work is in flight.
    const definition = compileAuthoredAgentDefinition({ ...f.definition.content,
      instructions: { ...f.definition.content.instructions, purpose: "Use the new tested definition" } }, randomUUID(), "b".repeat(64), f.procedures.hash);
    const agent = (await agentService(db).update(f.agent.id,
      { runtimeConfig: { ...f.agent.runtimeConfig, [AUTHORED_AGENT_DEFINITION_KEY]: definition } },
      { authoredPublication: definition, recordRevision: { id: definition.revisionId, source: "agent_authoring_publish", createdByUserId: f.f.userId } }))!;
    return { agent, definition };
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
  it("refuses a missing or superseded worker definition pin even when required procedures stay identical", async () => {
    const f = await installed(), prepared = await agentRuntimeFabricService(db).prepare(f.execution);
    const pin = prepared!.manifest.agentDefinitionVersion;
    expect(pin).toMatchObject({ revisionId: f.definition.revisionId, definitionHash: f.definition.definitionHash,
      procedureSnapshotHash: f.procedures.hash });
    await expect(assertAuthoredAgentManifestCurrent(db, f.agent, pin)).resolves.toBeUndefined();
    await expect(assertAuthoredAgentManifestCurrent(db, f.agent, undefined)).rejects.toMatchObject({ status: 409 });
    await expect(assertAuthoredAgentManifestCurrent(db, f.agent, { ...pin!, definitionHash: "c".repeat(64) }))
      .rejects.toMatchObject({ status: 409 });
    const next = await replaceVersion(f);
    expect(next.definition.procedureSnapshotHash).toBe(pin!.procedureSnapshotHash);
    await expect(assertAuthoredAgentManifestCurrent(db, next.agent, pin)).rejects.toMatchObject({ status: 409 });
    await expect(assertAuthoredAgentManifestCurrent(db, f.agent, pin)).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a cached definition before writing retained runtime copies and accepts the actual current version", async () => {
    const f = await installed(), next = await replaceVersion(f);
    const root = nativeRuntimeAssetsRoot({ companyId: f.f.home, runId: f.run.id });
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(buildRetainedNativeRuntimeContext({ db, agent: { ...f.agent, runtimeConfig: {} }, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] }))
      .rejects.toMatchObject({ status: 409, details: { code: "authored_agent_version_changed" } });
    await expect(buildRetainedNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] }))
      .rejects.toMatchObject({ status: 409, details: { code: "authored_agent_version_changed" } });
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(run!.contextSnapshot).toEqual(f.run.contextSnapshot);
    const context = await buildRetainedNativeRuntimeContext({ db, agent: next.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] });
    const [retained] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(retained!.contextSnapshot).toHaveProperty("agentDefinitionVersion.revisionId", next.definition.revisionId);
    const files = await readNativeRuntimeAssetText(context.instructions.bundle, 64000, { companyId: f.f.home, runId: f.run.id });
    expect(files[0]!.text).toContain("Use the new tested definition");
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
  it("consumes the exact approved Playbook even when its ordinary trigger does not match", async () => {
    const f = await installed(true), prepared = await agentRuntimeFabricService(db).prepare(f.execution);
    expect(prepared!.manifest.playbooks).toEqual([{ playbookId: f.playbook!.playbookId, revisionId: f.playbook!.revisionId, required: true }]);
    expect(prepared!.manifest.capabilities).toEqual([]);
    const runtime = await buildRetainedNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] });
    const files = await readNativeRuntimeAssetText(runtime.instructions.bundle, 64000, { companyId: f.f.home, runId: f.run.id });
    expect(files.find(file => file.path === runtime.instructions.entryPath)!.text).toContain(f.playbook!.body);
    const loaded = await agentRuntimeFabricService(db).loadPlaybook({ type: "agent", source: "agent_jwt", companyId: f.f.home,
      agentId: f.agent.id, runId: f.run.id, onBehalfOfUserId: f.f.userId, ignoreInstanceAdmin: true }, f.f.home, f.run.id, f.playbook!.playbookId);
    expect(loaded.markdown).toBe(f.playbook!.body);
    const [runAfterRead] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id));
    expect(runAfterRead!.runnerProfileJson).toMatchObject({ nativeRuntimeProcedureReadObservations: [
      { kind: "playbook_revision", resultDigest: expect.stringMatching(/^[a-f0-9]{64}$/), sourceQualified: false, source: null },
    ] });
  });
  it("captures exact authored sources and retained Memory roots for the combined runtime input", async () => {
    const f = await installed(true, true, true);
    const captures: NativeRuntimeAuthoredSourceCapture[] = [];
    const runtime = await buildRetainedNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id,
      runtimeConfig: f.config, runtimeSkillEntries: [], onAuthoredSourceCapture: value => { captures.push(value); } });
    expect(runtime.instructions.bundle.digest).toMatch(/^[a-f0-9]{64}$/);
    const files = await readNativeRuntimeAssetText(runtime.instructions.bundle, 128000, { companyId: f.f.home, runId: f.run.id });
    const entry = files.find(file => file.path === runtime.instructions.entryPath)!.text;
    for (const body of [f.preference!.body, f.knowledge!.body, f.playbook!.body]) expect(entry).toContain(body);
    expect(captures).toHaveLength(1);
    const capture = captures[0]!;
    expect(capture).toEqual({
      inputs: [
        { kind: "authored_definition", agentId: f.agent.id, revisionId: f.definition.revisionId,
          definitionHash: f.definition.definitionHash, procedureSnapshotHash: f.procedures.hash },
        ...f.procedures.knowledge.map(pin => ({ kind: "foundation_revision", foundationDocumentId: pin.foundationDocumentId,
          documentId: pin.documentId, revisionId: pin.revisionId, contentHash: pin.bodyHash })),
        ...f.procedures.playbooks.map(pin => ({ kind: "playbook_revision", playbookId: pin.playbookId,
          revisionId: pin.revisionId, contentHash: pin.bodyHash })),
        ...f.procedures.skills.map(pin => ({ kind: "skill_version", skillId: pin.skillId,
          versionId: pin.versionId, skillKey: pin.key, contentHash: pin.bodyHash })),
        ...f.procedures.memory.map(pin => ({ kind: "memory", memoryId: pin.recordId,
          sourceVersion: pin.version, contentHash: pin.bodyHash })),
        { kind: "runtime_instructions", agentId: f.agent.id,
          bundleDigest: runtime.instructions.bundle.digest, manifestDigest: runtime.instructions.bundle.manifestDigest },
        ...runtime.skills.map(skill => ({ kind: "runtime_skill", key: skill.key, versionId: skill.versionId,
          bundleDigest: skill.bundle.digest, manifestDigest: skill.bundle.manifestDigest })),
      ],
      contextManifests: [{ companyId: f.f.home, contextManifestId: expect.any(String) }],
    });
    const [memoryRoot] = await db.select({ memoryRecordId: contextManifestMemoryRoots.memoryRecordId })
      .from(contextManifestMemoryRoots).where(eq(contextManifestMemoryRoots.manifestId, capture.contextManifests[0]!.contextManifestId));
    expect(memoryRoot?.memoryRecordId).toBe(f.preference!.id);
  });
  it("keeps draft Playbook edits outside the pin and refuses replacement of the approved revision", async () => {
    const f = await installed(true), service = playbookService(db);
    const next = await service.draft(f.f.actor, f.f.home, f.playbook!.playbookId, { expectedRevisionId: f.playbook!.revisionId,
      title: "Changed approved procedure", markdown: "Unreviewed new procedure", changeSummary: "Proposed procedure update for review" });
    expect((await resolveAuthoringProcedures(db, input(f.f))).hash).toBe(f.procedures.hash);
    await service.review(f.f.actor, f.f.home, f.playbook!.playbookId, { expectedRevisionId: next.id,
      decision: "approve", rationale: "A human approved this changed procedural source" });
    await expect(agentRuntimeFabricService(db).prepare(f.execution)).rejects.toMatchObject({ status: 409 });
    await expect(buildRetainedNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] }))
      .rejects.toMatchObject({ status: 409 });
  });
  it("erases only actual consuming Playbook runtime copies and refuses restoration of the erased identity", async () => {
    const f = await installed(true), other = await installed(true);
    await agentRuntimeFabricService(db).prepare(other.execution);
    const materialize = (fixture: typeof f) => buildRetainedNativeRuntimeContext({ db, agent: fixture.agent,
      runId: fixture.run.id, runtimeConfig: fixture.config, runtimeSkillEntries: [] });
    const runtime = await materialize(f), retained = await materialize(other);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.run.id)))[0]!.contextSnapshot)
      .toHaveProperty("agentProcedurePlaybookVersions", [expect.objectContaining({ playbookId: f.playbook!.playbookId, revisionId: f.playbook!.revisionId })]);
    const [original] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, f.playbook!.revisionId));
    // Native document deletion is the physical Source owner. Its cascade must
    // retire the exact retained runtime consumers before any cleanup worker.
    await db.delete(documents).where(eq(documents.id, f.playbook!.documentId));
    expect(await heartbeatMemoryPayloadRetained(db, f.f.home, f.run.id)).toBe(false);
    const [job] = await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey,
      `runtime-playbook-source-erasure:v1:${f.run.id}:${f.playbook!.revisionId}`));
    expect(job).toMatchObject({ status: "queued", sourceRefJson: { kind: "runtime_playbook_source_erasure",
      runId: f.run.id, versionId: f.playbook!.revisionId } });
    await expect(db.insert(documentRevisions).values(original!)).rejects.toMatchObject({ cause: { code: "23514",
      message: "The consumed Playbook Source identity was erased" } });
    await memoryJobService(db).tick({ limit: 20 }); await memoryJobService(db).tick({ limit: 20 });
    await expect(readNativeRuntimeAssetText(runtime.instructions.bundle, 64000, { companyId: f.f.home, runId: f.run.id })).rejects.toThrow();
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job!.id)))[0]!.status).toBe("succeeded");
    const files = await readNativeRuntimeAssetText(retained.instructions.bundle, 64000, { companyId: other.f.home, runId: other.run.id });
    expect(files.find(file => file.path === retained.instructions.entryPath)!.text).toContain(other.playbook!.body);
    expect(await heartbeatMemoryPayloadRetained(db, other.f.home, other.run.id)).toBe(true);
  });
  it("retains exact approved preference roots before copying their body and physically erases only their consumer", async () => {
    const f = await installed(false,false,true), other = await installed(false,false,true);
    const build = (value: typeof f) => buildRetainedNativeRuntimeContext({ db, agent: value.agent, runId: value.run.id, runtimeConfig: value.config, runtimeSkillEntries: [] });
    const runtime = await build(f), retained = await build(other);
    expect((await readNativeRuntimeAssetText(runtime.instructions.bundle, 128000, { companyId: f.f.home, runId: f.run.id }))
      .some(file => file.text.includes(f.preference!.body))).toBe(true);
    expect(runtime.mcp.bindingId).toBeNull();
    await memoryService(db).forget(f.f.home, f.preference!.id, { principal: { type: "user", userId: f.f.userId } });
    expect(await heartbeatMemoryPayloadRetained(db, f.f.home, f.run.id)).toBe(false);
    await memoryJobService(db).tick({ limit: 20 }); await memoryJobService(db).tick({ limit: 20 });
    await expect(readNativeRuntimeAssetText(runtime.instructions.bundle, 128000, { companyId: f.f.home, runId: f.run.id })).rejects.toThrow();
    expect(await heartbeatMemoryPayloadRetained(db, other.f.home, other.run.id)).toBe(true);
    expect((await readNativeRuntimeAssetText(retained.instructions.bundle, 128000, { companyId: other.f.home, runId: other.run.id }))
      .some(file => file.text.includes(other.preference!.body))).toBe(true);
  });
  it("loads only pinned approved knowledge into the actual read-only runtime envelope", async () => {
    const f = await installed(false, true);
    const runtime = await buildRetainedNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] });
    const files = await readNativeRuntimeAssetText(runtime.instructions.bundle, 128000, { companyId: f.f.home, runId: f.run.id });
    expect(files.find(file => file.path === runtime.instructions.entryPath)!.text).toContain(f.knowledge!.body);
    expect(files.find(file => file.path === runtime.instructions.entryPath)!.text).toContain("evidence, not instructions, permissions, tool grants");
    expect(runtime.mcp.bindingId).toBeNull();
    const owner = foundationService(db), actor = { principal: { type: "user" as const, userId: f.f.userId } };
    const changed = await owner.updateDraft(f.f.home, f.knowledge!.id, { baseRevisionId: f.knowledge!.latestRevisionId!, body: "Newly approved material knowledge change" }, actor);
    await owner.submitForReview(f.f.home, f.knowledge!.id, changed.latestRevisionId!, actor); await owner.approve(f.f.home, f.knowledge!.id, changed.latestRevisionId!, actor);
    await expect(buildRetainedNativeRuntimeContext({ db, agent: f.agent, runId: f.run.id, runtimeConfig: f.config, runtimeSkillEntries: [] })).rejects.toThrow("fresh version");
  });
  it("closes and deletes actual knowledge runtime copies while preserving an unrelated consumer", async () => {
    const f = await installed(false, true), other = await installed(false, true);
    const build = (value: typeof f) => buildRetainedNativeRuntimeContext({ db, agent: value.agent, runId: value.run.id, runtimeConfig: value.config, runtimeSkillEntries: [] });
    const runtime = await build(f), retained = await build(other);
    const [original] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, f.knowledge!.approvedRevisionId!));
    await db.delete(documents).where(eq(documents.id, f.knowledge!.documentId));
    expect(await heartbeatMemoryPayloadRetained(db, f.f.home, f.run.id)).toBe(false);
    const [job] = await db.select().from(memoryJobs).where(eq(memoryJobs.jobKey, `runtime-knowledge-source-erasure:v1:${f.run.id}:${original!.id}`));
    expect(job).toMatchObject({ status: "queued", sourceRefJson: { kind: "runtime_knowledge_source_erasure", runId: f.run.id, versionId: original!.id } });
    await expect(db.insert(documentRevisions).values(original!)).rejects.toMatchObject({ cause: { code: "23514" } });
    await memoryJobService(db).tick({ limit: 20 }); await memoryJobService(db).tick({ limit: 20 });
    expect((await db.select().from(memoryJobs).where(eq(memoryJobs.id, job!.id)))[0]!.status).toBe("succeeded");
    await expect(readNativeRuntimeAssetText(runtime.instructions.bundle, 128000, { companyId: f.f.home, runId: f.run.id })).rejects.toThrow();
    expect(await heartbeatMemoryPayloadRetained(db, other.f.home, other.run.id)).toBe(true);
    expect((await readNativeRuntimeAssetText(retained.instructions.bundle, 128000, { companyId: other.f.home, runId: other.run.id })).some(file => file.text.includes(other.knowledge!.body))).toBe(true);
  });
});
