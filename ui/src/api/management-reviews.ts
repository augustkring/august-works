import type { CreateManagementReviewTask, ManagementReviewDefinition, ManagementReviewView, ManagementSourceOptions, ManagementSourceOptionsQuery, publishManagementReviewSchema, recordManagementReviewEventSchema } from "@paperclipai/shared";
import { api } from "./client";
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/management-reviews`;
const account = (path: string, userId?: string | null) => userId ? `${path}${path.includes("?") ? "&" : "?"}expectedUserId=${encodeURIComponent(userId)}` : path;
export interface ManagementReviewControls {
  items: Array<{ id: string; status: ManagementReviewView["status"]; createdAt: string; expiresAt: string }>;
  nextCursor: string | null;
  coverage: "bounded_native_review_metadata";
}
export const managementReviewsApi = {
  sourceOptions: (companyId: string, query: Omit<ManagementSourceOptionsQuery, "expectedUserId">, userId?: string | null) => { const params = new URLSearchParams({ kind: query.kind }); if (query.q) params.set("q", query.q); if (query.parentId) params.set("parentId", query.parentId); return api.get<ManagementSourceOptions>(account(`${base(companyId)}/source-options?${params}`, userId), { cache: "no-store" }); },
  controls: (companyId: string, cursor?: string, userId?: string | null) => api.get<ManagementReviewControls>(account(`${base(companyId)}/controls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, userId), { cache: "no-store" }),
  detail: (companyId: string, id: string, userId?: string | null) => api.get<ManagementReviewView>(account(`${base(companyId)}/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  create: (companyId: string, definition: ManagementReviewDefinition, userId?: string | null) => api.post<{ id: string; companyId: string; status: "draft"; contentHash: string }>(account(base(companyId), userId), definition),
  publish: (companyId: string, id: string, input: ReturnType<typeof publishManagementReviewSchema.parse>, userId?: string | null) => api.post<{ id: string; companyId: string; status: "published"; contentHash: string }>(account(`${base(companyId)}/${encodeURIComponent(id)}/publish`, userId), input),
  event: (companyId: string, id: string, input: ReturnType<typeof recordManagementReviewEventSchema.parse>, userId?: string | null) => api.post<{ id: string; reviewId: string; ordinal: number; event: string; interpretation: "human_reported_event" }>(account(`${base(companyId)}/${encodeURIComponent(id)}/events`, userId), input),
  createTask: (companyId: string, id: string, input: CreateManagementReviewTask, userId?: string | null) => api.post<{ issueId: string; reviewId: string; itemKey: string; reused: boolean }>(account(`${base(companyId)}/${encodeURIComponent(id)}/tasks`, userId), input),
};
