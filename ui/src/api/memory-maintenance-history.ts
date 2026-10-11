import { memoryMaintenanceHistorySchema } from "@paperclipai/shared";
import { api } from "./client";

export const memoryMaintenanceHistoryApi = {
  async get(company: string, principal: string, signal?: AbortSignal) {
    const view = memoryMaintenanceHistorySchema.parse(await api.get(
      `/companies/${encodeURIComponent(company)}/memory/experience/maintenance?expectedUserId=${encodeURIComponent(principal)}`,
      { signal, cache: "no-store" },
    ));
    if (view.companyId !== company) throw new Error("Memory maintenance context changed");
    return view;
  },
};
