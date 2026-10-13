import { memoryMaintenanceHistoryQuerySchema, memoryMaintenanceHistorySchema } from "@paperclipai/shared";
import { api } from "./client";

export const memoryMaintenanceHistoryApi = {
  async get(company: string, principal: string, signal?: AbortSignal, jobId?: string) {
    memoryMaintenanceHistoryQuerySchema.parse({ expectedUserId: principal, ...(jobId !== undefined ? { jobId } : {}) });
    const view = memoryMaintenanceHistorySchema.parse(await api.get(
      `/companies/${encodeURIComponent(company)}/memory/experience/maintenance?expectedUserId=${encodeURIComponent(principal)}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`,
      { signal, cache: "no-store" },
    ));
    if (view.companyId !== company || jobId && view.entries.some(entry => entry.jobId !== jobId)) throw new Error("Memory maintenance context changed");
    return view;
  },
};
