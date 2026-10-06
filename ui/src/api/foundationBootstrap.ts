import type { BootstrapRunView } from "@paperclipai/shared";
import { api as defaultApi } from "./client";
export const createFoundationBootstrapApi = (api: typeof defaultApi = defaultApi) => ({
  start: (companyId: string, input: { agentId: string; query: string; idempotencyKey: string }) => api.post<BootstrapRunView & { dispatchPending: boolean }>(`/companies/${companyId}/foundation/bootstrap`, input),
  get: (companyId: string, id: string) => api.get<BootstrapRunView & { initialQuestions: Array<{ key: string; question: string; required: boolean }>; withheldCandidateCount: number }>(`/companies/${companyId}/foundation/bootstrap/${id}`),
  answer: (companyId: string, id: string, expectedVersion: number, questionKey: string, answer: string) => api.post<BootstrapRunView>(`/companies/${companyId}/foundation/bootstrap/${id}/answer`, { expectedVersion, questionKey, answer }),
  proposals: (companyId: string, id: string, expectedVersion: number) => api.post<BootstrapRunView>(`/companies/${companyId}/foundation/bootstrap/${id}/create-proposals`, { expectedVersion }),
});

export const foundationBootstrapApi = createFoundationBootstrapApi();
