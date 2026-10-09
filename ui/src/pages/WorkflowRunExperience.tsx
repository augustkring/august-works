import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workflowsApi } from "../api/workflows";
import { useAccountIdentity } from "../api/companies-query";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "../components/ui/button";
import { Link, useParams } from "../lib/router";
import { queryKeys } from "../lib/queryKeys";
import { WorkflowRun } from "./WorkflowRun";

export function WorkflowRunEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  if (feature.query.isPending) return <RunLoading />;
  return feature.enabled ? <CurrentRun /> : <WorkflowRun />;
}
function RunLoading() {
  const { t } = useTranslation("experience");
  return <p role="status">{t("loading")}</p>;
}
function CurrentRun() {
  const { selectedCompanyId } = useCompany();
  const identity = useAccountIdentity();
  const { workflowId, runId } = useParams();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  if (identity.failed)
    return (
      <div role="alert" className="space-y-4">
        <p>{t("workflowRunLoadFailed")}</p>
        <Button
          className="min-h-11"
          onClick={() =>
            void client.refetchQueries({ queryKey: queryKeys.auth.session })
          }
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (!identity.settled || !principal || !workflowId || !runId)
    return <RunLoading />;
  return (
    <WorkflowRunExperience
      key={`${selectedCompanyId}:${principal}:${workflowId}:${runId}`}
      company={selectedCompanyId}
      principal={principal}
      workflow={workflowId}
      id={runId}
    />
  );
}
export function WorkflowRunExperience({
  company,
  principal,
  workflow,
  id,
}: {
  company: string;
  principal: string;
  workflow: string;
  id: string;
}) {
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const error = useRef<HTMLDivElement>(null);
  const prefix = ["workflow-run-experience", company, principal, workflow, id];
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: ({ signal }) =>
      workflowsApi.runExperience(company, principal, workflow, id, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company) return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type !== "activity.logged" &&
      event.type !== "analytical.context.access_lost"
    )
      return;
    if (
      event.type === "activity.logged" &&
      !/workflow|permission|membership|privacy|erased|deleted|withdraw/i.test(
        action,
      ) &&
      event.payload.entityType !== "company_membership"
    )
      return;
    setEpoch((value) => value + 1);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  useEffect(() => {
    heading.current?.focus();
  }, [query.data?.id, query.isFetching]);
  useEffect(() => {
    if (query.isError) error.current?.focus();
  }, [query.isError]);
  if (query.isError)
    return (
      <div ref={error} role="alert" tabIndex={-1} className="space-y-4">
        <p>{t("workflowRunLoadFailed")}</p>
        <Button className="min-h-11" onClick={() => void query.refetch()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (query.isPending || query.isFetching) return <RunLoading />;
  const detail = query.data;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <Link
        className="inline-flex min-h-11 items-center underline"
        to={`/workflows/${workflow}/runs`}
      >
        {t("workflowRunBack")}
      </Link>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("workflowRunTitle")}
      </h1>
      <p>
        {t("workflowRunRevision", {
          version: detail.revisionNumber,
          state: t(`workflowRunRevisionState.${detail.revisionState}`),
        })}
      </p>
      <p role="status">{t(`workflowRunStatus.${detail.status}`)}</p>
      <p className="text-sm text-muted-foreground">
        {t("workflowRunBoundary")}
      </p>
      <Button
        className="min-h-11"
        variant="outline"
        onClick={() => void query.refetch()}
      >
        {t("workflowRunRefresh")}
      </Button>
      <section aria-labelledby="workflow-run-attempts" className="space-y-4">
        <h2 id="workflow-run-attempts" className="text-lg font-medium">
          {t("workflowRunAttempts")}
        </h2>
        {detail.trace.state === "unavailable" ? (
          <p role="status">{t("workflowRunUnavailable")}</p>
        ) : detail.trace.attempts.length === 0 ? (
          <p>{t("workflowRunEmpty")}</p>
        ) : (
          <ol className="space-y-4">
            {detail.trace.attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="space-y-2 rounded-lg border border-border p-4"
              >
                <h3 className="break-words font-medium">{attempt.name}</h3>
                <p className="break-words">{attempt.operation}</p>
                <p>
                  {t("workflowRunAttempt", { number: attempt.attempt })} ·{" "}
                  {t(`workflowAttemptStatus.${attempt.status}`)}
                </p>
                <p>{t(`workflowExecution.${attempt.execution}`)}</p>
                {attempt.approvalCheckpoint && (
                  <p>{t("workflowRunApprovalBoundary")}</p>
                )}
                {attempt.waitingFor.map((kind) => (
                  <p key={kind}>{t(`workflowWaiting.${kind}`)}</p>
                ))}
                {attempt.payloadUnavailable && (
                  <p>{t("workflowRunPayloadUnavailable")}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to={`/workflows/${workflow}/runs/${id}/advanced`}
      >
        {t("workflowRunAdvanced")}
      </Link>
    </div>
  );
}
