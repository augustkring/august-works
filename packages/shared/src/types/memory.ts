import type {
  EvidenceCitation,
  EvidenceSensitivity,
  EvidenceSourceClass,
  EvidenceTrustLevel,
} from "./context.js";

export const MEMORY_TYPES = [
  "fact",
  "observation",
  "decision_reference",
  "preference",
  "lesson",
  "outcome",
  "relationship",
  "constraint",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_REVIEW_STATES = ["pending", "accepted", "rejected"] as const;
export type MemoryReviewState = (typeof MEMORY_REVIEW_STATES)[number];

export const MEMORY_VERIFICATION_STATES = [
  "unverified",
  "corroborated",
  "human_verified",
  "system_verified",
] as const;
export type MemoryVerificationState =
  (typeof MEMORY_VERIFICATION_STATES)[number];

export const MEMORY_RETENTION_STATES = ["active", "expired"] as const;
export type MemoryRetentionState = (typeof MEMORY_RETENTION_STATES)[number];

export const MEMORY_SCOPE_TYPES = ["company", "agent", "project", "subject"] as const;
export type MemoryScopeType = (typeof MEMORY_SCOPE_TYPES)[number];

export const MEMORY_BINDING_TARGET_TYPES = ["company", "agent", "project"] as const;
export type MemoryBindingTargetType =
  (typeof MEMORY_BINDING_TARGET_TYPES)[number];

export const MEMORY_EVIDENCE_RELATIONS = [
  "supports",
  "contradicts",
  "context",
] as const;
export type MemoryEvidenceRelation =
  (typeof MEMORY_EVIDENCE_RELATIONS)[number];

export interface MemoryScope {
  type: MemoryScopeType;
  id: string | null;
}

export interface MemorySubject {
  type: string;
  id: string;
}

export interface MemoryEvidenceInput {
  sourceClass: EvidenceSourceClass;
  sourceProvider: string;
  sourceType: string;
  sourceRef: string;
  sourceVersion: string | null;
  sourceUpdatedAt: string | null;
  observedAt: string;
  excerptHash: string;
  citation: EvidenceCitation;
  trustLevel: EvidenceTrustLevel;
  relation: MemoryEvidenceRelation;
}

export interface MemoryCandidateInput {
  bindingId: string;
  memoryType: MemoryType;
  scope: MemoryScope;
  subject: MemorySubject | null;
  ownerAgentId: string | null;
  title: string | null;
  content: string;
  summary: string | null;
  sensitivity: EvidenceSensitivity;
  importance: number;
  confidenceScore: number;
  validFrom: string | null;
  validUntil: string | null;
  observedAt: string;
  retentionPolicy: string;
  expiresAt: string | null;
  createdByOperationId: string | null;
  metadata: Record<string, unknown>;
  evidence: MemoryEvidenceInput[];
}

export interface MemoryBindingInput {
  key: string;
  name: string;
  providerKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface MemoryBindingTargetInput {
  targetType: MemoryBindingTargetType;
  targetId: string;
}

export interface MemoryReviewInput {
  decision: "accept" | "reject";
  verificationState?: MemoryVerificationState;
  reason?: string | null;
}

export interface MemoryCorrectionInput
  extends Omit<MemoryCandidateInput, "bindingId" | "scope" | "ownerAgentId"> {
  reason: string;
}

export interface MemoryRevokeInput {
  reason: string;
}
