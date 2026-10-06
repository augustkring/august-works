import type { Db } from "@paperclipai/db";
import { v7FeatureEnabled, type EvidenceItem } from "@paperclipai/shared";
import type { ContextProvider } from "../context/context-engine.js";
import { instanceSettingsService } from "../instance-settings.js";
import { derivedMemoryService } from "./derived-memory.js";
export function derivedMemoryContextProvider(db: Db): ContextProvider {
  return { key: "derived_memory", requirement: "optional", async retrieve({ request }) {
    const flags = await instanceSettingsService(db).getExperimental();
    if (!v7FeatureEnabled(flags, "memory_observations_v7")) return { evidence: [] };
    const actor = { type: "agent" as const, companyId: request.companyId, agentId: request.agentId, source: "agent_jwt" as const, runId: request.runId ?? null, onBehalfOfUserId: request.responsibleUserId ?? null };
    const service = derivedMemoryService(db), purpose = request.intent ?? "general_work";
    const observations = (await service.listObservations(actor, request.companyId)).filter((row) => row.status === "accepted");
    const models = v7FeatureEnabled(flags, "memory_models_v7") ? (await service.listModels(actor, request.companyId)).filter((row) => row.status === "active") : [];
    const tokens = [...new Set(request.query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
    const selected = [...observations.map((row) => ({ row, type: "memory_observation" as const })), ...models.map((row) => ({ row, type: "memory_model" as const }))]
      .filter(({ row }) => row.purpose === purpose && (row.scopeType === "company" || (row.scopeType === "project" && row.scopeId === request.projectId) || (row.scopeType === "subject" && request.subjectRefs?.includes(row.scopeId!)))
        && tokens.some((token) => row.content.normalize("NFKC").toLowerCase().includes(token))).slice(0, 8);
    const evidence: EvidenceItem[] = [];
    for (const { row, type } of selected) {
      const detail = type === "memory_model" ? await service.getModel(actor, request.companyId, row.id) : await service.getObservation(actor, request.companyId, row.id);
      if (!detail.content || !["accepted", "active"].includes(detail.status) || detail.version !== row.version || detail.updatedAt.getTime() !== row.updatedAt.getTime()) continue;
      evidence.push({ id: `${type}:${row.id}`, companyId: request.companyId, sourceClass: "accepted_memory", sourceProvider: "august_works_derived_memory", sourceType: type,
        sourceRef: `memory://${type}/${row.id}`, sourceVersion: String(row.version), title: type === "memory_model" && "name" in row ? row.name : "Derived observation",
        excerpt: `Derived intelligence — evidence-linked, not canonical Foundation.\n${row.content}`, sourceUpdatedAt: row.updatedAt.toISOString(), observedAt: row.updatedAt.toISOString(), validFrom: null, validUntil: null,
        authorityDomain: null, trustLevel: "low", sensitivity: row.sensitivity, citation: { label: type === "memory_model" ? "Derived mental model" : "Derived observation" },
        metadata: { derived: true, verificationState: "human_reviewed_derived", confidenceScore: row.confidence, scopeType: row.scopeType, scopeId: row.scopeId, purpose, sourceMemoryIds: [...new Set(detail.evidence.map((edge) => edge.memoryRecordId))], sourceMemoryVersions: Object.fromEntries(detail.evidence.map((edge) => [edge.memoryRecordId, edge.sourceVersion])) } });
    }
    return { evidence };
  } };
}
