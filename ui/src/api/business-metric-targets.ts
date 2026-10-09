import type { BusinessMetricTargetView, BusinessMetricTargetVersionView, BusinessMetricTargetComparison, BusinessMetricResult, CreateBusinessMetricTarget, ReviseBusinessMetricTarget, ApproveBusinessMetricTarget, RetireBusinessMetricTarget } from "@paperclipai/shared";
import { api } from "./client";
const path = (companyId: string, suffix: string, userId?: string | null, cursor?: string) => {
  const params = new URLSearchParams(); if (userId) params.set("expectedUserId", userId); if (cursor) params.set("cursor", cursor);
  return `/companies/${encodeURIComponent(companyId)}/business-metric-targets${suffix}${params.size ? `?${params}` : ""}`;
};
export const businessMetricTargetsApi = {
  list: (companyId: string, cursor?: string, userId?: string | null) => api.get<{ items: BusinessMetricTargetView[]; nextCursor: string | null }>(path(companyId, "", userId, cursor), { cache: "no-store" }),
  detail: (companyId: string, id: string, userId?: string | null) => api.get<{ target: BusinessMetricTargetView; versions: BusinessMetricTargetVersionView[]; reviewReason: string | null }>(path(companyId, `/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  create: (companyId: string, input: CreateBusinessMetricTarget, userId?: string | null) => api.post<{ target: BusinessMetricTargetView; version: BusinessMetricTargetVersionView }>(path(companyId, "", userId), input),
  revise: (companyId: string, id: string, input: ReviseBusinessMetricTarget, userId?: string | null) => api.post<BusinessMetricTargetVersionView>(path(companyId, `/${encodeURIComponent(id)}/versions`, userId), input),
  approve: (companyId: string, id: string, input: ApproveBusinessMetricTarget, userId?: string | null) => api.post<BusinessMetricTargetView>(path(companyId, `/${encodeURIComponent(id)}/approve`, userId), input),
  retire: (companyId: string, id: string, input: RetireBusinessMetricTarget, userId?: string | null) => api.post<BusinessMetricTargetView>(path(companyId, `/${encodeURIComponent(id)}/retire`, userId), input),
  compare: (companyId: string, id: string, userId?: string | null) => api.post<{ comparison: BusinessMetricTargetComparison; observation: BusinessMetricResult | null }>(path(companyId, `/${encodeURIComponent(id)}/compare`, userId), {}),
};
