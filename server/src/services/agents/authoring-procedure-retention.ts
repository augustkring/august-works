import { and, eq } from "drizzle-orm";
import { agentConfigurationTests, agentExecutionManifests, agentExecutionManifestItems, agentIdentities, agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { agentExecutionManifestSchema } from "@paperclipai/shared";
import type { authoringTestRuntime } from "./authoring-test-runtime.js";
import { contextEngineService } from "../context/context-engine.js";
import { contextManifestService } from "../context/context-manifest.js";
import type { EvidenceItem } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { forbidden } from "../../errors.js";

/** Retain the actual procedural Source graph with the Original inventory and
 * Context owners. Source erasure follows their existing tombstones/outbox;
 * this records no execution authorization or outcome qualification. */
export async function retainAuthoringProcedureSources(db: Db, testId: string,
  current: Awaited<ReturnType<ReturnType<typeof authoringTestRuntime>["qualify"]>>) {
  if (!current.procedures.skills.length && !current.procedures.playbooks.length && !current.procedures.knowledge.length && !current.procedures.snapshot.rolePack?.pins.length) return;
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
  let contextId = context.packet.manifest.id;
  if (current.procedures.knowledge.length) {
    const evidence: EvidenceItem[] = current.procedures.knowledge.map(pin => ({
      id: `foundation:${pin.foundationDocumentId}:${pin.revisionId}:whole`, companyId: test.companyId,
      sourceClass: "foundation", sourceProvider: "august_works_foundation", sourceType: "foundation_document_revision",
      sourceRef: `foundation://${pin.foundationDocumentId}/${pin.revisionId}/whole`, sourceVersion: pin.revisionId,
      title: pin.title, excerpt: pin.body, sourceUpdatedAt: null, observedAt: new Date().toISOString(),
      validFrom: pin.validFrom, validUntil: pin.validUntil, sensitivity: pin.sensitivity, authorityDomain: null,
      trustLevel: "high", citation: { label: pin.title, href: `/foundation/${pin.foundationDocumentId}` },
      metadata: { foundationDocumentId: pin.foundationDocumentId, documentId: pin.documentId, bodyHash: pin.bodyHash, readOnly: true },
    }));
    const retained = await contextManifestService(db).create({ companyId: test.companyId, agentId: test.agentId,
      runId: test.runId, responsibleUserId: test.createdByUserId, query: "Exact selected knowledge for representative test",
      policySnapshot: { intent: "agent_safe_test", selectedKnowledgeHash: current.procedures.hash, grantsAuthority: false },
      selected: evidence.map(item => ({ decision: { evidence: item, authorityRank: null, primaryForDomain: false,
        reason: "non_authoritative_source" as const }, selectionReason: "exact_saved_knowledge_selection" })) });
    contextId = retained.manifest.id;
  }
  const rolePack = current.procedures.snapshot.rolePack;
  const policyHash = nativeSha256({ testId, candidateHash: test.candidateHash, configurationHash: test.configurationHash,
    procedureSnapshotHash: current.procedures.hash });
  const manifest = agentExecutionManifestSchema.parse({ schemaVersion: 5, runId: run.id, companyId: test.companyId,
    agentId: test.agentId, agentIdentityId: presence.identity.id, homeCompanyId: presence.identity.homeCompanyId,
    responsibleUserId: test.createdByUserId,
    executionScope: { primaryCompanyId: test.companyId, primaryAgentPresenceId: test.agentId, delegatedScopes: [] },
    rolePack: rolePack ? { systemKey: rolePack.systemKey, systemVersion: rolePack.systemVersion, pins: rolePack.pins } : null,
    contextManifests: [{ companyId: test.companyId, contextManifestId: contextId }],
    skills: current.procedures.skills.map(pin => ({ skillId: pin.skillId, versionId: pin.versionId, key: pin.key, name: pin.name,
      selection: "required", loadPoint: "always", estimatedDescriptorTokens: Math.ceil(Buffer.byteLength(pin.key + pin.name, "utf8") / 4) })),
    playbooks: current.procedures.playbooks.map(pin => ({ playbookId: pin.playbookId, revisionId: pin.revisionId, required: true })), capabilities: [],
    providers: [{ companyId: test.companyId, agentId: test.agentId, providerBindingId: current.provider.provider.id,
      profileRef: current.provider.runtime.providerProfileRef, snapshotHash: current.provider.provider.capabilitySnapshotHash,
      isolationMode: current.provider.provider.isolationMode }],
    executionPolicy: { deterministicPreference: true, policies: rolePack?.items.filter(item => item.type === "required_policy").map(item => item.ref) ?? [],
      approvalRefs: [], restrictions: ["Representative test Source retention only", "No executable capabilities or agent activation"], policySnapshotHash: policyHash },
    inventoryEstimatedTokens: 0, warnings: [] });
  const [record] = await db.insert(agentExecutionManifests).values({ companyId: test.companyId, runId: test.runId,
    agentId: test.agentId, agentIdentityId: presence.identity.id, contextManifestId: contextId,
    manifest, hash: nativeSha256(manifest), policySnapshotHash: policyHash }).returning();
  const items = [
    ...current.procedures.skills.map(pin => ({ type: "skill", ref: pin.skillId, versionRef: pin.versionId })),
    ...current.procedures.playbooks.map(pin => ({ type: "playbook", ref: pin.playbookId, versionRef: pin.revisionId })),
    ...(current.procedures.knowledge.length ? [{ type: "company_scope", ref: test.companyId, versionRef: contextId }] : []),
  ];
  if (items.length) await db.insert(agentExecutionManifestItems).values(items.map(pin => ({ ...pin, companyId: test.companyId, manifestId: record!.id })));
}
