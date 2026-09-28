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

export const CONTEXT_EVIDENCE_BUCKETS = [
  "foundation",
  "connected_evidence",
  "shared_memory",
  "private_memory",
  "task_context",
  "artifacts",
] as const;

export type ContextEvidenceBucket = (typeof CONTEXT_EVIDENCE_BUCKETS)[number];

export interface ContextAuthoritySelector {
  sourceClass: EvidenceSourceClass;
  sourceProvider?: string;
}

export interface ContextAuthorityRule {
  authorityDomain: string;
  preferredSources: ContextAuthoritySelector[];
}

export interface ContextAuthorityPolicy {
  rules: ContextAuthorityRule[];
}

export type ContextAuthorityReason =
  | "preferred_authority"
  | "authority_fallback"
  | "lower_authority"
  | "non_authoritative_source"
  | "unconfigured_domain";

export interface ContextAuthorityDecision {
  evidence: EvidenceItem;
  authorityRank: number | null;
  primaryForDomain: boolean;
  reason: ContextAuthorityReason;
}

export type ContextEligibilityExclusionReason =
  | "not_yet_valid"
  | "expired"
  | "sensitivity_ceiling";

export interface ContextEligibilityExclusion {
  evidenceId: string;
  reason: ContextEligibilityExclusionReason;
}

export interface ContextEligibilityResult {
  eligible: EvidenceItem[];
  excluded: ContextEligibilityExclusion[];
}

export interface ContextBudgetBucket {
  maxItems: number;
}

export interface ContextBudget {
  maxItems: number;
  maxEstimatedTokens: number;
  buckets: Record<ContextEvidenceBucket, ContextBudgetBucket>;
}

export type ContextBudgetExclusionReason =
  | "bucket_item_limit"
  | "total_item_limit"
  | "total_token_limit";

export interface ContextBudgetExclusion {
  evidenceId: string;
  bucket: ContextEvidenceBucket;
  estimatedTokens: number;
  reason: ContextBudgetExclusionReason;
}

export interface ContextBudgetResult {
  selected: ContextAuthorityDecision[];
  excluded: ContextBudgetExclusion[];
  selectedEstimatedTokens: number;
  selectedItemCount: number;
  bucketItemCounts: Record<ContextEvidenceBucket, number>;
}


export const CONTEXT_PROVIDER_REQUIREMENTS = ["mandatory", "optional"] as const;
export type ContextProviderRequirement = (typeof CONTEXT_PROVIDER_REQUIREMENTS)[number];

export const CONTEXT_PROVIDER_WARNING_CODES = [
  "permission_denied",
  "provider_timeout",
  "provider_failed",
  "provider_omitted",
] as const;
export type ContextProviderWarningCode =
  (typeof CONTEXT_PROVIDER_WARNING_CODES)[number];

export interface ContextProviderWarning {
  providerKey: string;
  code: ContextProviderWarningCode;
  message: string;
}

export interface ContextPacketManifestRef {
  id: string;
  queryHash: string;
  policySnapshotHash: string;
}

export interface ContextPacket {
  governance: {
    sensitivityCeiling: EvidenceSensitivity;
    asOf: string;
  };
  foundation: EvidenceItem[];
  connectedEvidence: EvidenceItem[];
  sharedMemory: EvidenceItem[];
  privateMemory: EvidenceItem[];
  taskContext: EvidenceItem[];
  artifacts: EvidenceItem[];
  warnings: ContextProviderWarning[];
  citations: EvidenceCitation[];
  manifest: ContextPacketManifestRef | null;
  selectedEstimatedTokens: number;
}
