import type { WorkSignalDecisionInput, WorkSignalView } from "@paperclipai/shared";
import { api as defaultApi } from "./client";
export const createWorkSignalsApi = (api: typeof defaultApi = defaultApi) => ({
  list: (companyId: string) => api.get<WorkSignalView[]>(`/companies/${companyId}/work-signals`),
  decide: (companyId: string, id: string, action: "apply" | "ignore" | "review", input: WorkSignalDecisionInput) => api.post<WorkSignalView>(`/companies/${companyId}/work-signals/${id}/${action}`, input),
});

export const workSignalsApi = createWorkSignalsApi();
