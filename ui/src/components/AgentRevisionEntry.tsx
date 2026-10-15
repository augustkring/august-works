import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { agentAuthoringApi } from "../api/agent-authoring";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
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
    identity = useV9CurrentAccount(),
    navigate = useNavigate(),
    client = useQueryClient();
  const principal = identity.userId;
  const authority = useV9PrivateReadAuthority(principal ?? "");
  const navigationPending = useRef(false);
  const alive = useRef(true),
    scope = useRef("");
  scope.current = `${company}:${principal}:${agentId}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = ["agent-draft-admission", company, principal, agentId, authority.epoch];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.admission(company, principal!, agentId, signal)),
    enabled: authority.readReady && !!principal && !identity.localImplicit,
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
  function current() {
    const state = client.getQueryState(key);
    return authority.canRead() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated &&
      client.getQueryData<{ canCreateDraft: boolean }>(key)?.canCreateDraft === true;
  }
  if (
    !current() || identity.failed ||
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
          if (navigationPending.current || !current()) return;
          const requestedScope = scope.current;
          navigationPending.current = true;
          void (async () => {
            try {
              if (!await beforeNavigate() || !alive.current || scope.current !== requestedScope || !current()) return;
              // The Human decision may outlive the server-side admission. Fetch
              // its current Native owner again before handing off to the draft.
              await client.fetchQuery({ queryKey: key, retry: false, staleTime: 0,
                queryFn: ({ signal }) => authority.read(() => agentAuthoringApi.admission(company, principal!, agentId, signal)) });
              if (alive.current && scope.current === requestedScope && current())
                navigate(`/agents/custom?agentId=${encodeURIComponent(agentId)}`);
            } catch { /* Failed admission never permits a handoff; the query hides the entry. */ }
            finally { navigationPending.current = false; }
          })();
        }}
      >
        {t("agentRevisionCreate")}
      </Button>
    </div>
  );
}
