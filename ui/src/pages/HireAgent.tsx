import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  v9FeatureEnabled,
  type HireAgentCapability,
} from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
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
  internal_draft: "hireCatalog.createDrafts",
  external_communication: "hireCatalog.sendExternally",
  data_mutation: "hireCatalog.changeData",
  financial_commitment: "hireCatalog.financial",
  person_decision: "hireCatalog.personDecision",
  destructive_action: "hireCatalog.deleteData",
  restricted_processing: "hireCatalog.restricted",
};

function HireCatalog({
  company,
  principal,
}: {
  company: string;
  principal: string;
}) {
  const { t } = useTranslation("experience");
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
  const authority = useV9AuthoringAuthority(company, principal);
  const key = ["agent-authoring-hire-catalog", company, principal, authority.epoch];
  const catalog = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      authority.read(() => agentAuthoringApi.hireCatalog(company, principal, signal)),
    enabled: authority.writeReady,
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
      if (!authority.canWrite() || client.getQueryState(key)?.fetchStatus === "fetching") throw new Error("Current hiring access is unresolved");
      if (!attempt.current) {
        if (!selected) throw new Error("Choose a current capability");
        attempt.current = {
          requestId: crypto.randomUUID(),
          agentId: null,
          packageVersionId: selected.versionId,
        };
      }
      const epoch = securityEpoch.current;
      const pending = attempt.current;
      const draft = await authority.write(() => agentAuthoringApi.create(company, principal, pending));
      if (epoch !== securityEpoch.current) throw new Error("Agent setup needs current confirmation");
      return {
        draft,
        epoch,
      };
    },
    onSuccess: ({ draft, epoch }) => {
      if (alive.current && epoch === securityEpoch.current && authority.confirmed(draft))
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
  if (!authority.readReady) return <p role={authority.failed ? "alert" : "status"}>{t("hireCatalog.checkingAccess")}</p>;
  if (!authority.writeReady) return (
    <div className="space-y-4 p-6">
      <p role="status">{t("hireCatalog.unavailable")}</p>
      {attempt.current && <p role="alert">{t("hireCatalog.previousUnconfirmed")}</p>}
      <HireSavedSetups company={company} principal={principal} authority={authority} />
    </div>
  );
  if (catalog.isFetching) return <p role="status">{t("hireCatalog.loadingCatalog")}</p>;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        to={versionId ? "/agents/hire" : "/agents"}
        className="inline-flex min-h-11 items-center underline"
      >
        {versionId ? t("hireCatalog.backCapabilities") : t("hireCatalog.backAgents")}
      </Link>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {selected?.name ?? t("hireCatalog.title")}
      </h1>
      {create.isError &&
        attempt.current &&
        (!selected ||
          selected.versionId !== attempt.current.packageVersionId) && (
          <div role="alert" className="space-y-2">
            <p>{t("hireCatalog.earlierUnconfirmed")}</p>
            <Button
              className="min-h-11"
              disabled={create.isPending || checkingAccess}
              onClick={() => create.mutate()}
            >{t("hireCatalog.retrySetup")}</Button>
          </div>
        )}
      {(catalog.isPending || checkingAccess) && (
        <p role="status">{t("hireCatalog.loadingCatalog")}</p>
      )}
      {catalog.isError && (
        <div role="alert">
          <p>{t("hireCatalog.catalogFailed")}</p>
          <Button className="min-h-11" onClick={() => void catalog.refetch()}>{t("hireCatalog.tryAgain")}</Button>
        </div>
      )}
      {catalog.isSuccess && !checkingAccess && versionId && !selected && (
        <p role="status">{t("hireCatalog.withdrawn")}</p>
      )}
      {catalog.isSuccess && !checkingAccess && !versionId && (
        <>
          <p>{t("hireCatalog.chooseOutcome")}</p>
          <label className="block space-y-2">{t("hireCatalog.findCapability")}<Input
              className="min-h-11"
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {catalog.data.length === 0 && (
            <p role="status">{t("hireCatalog.noCapabilities")}</p>
          )}
          {catalog.data.length > 0 && matches?.length === 0 && (
            <p role="status">{t("hireCatalog.noMatches")}</p>
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
                  <p>{t("hireCatalog.needsLabel")}{" "}{item.requiredConnections.join(", ")}</p>
                )}
                <p>
                  {item.actionClasses.every(
                    (action) => action === "internal_draft",
                  )
                    ? t("hireCatalog.draftsConditional")
                    : t("hireCatalog.asksMaterial")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {!versionId && (
        <HireSavedSetups company={company} principal={principal} authority={authority} />
      )}
      {selected && (
        <>
          <section className="space-y-2" aria-labelledby="capability-does">
            <h2 id="capability-does" className="text-lg font-semibold">{t("hireCatalog.does")}</h2>
            <p>{selected.outcome}</p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-needs">
            <h2 id="capability-needs" className="text-lg font-semibold">{t("hireCatalog.needs")}</h2>
            <p>{t("hireCatalog.knowledgeLabel")}{" "}{" "}
              {selected.requiredKnowledge.join(", ") ||
                t("hireCatalog.noKnowledge")}
            </p>
            <p>{t("hireCatalog.appsLabel")}{" "}{" "}
              {selected.requiredConnections.join(", ") ||
                t("hireCatalog.noApps")}
            </p>
            <p>{t("hireCatalog.checkAccess")}</p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-automatic">
            <h2 id="capability-automatic" className="text-lg font-semibold">{t("hireCatalog.automatic")}</h2>
            <p>
              {selected.actionClasses.includes("internal_draft")
                ? t("hireCatalog.automaticDrafts")
                : t("hireCatalog.noAutomatic")}
            </p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-approval">
            <h2 id="capability-approval" className="text-lg font-semibold">{t("hireCatalog.asksBefore")}</h2>
            <p>{t("hireCatalog.humanApproval")}</p>
            {selected.actionClasses.filter(
              (action) => action !== "internal_draft",
            ).length > 0 && (
              <ul>
                {selected.actionClasses
                  .filter((action) => action !== "internal_draft")
                  .map((action) => (
                    <li key={action}>{t(actionNames[action])}</li>
                  ))}
              </ul>
            )}
            <p>{t("hireCatalog.cannotGrant")}</p>
          </section>
          <section className="space-y-2" aria-labelledby="capability-limits">
            <h2 id="capability-limits" className="text-lg font-semibold">{t("hireCatalog.limits")}</h2>
            <ul>
              {selected.limits.map((limit, index) => (
                <li key={index}>{limit}</li>
              ))}
            </ul>
          </section>
          <p>{t("hireCatalog.notActive")}</p>
          <p>{t("hireCatalog.savedSetupOnly")}</p>
          {create.isError && (
            <p role="alert">
              {create.error instanceof ApiError &&
              [400, 422].includes(create.error.status)
                ? t("hireCatalog.useFailed")
                : create.error instanceof ApiError &&
                    [401, 403].includes(create.error.status)
                  ? t("hireCatalog.accessDenied")
                  : t("hireCatalog.unconfirmed")}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <Link
              className="inline-flex min-h-11 items-center underline"
              to="/agents"
            >{t("hireCatalog.backAgents")}</Link>
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
                ? t("hireCatalog.preparing")
                : create.isError && attempt.current
                  ? t("hireCatalog.retrySetup")
                  : t("hireCatalog.useAgent")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function HireAgent() {
  const { t } = useTranslation("experience");
  const { selectedCompanyId: company } = useCompany();
  const identity = useV9CurrentAccount();
  const { draftId } = useParams<{ draftId?: string }>();
  const settings = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  if (settings.isPending || (!identity.userId && !identity.settled))
    return <p role="status">{t("hireCatalog.loadingOptions")}</p>;
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
        <p>{t("hireCatalog.optionsFailed")}</p>
        <Button className="min-h-11" onClick={() => void settings.refetch()}>{t("hireCatalog.tryAgain")}</Button>
      </div>
    );
  if (!company || !identity.userId || identity.localImplicit)
    return (
      <p role="status">{t("hireCatalog.signIn")}</p>
    );
  return (
    <HireCatalog
      key={`${company}:${identity.userId}`}
      company={company}
      principal={identity.userId}
    />
  );
}
