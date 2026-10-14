import { WorkflowPublicationControls } from "../components/WorkflowPublicationControls";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { workflowsApi } from "../api/workflows";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { WorkflowRequestRecoveryLinks, usePendingWorkflowRequests } from "../components/WorkflowRequestRecoveryLinks";
import { WorkflowBuilderExperimentalGate } from "../components/WorkflowBuilderExperimentalGate";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Button } from "../components/ui/button";
import { Link, useParams, useLocation } from "../lib/router";
import { WorkflowBuilder } from "./WorkflowBuilder";
import { WorkflowLifecycleControls } from "../components/WorkflowLifecycleControls";
import { WorkflowOperations } from "../components/WorkflowOperations";
import { WorkflowRunControls } from "../components/WorkflowRunControls";
import { WorkflowTestControls } from "../components/WorkflowTestControls";
import { queryKeys } from "../lib/queryKeys";

export function WorkflowEntry() {
  const client = useQueryClient();
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  const { selectedCompanyId } = useCompany();
  const identity = useV9CurrentAccount();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const { workflowId } = useParams();
  const { t } = useTranslation("experience");
  if (feature.query.isPending) return <p role="status">{t("loading")}</p>;
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
  return <WorkflowDetailEntrySurface key={`${selectedCompanyId}:${principal}:${workflowId}`} company={selectedCompanyId} principal={principal} id={workflowId}
    progressive={feature.enabled} newWorkEnabled={!!feature.query.data?.enableWorkflowsV1 && !!feature.query.data?.enableWorkflowBuilderV1} />;
}

