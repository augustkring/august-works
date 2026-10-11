import { agentRetirementCommandSchema, agentRetirementViewSchema, type AgentRetirementCommand } from "@paperclipai/shared";
import { api } from "./client";

const path = (companyId: string, agentId: string, principal: string) =>
  `/companies/${encodeURIComponent(companyId.toLowerCase())}/agents/${encodeURIComponent(agentId.toLowerCase())}/retirement?expectedUserId=${encodeURIComponent(principal)}`;
function original(raw: unknown, companyId: string, agentId: string) {
  const view = agentRetirementViewSchema.parse(raw);
  if (view.companyId !== companyId.toLowerCase() || view.agentId !== agentId.toLowerCase()) throw new Error("Retirement context changed");
  return view;
}
export const agentRetirementApi = {
  get: async (companyId: string, agentId: string, principal: string, signal?: AbortSignal) => {
    const raw = await api.get(path(companyId, agentId, principal), { signal, cache: "no-store" });
    signal?.throwIfAborted();
    return original(raw, companyId, agentId);
  },
  retire: async (companyId: string, agentId: string, principal: string, raw: AgentRetirementCommand) =>
    original(await api.post(path(companyId, agentId, principal), agentRetirementCommandSchema.parse(raw)), companyId, agentId),
};
