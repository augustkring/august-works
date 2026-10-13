import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { useV9FeatureEnabled } from "@/hooks/useV9FeatureEnabled";
import { useExperienceHeading } from "@/hooks/useExperienceHeading";
import { getOrchestrationExperience } from "@/api/orchestration-experience";
import { Link } from "@/lib/router";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
import { Orchestration } from "./Orchestration";

export function OrchestrationEntry() {
  const identity = useV9CurrentAccount(), { selectedCompanyId } = useCompany(), feature = useV9FeatureEnabled("progressive_shell_v9");
  const { t } = useTranslation("experience");
  if (!identity.settled || !feature.query.isSuccess || feature.query.isFetching) return <p role={feature.query.isError ? "alert" : "status"}>{t(feature.query.isError ? "orchestrationExperience.unavailable" : "loading")}</p>;
  if (!feature.enabled) return <Orchestration />;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.localImplicit || !identity.userId) return <p role="status">{t("workflowIntent.accountRequired")}</p>;
  return <OrchestrationExperience key={`${selectedCompanyId}:${identity.userId}`} company={selectedCompanyId} principal={identity.userId} />;
}

export function OrchestrationExperience({ company, principal }: { company: string; principal: string }) {
  const { t, i18n } = useTranslation("experience"), { selectedCompanyId } = useCompany(), authority = useV9PrivateReadAuthority(principal);
  const [params] = useSearchParams(), client = useQueryClient(), [epoch, setEpoch] = useState(0), source = useRef(0);
  const [opened, setOpened] = useState<string | null>(null);
  const prefix = ["v9-orchestration-experience", company, principal], key = [...prefix, authority.epoch, epoch];
  const scope = useRef({ company, principal, selectedCompanyId }); scope.current = { company, principal, selectedCompanyId };
  const current = () => authority.canRead() && scope.current.company === company && scope.current.principal === principal &&
    scope.current.selectedCompanyId === company && source.current === epoch;
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company, retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Current work status needs review");
      const value = await getOrchestrationExperience(company, principal, signal);
      if (!current()) throw new Error("Current work status scope changed");
      return value;
    }) });
  const refresh = () => {
    source.current++; setEpoch(source.current); setOpened(null);
    void client.cancelQueries({ queryKey: prefix }); void client.invalidateQueries({ queryKey: prefix, refetchType: "none" });
  };
  useCompanyLiveEvent(event => {
    if (event.companyId !== company) return;
    if (/orchestrat|supervision|verification|issue|agent|membership|permission|role|erased|deleted|withdraw/i.test(`${event.payload.entityType}:${event.payload.action}`) ||
      event.type === "analytical.context.access_lost") {
      refresh();
    }
  });
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  const heading = useExperienceHeading(`${company}:${principal}:orchestration`, !fresh, query.isError);
  if (!current()) return <p role="status">{t("loading")}</p>;
  if (fresh && params.get("view") === "advanced" && query.data.canInspect) return <Orchestration />;
  return <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("orchestrationExperience.heading")}</h1>
      <Button className="min-h-11" variant="outline" disabled={query.isFetching} onClick={refresh}>{t("orchestrationExperience.refresh")}</Button>
    </div>
    <p className="text-muted-foreground">{t("orchestrationExperience.boundary")}</p>
    {query.isError ? <div role="alert" className="space-y-3"><p>{t("orchestrationExperience.unavailable")}</p>
      <Button className="min-h-11" onClick={refresh}>{t("tryAgain")}</Button></div>
      : !fresh ? <p role="status">{t("loading")}</p>
      : <>
        <p className="text-sm text-muted-foreground">{t("orchestrationExperience.bounded")}</p>
        <p className="text-sm text-muted-foreground">{t("orchestrationExperience.checked", { time: new Date(query.data.observedAt).toLocaleString(i18n.resolvedLanguage ?? "en", { dateStyle: "short", timeStyle: "short" }) })}</p>
        {!query.data.rows.length ? <p role="status">{t("orchestrationExperience.empty")}</p> : <ul className="space-y-4">
          {query.data.rows.map(plan => <li key={plan.id} className="space-y-3 rounded-md border p-4">
            <h2 className="break-words text-lg font-semibold">{plan.taskTitle}{plan.taskTitleTruncated && "…"}</h2>
            <p>{t(`orchestrationExperience.status.${plan.status}`)}</p>
            <p className="break-words">{t("orchestrationExperience.owner")}: {plan.owner?.name ?? t("orchestrationExperience.ownerUnavailable")}</p>
            <p className="break-words">{t("orchestrationExperience.helpers")}: {plan.helpers.length ? plan.helpers.map(agent => agent.name).join(", ") : t("orchestrationExperience.noHelpers")}</p>
            {plan.assignmentsUnavailable && <p role="status">{t("orchestrationExperience.assignmentsUnavailable")}</p>}
            <Link className="inline-flex min-h-11 items-center underline" to={plan.taskHref}>{t("orchestrationExperience.openTask")}</Link>
            {plan.inspection && <div className="space-y-3">
              <Button className="min-h-11" variant="outline" aria-expanded={opened === plan.id} aria-controls={`inspect-${plan.id}`}
                onClick={() => setOpened(value => value === plan.id ? null : plan.id)}>{t("orchestrationExperience.inspect")}</Button>
              <section id={`inspect-${plan.id}`} hidden={opened !== plan.id} aria-label={t("orchestrationExperience.inspection")} className="space-y-3">
                <h3 className="font-semibold">{t(`orchestrationExperience.mode.${plan.inspection.mode}`)}</h3>
                <p>{t("orchestrationExperience.budget", { workers: plan.inspection.budgets.maxWorkers, parallel: plan.inspection.budgets.maxParallel,
                  depth: plan.inspection.budgets.maxDepth, seconds: plan.inspection.budgets.maxSeconds, retries: plan.inspection.budgets.maxRetries, tools: plan.inspection.budgets.maxToolActions })}</p>
                <p>{t(plan.inspection.budgets.modelCostCapConfigured ? "orchestrationExperience.costCap" : "orchestrationExperience.noCostCap")}</p>
                <ol className="space-y-3">{plan.inspection.workers.map(worker => <li key={worker.number} className="space-y-1 rounded-md border p-3">
                  <h4 className="font-semibold">{t("orchestrationExperience.worker", { number: worker.number })}</h4>
                  <p className="break-words">{worker.agent?.name ?? t("orchestrationExperience.ownerUnavailable")}</p>
                  <p>{t(`orchestrationExperience.workerStatus.${worker.status}`)}</p>
                  <p>{t(worker.dependsOn.length ? "orchestrationExperience.dependencies" : "orchestrationExperience.noDependencies", { numbers: worker.dependsOn.join(", ") })}</p>
                  <p>{t("orchestrationExperience.attempts", { count: worker.attemptsRecorded })}</p>
                  <Link className="inline-flex min-h-11 items-center underline" to={`/issues/${worker.taskId}`}>{t("orchestrationExperience.openTask")}</Link>
                </li>)}</ol>
                <p>{t("orchestrationExperience.controlBoundary")}</p>
                <Link className="inline-flex min-h-11 items-center underline" to={plan.inspection.safetyHref}>{t("orchestrationControl.heading")}</Link>
                <Link className="inline-flex min-h-11 items-center underline" to={plan.inspection.controlHref}>{t("orchestrationExperience.controls")}</Link>
              </section>
            </div>}
          </li>)}</ul>}
        {query.data.hasMore && <p role="status">{t("orchestrationExperience.more")}</p>}
      </>}
  </div>;
}
