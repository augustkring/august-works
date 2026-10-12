import { and, eq } from "drizzle-orm";
import { agentConfigurationTests, agentExecutionManifests, agentExecutionManifestItems, agentIdentities, agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentExecutionManifestSchema } from "@paperclipai/shared";
import type { authoringTestRuntime } from "./authoring-test-runtime.js";
import { contextEngineService } from "../context/context-engine.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { forbidden } from "../../errors.js";

/** Retain the actual procedural Source graph with the Original inventory and
 * Context owners. Source erasure follows their existing tombstones/outbox;
 * this records no execution authorization or outcome qualification. */
export async function retainAuthoringProcedureSources(db: Db, testId: string,
  current: Awaited<ReturnType<ReturnType<typeof authoringTestRuntime>["qualify"]>>) {
  if (!current.procedures.skills.length && !current.procedures.snapshot.rolePack?.pins.length) return;
  const [test] = await db.select().from(agentConfigurationTests).where(eq(agentConfigurationTests.id, testId));
  const [run] = test ? await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, test.companyId),
    eq(heartbeatRuns.agentId, test.agentId), eq(heartbeatRuns.id, test.runId))) : [];
  const [presence] = test ? await db.select({ agent: agents, identity: agentIdentities }).from(agents)
    .innerJoin(agentIdentities, eq(agentIdentities.id, agents.agentIdentityId))
    .where(and(eq(agents.companyId, test.companyId), eq(agents.id, test.agentId))) : [];
  if (!test || !presence || !run || run.status !== "running" || run.triggerDetail !== "agent_safe_test" ||
    run.responsibleUserId !== test.createdByUserId || run.contextSnapshot?.agentConfigurationTestId !== test.id ||
    test.draftId !== current.draft.id || test.companyId !== current.draft.companyId || test.agentId !== current.agentId ||
    test.authorityHash !== current.authorityHash || test.configurationHash !== current.configurationHash)
    throw forbidden("Procedural retention requires the exact current saved test controller");
  const context = await contextEngineService(db).assemble({ companyId: test.companyId, agentId: test.agentId,
    responsibleUserId: test.createdByUserId, enforceResponsibleUserIntersection: true, runId: test.runId,
    issueId: null, query: "Representative internal draft procedural retention", intent: "agent_safe_test",
    sourceScope: "task_only", includeFoundation: false, sensitivityCeiling: "internal" });
  if (!context.packet.manifest) throw forbidden("The procedure test requires its Original Context Source owner");
  const rolePack = current.procedures.snapshot.rolePack;
  const policyHash = nativeSha256({ testId, candidateHash: test.candidateHash, configurationHash: test.configurationHash,
    procedureSnapshotHash: current.procedures.hash });
  const manifest = agentExecutionManifestSchema.parse({ schemaVersion: 5, runId: run.id, companyId: test.companyId,
    agentId: test.agentId, agentIdentityId: presence.identity.id, homeCompanyId: presence.identity.homeCompanyId,
    responsibleUserId: test.createdByUserId,
    executionScope: { primaryCompanyId: test.companyId, primaryAgentPresenceId: test.agentId, delegatedScopes: [] },
    rolePack: rolePack ? { systemKey: rolePack.systemKey, systemVersion: rolePack.systemVersion, pins: rolePack.pins } : null,
    contextManifests: [{ companyId: test.companyId, contextManifestId: context.packet.manifest.id }],
    skills: current.procedures.skills.map(pin => ({ skillId: pin.skillId, versionId: pin.versionId, key: pin.key, name: pin.name,
      selection: "required", loadPoint: "always", estimatedDescriptorTokens: Math.ceil(Buffer.byteLength(pin.key + pin.name, "utf8") / 4) })),
    playbooks: [], capabilities: [],
    providers: [{ companyId: test.companyId, agentId: test.agentId, providerBindingId: current.provider.provider.id,
      profileRef: current.provider.runtime.providerProfileRef, snapshotHash: current.provider.provider.capabilitySnapshotHash,
      isolationMode: current.provider.provider.isolationMode }],
    executionPolicy: { deterministicPreference: true, policies: rolePack?.items.filter(item => item.type === "required_policy").map(item => item.ref) ?? [],
      approvalRefs: [], restrictions: ["Representative test Source retention only", "No executable capabilities or agent activation"], policySnapshotHash: policyHash },
    inventoryEstimatedTokens: 0, warnings: [] });
  const [record] = await db.insert(agentExecutionManifests).values({ companyId: test.companyId, runId: test.runId,
    agentId: test.agentId, agentIdentityId: presence.identity.id, contextManifestId: context.packet.manifest.id,
    manifest, hash: nativeSha256(manifest), policySnapshotHash: policyHash }).returning();
  if (current.procedures.skills.length) await db.insert(agentExecutionManifestItems).values(current.procedures.skills.map(pin => ({ companyId: test.companyId,
    manifestId: record!.id, type: "skill", ref: pin.skillId, versionRef: pin.versionId })));
}
