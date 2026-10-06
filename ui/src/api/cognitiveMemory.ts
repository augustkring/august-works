import type { CognitiveBindingView } from "@paperclipai/shared";
import { api as defaultApi } from "./client";
export const createCognitiveMemoryApi = (api: typeof defaultApi = defaultApi) => ({
  status: (companyId: string) => api.get<{ mode: string; hindsight: string; bindings: CognitiveBindingView[] }>(`/companies/${companyId}/memory/cognitive/status`),
  create: (companyId: string, purpose: string) => api.post<CognitiveBindingView>(`/companies/${companyId}/memory/cognitive/bindings`, { bindingKey: `local.${crypto.randomUUID()}`, providerKey: "local_baseline", scope: { type: "company", id: null }, purpose }),
  reconcile: (companyId: string, bindingId: string) => api.post<{ status: string; count: number }>(`/companies/${companyId}/memory/cognitive/reconcile`, { bindingId }),
});

export const cognitiveMemoryApi = createCognitiveMemoryApi();
