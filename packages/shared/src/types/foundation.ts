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
