import type {
  AssessReadiness,
  ReadinessAssessmentView,
  CoreStewardSummary,
} from "@paperclipai/shared";
import { api } from "./client";
const scope = (path: string, userId?: string | null) =>
  userId ? `${path}?expectedUserId=${encodeURIComponent(userId)}` : path;
export const readinessApi = {
  stewards: (companyId: string) =>
    api.get<CoreStewardSummary>(`/companies/${companyId}/core-stewards`),
  findings: (companyId: string, userId?: string | null) =>
    api.get<
      Array<{ id: string; summary: string; status: string; severity: string }>
    >(scope(`/companies/${companyId}/readiness/findings`, userId)),
  assess: (companyId: string, input: AssessReadiness, userId?: string | null) =>
    api.post<ReadinessAssessmentView>(
      scope(`/companies/${companyId}/readiness/assess`, userId),
      input,
    ),
  list: (companyId: string) =>
    api.get<ReadinessAssessmentView[]>(
      `/companies/${companyId}/readiness/assessments`,
    ),
};
