import type {
  MemoryBinding,
  MemoryMaintenanceJobSummary,
  MemoryBindingInput,
  MemoryBindingTargetInput,
  MemoryCorrectionInput,
  MemoryRecord,
  MemoryRecordDetail,
  MemoryRecordListQuery,
  MemoryRevokeInput,
} from "@paperclipai/shared";
import { api as defaultApi } from "./client";

export const createMemoryApi = (api: typeof defaultApi = defaultApi) => ({
  jobs: (companyId: string) => api.get<MemoryMaintenanceJobSummary[]>(`/companies/${companyId}/memory/jobs`),
  enqueueMaintenance: (companyId: string, input: { operationType: "dedupe" | "compaction" | "reflection" | "index_refresh"; recordIds: string[]; proposedLesson?: { title: string; content: string } }, key: string) =>
    api.post<{ id: string; status: string }>(`/companies/${companyId}/memory/jobs`, input, { headers: { "Idempotency-Key": key } }),
  exportMemory: (companyId: string) => api.get<unknown>(`/companies/${companyId}/memory/export`),
  forget: (companyId: string, recordId: string) =>
    api.delete<{ deletedRecordCount: number }>(`/companies/${companyId}/memory/records/${recordId}`),
  retentionPolicy: (companyId: string) => api.get<{ companyId: string; maxAgeDays: number | null; canManage: boolean }>(`/companies/${companyId}/memory/retention-policy`),
  setRetentionPolicy: (companyId: string, maxAgeDays: number | null) =>
    api.put<{ maxAgeDays: number | null }>(`/companies/${companyId}/memory/retention-policy`, { maxAgeDays }),
  listRecords: (companyId: string, input: Partial<MemoryRecordListQuery> = {}) => {
    const params = new URLSearchParams();
    if (input.reviewState) params.set("reviewState", input.reviewState);
    if (input.memoryType) params.set("memoryType", input.memoryType);
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return api.get<MemoryRecord[]>(`/companies/${companyId}/memory/records${suffix}`);
  },

  getRecord: (companyId: string, recordId: string) =>
    api.get<MemoryRecordDetail>(`/companies/${companyId}/memory/records/${recordId}`),

  accept: (companyId: string, recordId: string, reason?: string) =>
    api.post<MemoryRecordDetail>(
      `/companies/${companyId}/memory/records/${recordId}/accept`,
      reason?.trim() ? { reason: reason.trim() } : {},
    ),

  reject: (companyId: string, recordId: string, reason: string) =>
    api.post<MemoryRecordDetail>(
      `/companies/${companyId}/memory/records/${recordId}/reject`,
      { reason: reason.trim() },
    ),

  correct: (companyId: string, recordId: string, input: MemoryCorrectionInput) =>
    api.post<MemoryRecordDetail>(
      `/companies/${companyId}/memory/records/${recordId}/correct`,
      input,
    ),

  revoke: (companyId: string, recordId: string, input: MemoryRevokeInput) =>
    api.post<MemoryRecordDetail>(
      `/companies/${companyId}/memory/records/${recordId}/revoke`,
      input,
    ),

  listBindings: (companyId: string) =>
    api.get<MemoryBinding[]>(`/companies/${companyId}/memory/bindings`),

  createBinding: (companyId: string, input: MemoryBindingInput) =>
    api.post<MemoryBinding>(`/companies/${companyId}/memory/bindings`, input),

  createCompanyBinding: (companyId: string, input: MemoryBindingInput) =>
    api.post<MemoryBinding>(
      `/companies/${companyId}/memory/bindings/company`,
      input,
    ),

  addBindingTarget: (
    companyId: string,
    bindingId: string,
    input: MemoryBindingTargetInput,
  ) =>
    api.post(
      `/companies/${companyId}/memory/bindings/${bindingId}/targets`,
      input,
    ),
});

export const memoryApi = createMemoryApi();
