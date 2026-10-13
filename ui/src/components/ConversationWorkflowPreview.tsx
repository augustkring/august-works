import type { ConversationAuthoringView } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";

/** The existing workflow owner supplies the bounded declaration projection.
 * No test, effective access or approval result is inferred from its labels. */
export function ConversationWorkflowPreview({ proposal }: { proposal: ConversationAuthoringView["proposals"][number] }) {
  const { t } = useTranslation("experience"), flow = proposal.preview, comparison = proposal.comparison;
  return <details className="space-y-3">
    <summary className="flex min-h-11 cursor-pointer items-center font-medium">{t("conversationAuthoring.preview")}</summary>
    <p className="text-sm text-muted-foreground">{t("workflowReviewLimits")}</p>
    {!flow || flow.coverage !== "complete" ? <p>{t("workflowFlowUnavailable")}</p>
      : flow.steps.length === 0 ? <p>{t("workflowEmptyDraft")}</p>
      : <><p className="text-sm text-muted-foreground">{t("workflowFlowNumbers")}</p>
        <ol className="space-y-3">{flow.steps.map(step => <li key={step.number} className="space-y-2 break-words rounded-md border p-3">
          <h4 className="font-medium">{step.number}. {step.name}</h4>
          <p>{step.operation}</p>
          <p>{t("workflowEffect")}: {t(`workflowEffects.${step.effect}`)}</p>
          <p>{t(step.approval === "checkpoint" ? "workflowCheckpoint" : "workflowApprovalUnverified")}</p>
          <div><p>{t("workflowNext")}</p>{step.next.length ? <ul className="space-y-1">{step.next.map((next, index) => <li key={index}>
            {t("workflowNextStep", { number: next.number })}{next.output ? ` — ${t("workflowOutput", { output: next.output })}` : ""}{next.label ? ` — ${next.label}` : ""}
          </li>)}</ul> : <p>{t("workflowEnd")}</p>}</div>
        </li>)}</ol></>}
    {proposal.state === "changed" && <section className="space-y-2" aria-label={t("conversationAuthoring.comparison")}>
      <h4 className="font-medium">{t("conversationAuthoring.comparison")}</h4>
      <p className="text-sm text-muted-foreground">{t("workflowComparisonBoundary")}</p>
      {!comparison || comparison.state !== "available" ? <p>{t("workflowComparisonUnavailable")}</p>
        : <><p>{t("conversationAuthoring.changeCounts", { added: comparison.steps.filter(step => step.change === "added").length,
          changed: comparison.steps.filter(step => step.change === "changed").length, removed: comparison.removedSteps })}</p>
          {comparison.connectionsChanged && <p>{t("workflowConnectionsChanged")}</p>}
          {comparison.dataDefinitionChanged && <p>{t("workflowDataDefinitionChanged")}</p>}
          {comparison.settingsChanged && <p>{t("workflowSettingsChanged")}</p>}
        </>}
    </section>}
  </details>;
}
