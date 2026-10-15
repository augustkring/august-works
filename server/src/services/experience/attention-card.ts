import type { AttentionItem, ExperienceCard } from "@paperclipai/shared";

/** Customer copy derived from native pending state; never predicts business impact. */
export function attentionExperienceCard(
  item: AttentionItem,
  observedAt: string,
): ExperienceCard {
  const source = {
    domain: "attention" as const,
    companyId: item.companyId,
    resourceId: item.id,
    version: item.updatedAt,
    observedAt,
  };
  let kind: ExperienceCard["kind"] = "decision",
    consequence: string | null = null;
  switch (item.sourceKind) {
    case "approval":
      kind = "approval";
      consequence =
        "This approval remains pending until an authorized person decides.";
      break;
    case "decision":
      consequence =
        "This decision remains open until it is resolved, cancelled or expires.";
      break;
    case "issue_thread_interaction":
      kind = item.detail?.kind === "questions" ? "question" : "confirmation";
      consequence =
        "This request remains pending until it is resolved, cancelled or expires.";
      break;
    case "join_request":
      kind = "permission";
      consequence =
        "This join request remains pending; company membership has not been granted.";
      break;
    case "recovery_action":
    case "failed_run":
      kind = "recovery";
      consequence =
        item.sourceKind === "failed_run"
          ? "Automatic retries are exhausted. Review the failure before starting another attempt."
          : "This recovery action remains unresolved until its native owner confirms recovery or cancellation.";
      break;
    case "blocker_attention":
      kind = "recovery";
      consequence =
        item.detail?.kind === "blocker" &&
        typeof item.detail.blockedTaskCount === "number" &&
        item.detail.blockedTaskCount > 0
          ? `${item.detail.blockedTaskCount} linked tasks remain blocked.`
          : "The native work owner still reports a blocker. Review its current state before acting.";
      break;
    case "review":
      kind = "approval";
      consequence =
        "This work remains in review until its native review path is resolved.";
      break;
    case "budget_alert":
    case "agent_error_alert":
      kind = "warning";
      consequence =
        item.sourceKind === "budget_alert"
          ? "The budget incident remains open. Any current budget stop stays in force."
          : "The agent remains in error until its native status changes.";
      break;
    case "productivity_review":
      // Historical items do not establish a current action or consequence.
      kind = "status";
      break;
  }
  const evidence = [item.subject.status ?? "Current attention item"];
  if (item.decideBy) evidence.push(`Decision due: ${item.decideBy}`);
  if (item.expiresAt) evidence.push(`Expires: ${item.expiresAt}`);
  const audience = item.resolverAudience;
  const whyYou =
    audience?.effectiveResolverPolicy === "human_only"
      ? `${item.whyNow} A human response is required by the current resolver policy.`
      : item.whyNow;
  return {
    id: item.id,
    kind,
    title: item.subject.title ?? item.whyNow,
    whyYou,
    consequence,
    source,
    freshness: "fresh",
    evidence,
    actions: [
      {
        id: "open",
        label: "Review",
        labelKey: "review",
        operation: "open",
        href:
          item.sourceKind === "decision"
            ? `/needs-you?decisionId=${encodeURIComponent(item.subject.id)}`
            : `/needs-you?attentionId=${encodeURIComponent(item.id)}`,
        criticality:
          [
            "approval",
            "join_request",
            "budget_alert",
            "agent_error_alert",
            "failed_run",
            "recovery_action",
          ].includes(item.sourceKind) || item.severity === "critical"
            ? "C3"
            : "C2",
        source,
        requiresCurrentAuthorization: true,
      },
    ],
  };
}
