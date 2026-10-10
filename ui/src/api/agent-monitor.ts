import { agentMonitorSchema } from "@paperclipai/shared";
import { api } from "./client";
export const agentMonitorApi = {
  async get(
    company: string,
    principal: string,
    agentId: string,
    signal?: AbortSignal,
  ) {
    const view = agentMonitorSchema.parse(
      await api.get(
        `/companies/${encodeURIComponent(company)}/agents/${encodeURIComponent(agentId)}/experience?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    );
    if (view.companyId !== company || view.agentId !== agentId)
      throw new Error("Agent context changed");
    return view;
  },
};
