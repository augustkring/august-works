import { maintenanceHistorySchema } from "@paperclipai/shared";
import { api } from "./client";
export const maintenanceHistoryApi = {
  async get(
    company: string,
    principal: string,
    installationId: string,
    signal?: AbortSignal,
  ) {
    const view = maintenanceHistorySchema.parse(
      await api.get(
        `/companies/${encodeURIComponent(company)}/agent-package-installations/${encodeURIComponent(installationId)}/experience/maintenance?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    );
    if (view.companyId !== company || view.installationId !== installationId)
      throw new Error("Maintenance context changed");
    return view;
  },
};
