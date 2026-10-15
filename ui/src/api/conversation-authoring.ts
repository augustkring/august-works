import { conversationAuthoringViewSchema } from "@paperclipai/shared";
import { api } from "./client";
const uuid = conversationAuthoringViewSchema.shape.companyId;
export const conversationAuthoringKey = (company: string, principal: string, conversation: string, generation: number) =>
  ["conversation-authoring", company, principal, conversation, generation] as const;
export async function getConversationAuthoring(company: string, principal: string, conversation: string, agent: string, generation: number, signal?: AbortSignal) {
  uuid.parse(company); uuid.parse(conversation); uuid.parse(agent);
  const result = conversationAuthoringViewSchema.parse(await api.get(
    `/companies/${company}/conversations/${conversation}/authoring?${new URLSearchParams({ expectedUserId: principal })}`,
    { signal, cache: "no-store" }));
  signal?.throwIfAborted();
  if (result.companyId !== company || result.conversationId !== conversation || result.agentId !== agent || result.generation !== generation)
    throw new Error("The current conversation authoring scope changed");
  return result;
}
