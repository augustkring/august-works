import type { CreateOrchestrationPlanInput, OrchestrationPlanView, OrchestrationPlanDetail, SupervisionView, SupervisionInterventionInput } from "@paperclipai/shared";
import { api } from "./client";
export const orchestrationApi = {
  list: (companyId: string) => api.get<OrchestrationPlanView[]>(`/companies/${companyId}/orchestration/plans`),
  get: (companyId: string, id: string) => api.get<OrchestrationPlanDetail>(`/companies/${companyId}/orchestration/plans/${id}`),
  create: (companyId: string, input: CreateOrchestrationPlanInput) => api.post<OrchestrationPlanView>(`/companies/${companyId}/orchestration/plans`, input),
  supervision: (companyId: string,id: string) => api.get<SupervisionView>(`/companies/${companyId}/orchestration/plans/${id}/supervision`),
  intervene: (companyId: string,id: string,input: SupervisionInterventionInput) => api.post<unknown>(`/companies/${companyId}/orchestration/plans/${id}/intervene`,input),
  decide: (companyId: string, id: string, input: { expectedVersion: number; action: "start" | "pause" | "cancel"; rationale: string }) => api.post<{ plan: OrchestrationPlanView; runtime: unknown }>(`/companies/${companyId}/orchestration/plans/${id}/decisions`, input),
};
