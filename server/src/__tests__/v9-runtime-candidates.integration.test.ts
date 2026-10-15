import { normalizePaperclipRunnerAdapterConfig } from "@paperclipai/adapter-utils/server-utils";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, agentConfigurationRuntimeCandidates, agentPresenceRuntimeBindings, agents, authUsers,
  createDb, heartbeatRuns, orchestrationModelReservations } from "@paperclipai/db";
import { agentRuntimeCandidateService } from "../services/agents/authoring-runtime-candidates.js";
import { agentAuthoringService } from "../services/agents/authoring-drafts.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { discoverNativeCapabilities } from "../services/native-provider-conformance.js";
import { makeProviderCapabilitySnapshot } from "../services/provider-capabilities.js";
import { hashContextPolicySnapshot } from "../services/context/context-manifest.js";
import type { WorkerModelProfile } from "../services/orchestration/worker-model-profiles.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("Canonical saved runtime proposals have no live effect", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>, draft: Awaited<ReturnType<ReturnType<typeof agentAuthoringService>["create"]>>;
  let profile: WorkerModelProfile, service: ReturnType<typeof agentRuntimeCandidateService>;
  const sourceSha = "a".repeat(40), origin = "https://protected.test.invalid";
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v9-runtime-candidates-"); db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { await database?.cleanup(); }, 30000);
  beforeEach(async () => {
    await instanceSettingsService(db).updateExperimental({ agent_packages_v7: true, hire_agent_v9: true, saas_deployment_profile_v6: true, billing_v6: true });
    f = await seedV5Presences(db);
    const current = { provider: "aw_text_only", model: "current-fixture-model", workerModelProfileId: randomUUID(), maxOutputTokens: 256 };
    await db.update(agents).set({ adapterType: "paperclip_runner", adapterConfig: current }).where(eq(agents.id, f.presence.id));
    const providers = agentProviderBindingService(db), binding = await providers.create(f.actor, f.home, f.presence.id,
      { providerType: "paperclip_native", providerAgentRef: f.presence.id, isolationMode: "isolated_per_presence", providerEndpointRef: null });
    const runtime = await providers.attach(f.actor, f.home, f.presence.id, { providerBindingId: binding.id, providerProfileRef: `fixture:${f.presence.id}` });
    const id = randomUUID(), config = normalizePaperclipRunnerAdapterConfig("paperclip_runner", { ...current, workerModelProfileId: id, model: "alternative-fixture-model" });
    const snapshot = makeProviderCapabilitySnapshot(await discoverNativeCapabilities({ companyId: f.home, adapterType: "paperclip_runner", config }));
    profile = { id, companyId: f.home, workerAgentId: f.presence.id, providerBindingId: binding.id, providerSnapshotHash: snapshot.hash,
      providerProfileRef: runtime.providerProfileRef, qualifiedConfigurationHash: hashContextPolicySnapshot({ adapterType: "paperclip_runner", adapterConfig: config }),
      binding: { provider: "anthropic", method: "api_key", mode: "shared", connectionId: randomUUID(), grantId: randomUUID() },
      transport: "server-text-only-v1", contract: "anthropic-text-messages-2023-06-01", maximumEnvelopeBytes: 64000,
      inputTokensUpperBound: 1000, maxOutputTokens: 256,
      tariff: { provider: "anthropic", model: String(config.model), currency: "USD", fixedMinor: 3, inputMinorPerMillion: 0, outputMinorPerMillion: 0,
        qualificationHash: "b".repeat(64), sourceSha, testedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
      qualificationEvidenceRef: `${origin}/qualification/software-only.json`, qualificationArtifactSha256: "c".repeat(64) };
    service = agentRuntimeCandidateService(db, { profiles: [profile], sourceSha, protectedEvidenceOrigin: origin });
    draft = await agentAuthoringService(db).create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
  });
  const input = () => ({ requestId: randomUUID(), expectedVersion: draft.version, modelProfileId: profile.id });
  it("constructs a body-free selectable proposal and preserves Original configuration, bindings and liabilities", async () => {
    const agent = (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0];
    const runtime = await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, f.presence.id));
    const runs = await db.select().from(heartbeatRuns), liabilities = await db.select().from(orchestrationModelReservations);
    const catalog = await service.catalog(f.actor, f.home, draft.id);
    expect(catalog.choices).toEqual([{ modelProfileId: profile.id, model: profile.tariff.model, configurationHash: profile.qualifiedConfigurationHash,
      maxOutputTokens: 256, maximumMinorPerCall: 3, currency: "USD", requiresConformance: true, changesLive: false }]);
    const candidate = await service.create(f.actor, f.home, draft.id, input());
    expect(candidate).toMatchObject({ recordedStatus: "draft", qualificationCurrent: false, qualificationRequestId: null, changesLive: false });
    expect(JSON.stringify({ catalog, candidate })).not.toMatch(/PRIVATE_CONFIGURATION|software-only-value|credential|providerProfileRef/);
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]).toEqual(agent);
    expect(await db.select().from(agentPresenceRuntimeBindings).where(eq(agentPresenceRuntimeBindings.agentId, f.presence.id))).toEqual(runtime);
    expect(await db.select().from(heartbeatRuns)).toEqual(runs); expect(await db.select().from(orchestrationModelReservations)).toEqual(liabilities);
  });
  it("reconciles concurrent original creation without another candidate or activity", async () => {
    const command = input(), result = await Promise.all([service.create(f.actor, f.home, draft.id, command), service.create(f.actor, f.home, draft.id, command)]);
    expect(result[0]!.id).toBe(result[1]!.id);
    expect(await db.select().from(agentConfigurationRuntimeCandidates).where(eq(agentConfigurationRuntimeCandidates.draftId, draft.id))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home),
      eq(activityLog.action, "agent_configuration.runtime_candidate_created")))).toHaveLength(1);
    await expect(service.create(f.actor, f.home, draft.id, { ...command, modelProfileId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  });
  it("recovers the exact creation slot after flag rollback and never treats absence as refusal", async () => {
    const command = input(), candidate = await service.create(f.actor, f.home, draft.id, command);
    await instanceSettingsService(db).updateExperimental({ hire_agent_v9: false });
    expect(await service.creationReceipt(f.actor, f.home, draft.id, command.requestId)).toEqual(candidate);
    expect(await service.create(f.actor, f.home, draft.id, command)).toEqual(candidate);
    expect(await service.creationReceipt(f.actor, f.home, draft.id, randomUUID())).toBeNull();
    await expect(service.create(f.actor, f.home, draft.id, input())).rejects.toMatchObject({ status: 404 });
  });
  it("refuses a stale expected version, wrong selector and changed virtual configuration without allocating a proposal", async () => {
    await expect(service.create(f.actor, f.home, draft.id, { ...input(), expectedVersion: draft.version + 1 })).rejects.toMatchObject({ status: 409 });
    await expect(service.create(f.actor, f.home, draft.id, { ...input(), modelProfileId: randomUUID() })).rejects.toMatchObject({ status: 403 });
    await db.update(agents).set({ adapterConfig: { changed: true } }).where(eq(agents.id, f.presence.id));
    await expect(service.create(f.actor, f.home, draft.id, input())).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(agentConfigurationRuntimeCandidates).where(eq(agentConfigurationRuntimeCandidates.draftId, draft.id))).toEqual([]);
  });
  it("uses verified current author/configuration authority without an instance-admin bypass", async () => {
    const candidate = await service.create(f.actor, f.home, draft.id, input());
    await db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.userId));
    await expect(service.catalog({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id)).rejects.toMatchObject({ status: 403 });
    await expect(service.get({ ...f.actor, isInstanceAdmin: true }, f.home, draft.id, candidate.id)).rejects.toMatchObject({ status: 403 });
  });
  it("does not expose another tenant or substitute a candidate from another draft", async () => {
    const command = input(), candidate = await service.create(f.actor, f.home, draft.id, command);
    const other = await agentAuthoringService(db).create(f.actor, f.home, { requestId: randomUUID(), agentId: f.presence.id });
    await expect(service.get(f.actor, f.home, other.id, candidate.id)).rejects.toMatchObject({ status: 404 });
    expect(await service.creationReceipt(f.actor, f.home, other.id, command.requestId)).toBeNull();
    await expect(service.get(f.actor, f.guest, draft.id, candidate.id)).rejects.toMatchObject({ status: 404 });
    await expect(agentAuthoringService(db).save(f.actor, f.home, other.id, { requestId: randomUUID(), expectedVersion: other.version,
      step: "runtime", content: { ...other.content!, runtimeCandidateId: candidate.id } })).rejects.toMatchObject({ status: 422 });
  });
  it("saves only a canonical own candidate selection while the Original live configuration stays unchanged", async () => {
    const candidate = await service.create(f.actor, f.home, draft.id, input());
    const original = (await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0];
    const saved = await agentAuthoringService(db).save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: draft.version,
      step: "runtime", content: { ...draft.content!, runtimeCandidateId: candidate.id } });
    expect(saved.content?.runtimeCandidateId).toBe(candidate.id);
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]).toEqual(original);
    await db.update(agentConfigurationRuntimeCandidates).set({ status: "retired" }).where(eq(agentConfigurationRuntimeCandidates.id, candidate.id));
    await expect(agentAuthoringService(db).save(f.actor, f.home, draft.id, { requestId: randomUUID(), expectedVersion: saved.version,
      step: "runtime", content: saved.content! })).rejects.toMatchObject({ status: 422 });
  });
});
