import { useTranslation } from "react-i18next";
import type { ActivationCommand, ActivationView } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { Link } from "../lib/router";

type Start = Omit<Extract<ActivationCommand, { operation: "start_first_task" }>, "requestId" | "expectedVersion">;
export function ActivationFirstTask({ value, canStart, canStop, pending, onStart, onContinue, onStop, onRefresh }: {
  value: ActivationView["firstTask"]; canStart: boolean; canStop: boolean; pending: boolean;
  onStart: (input: Start) => void; onContinue: () => void; onStop: (planVersion: number) => void; onRefresh: () => void;
}) {
  const { t } = useTranslation("experience");
  if (!value) return null;
  if (value.current) {
    const task = value.current;
    return <section aria-label={t("activation.firstTaskProgress")} className="space-y-3">
      <p role="status">{t(`activation.firstTaskStatus.${task.status}`)}</p>
      <Link to={`/issues/${task.issueId}`} className="inline-flex min-h-11 items-center underline">{t("activation.openFirstTask")}</Link>
      {task.status === "running" && !task.dispatched ? <>
        <p>{t("activation.firstTaskDispatchPending")}</p>
        <Button className="min-h-11" disabled={!canStart || pending} onClick={onContinue}>{t("activation.continueFirstTask")}</Button>
      </> : null}
      {task.status === "running" || task.status === "paused" ? <Button variant="outline" className="min-h-11" disabled={!canStop || pending} onClick={() => onStop(task.planVersion)}>{t("activation.stopFirstTask")}</Button> : null}
      <Button variant="outline" className="min-h-11" disabled={pending} onClick={onRefresh}>{t("activation.checkFirstTask")}</Button>
      <p>{t("activation.firstTaskReviewRequired")}</p>
    </section>;
  }
  if (!value.candidates.length) return null;
  return <section aria-label={t("activation.firstTaskReview")} className="space-y-3">
    <p>{t("activation.firstTaskScope")}</p>
    <p>{t("activation.firstTaskCompute")}</p>
    {value.candidates.map(task => <article key={`${task.planId}:${task.installationHash}`} className="space-y-3">
      <h2 className="text-lg font-semibold">{task.title}</h2>
      <Link to={`/issues/${task.issueId}`} className="inline-flex min-h-11 items-center underline">{t("activation.reviewFirstTask")}</Link>
      <Button className="min-h-11" disabled={!canStart || pending} onClick={() => onStart({ operation: "start_first_task", installationId: task.installationId,
        planId: task.planId, expectedPlanVersion: task.planVersion, expectedInstallationHash: task.installationHash, expectedMaximumModelCostMinor: task.maximumModelCostMinor })}>{t("activation.runFirstTask")}</Button>
    </article>)}
    {value.hasMore ? <p>{t("activation.moreFirstTasks")}</p> : null}
  </section>;
}
