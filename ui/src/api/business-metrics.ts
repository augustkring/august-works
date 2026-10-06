import type { BusinessMetricView, BusinessMetricVersionView, BusinessMetricResult, BusinessMetricQuery, CreateBusinessMetric, CreateBusinessMetricVersion, PublishBusinessMetric, TransitionBusinessMetric } from "@paperclipai/shared";
import { api } from "./client";
const actorPath = (path: string, userId?: string | null) => userId ? `${path}${path.includes("?") ? "&" : "?"}expectedUserId=${encodeURIComponent(userId)}` : path;
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/business-metrics`;
export const businessMetricsApi = {
  list: (companyId: string, cursor?: string, userId?: string | null) => api.get<{ items: BusinessMetricView[]; nextCursor: string | null }>(actorPath(`${base(companyId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, userId), { cache: "no-store" }),
  detail: (companyId: string, metricId: string, userId?: string | null) => api.get<{ metric: BusinessMetricView; versions: BusinessMetricVersionView[] }>(actorPath(`${base(companyId)}/${encodeURIComponent(metricId)}`, userId), { cache: "no-store" }),
  create: (companyId: string, input: CreateBusinessMetric, userId?: string | null) => api.post<{ metric: BusinessMetricView; version: BusinessMetricVersionView }>(actorPath(base(companyId), userId), input),
  createVersion: (companyId: string, metricId: string, input: CreateBusinessMetricVersion, userId?: string | null) => api.post<BusinessMetricVersionView>(actorPath(`${base(companyId)}/${encodeURIComponent(metricId)}/versions`, userId), input),
  publish: (companyId: string, metricId: string, input: PublishBusinessMetric, userId?: string | null) => api.post<BusinessMetricView>(actorPath(`${base(companyId)}/${encodeURIComponent(metricId)}/publish`, userId), input),
  transition: (companyId: string, metricId: string, input: TransitionBusinessMetric, userId?: string | null) => api.post<BusinessMetricView>(actorPath(`${base(companyId)}/${encodeURIComponent(metricId)}/lifecycle`, userId), input),
  query: (companyId: string, input: BusinessMetricQuery, userId?: string | null) => api.post<BusinessMetricResult>(actorPath(`${base(companyId)}/query`, userId), input),
};
