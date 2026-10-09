import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  v9FeatureEnabled,
  type HireAgentCapability,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { queryKeys } from "@/lib/queryKeys";
import { Link, useParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/api/client";
import { useNavigate } from "@/lib/router";
import { HireAgentSetup } from "./HireAgentSetup";
import { HireSavedSetups } from "./HireSavedSetups";

const actionNames: Record<
  HireAgentCapability["actionClasses"][number],
  string
> = {
  internal_draft: "Create internal drafts",
  external_communication: "Send externally",
  data_mutation: "Change company data",
  financial_commitment: "Make financial commitments",
  person_decision: "Make decisions affecting people",
  destructive_action: "Delete or replace data",
  restricted_processing: "Process restricted information",
};

function HireCatalog({
  company,
  principal,
}: {
  company: string;
  principal: string;
}) {
  const { versionId } = useParams<{ versionId?: string }>();
  const [search, setSearch] = useState("");
  const [checkingAccess, setCheckingAccess] = useState(false);
  const securityEpoch = useRef(0);
  const alive = useRef(true);
  const attempt = useRef<{
    requestId: string;
    agentId: null;
    packageVersionId: string;
  } | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const heading = useRef<HTMLHeadingElement>(null);
  const client = useQueryClient();
  const key = ["agent-authoring-hire-catalog", company, principal];
  const catalog = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      agentAuthoringApi.hireCatalog(company, principal, signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    heading.current?.focus();
  }, [versionId]);
  useCompanyLiveEvent((event) => {
    if (event.type !== "activity.logged" || event.companyId !== company) return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.payload.entityType === "company_membership" ||
      action.includes("permission") ||
      action.startsWith("resource_membership.") ||
      action.includes("erased") ||
      action.endsWith("deleted") ||
      action.startsWith("agent_package.")
    ) {
      setCheckingAccess(true);
      const epoch = ++securityEpoch.current;
      void client.resetQueries({ queryKey: key, exact: true }).then(() => {
        if (epoch === securityEpoch.current) setCheckingAccess(false);
      });
    }
  });
  const selected = checkingAccess
    ? undefined
    : catalog.data?.find((item) => item.versionId === versionId);
  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a current capability");
      attempt.current ??= {
        requestId: crypto.randomUUID(),
        agentId: null,
        packageVersionId: selected.versionId,
      };
      const epoch = securityEpoch.current;
      return {
        draft: await agentAuthoringApi.create(
          company,
          principal,
          attempt.current,
        ),
        epoch,
      };
    },
    onSuccess: ({ draft, epoch }) => {
      if (alive.current && epoch === securityEpoch.current)
        navigate(`/agents/hire/drafts/${draft.id}/${draft.step}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && [400, 422].includes(error.status))
        attempt.current = null;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        setCheckingAccess(true);
        const epoch = ++securityEpoch.current;
        void client.resetQueries({ queryKey: key, exact: true }).then(() => {
          if (alive.current && epoch === securityEpoch.current)
            setCheckingAccess(false);
        });
      }
    },
  });
  const term = search.trim().toLocaleLowerCase();
  const matches = catalog.data?.filter((item) =>
    `${item.name} ${item.category} ${item.outcome}`
      .toLocaleLowerCase()
      .includes(term),
  );
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        to={versionId ? "/agents/hire" : "/agents"}
        className="inline-flex min-h-11 items-center underline"
      >
        {versionId ? "Back to capabilities" : "Back to agents"}
      </Link>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {selected?.name ?? "Hire agent"}
      </h1>
      {(catalog.isPending || checkingAccess) && (
        <p role="status">Loading available capabilities…</p>
      )}
      {catalog.isError && (
        <div role="alert">
          <p>
            Available capabilities could not be loaded. Check your current
            company access and try again.
          </p>
          <Button className="min-h-11" onClick={() => void catalog.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {catalog.isSuccess && !checkingAccess && versionId && !selected && (
        <p role="status">
          This capability version is no longer available. Choose a currently
          available capability.
        </p>
      )}
      {catalog.isSuccess && !checkingAccess && !versionId && (
        <>
          <p>Choose the outcome you want an agent to help with.</p>
          <label className="block space-y-2">
            Find a capability
            <Input
              className="min-h-11"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {catalog.data.length === 0 && (
            <p role="status">
              No customer capabilities are available in this deployment yet.
            </p>
          )}
          {catalog.data.length > 0 && matches?.length === 0 && (
            <p role="status">No capabilities match your search.</p>
          )}
          <ul className="space-y-4">
            {matches?.map((item) => (
              <li
                key={item.versionId}
                className="space-y-2 rounded-lg border border-border p-4"
              >
                <h2 className="text-lg font-semibold">
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    to={`/agents/hire/capabilities/${item.versionId}`}
                  >
                    {item.name}
                  </Link>
                </h2>
                <p>{item.outcome}</p>
                {item.requiredConnections.length > 0 && (
                  <p>Needs: {item.requiredConnections.join(", ")}</p>
                )}
                <p>
                  {item.actionClasses.every(
                    (action) => action === "internal_draft",
                  )
                    ? "Internal drafts; company access must be checked."
                    : "Asks before actions that materially affect your company or others."}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {!versionId && (
        <HireSavedSetups company={company} principal={principal} />
      )}
      {selected && (
        <>
          <section className="space-y-2" aria-labelledby="capability-does">
            <h2 id="capability-does" className="text-lg font-semibold">
              Does
            </h2>
            <p>{selected.outcome}</p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-needs">
            <h2 id="capability-needs" className="text-lg font-semibold">
              Needs
            </h2>
            <p>
              Knowledge:{" "}
              {selected.requiredKnowledge.join(", ") ||
                "No required knowledge sources declared."}
            </p>
            <p>
              Connected apps:{" "}
              {selected.requiredConnections.join(", ") ||
                "No required connected apps declared."}
            </p>
            <p>Current company access will need to be checked before use.</p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-automatic">
            <h2 id="capability-automatic" className="text-lg font-semibold">
              Can do automatically
            </h2>
            <p>
              {selected.actionClasses.includes("internal_draft")
                ? "Create internal drafts when current company policy and access allow it."
                : "No automatic actions are declared for this capability."}
            </p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-approval">
            <h2 id="capability-approval" className="text-lg font-semibold">
              Asks before
            </h2>
            <p>
              Actions that materially affect your company or others always
              require human approval.
            </p>
            {selected.actionClasses.filter(
              (action) => action !== "internal_draft",
            ).length > 0 && (
              <ul>
                {selected.actionClasses
                  .filter((action) => action !== "internal_draft")
                  .map((action) => (
                    <li key={action}>{actionNames[action]}</li>
                  ))}
              </ul>
            )}
            <p>Agents cannot grant themselves permissions.</p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-limits">
            <h2 id="capability-limits" className="text-lg font-semibold">
              Important limits
            </h2>
            <ul>
              {selected.limits.map((limit, index) => (
                <li key={index}>{limit}</li>
              ))}
            </ul>
          </section>
          <p>
            A company owner has not been assigned. This capability is not active
            in your company.
          </p>
          <p>
            Using this capability starts a saved setup. It does not activate an
            agent or give it access.
          </p>
          {create.isError && (
            <p role="alert">
              {create.error instanceof ApiError &&
              [400, 422].includes(create.error.status)
                ? "This capability could not be used. Choose a currently available capability and try again."
                : create.error instanceof ApiError &&
                    [401, 403].includes(create.error.status)
                  ? "Your current access does not permit this setup."
                  : "The setup request was not acknowledged. Retry the same request to find its saved result."}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <Link
              className="inline-flex min-h-11 items-center underline"
              to="/agents"
            >
              Back to agents
            </Link>
            <Button
              className="min-h-11"
              disabled={
                create.isPending ||
                checkingAccess ||
                Boolean(
                  attempt.current &&
                    attempt.current.packageVersionId !== selected.versionId,
                )
              }
              onClick={() => create.mutate()}
            >
              {create.isPending
                ? "Preparing setup…"
                : create.isError && attempt.current
                  ? "Retry the same setup request"
                  : "Use this agent"}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

export function HireAgent() {
  const { selectedCompanyId: company } = useCompany();
  const identity = useAccountIdentity();
  const { draftId } = useParams<{ draftId?: string }>();
  const settings = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  if (settings.isPending || !identity.settled)
    return <p role="status">Loading agent hiring options…</p>;
  if (draftId && company && identity.userId && !identity.localImplicit)
    return (
      <HireAgentSetup
        key={`${company}:${identity.userId}:${draftId}`}
        company={company}
        principal={identity.userId}
        id={draftId}
        enabled={Boolean(
          settings.data && v9FeatureEnabled(settings.data, "hire_agent_v9"),
        )}
      />
    );
  if (settings.isError)
    return (
      <div role="alert">
        <p>Agent hiring options could not be loaded.</p>
        <Button className="min-h-11" onClick={() => void settings.refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!v9FeatureEnabled(settings.data, "hire_agent_v9"))
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        <p role="status">New agent hiring is unavailable.</p>
        {company && identity.userId && !identity.localImplicit && (
          <HireSavedSetups
            key={`${company}:${identity.userId}`}
            company={company}
            principal={identity.userId}
          />
        )}
      </main>
    );
  if (!company || !identity.userId || identity.localImplicit)
    return (
      <p role="status">
        Sign in with a verified account and select a company to hire an agent.
      </p>
    );
  return (
    <HireCatalog
      key={`${company}:${identity.userId}`}
      company={company}
      principal={identity.userId}
    />
  );
}
