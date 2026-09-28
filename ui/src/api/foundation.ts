import type {
  CreateFoundationDocument,
  FoundationCapabilities,
  FoundationChangeProposal,
  FoundationDocument,
  FoundationSearchResult,
  UpdateFoundationDraft,
} from "@paperclipai/shared";
import { api } from "./client";

export interface FoundationRevision {
  id: string;
  revisionNumber: number;
  title: string | null;
  body: string;
  changeSummary: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdByRunId: string | null;
  createdAt: Date | string;
}

export interface FoundationProposalDecisionResult {
  proposal: FoundationChangeProposal;
  foundation: FoundationDocument;
}

export const foundationApi = {
  capabilities: (companyId: string) =>
    api.get<FoundationCapabilities>(`/companies/${companyId}/foundation/capabilities`),

  list: (companyId: string) =>
    api.get<FoundationDocument[]>(`/companies/${companyId}/foundation`),

  get: (companyId: string, foundationDocumentId: string) =>
    api.get<FoundationDocument>(
      `/companies/${companyId}/foundation/${foundationDocumentId}`,
    ),

  search: (
    companyId: string,
    input: { q: string; limit?: number; scope?: "approved" | "working" },
  ) => {
    const params = new URLSearchParams({ q: input.q });
    if (input.limit) params.set("limit", String(input.limit));
    if (input.scope) params.set("scope", input.scope);
    return api.get<FoundationSearchResult[]>(
      `/companies/${companyId}/foundation/search?${params.toString()}`,
    );
  },

  create: (companyId: string, input: CreateFoundationDocument) =>
    api.post<FoundationDocument>(`/companies/${companyId}/foundation`, input),

  updateDraft: (
    companyId: string,
    foundationDocumentId: string,
    input: UpdateFoundationDraft,
  ) =>
    api.patch<FoundationDocument>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/draft`,
      input,
    ),

  revisions: (companyId: string, foundationDocumentId: string) =>
    api.get<FoundationRevision[]>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/revisions`,
    ),

  submitForReview: (
    companyId: string,
    foundationDocumentId: string,
    expectedRevisionId: string,
  ) =>
    api.post<FoundationDocument>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/submit`,
      { expectedRevisionId },
    ),

  approve: (
    companyId: string,
    foundationDocumentId: string,
    expectedRevisionId: string,
  ) =>
    api.post<FoundationDocument>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/approve`,
      { expectedRevisionId },
    ),

  rejectReview: (
    companyId: string,
    foundationDocumentId: string,
    expectedRevisionId: string,
  ) =>
    api.post<FoundationDocument>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/reject`,
      { expectedRevisionId },
    ),

  archive: (companyId: string, foundationDocumentId: string) =>
    api.post<FoundationDocument>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/archive`,
      {},
    ),

  listProposals: (companyId: string, foundationDocumentId: string) =>
    api.get<FoundationChangeProposal[]>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/proposals`,
    ),

  createProposal: (
    companyId: string,
    foundationDocumentId: string,
    input: {
      sourceType: string;
      sourceId?: string | null;
      baseRevisionId?: string | null;
      proposedBody: string;
      changeSummary?: string | null;
      reason?: string | null;
    },
  ) =>
    api.post<FoundationChangeProposal>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/proposals`,
      input,
    ),

  acceptProposal: (
    companyId: string,
    foundationDocumentId: string,
    proposalId: string,
  ) =>
    api.post<FoundationProposalDecisionResult>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/proposals/${proposalId}/accept`,
      {},
    ),

  rejectProposal: (
    companyId: string,
    foundationDocumentId: string,
    proposalId: string,
  ) =>
    api.post<FoundationChangeProposal>(
      `/companies/${companyId}/foundation/${foundationDocumentId}/proposals/${proposalId}/reject`,
      {},
    ),
};
