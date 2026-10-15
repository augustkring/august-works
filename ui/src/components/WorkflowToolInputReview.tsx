import type { WorkflowStepInputReview } from "@paperclipai/shared";
import { useTranslation } from "react-i18next";

/** Current Source-bound review supplied by the Native read owner, never raw config. */
export function WorkflowToolInputReview({ review }: { review: Extract<WorkflowStepInputReview, { kind: "connected_tool" }> }) {
  const { t } = useTranslation("experience");
  return <div className="space-y-3">
    {review.fields.length === 0 && <p>{t("workflowToolInputReview.empty")}</p>}
    <dl className="space-y-3">{review.fields.map(field => {
      const included = Object.hasOwn(review.values, field.name), value = review.values[field.name];
      return <div key={field.name}><dt className="font-medium break-words">{field.label}</dt>
        <dd className="whitespace-pre-wrap break-words">{!included ? t("workflowToolInputReview.omitted")
          : typeof value === "boolean" ? t(value ? "workflowDraftStep.condition.true" : "workflowDraftStep.condition.false")
            : typeof value === "string" && value.length === 0 ? t("workflowToolInputReview.emptyText") : <code>{JSON.stringify(value)}</code>}</dd>
      </div>;
    })}</dl>
    <p className="text-sm text-muted-foreground">{t("workflowToolInputReview.boundary")}</p>
  </div>;
}
