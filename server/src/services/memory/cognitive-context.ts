import type { Db } from "@paperclipai/db";
import { v7FeatureEnabled, type EvidenceItem } from "@paperclipai/shared";
import type { ContextProvider } from "../context/context-engine.js";
import { instanceSettingsService } from "../instance-settings.js";
import { cognitiveMemoryService } from "./cognitive-memory.js";
export function cognitiveContextProvider(db: Db): ContextProvider {
  return { key: "cognitive_memory", requirement: "optional", async retrieve({ request, signal }) {
    const flags = await instanceSettingsService(db).getExperimental();
    if (!v7FeatureEnabled(flags, "cognitive_memory_v7")) return { evidence: [] };
    const actor = { type: "agent" as const, companyId: request.companyId, agentId: request.agentId, source: "agent_jwt" as const,
      runId: request.runId ?? null, onBehalfOfUserId: request.responsibleUserId ?? null };
    const service = cognitiveMemoryService(db), status = await service.status(actor, request.companyId);
    const bindings = status.bindings.filter((binding) => binding.scopeType === "company"
      || (binding.scopeType === "project" && binding.scopeId === request.projectId)
      || (binding.scopeType === "subject" && request.subjectRefs?.includes(binding.scopeId!))
      || (binding.scopeType === "agent" && flags.enablePrivateAgentMemoryV1 === true && binding.scopeId === request.agentId)).slice(0, 8);
    const results = await Promise.all(bindings.map((binding) => service.recall(actor, request.companyId, binding.id, { query: request.query, purpose: request.intent ?? "general_work", sensitivityCeiling: request.sensitivityCeiling ?? "internal", topK: 24, signal })));
    return { evidence: results.flat().map(({ record, score }): EvidenceItem => ({ id: `memory:${record.id}`, companyId: request.companyId,
      sourceClass: record.scopeType === "agent" ? "private_memory" : "accepted_memory", sourceProvider: "august_works_memory", sourceType: "memory_record", sourceRef: `memory://record/${record.id}`,
      title: record.title, excerpt: record.content.slice(0, 64000), sourceVersion: record.updatedAt.toISOString(), sourceUpdatedAt: record.updatedAt.toISOString(), observedAt: record.observedAt.toISOString(),
      validFrom: record.validFrom?.toISOString() ?? null, validUntil: record.validUntil && record.expiresAt ? new Date(Math.min(record.validUntil.getTime(), record.expiresAt.getTime())).toISOString() : (record.validUntil ?? record.expiresAt)?.toISOString() ?? null,
      authorityDomain: null, trustLevel: ["human_verified", "system_verified"].includes(record.verificationState) ? "high" : "low", sensitivity: record.sensitivityLabel,
      citation: { label: record.title ?? `Memory ${record.id.slice(0, 8)}` }, metadata: { recordId: record.id, scopeType: record.scopeType, scopeId: record.scopeId, verificationState: record.verificationState, confidenceScore: record.confidenceScore, cognitiveRetrievalScore: score } })) };
  } };
}
