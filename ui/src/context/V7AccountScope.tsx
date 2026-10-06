import { Activity, createContext, useContext, useMemo, type ComponentType } from "react";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { useAccountIdentity } from "@/api/companies-query";
import { createAccountClient, type BoardPrincipal } from "@/api/account-client";
import { healthApi } from "@/api/health";
import { createFoundationBootstrapApi } from "@/api/foundationBootstrap";
import { createCognitiveMemoryApi } from "@/api/cognitiveMemory";
import { createDerivedMemoryApi } from "@/api/derivedMemory";
import { createLearningApi } from "@/api/learning";
import { createWorkSignalsApi } from "@/api/work-signals";
import { createOrchestrationApi } from "@/api/orchestration";
import { createAgentsApi } from "@/api/agents";
import { createMemoryApi } from "@/api/memory";
import { createFoundationApi } from "@/api/foundation";
import { createIssuesApi } from "@/api/issues";
import { createWorkflowsApi } from "@/api/workflows";
import { createInstanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { useCompany } from "./CompanyContext";

function createScope(principalId: BoardPrincipal) {
  const client = createAccountClient(principalId);
  return {
    principalId,
    foundationBootstrapApi: createFoundationBootstrapApi(client),
    cognitiveMemoryApi: createCognitiveMemoryApi(client),
    derivedMemoryApi: createDerivedMemoryApi(client),
    learningApi: createLearningApi(client),
    workSignalsApi: createWorkSignalsApi(client),
    orchestrationApi: createOrchestrationApi(client),
    agentsApi: createAgentsApi(client),
    memoryApi: createMemoryApi(client),
    foundationApi: createFoundationApi(client),
    issuesApi: createIssuesApi(client),
    workflowsApi: createWorkflowsApi(client),
    instanceSettingsApi: createInstanceSettingsApi(client),
  };
}

const AccountScope = createContext<ReturnType<typeof createScope> | null>(null);

export function useV7AccountScope() {
  const scope = useContext(AccountScope);
  if (!scope) throw new Error("This page requires a resolved account scope");
  return scope;
}

/** Remount all forms and mutation observers when the account or company changes. */
export function withV7AccountScope(Page: ComponentType) {
  return function AccountScopedPage() {
    const identity = useAccountIdentity();
    const { selectedCompanyId } = useCompany();
    const resolvingSession = useIsFetching({ queryKey: queryKeys.auth.session, exact: true }) > 0;
    const health = useQuery({
      queryKey: queryKeys.health,
      queryFn: () => healthApi.get(),
      enabled: identity.settled && !identity.userId,
      retry: false,
    });
    const principalId: BoardPrincipal | null = !identity.settled || identity.failed ? null
      : identity.userId ? `user:${identity.userId}`
      : health.isSuccess && health.data.deploymentMode === "local_trusted" ? "local-board" : null;
    const scope = useMemo(() => principalId ? createScope(principalId) : null, [principalId]);
    if (identity.failed || (!identity.userId && health.isError)) {
      return <p role="alert">Unable to verify your account. Reload this page to try again.</p>;
    }
    if (identity.settled && !identity.userId && health.isSuccess && health.data.deploymentMode !== "local_trusted") {
      return <p role="alert">Sign in to continue.</p>;
    }
    if (!scope) return <p role="status">Verifying your account…</p>;
    return <>
      {resolvingSession ? <p role="status">Verifying your account…</p> : null}
      <AccountScope.Provider key={JSON.stringify([principalId, selectedCompanyId])} value={scope}>
        <Activity mode={resolvingSession ? "hidden" : "visible"}><Page /></Activity>
      </AccountScope.Provider>
    </>;
  };
}
