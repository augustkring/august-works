import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {ApiError,isAnalyticalSourceAccessLost} from "@/api/client";
import {Button} from "@/components/ui/button";
import { agentChatsApi } from "@/api/agentChats";
import { agentsApi } from "@/api/agents";
import { authApi } from "@/api/auth";
import { useCompany } from "@/context/CompanyContext";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { recordAgentChatVisit } from "@/lib/recent-agent-chats";
import { queryKeys } from "@/lib/queryKeys";
import { useParams } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { TaskDetailSurface } from "./IssueDetail";
import type { Issue } from "@paperclipai/shared";

export function AgentChat() {
  const { agentRef = "" } = useParams<{ agentRef: string }>();
  const { selectedCompanyId } = useCompany();
  const { enabled, loaded } = useAgentChatEnabled();
  const client = useQueryClient();
  const agents = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const userId =
    session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const agent = agents.data?.find(
    (item) => item.id === agentRef || agentRouteRef(item) === agentRef,
  );
  const chatKey = queryKeys.agentChats.detail(selectedCompanyId, userId, agent?.id);
  const chat = useQuery({
    queryKey: chatKey,
    queryFn: () => agentChatsApi.get(selectedCompanyId!, agent!.id),
    enabled: enabled && !!agent && session.isFetched,
    retry: (count,error) => !isAnalyticalSourceAccessLost(error) && count < 3,
  });
  const creating = useRef<Promise<Issue> | null>(null);
  useEffect(() => {
    creating.current = null;
  }, [selectedCompanyId, userId, agent?.id, chat.data?.id]);
  useEffect(() => {
    if (enabled && agent && session.isFetched)
      recordAgentChatVisit(agent.companyId, userId, agent.id);
  }, [enabled, agent?.id, agent?.companyId, userId, session.isFetched]);
  const ensureIssue = useCallback(async () => {
    if (!agent || !selectedCompanyId) throw new Error("Agent not found");
    if (chat.data) return chat.data;
    const promise = (creating.current ??= agentChatsApi.ensure(
      selectedCompanyId,
      agent.id,
    ));
    try {
      const issue = await promise;
      client.setQueryData(queryKeys.issues.detail(issue.id), issue);
      client.setQueryData(chatKey, issue);
      return issue;
    } catch (error) {
      creating.current = null;
      throw error;
    }
  }, [agent, selectedCompanyId, chat.data, client, userId]);
  const recoveryIssueId = chat.error instanceof ApiError
    ? (chat.error.body as {details?:{conversationIssueId?:unknown}})?.details?.conversationIssueId : undefined;
  const restart = useMutation({
    mutationFn: () => {
      if (!agent || !selectedCompanyId || typeof recoveryIssueId !== "string") throw new Error("Conversation recovery is unavailable");
      return agentChatsApi.restart(selectedCompanyId,agent.id,recoveryIssueId);
    },
    onSuccess: issue => {
      creating.current=null;
      client.setQueryData(queryKeys.issues.detail(issue.id),issue);
      client.setQueryData(chatKey,issue);
      void chat.refetch();
    },
  });
  const refreshConversation = useCallback(() => { void chat.refetch(); }, [chat.refetch]);
  if (!loaded || agents.isPending || session.isPending)
    return (
      <p className="text-sm text-muted-foreground">Loading conversation…</p>
    );
  if (!enabled && !chat.data)
    return (
      <p className="text-sm text-muted-foreground">
        Agent Chat is disabled. Enable it in Experimental settings. Existing
        history remains available through task links.
      </p>
    );
  if (agents.error || chat.error)
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{(restart.error ?? agents.error ?? chat.error)?.message}</p>
        {enabled && agent && isAnalyticalSourceAccessLost(chat.error) && typeof recoveryIssueId === "string" && (
          <Button variant="outline" disabled={restart.isPending} onClick={() => restart.mutate()}>Start a new conversation</Button>
        )}
      </div>
    );
  if (!agent)
    return <p className="text-sm text-destructive">Agent not found.</p>;
  if (chat.isPending)
    return (
      <p className="text-sm text-muted-foreground">Loading conversation…</p>
    );
  return (
    <TaskDetailSurface
      // Preserve the unsent composer when lazy creation assigns its issue ID.
      // Source denial unmounts this surface before explicit recovery.
      key={`${selectedCompanyId}:${agent.id}:${userId}`}
      conversation={{ agent, issue: chat.data ?? null, ensureIssue, refreshConversation }}
    />
  );
}
