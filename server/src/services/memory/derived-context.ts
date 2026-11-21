import type { Db } from "@paperclipai/db";
import { memoryModelEvidence, memoryModels, memoryObservationEvidence, memoryObservations } from "@paperclipai/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { v7FeatureEnabled, type EvidenceItem } from "@paperclipai/shared";
import type { ContextProvider } from "../context/context-engine.js";
import { instanceSettingsService } from "../instance-settings.js";
import { derivedMemoryService } from "./derived-memory.js";
export function derivedMemoryContextProvider(db: Db): ContextProvider {
  return { key: "derived_memory", requirement: "optional", async retrieve({ request }) {
    const flags = await instanceSettingsService(db).getExperimental();
    if (!v7FeatureEnabled(flags, "memory_observations_v7")) return { evidence: [] };
    const actor = request.authorizationActor ?? { type: "agent" as const, companyId: request.companyId,
      agentId: request.agentId, source: "agent_jwt" as const, runId: request.runId ?? null,
      onBehalfOfUserId: request.responsibleUserId ?? null };
    const service = derivedMemoryService(db), purpose = request.intent ?? "general_work";
    const observations = (await service.listObservations(actor, request.companyId)).filter((row) => row.status === "accepted");
    const models = v7FeatureEnabled(flags, "memory_models_v7") ? (await service.listModels(actor, request.companyId)).filter((row) => row.status === "active") : [];
    const tokens = [...new Set(request.query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
    const selected = [...observations.map((row) => ({ row, type: "memory_observation" as const })), ...models.map((row) => ({ row, type: "memory_model" as const }))]
      .filter(({ row }) => row.purpose === purpose && (row.scopeType === "company" || (row.scopeType === "project" && row.scopeId === request.projectId) || (row.scopeType === "subject" && request.subjectRefs?.includes(row.scopeId!)))
        && tokens.some((token) => row.content.normalize("NFKC").toLowerCase().includes(token))).slice(0, 8);
    const selectedObservationIds = selected.flatMap(({ row, type }) => type === "memory_observation" ? [row.id] : []);
    const selectedModelIds = selected.flatMap(({ row, type }) => type === "memory_model" ? [row.id] : []);
    const [currentObservations, currentModels, observationEdges, modelEdges] = await Promise.all([
      selectedObservationIds.length ? db.select({ id: memoryObservations.id, content: memoryObservations.content, status: memoryObservations.status,
        version: memoryObservations.version, updatedAt: memoryObservations.updatedAt, erasedAt: memoryObservations.erasedAt }).from(memoryObservations).where(and(
        eq(memoryObservations.companyId, request.companyId), inArray(memoryObservations.id, selectedObservationIds))) : [],
      selectedModelIds.length ? db.select({ id: memoryModels.id, content: memoryModels.content, status: memoryModels.status,
        version: memoryModels.version, updatedAt: memoryModels.updatedAt, erasedAt: memoryModels.erasedAt }).from(memoryModels).where(and(
        eq(memoryModels.companyId, request.companyId), inArray(memoryModels.id, selectedModelIds))) : [],
      selectedObservationIds.length ? db.select({ ownerId: memoryObservationEvidence.observationId, memoryRecordId: memoryObservationEvidence.memoryRecordId,
        sourceVersion: memoryObservationEvidence.sourceVersion }).from(memoryObservationEvidence).where(and(
        eq(memoryObservationEvidence.companyId, request.companyId), inArray(memoryObservationEvidence.observationId, selectedObservationIds))) : [],
      selectedModelIds.length ? db.select({ ownerId: memoryModelEvidence.modelId, memoryRecordId: memoryModelEvidence.memoryRecordId,
        sourceVersion: memoryModelEvidence.sourceVersion }).from(memoryModelEvidence).where(and(
        eq(memoryModelEvidence.companyId, request.companyId), or(...selected.flatMap(({ row, type }) =>
          type === "memory_model" ? [and(eq(memoryModelEvidence.modelId, row.id), eq(memoryModelEvidence.modelVersion, row.version))] : []))!)) : [],
    ]);
    const currentById = new Map([...currentObservations, ...currentModels].map((row) => [row.id, row]));
    const edgesByOwner = new Map<string, Array<{ memoryRecordId: string; sourceVersion: string }>>();
    for (const edge of [...observationEdges, ...modelEdges]) {
      const edges = edgesByOwner.get(edge.ownerId) ?? [];
      edges.push({ memoryRecordId: edge.memoryRecordId, sourceVersion: edge.sourceVersion });
      edgesByOwner.set(edge.ownerId, edges);
    }
    const evidence: EvidenceItem[] = [];
    for (const { row, type } of selected) {
      const current = currentById.get(row.id);
      if (!current || current.erasedAt || current.status !== row.status || current.version !== row.version ||
        current.updatedAt.getTime() !== row.updatedAt.getTime() || current.content !== row.content) continue;
      const sourceEdges = edgesByOwner.get(row.id) ?? [];
      evidence.push({ id: `${type}:${row.id}`, companyId: request.companyId, sourceClass: "accepted_memory", sourceProvider: "august_works_derived_memory", sourceType: type,
        sourceRef: `memory://${type}/${row.id}`, sourceVersion: String(row.version), title: type === "memory_model" && "name" in row ? row.name : "Derived observation",
        excerpt: `Derived intelligence — evidence-linked, not canonical Foundation.\n${row.content}`, sourceUpdatedAt: row.updatedAt.toISOString(), observedAt: row.updatedAt.toISOString(), validFrom: null, validUntil: null,
        authorityDomain: null, trustLevel: "low", sensitivity: row.sensitivity, citation: { label: type === "memory_model" ? "Derived mental model" : "Derived observation" },
        metadata: { derived: true, verificationState: "human_reviewed_derived", confidenceScore: row.confidence, scopeType: row.scopeType, scopeId: row.scopeId, purpose, sourceMemoryIds: [...new Set(sourceEdges.map((edge) => edge.memoryRecordId))], sourceMemoryVersions: Object.fromEntries(sourceEdges.map((edge) => [edge.memoryRecordId, edge.sourceVersion])) } });
    }
    return { evidence };
  } };
}
