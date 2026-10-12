import { agentPauseReceiptSchema, agentPauseReviewSchema, type AgentPauseCommand } from "@paperclipai/shared";
import { api } from "./client";
const path = (company: string, agent: string, principal: string, action: string) =>
  `/companies/${encodeURIComponent(company)}/agents/${encodeURIComponent(agent)}/experience/${action}?expectedUserId=${encodeURIComponent(principal)}`;
export const agentPauseApi = {
  review: async (company: string, principal: string, agentId: string, signal?: AbortSignal) =>
    agentPauseReviewSchema.parse(await api.get(path(company, agentId, principal, "pause-review"), { signal, cache: "no-store" })),
  pause: async (company: string, principal: string, agentId: string, command: AgentPauseCommand) =>
    agentPauseReceiptSchema.parse(await api.post(path(company, agentId, principal, "pause"), command)),
  receipt: async (company: string, principal: string, agentId: string, requestId: string, signal?: AbortSignal) => {
    const value = await api.get(path(company, agentId, principal, `pause-requests/${encodeURIComponent(requestId)}`), { signal, cache: "no-store" });
    return value === null ? null : agentPauseReceiptSchema.parse(value);
  },
};
