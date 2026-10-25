import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { authApi } from "@/api/auth";
import { sidebarPreferencesApi } from "@/api/sidebarPreferences";
import { useCompany } from "@/context/CompanyContext";
import {
  useResourceMemberships,
  useResourceMembershipMutation,
} from "@/hooks/useResourceMemberships";
import { useRecentAgentChats } from "@/lib/recent-agent-chats";
import { queryKeys } from "@/lib/queryKeys";
import { useLocation, useNavigate } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { AgentChatSidebar } from "./AgentChatSidebar";
import { AgentChatPicker } from "./AgentChatPicker";
import { useSidebar } from "@/context/SidebarContext";

export function SidebarAgentChats({ enabled = true, showNavigation = true }: { enabled?: boolean; showNavigation?: boolean }) {
  const { selectedCompanyId } = useCompany();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const userId = session?.user?.id ?? session?.session?.userId;
  return (
    <CompanyAgentChats
      key={`${selectedCompanyId}:${userId ?? "local-board"}`}
      companyId={selectedCompanyId}
      userId={userId}
      showNavigation={showNavigation}
      enabled={enabled}
    />
  );
}

// A scope change unmounts the picker, including its open state and search.
function CompanyAgentChats({ companyId, userId, showNavigation, enabled }: { companyId: string | null; userId?: string; showNavigation: boolean; enabled: boolean }) {
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId!),
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });
  const agents = agentsQuery.data ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const { isMobile, setSidebarOpen } = useSidebar();
  const recentIds = useRecentAgentChats(companyId ?? "", userId);
  const memberships = useResourceMemberships(companyId);
  const mutation = useResourceMembershipMutation(companyId);
  const stars = memberships.data?.starredAgentIds ?? [];
  const location = useLocation();
  const preferenceKey = queryKeys.sidebarPreferences.preferredCoworker(companyId ?? "__none__", userId ?? "__anon__");
  const preferredQuery = useQuery({
    queryKey: preferenceKey,
    queryFn: () => sidebarPreferencesApi.getPreferredCoworker(companyId!),
    enabled: Boolean(companyId && userId),
  });
  const preferredMutation = useMutation({
    mutationFn: (agentId: string | null) => sidebarPreferencesApi.updatePreferredCoworker(companyId!, { agentId }),
    onSuccess: (preference) => client.setQueryData(preferenceKey, preference),
  });
  useEffect(() => {
    const ask = () => {
      if (!enabled) {
        document.dispatchEvent(new Event("paperclip:open-command"));
        return;
      }
      const preferred = agents.find((agent) => agent.id === preferredQuery.data?.agentId);
      if (preferred) {
        navigate(`/chats/${encodeURIComponent(agentRouteRef(preferred))}`);
      } else {
        setPickerOpen(true);
      }
    };
    document.addEventListener("paperclip:ask-generalist", ask);
    return () => document.removeEventListener("paperclip:ask-generalist", ask);
  }, [agents, enabled, navigate, preferredQuery.data?.agentId]);
  const activeRef = location.pathname.match(/\/chats\/([^/]+)/)?.[1];
  const active = agents.find((agent) => agent.id === activeRef || agentRouteRef(agent) === activeRef);
  return (
    <>
      {showNavigation && <AgentChatSidebar
        agents={agents}
        onOpenChat={() => setPickerOpen(true)}
        activeId={active?.id ?? ""}
        starredIds={stars}
        recentIds={recentIds}
        onToggleStar={(id) => {
          mutation.mutate({
            resourceType: "agent",
            resourceId: id,
            resourceName: agents.find((agent) => agent.id === id)?.name ?? "Agent",
            starred: !stars.includes(id),
          });
        }}
      />}
      <AgentChatPicker
        agents={agents}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        loading={agentsQuery.isPending}
        error={agentsQuery.error}
        onRetry={() => { void agentsQuery.refetch(); }}
        preferredAgentId={preferredQuery.data?.agentId ?? null}
        onSetPreferredAgent={(agentId) => preferredMutation.mutate(agentId)}
        savingPreferred={preferredMutation.isPending}
        preferenceError={preferredMutation.error instanceof Error ? preferredMutation.error.message : null}
        onSelect={(agent) => {
          if (isMobile) setSidebarOpen(false);
          navigate(`/chats/${encodeURIComponent(agentRouteRef(agent))}`);
        }}
      />
    </>
  );
}
