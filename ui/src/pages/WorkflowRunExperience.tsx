import { useEffect, useRef, useState } from "react";
import { workflowSupportDiagnostic } from "@paperclipai/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workflowsApi } from "../api/workflows";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { workflowReadSourceChanged } from "../lib/workflow-source-invalidation";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "../components/ui/button";
import { WorkflowStopControls } from "../components/WorkflowStopControls";
import { WorkflowSupportDiagnostics } from "../components/WorkflowSupportDiagnostics";
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
  const identity = useV9CurrentAccount();
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
  const { selectedCompanyId } = useCompany();
  const authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0);
  const source = useRef(0);
  const error = useRef<HTMLDivElement>(null);
  const prefix = ["workflow-run-experience", company, principal, workflow, id];
  const key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, workflow, id, selectedCompanyId, authority });
  scope.current = { company, principal, workflow, id, selectedCompanyId, authority };
  const canReadCurrent = () => scope.current.company === company && scope.current.principal === principal && scope.current.workflow === workflow &&
    scope.current.id === id && scope.current.selectedCompanyId === company && scope.current.authority.canRead() && source.current === epoch;
  const query = useQuery({
    queryKey: key,
    enabled: authority.readReady && selectedCompanyId === company,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!canReadCurrent()) throw new Error("Current run history needs review");
      const value = await workflowsApi.runExperience(company, principal, workflow, id, signal);
      if (!canReadCurrent()) throw new Error("Current run history scope changed"); return value;
    }),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || !workflowReadSourceChanged(event)) return;
    source.current++; setEpoch(source.current);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  const state = client.getQueryState(key), fresh = canReadCurrent() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const heading = useExperienceHeading(`${company}:${principal}:${workflow}:${id}`, !fresh, query.isError);
  useEffect(() => {
    if (canReadCurrent() && query.isError && !document.activeElement?.closest('[role="dialog"],button,a[href],input,select,textarea,summary,[contenteditable="true"],[role="button"]')) error.current?.focus();
  }, [query.isError]);
  if (!canReadCurrent()) return <RunLoading />;
  const controls = (
    <WorkflowStopControls
      company={company}
      principal={principal}
      workflow={workflow}
      id={id}
      detail={
        fresh
          ? query.data
          : null
      }
      refresh={() => void query.refetch()}
    />
  );
  if (query.isError)
    return (
      <>
        <div ref={error} role="alert" tabIndex={-1} className="space-y-4">
          <p>{t("workflowRunLoadFailed")}</p>
          <Button className="min-h-11" onClick={() => void query.refetch()}>
            {t("tryAgain")}
          </Button>
        </div>
        {controls}
      </>
    );
  if (!fresh)
    return (
      <>
        <RunLoading />
        {controls}
      </>
    );
  const detail = query.data!;
  const supportReport = workflowSupportDiagnostic(detail, {
    companyId: company,
    workflowId: workflow,
    runId: id,
  });
  return (
    <>
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/workflows/${workflow}/runs`}
        >
          {t("workflowRunBack")}
        </Link>
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
          {t(
            detail.purpose === "test"
              ? "workflowTestRunTitle"
              : "workflowRunTitle",
          )}
        </h1>
        <p>
          {t("workflowRunRevision", {
            version: detail.revisionNumber,
            state: t(`workflowRunRevisionState.${detail.revisionState}`),
          })}
        </p>
        <p role="status">{t(`workflowRunStatus.${detail.status}`)}</p>
        {detail.canRequestStop && <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${workflow}/runs/${id}/control`}>{t("workflowRunControl.open")}</Link>}
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
                  {attempt.branchChoice.state === "selected" && (
                    <p className="break-words">
                      {t("workflowRunBranchSelected", {
                        name: attempt.branchChoice.nextStep,
                      })}
                    </p>
                  )}
                  {attempt.branchChoice.state === "not_recorded" && (
                    <p>{t("workflowRunBranchNotRecorded")}</p>
                  )}
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
        {supportReport && (
          <WorkflowSupportDiagnostics
            key={`${epoch}:${detail.updatedAt}`}
            report={supportReport}
          />
        )}
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/workflows/${workflow}/runs/${id}/advanced`}
        >
          {t("workflowRunAdvanced")}
        </Link>
      </div>
      {controls}
    </>
  );
}