function WorkflowDetailEntrySurface({ company, principal, id, progressive, newWorkEnabled }: {
  company: string; principal: string; id: string; progressive: boolean; newWorkEnabled: boolean;
}) {
  const pending = usePendingWorkflowRequests(company, principal, id), { t } = useTranslation("experience");
  if (!pending.ready) return <p role="status">{t("loading")}</p>;
  const savedRequests = <WorkflowRequestRecoveryLinks company={company} principal={principal} workflow={id} />;
  // The Original gate redirects when rollout is closed. An unresolved request
  // must retain its read-only recovery entry rather than navigate away from it.
  if (pending.failed || (pending.rows.length && (!progressive || !newWorkEnabled))) return savedRequests;
  if (!progressive) return <>{savedRequests}<WorkflowBuilderExperimentalGate><WorkflowBuilder /></WorkflowBuilderExperimentalGate></>;
  return (
    <>{savedRequests}
    <WorkflowBuilderExperimentalGate><WorkflowReview
      key={`${company}:${principal}:${id}`}
      company={company}
      principal={principal}
      id={id}
    /></WorkflowBuilderExperimentalGate>
    </>
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
  const { selectedCompanyId } = useCompany();
  const authority = useV9PrivateReadAuthority(principal, true);
  const [epoch, setEpoch] = useState(0);
  const source = useRef(0);
  const location = useLocation(), requestedRevision = new URLSearchParams(location.search).get("revision");
  const [selected, setSelected] = useState<"active" | "draft">(requestedRevision === "draft" ? "draft" : "active");
  useEffect(() => { if (requestedRevision === "draft" || requestedRevision === "active") setSelected(requestedRevision); }, [requestedRevision]);
  const error = useRef<HTMLDivElement>(null);
  const prefix = ["workflow-experience", company, principal, id];
  const key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, id, selectedCompanyId, authority });
  scope.current = { company, principal, id, selectedCompanyId, authority };
  const canReadCurrent = () => scope.current.company === company && scope.current.principal === principal && scope.current.id === id &&
    scope.current.selectedCompanyId === company && scope.current.authority.canRead() && source.current === epoch;
  const query = useQuery({
    queryKey: key,
    enabled: authority.readReady && selectedCompanyId === company,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!canReadCurrent()) throw new Error("Current workflow access needs review");
      const value = await workflowsApi.experience(company, principal, id, signal);
      if (!canReadCurrent()) throw new Error("Current workflow access changed");
      return value;
    }),
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
      !/workflow|agent|connection|tool|permission|membership|privacy|erased|deleted|withdraw/i.test(
        action,
      ) &&
      event.payload.entityType !== "company_membership"
    )
      return;
    // A new observer identity immediately hides retained data and rejects late old responses.
    source.current++;
    setEpoch(source.current);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  const state = client.getQueryState(key);
  const fresh = canReadCurrent() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const heading = useExperienceHeading(`${company}:${principal}:${id}:${selected}`, !fresh, query.isError);
  useEffect(() => {
    if (canReadCurrent() && query.isError && !document.activeElement?.closest('[role="dialog"],button,a[href],input,select,textarea,summary,[contenteditable="true"],[role="button"]')) error.current?.focus();
  }, [query.isError]);
  if (!canReadCurrent()) return <p role="status">{t("loading")}</p>;
  const controls = (
    <>
    <WorkflowPublicationControls key="publication" company={company} principal={principal} id={id}
      detail={fresh ? query.data : null}
      refresh={() => void query.refetch()} />
    <WorkflowTestControls key="test" company={company} principal={principal} id={id}
      detail={fresh ? query.data : null}
      refresh={() => void query.refetch()} />
    <WorkflowRunControls key="launch" company={company} principal={principal} id={id}
      detail={fresh ? query.data : null}
      refresh={() => void query.refetch()} />
    <WorkflowLifecycleControls
      key="lifecycle"
      company={company}
      principal={principal}
      id={id}
      detail={
        fresh
          ? query.data
          : null
      }
      refresh={() => {
        void query.refetch();
      }}
    />
    </>
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
  if (!fresh)
    return (
      <>
        <p role="status">{t("loading")}</p>
        {controls}
      </>
    );
  const detail = query.data!;
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
        <WorkflowOperations
          company={company}
          principal={principal}
          detail={detail}
          refresh={() => void query.refetch()}
        />
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
            {current.state === "draft" && detail.canEdit && <Link className="inline-flex min-h-11 items-center underline" to={`/workflows/${id}/draft`}>{t("workflowDraftFlow.open")}</Link>}
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
                          <dd>{step.toolAccess?.operationName ?? step.operation}</dd>
                        </div>
                        {step.semantics && <>
                          <div>
                            <dt className="font-medium">{t("workflowSemantics.actor")}</dt>
                            <dd>{step.toolAccess?.connectionName ?? (step.assignment?.state === "current" ? step.assignment.name
                              : step.assignment ? t("workflowSemantics.assignmentUnavailable")
                              : t(`workflowSemantics.actors.${step.semantics.actor}`))}</dd>
                          </div>
                          <div>
                            <dt className="font-medium">{t("workflowSemantics.input")}</dt>
                            <dd>{t(`workflowSemantics.inputs.${step.semantics.input}`)}
                              {step.semantics.durationSeconds !== null && ` ${t("workflowSemantics.delaySeconds", { count: step.semantics.durationSeconds })}`}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium">{t("workflowSemantics.access")}</dt>
                            <dd>{t(`workflowSemantics.accessStates.${step.semantics.access}`)}</dd>
                          </div>
                          <div>
                            <dt className="font-medium">{t("workflowSemantics.policy")}</dt>
                            <dd>{t(`workflowSemantics.policies.${step.semantics.approvalPolicy}`)}</dd>
                          </div>
                        </>}
                        {step.toolAccess && <div>
                          <dt className="font-medium">{t("workflowConnectionAccess.label")}</dt>
                          <dd>
                            <p>{t(`workflowConnectionAccess.states.${step.toolAccess.state}`)}</p>
                            {step.toolAccess.previewHref && <Link className="inline-flex min-h-11 items-center underline"
                              to={step.toolAccess.previewHref}>{t("workflowConnectionAccess.review", { name: step.toolAccess.connectionName })}</Link>}
                          </dd>
                        </div>}
                        {step.inputReview?.kind === "condition" && <div>
                          <dt className="font-medium">{t("workflowDraftStep.condition.heading")}</dt>
                          <dd className="space-y-2">
                            <p>{t(`workflowDraftStep.condition.sources.${step.inputReview.source}`)}</p>
                            <ol className="space-y-1" aria-label={t("workflowDraftStep.condition.path")}>
                              {step.inputReview.path.map((field, index) => <li key={index} className="break-words"><code>{JSON.stringify(field)}</code></li>)}
                            </ol>
                            <p>{t(`workflowDraftStep.condition.operators.${step.inputReview.operator}`)}</p>
                            <p className="break-words">{t(`workflowDraftStep.condition.types.${step.inputReview.value === null ? "null" : typeof step.inputReview.value}`)}: <code>{JSON.stringify(step.inputReview.value)}</code></p>
                          </dd>
                        </div>}
                        {step.inputReview?.kind === "approval" && <>
                          <div>
                            <dt className="font-medium">{t("workflowDraftStep.summary")}</dt>
                            <dd className="whitespace-pre-wrap break-words">{step.inputReview.summary}</dd>
                          </div>
                          <div>
                            <dt className="font-medium">{t("workflowDraftStep.consequence")}</dt>
                            <dd className="whitespace-pre-wrap break-words">{step.inputReview.consequence}</dd>
                          </div>
                        </>}
                        {step.inputReview?.kind === "advanced" && <div>
                          <dt className="font-medium">{t("workflowSemantics.input")}</dt>
                          <dd>{t("workflowSemantics.inputs.advanced")}</dd>
                        </div>}
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
                          {step.semantics && <dd>
                            {step.semantics.maxAttempts !== null && <p>{t("workflowSemantics.maxAttempts", { count: step.semantics.maxAttempts })}</p>}
                            <p>{t(`workflowSemantics.idempotency.${step.semantics.idempotency}`)}</p>
                          </dd>}
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
                      {current.state === "draft" && detail.canEdit && step.nodeId && <Link
                        className="inline-flex min-h-11 items-center underline"
                        to={`/workflows/${id}/draft/steps/${encodeURIComponent(step.nodeId)}`}>{t("workflowDraftStep.open")}</Link>}
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
