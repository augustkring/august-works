import type { WorkSignalDecisionInput, WorkSignalView } from "@paperclipai/shared";
import { api } from "./client";
export const workSignalsApi = {
  list: (companyId: string) => api.get<WorkSignalView[]>(`/companies/${companyId}/work-signals`),
  decide: (companyId: string, id: string, action: "apply" | "ignore" | "review", input: WorkSignalDecisionInput) => api.post<WorkSignalView>(`/companies/${companyId}/work-signals/${id}/${action}`, input),
};
