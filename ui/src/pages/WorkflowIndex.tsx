import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/i18n";
import { workflowAuthoringExperienceApi } from "../api/workflow-authoring-experience";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9CurrentAccount, hasCurrentV9Session } from "../hooks/useV9CurrentAccount";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { queryKeys } from "../lib/queryKeys";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
import { Workflows } from "./Workflows";

export function WorkflowsEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9"), identity = useV9CurrentAccount();
  const { selectedCompanyId } = useCompany(), { t } = useTranslation("experience");
  if (feature.query.isPending) return <p role="status">{t("loading")}</p>;
  if (feature.query.isError) return <p role="alert">{t("workflowLoadFailed")}</p>;
  if (feature.query.isFetching) return <p role="status">{t("loading")}</p>;
  if (!feature.enabled) return <Workflows />;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (!identity.userId || identity.localImplicit) return <p role="status">{t("workflowIntent.accountRequired")}</p>;
  return <WorkflowIndex key={`${selectedCompanyId}:${identity.userId}`} company={selectedCompanyId} principal={identity.userId} />;
}
export function WorkflowIndex({ company, principal }: { company: string; principal: string }) {
  const { t } = useTranslation("experience"), client = useQueryClient(), identity = useV9CurrentAccount();
  const { selectedCompanyId } = useCompany(), feature = useV9FeatureEnabled("progressive_shell_v9");
  const [epoch, setEpoch] = useState(0), error = useRef<HTMLDivElement>(null);
  const ready = selectedCompanyId === company && identity.settled && !identity.localImplicit && identity.userId === principal &&
    feature.query.isSuccess && !feature.query.isFetching && feature.enabled;
  const prefix = ["workflow-experience-index", company, principal];
  const query = useQuery({
    queryKey: [...prefix, identity.authorityEpoch, epoch], enabled: ready,
    queryFn: async ({ signal }) => {
      if (!hasCurrentV9Session(client, principal, identity.sessionId)) throw new Error("Current account is unavailable");
      return workflowAuthoringExperienceApi.index(company, principal, signal);
    },
    retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent(event => {
    if (event.companyId !== company || event.type !== "analytical.context.access_lost" &&
      !(event.type === "activity.logged" && /workflow|permission|membership|privacy|erased|deleted|withdraw/.test(String(event.payload.action)))) return;
    setEpoch(value => value + 1);
    void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix });
  });
  const failed = identity.failed || query.isError || feature.query.isError;
  const loading = !ready || query.isPending || query.isFetching;
  const heading = useExperienceHeading(`${company}:${principal}`, loading, failed);
  if (failed) return <div ref={error} role="alert" tabIndex={-1} className="space-y-3">
    <p>{t("workflowLoadFailed")}</p><Button className="min-h-11" onClick={() => {
      void client.refetchQueries({ queryKey: queryKeys.auth.session });
      void client.refetchQueries({ queryKey: queryKeys.instance.experimentalSettings });
      if (ready) void query.refetch();
    }}>{t("tryAgain")}</Button>
  </div>;
  if (loading || !query.data) return <p role="status">{t("loading")}</p>;
  return <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("workflowIntent.indexHeading")}</h1>
    <p>{t("workflowIntent.indexPurpose")}</p>
    {query.data.canCreateDraft && <Link className="inline-flex min-h-11 items-center underline" to="/workflows/new">{t("workflowIntent.heading")}</Link>}
    <ul className="divide-y divide-border">
      {query.data.workflows.map(workflow => <li key={workflow.id} className="space-y-2 py-4">
        <Link className="inline-flex min-h-11 items-center break-words font-medium underline" to={`/workflows/${workflow.id}`}>{workflow.name}</Link>
        <p>{t(`workflowStatus.${workflow.status}`)}</p>
        {workflow.description && <p className="break-words text-sm text-muted-foreground">{workflow.description}</p>}
      </li>)}
    </ul>
    {!query.data.workflows.length && <p>{t("workflowIntent.empty")}</p>}
    <p className="text-sm text-muted-foreground">{t("workflowIntent.bounded")}</p>
  </div>;
}
