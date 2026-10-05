import type { MemoryObservationView, MemoryModelView } from "@paperclipai/shared";
import { api } from "./client";
export const derivedMemoryApi = {
  observations: (companyId: string) => api.get<MemoryObservationView[]>(`/companies/${companyId}/memory/observations`),
  models: (companyId: string) => api.get<MemoryModelView[]>(`/companies/${companyId}/memory/models`),
  observation: (companyId: string, id: string) => api.get<MemoryObservationView & { evidence: Array<{ memoryRecordId: string; sourceVersion: string; relationship: string }> }>(`/companies/${companyId}/memory/observations/${id}`),
  model: (companyId: string, id: string) => api.get<MemoryModelView & { evidence: Array<{ memoryRecordId: string; sourceVersion: string; observationId: string | null }> }>(`/companies/${companyId}/memory/models/${id}`),
  createObservation: (companyId: string, input: { content: string; purpose: string; sensitivity: string; recordIds: string[] }) => api.post<MemoryObservationView>(`/companies/${companyId}/memory/observations`, {
    observationKey: `observation.${crypto.randomUUID()}`, scope: { type: "company", id: null }, content: input.content, purpose: input.purpose, sensitivity: input.sensitivity, evidence: input.recordIds.map((memoryRecordId) => ({ memoryRecordId, relation: "supports" })),
  }),
  createModel: (companyId: string, input: { name: string; purpose: string; query: string; recordIds: string[] }) => api.post<MemoryModelView>(`/companies/${companyId}/memory/models`, {
    modelKey: `model.${crypto.randomUUID()}`, name: input.name, scope: { type: "company", id: null }, purpose: input.purpose, sourceQuery: input.query, memoryRecordIds: input.recordIds, observationIds: [],
  }),
  review: (companyId: string, kind: "observations" | "models", id: string, decision: "accept" | "reject" | "revoke", expectedVersion: number, reason: string) => api.post(`/companies/${companyId}/memory/${kind}/${id}/${decision}`, { expectedVersion, reason }),
  rebuild: (companyId: string, id: string, expectedVersion: number, recordIds: string[]) => api.post<{ id: string; status: string }>(`/companies/${companyId}/memory/models/${id}/rebuild`, { expectedVersion, memoryRecordIds: recordIds, observationIds: [] }),
};
