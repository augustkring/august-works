export const EVIDENCE_SOURCE_CLASSES = [
  "foundation",
  "system_of_record",
  "accepted_memory",
  "private_memory",
  "task",
  "artifact",
  "conversation",
  "external_untrusted",
] as const;

export type EvidenceSourceClass = (typeof EVIDENCE_SOURCE_CLASSES)[number];

export const EVIDENCE_TRUST_LEVELS = [
  "high",
  "medium",
  "low",
  "untrusted",
] as const;

export type EvidenceTrustLevel = (typeof EVIDENCE_TRUST_LEVELS)[number];

export const EVIDENCE_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export type EvidenceSensitivity = (typeof EVIDENCE_SENSITIVITIES)[number];

export interface EvidenceCitation {
  label: string;
  href?: string;
}

export interface EvidenceItem {
  id: string;
  companyId: string;

  sourceClass: EvidenceSourceClass;
  sourceProvider: string;
  sourceType: string;
  sourceRef: string;

  title: string | null;
  excerpt: string;

  sourceVersion: string | null;
  sourceUpdatedAt: string | null;
  observedAt: string;

  validFrom: string | null;
  validUntil: string | null;

  authorityDomain: string | null;
  trustLevel: EvidenceTrustLevel;
  sensitivity: EvidenceSensitivity;

  citation: EvidenceCitation;
  metadata: Record<string, unknown>;
}
