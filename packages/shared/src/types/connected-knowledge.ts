import type {
  ContextProviderWarning,
  EvidenceItem,
  EvidenceSourceClass,
} from "./context.js";

export const CONNECTED_KNOWLEDGE_ACCESS_MODES = [
  "live",
  "synced",
  "hybrid",
] as const;

export type ConnectedKnowledgeAccessMode =
  (typeof CONNECTED_KNOWLEDGE_ACCESS_MODES)[number];

export const CONNECTED_KNOWLEDGE_FRESHNESS_STATES = [
  "fresh",
  "stale",
  "unknown",
  "reauthorization_required",
  "unreachable",
] as const;

export type ConnectedKnowledgeFreshnessState =
  (typeof CONNECTED_KNOWLEDGE_FRESHNESS_STATES)[number];

export interface ConnectedKnowledgeEvidenceProvenance {
  providerKey: string;
  sourceProvider: string;
  accessMode: ConnectedKnowledgeAccessMode;
  aclFingerprint: string | null;
  authorizedAt: string;
  expiresAt: string | null;
  sourceAuthority: "provider";
  freshness: ConnectedKnowledgeFreshnessState;
  indexedAt: string;
  tombstone: boolean;
}

export const CONNECTED_KNOWLEDGE_SOURCE_CLASSES = [
  "system_of_record",
  "conversation",
  "external_untrusted",
] as const satisfies readonly EvidenceSourceClass[];

export type ConnectedKnowledgeSourceClass =
  (typeof CONNECTED_KNOWLEDGE_SOURCE_CLASSES)[number];

export const CONNECTED_KNOWLEDGE_DENIAL_CODES = [
  "permission_denied",
  "scope_denied",
  "principal_unresolved",
] as const;

export type ConnectedKnowledgeDenialCode =
  (typeof CONNECTED_KNOWLEDGE_DENIAL_CODES)[number];

export interface ConnectedKnowledgeProviderDescriptor {
  key: string;
  displayName: string;
  sourceProvider: string;
  accessMode: ConnectedKnowledgeAccessMode;
  sourceClasses: ConnectedKnowledgeSourceClass[];
}

export interface ConnectedKnowledgeRequest {
  enforceResponsibleUserIntersection?: boolean;
  companyId: string;
  agentId: string;
  responsibleUserId: string | null;
  runId: string | null;
  issueId: string | null;
  projectId: string | null;
  query: string;
  intent: string | null;
  subjectRefs: string[];
  limit: number;
  asOf: string;
}

export interface ConnectedKnowledgeAuthorizedScope {
  providerKey: string;
  companyId: string;
  agentId: string;
  responsibleUserId: string | null;
  runId: string | null;
  requestFingerprint: string;
  aclVersion: string | null;
  authorizedAt: string;
  expiresAt: string | null;
  constraints: Record<string, unknown>;
}

export type ConnectedKnowledgeAccessDecision =
  | {
      allowed: true;
      scope: ConnectedKnowledgeAuthorizedScope;
    }
  | {
      allowed: false;
      code: ConnectedKnowledgeDenialCode;
      reason: string;
    };

export interface ConnectedKnowledgeProviderResult {
  evidence: EvidenceItem[];
  warnings?: ContextProviderWarning[];
}
