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
import { WorkflowBuilder } from "./WorkflowBuilder";
import { WorkflowLifecycleControls } from "../components/WorkflowLifecycleControls";
import { queryKeys } from "../lib/queryKeys";

export function WorkflowEntry() {
  const client = useQueryClient();
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  const { selectedCompanyId } = useCompany();
  const identity = useAccountIdentity();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const { workflowId } = useParams();
  const { t } = useTranslation("experience");
  if (feature.query.isPending) return <p role="status">{t("loading")}</p>;
  if (!feature.enabled) return <WorkflowBuilder />;
  if (identity.failed)
    return (
      <div role="alert" className="space-y-4">
        <p>{t("workflowLoadFailed")}</p>
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
  if (!identity.settled || !principal || !workflowId)
    return <p role="status">{t("loading")}</p>;
  return (
    <WorkflowReview
      key={`${selectedCompanyId}:${principal}:${workflowId}`}
      company={selectedCompanyId}
      principal={principal}
      id={workflowId}
    />
  );
}

export function WorkflowReview({
  company,
  principal,
  id,
}: {
  company: string;
  principal: string;
  id: string;
}) {
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const [selected, setSelected] = useState<"active" | "draft">("active");
  const heading = useRef<HTMLHeadingElement>(null);
  const error = useRef<HTMLDivElement>(null);
  const prefix = ["workflow-experience", company, principal, id];
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: ({ signal }) =>
      workflowsApi.experience(company, principal, id, signal),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (
      event.companyId !== company ||
      (event.type !== "activity.logged" &&
        event.type !== "analytical.context.access_lost")
    )
      return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type === "activity.logged" &&
      !/workflow|permission|membership|privacy|erased|deleted|withdraw/i.test(
        action,
      ) &&
      event.payload.entityType !== "company_membership"
    )
      return;
    // A new observer identity immediately hides retained data and rejects late old responses.
    setEpoch((value) => value + 1);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  useEffect(() => {
    heading.current?.focus();
  }, [query.data?.id, selected]);
  useEffect(() => {
    if (query.isError) error.current?.focus();
  }, [query.isError]);
  const controls = (
    <WorkflowLifecycleControls
      key="lifecycle"
      company={company}
      principal={principal}
      id={id}
      detail={
        !query.isPending && !query.isFetching && !query.isError
          ? query.data
          : null
      }
      refresh={() => {
        void query.refetch();
      }}
    />
  );
  if (query.isError)
    return (
      <>
        <div ref={error} role="alert" tabIndex={-1} className="space-y-4">
          <p>{t("workflowLoadFailed")}</p>
          <Button className="min-h-11" onClick={() => void query.refetch()}>
            {t("tryAgain")}
          </Button>
        </div>
        {controls}
      </>
    );
  if (query.isPending || query.isFetching)
    return (
      <>
        <p role="status">{t("loading")}</p>
        {controls}
      </>
    );
  const detail = query.data;
  const current =
    selected === "draft" || !detail.active ? detail.draft : detail.active;
  return (
    <>
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/workflows"
        >
          {t("workflowBack")}
        </Link>
        <h1
          ref={heading}
          tabIndex={-1}
          className="break-words text-2xl font-semibold"
        >
          {detail.name}
        </h1>
        {detail.description && (
          <p className="break-words">{detail.description}</p>
        )}
        <p>{t(`workflowStatus.${detail.status}`)}</p>
        {detail.active && detail.draft && (
          <nav
            aria-label={t("workflowVersions")}
            className="flex flex-wrap gap-3"
          >
            <Button
              className="min-h-11"
              variant={selected === "active" ? "default" : "outline"}
              aria-pressed={selected === "active"}
              onClick={() => setSelected("active")}
            >
              {t("workflowActiveVersion", { version: detail.active.version })}
            </Button>
            <Button
              className="min-h-11"
              variant={selected === "draft" ? "default" : "outline"}
              aria-pressed={selected === "draft"}
              onClick={() => setSelected("draft")}
            >
              {t("workflowDraftVersion", { version: detail.draft.version })}
            </Button>
          </nav>
        )}
        {current ? (
          <section aria-labelledby="workflow-flow" className="space-y-4">
            <h2 id="workflow-flow" className="text-lg font-medium">
              {t(
                current.state === "draft"
                  ? "workflowDraftVersion"
                  : "workflowActiveVersion",
                { version: current.version },
              )}
            </h2>
            {current.state === "draft" && <p>{t("workflowDraftSeparate")}</p>}
            {current.state === "draft" &&
              detail.active &&
              detail.comparison && (
                <section
                  aria-labelledby="workflow-changes"
                  className="space-y-3 rounded-lg border border-border p-4"
                >
                  <h3 id="workflow-changes" className="font-medium">
                    {t("workflowComparisonTitle", {
                      version: detail.active.version,
                    })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("workflowComparisonBoundary")}
                  </p>
                  {detail.comparison.state === "unavailable" ? (
                    <p role="status">{t("workflowComparisonUnavailable")}</p>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {detail.comparison.steps.map((step) => (
                          <li key={step.number}>
                            <a
                              className="inline-flex min-h-11 items-center underline"
                              href={`#workflow-step-${step.number}`}
                            >
                              {t(
                                step.change === "added"
                                  ? "workflowStepAdded"
                                  : "workflowStepChanged",
                                { number: step.number },
                              )}
                            </a>
                          </li>
                        ))}
                        {detail.comparison.removedSteps > 0 && (
                          <li>
                            {t("workflowStepsRemoved", {
                              count: detail.comparison.removedSteps,
                            })}
                          </li>
                        )}
                        {detail.comparison.connectionsChanged && (
                          <li>{t("workflowConnectionsChanged")}</li>
                        )}
                        {detail.comparison.dataDefinitionChanged && (
                          <li>{t("workflowDataDefinitionChanged")}</li>
                        )}
                        {detail.comparison.settingsChanged && (
                          <li>{t("workflowSettingsChanged")}</li>
                        )}
                      </ul>
                      {detail.comparison.steps.length === 0 &&
                        detail.comparison.removedSteps === 0 &&
                        !detail.comparison.connectionsChanged &&
                        !detail.comparison.dataDefinitionChanged &&
                        !detail.comparison.settingsChanged && (
                          <p>{t("workflowComparedUnchanged")}</p>
                        )}
                    </>
                  )}
                </section>
              )}
            {current.coverage === "flow_unavailable" ? (
              <p role="status">{t("workflowFlowUnavailable")}</p>
            ) : current.steps.length === 0 ? (
              <p>{t("workflowEmptyDraft")}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("workflowFlowNumbers")}
                </p>
                <ol className="space-y-4">
                  {current.steps.map((step) => (
                    <li
                      key={step.number}
                      id={`workflow-step-${step.number}`}
                      tabIndex={-1}
                      className="space-y-3 rounded-lg border border-border p-4"
                    >
                      <h3 className="break-words font-medium">
                        {t("workflowStep", {
                          number: step.number,
                          name: step.name,
                        })}
                      </h3>
                      <dl className="space-y-2 text-sm">
                        <div>
                          <dt className="font-medium">
                            {t("workflowOperation")}
                          </dt>
                          <dd>{step.operation}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">{t("workflowEffect")}</dt>
                          <dd>{t(`workflowEffects.${step.effect}`)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">
                            {t("workflowApproval")}
                          </dt>
                          <dd>
                            {t(
                              step.approval === "checkpoint"
                                ? "workflowCheckpoint"
                                : "workflowApprovalUnverified",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium">{t("workflowRetry")}</dt>
                          <dd>{t(`workflowRetries.${step.retry}`)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">
                            {t("workflowTestMode")}
                          </dt>
                          <dd>{t(`workflowTestModes.${step.testMode}`)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">{t("workflowNext")}</dt>
                          <dd>
                            {step.next.length === 0 ? (
                              t("workflowEnd")
                            ) : (
                              <ul className="space-y-1">
                                {step.next.map((next, index) => (
                                  <li key={index} className="break-words">
                                    {t("workflowNextStep", {
                                      number: next.number,
                                    })}
                                    {next.output
                                      ? ` — ${t("workflowOutput", { output: next.output })}`
                                      : ""}
                                    {next.label
                                      ? ` — ${t("workflowBranchLabel", { label: next.label })}`
                                      : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        ) : (
          <p role="status">{t("workflowNoRevision")}</p>
        )}
        <section
          aria-labelledby="workflow-review-boundary"
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <h2 id="workflow-review-boundary" className="text-lg font-medium">
            {t("workflowReviewBoundary")}
          </h2>
          <p>{t("workflowReviewLimits")}</p>
          <p>{t("workflowTestLimits")}</p>
        </section>
        <nav aria-label={t("workflowActions")} className="flex flex-wrap gap-4">
          {detail.canEdit && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              to={`/workflows/${id}/advanced`}
            >
              {t("workflowEditDraft")}
            </Link>
          )}
          {detail.active && (
            <Link
              className="inline-flex min-h-11 items-center underline"
              to={`/workflows/${id}/runs`}
            >
              {t("workflowRunHistory")}
            </Link>
          )}
        </nav>
      </div>
      {controls}
    </>
  );
}
