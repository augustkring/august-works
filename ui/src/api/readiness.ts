import type { AssessReadiness, ReadinessAssessmentView } from "@paperclipai/shared";
import { api } from "./client";
export const readinessApi = {
  assess: (companyId: string, input: AssessReadiness) => api.post<ReadinessAssessmentView>(`/companies/${companyId}/readiness/assess`, input),
  list: (companyId: string) => api.get<ReadinessAssessmentView[]>(`/companies/${companyId}/readiness/assessments`),
};
