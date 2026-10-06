export const FOUNDATION_CATEGORIES = [
  "company",
  "business_model",
  "market_customer",
  "products_services",
  "brand",
  "strategy",
  "organization_leadership",
  "operating_model",
  "governance",
] as const;
export type FoundationCategory = (typeof FOUNDATION_CATEGORIES)[number];

export const FOUNDATION_DOCUMENT_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "superseded",
  "archived",
] as const;
export type FoundationDocumentStatus = (typeof FOUNDATION_DOCUMENT_STATUSES)[number];

export const FOUNDATION_AUTHORITY_LEVELS = ["canonical", "supporting"] as const;
export type FoundationAuthorityLevel = (typeof FOUNDATION_AUTHORITY_LEVELS)[number];

export const FOUNDATION_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type FoundationSensitivity = (typeof FOUNDATION_SENSITIVITIES)[number];

export const FOUNDATION_PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "superseded",
] as const;
export type FoundationProposalStatus = (typeof FOUNDATION_PROPOSAL_STATUSES)[number];

export interface FoundationGovernanceSnapshot {
  category: FoundationCategory;
  documentType: string;
  authorityLevel: FoundationAuthorityLevel;
  sensitivity: FoundationSensitivity;
  ownerUserId: string | null;
  ownerAgentId: string | null;
  reviewFrequencyDays: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

export interface FoundationDraftGovernance {
  category: FoundationCategory;
  documentType: string;
  authorityLevel: FoundationAuthorityLevel;
  sensitivity: FoundationSensitivity;
  ownerUserId: string | null;
  ownerAgentId: string | null;
  reviewFrequencyDays: number | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface FoundationRevisionView {
  id: string;
  revisionNumber: number;
  title: string | null;
  body: string;
  changeSummary: string | null;
  createdAt: Date;
}

export interface FoundationDocument {
  id: string;
  companyId: string;
  documentId: string;
  approvedRevisionId: string | null;
  foundationKey: string;
  category: FoundationCategory;
  documentType: string;
  authorityLevel: FoundationAuthorityLevel;
  status: FoundationDocumentStatus;
  sensitivity: FoundationSensitivity;
  ownerUserId: string | null;
  ownerAgentId: string | null;
  reviewFrequencyDays: number | null;
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  title: string | null;
  body: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
  canonicalRevision: FoundationRevisionView | null;
  canonicalGovernance: FoundationGovernanceSnapshot | null;
}

export interface FoundationChangeProposal {
  id: string;
  companyId: string;
  foundationDocumentId: string;
  sourceType: string;
  sourceId: string | null;
  proposedByAgentId: string | null;
  proposedByUserId: string | null;
  baseRevisionId: string | null;
  proposedBody: string;
  changeSummary: string | null;
  reason: string | null;
  status: FoundationProposalStatus;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FoundationSearchScope = "approved" | "working";

export interface FoundationSection {
  id: string;
  companyId: string;
  foundationDocumentId: string;
  documentRevisionId: string;
  headingPath: string[];
  ordinal: number;
  body: string;
  contentHash: string;
  tokenCount: number;
  createdAt: Date;
}

export interface FoundationIndexResult {
  companyId: string;
  foundationDocumentId: string;
  documentRevisionId: string;
  revisionNumber: number;
  indexedSectionCount: number;
  writtenSectionCount: number;
  unchangedFromPreviousCount: number;
  changedSectionCount: number;
  removedSectionCount: number;
}

export interface FoundationSearchResult {
  sectionId: string;
  foundationDocumentId: string;
  foundationKey: string;
  category: FoundationCategory;
  documentType: string;
  authorityLevel: FoundationAuthorityLevel;
  sensitivity: FoundationSensitivity;
  status: FoundationDocumentStatus;
  documentRevisionId: string;
  revisionNumber: number;
  title: string | null;
  headingPath: string[];
  ordinal: number;
  excerpt: string;
  contentHash: string;
  tokenCount: number;
  rank: number;
  sourceUpdatedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface FoundationCapabilities {
  read: boolean;
  propose: boolean;
  edit: boolean;
  approve: boolean;
}
