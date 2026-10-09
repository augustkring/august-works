import type { StrategyExecutionLinkView, StrategyExecutionLinkVersionView, StrategyExecutionLinkDetail, StrategyExecutionLinkList, CreateStrategyExecutionLink, ReviseStrategyExecutionLink, ApproveStrategyExecutionLink, RetireStrategyExecutionLink } from "@paperclipai/shared";
import { api } from "./client";
const path = (companyId: string, suffix: string, userId?: string | null, cursor?: string) => {
  const params = new URLSearchParams(); if (userId) params.set("expectedUserId", userId); if (cursor) params.set("cursor", cursor);
  return `/companies/${encodeURIComponent(companyId)}/strategy-execution-links${suffix}${params.size ? `?${params}` : ""}`;
};
export const strategyExecutionApi = {
  list: (companyId: string, cursor?: string, userId?: string | null) => api.get<StrategyExecutionLinkList>(path(companyId, "", userId, cursor), { cache: "no-store" }),
  detail: (companyId: string, id: string, userId?: string | null) => api.get<StrategyExecutionLinkDetail>(path(companyId, `/${encodeURIComponent(id)}`, userId), { cache: "no-store" }),
  create: (companyId: string, input: CreateStrategyExecutionLink, userId?: string | null) => api.post<{ link: StrategyExecutionLinkView; version: StrategyExecutionLinkVersionView }>(path(companyId, "", userId), input),
  revise: (companyId: string, id: string, input: ReviseStrategyExecutionLink, userId?: string | null) => api.post<StrategyExecutionLinkVersionView>(path(companyId, `/${encodeURIComponent(id)}/versions`, userId), input),
  approve: (companyId: string, id: string, input: ApproveStrategyExecutionLink, userId?: string | null) => api.post<StrategyExecutionLinkView>(path(companyId, `/${encodeURIComponent(id)}/approve`, userId), input),
  retire: (companyId: string, id: string, input: RetireStrategyExecutionLink, userId?: string | null) => api.post<StrategyExecutionLinkView>(path(companyId, `/${encodeURIComponent(id)}/retire`, userId), input),
};
