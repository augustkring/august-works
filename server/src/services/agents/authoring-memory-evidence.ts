import type { EvidenceItem } from "@paperclipai/shared";
import type { resolveAuthoringMemory } from "./authoring-memory.js";

export function authoringMemoryEvidence(companyId: string,
  memory: Awaited<ReturnType<typeof resolveAuthoringMemory>>): EvidenceItem[] {
  return memory.map(pin => ({ id: `memory:${pin.recordId}:${pin.version}`, companyId,
    sourceClass: "accepted_memory", sourceProvider: "august_works_memory", sourceType: "memory_record",
    sourceRef: `memory://record/${pin.recordId}`, sourceVersion: pin.version, sourceUpdatedAt: pin.version,
    title: pin.title, excerpt: pin.body, observedAt: new Date().toISOString(), validFrom: pin.validFrom,
    validUntil: pin.validUntil, authorityDomain: null, trustLevel: "high", sensitivity: pin.sensitivity,
    citation: { label: pin.title, href: `/memory/${pin.recordId}` },
    metadata: { recordId: pin.recordId, bodyHash: pin.bodyHash, memoryType: "preference", readOnly: true, expiresAt: pin.expiresAt } }));
}
