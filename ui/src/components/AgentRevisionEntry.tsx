import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { agentAuthoringApi } from "../api/agent-authoring";
import { useAccountIdentity } from "../api/companies-query";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useNavigate } from "../lib/router";
import { Button } from "./ui/button";

export function AgentRevisionEntry(props: {
  company: string;
  agentId: string;
  beforeNavigate: () => boolean | Promise<boolean>;
}) {
  const feature = useV9FeatureEnabled("hire_agent_v9");
  return feature.enabled ? <CurrentRevisionEntry {...props} /> : null;
}
function CurrentRevisionEntry({
  company,
  agentId,
  beforeNavigate,
}: {
  company: string;
  agentId: string;
  beforeNavigate: () => boolean | Promise<boolean>;
}) {
  const { t } = useTranslation("experience"),
    identity = useAccountIdentity(),
    navigate = useNavigate(),
    client = useQueryClient();
  const principal = identity.userId;
  const alive = useRef(true),
    scope = useRef("");
  scope.current = `${company}:${principal}:${agentId}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = ["agent-draft-admission", company, principal, agentId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      agentAuthoringApi.admission(company, principal!, agentId, signal),
    enabled: identity.settled && !!principal && !identity.localImplicit,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.payload.entityId === agentId ||
      /permission|membership|privacy|erased|deleted/i.test(action)
    )
      void client.resetQueries({ queryKey: key });
  });
  if (
    identity.failed ||
    query.isError ||
    query.isPending ||
    query.isFetching ||
    !query.data?.canCreateDraft
  )
    return null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">
        {t("agentRevisionBoundary")}
      </p>
      <Button
        className="min-h-11"
        variant="outline"
        onClick={() => {
          const requestedScope = scope.current;
          void Promise.resolve(beforeNavigate()).then((allowed) => {
            if (allowed && alive.current && scope.current === requestedScope)
              navigate(`/agents/custom?agentId=${encodeURIComponent(agentId)}`);
          });
        }}
      >
        {t("agentRevisionCreate")}
      </Button>
    </div>
  );
}
