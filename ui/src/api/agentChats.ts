import type { Issue, AgentChatOpenInput } from "@paperclipai/shared";
import { api } from "./client";
export const agentChatsApi = {
  get: (companyId: string, agentRef: string) =>
    api.get<Issue | null>(
      `/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`,
    ),
  restart: (companyId:string, agentRef:string, replaceInaccessibleIssueId:string) =>
    api.post<Issue>(`/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`,
      {replaceInaccessibleIssueId} satisfies AgentChatOpenInput),
  ensure: (companyId: string, agentRef: string) =>
    api.post<Issue>(
      `/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`,
      {},
    ),
};
