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

export const MEMORY_RETENTION_STATES = ["active", "expired", "superseded"] as const;
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

export type SharedMemoryScope =
  | { type: "company"; id: null }
  | { type: "project"; id: string }
  | { type: "subject"; id: string };

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
  reason?: string | null;
}

export interface MemoryCorrectionInput
  extends Omit<MemoryCandidateInput, "bindingId" | "scope" | "ownerAgentId"> {
  reason: string;
}

export interface MemoryRevokeInput {
  reason: string;
}

export interface MemoryPrivateInput
  extends Omit<
    MemoryCandidateInput,
    "scope" | "ownerAgentId" | "createdByOperationId"
  > {
  createdByOperationId: string;
}

export interface MemoryShareInput {
  targetBindingId: string;
  targetScope: SharedMemoryScope;
  reason: string;
  createdByOperationId: string;
}

export interface MemoryPrivateCorrectionInput
  extends Omit<MemoryCorrectionInput, "createdByOperationId"> {
  createdByOperationId: string;
}


export interface MemoryBinding {
  id: string;
  companyId: string;
  key: string;
  name: string;
  providerKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRecord {
  id: string;
  companyId: string;
  bindingId: string;
  providerKey: string;
  memoryType: MemoryType;
  scopeType: MemoryScopeType;
  scopeId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  ownerAgentId: string | null;
  title: string | null;
  content: string;
  summary: string | null;
  reviewState: MemoryReviewState;
  verificationState: MemoryVerificationState;
  sensitivityLabel: EvidenceSensitivity;
  importance: number;
  confidenceScore: number;
  validFrom: Date | null;
  validUntil: Date | null;
  observedAt: Date;
  retentionPolicy: string;
  expiresAt: Date | null;
  retentionState: MemoryRetentionState;
  supersedesRecordId: string | null;
  supersededByRecordId: string | null;
  revokedAt: Date | null;
  revokedByActorType: "user" | "agent" | "system" | null;
  revokedByActorId: string | null;
  revocationReason: string | null;
  createdByActorType: "user" | "agent" | "system";
  createdByActorId: string;
  createdByOperationId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MemoryEvidence {
  id: string;
  companyId: string;
  memoryRecordId: string;
  sourceClass: EvidenceSourceClass;
  sourceProvider: string;
  sourceType: string;
  sourceRef: string;
  sourceVersion: string | null;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  excerptHash: string;
  citationJson: EvidenceCitation;
  trustLevel: EvidenceTrustLevel;
  supportsOrContradicts: MemoryEvidenceRelation;
  createdAt: Date;
}

export interface MemoryRecordDetail {
  record: MemoryRecord;
  evidence: MemoryEvidence[];
}

export interface MemoryRecordListQuery {
  reviewState?: MemoryReviewState;
  memoryType?: MemoryType;
  limit: number;
}
