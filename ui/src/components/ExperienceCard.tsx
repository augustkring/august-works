import type { ExperienceCard as CardModel } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { useTranslation } from "react-i18next";
/** Text and typed links only; models cannot supply HTML, handlers or arbitrary React. */
export function ExperienceCard({
  card,
  headingLevel = 3,
}: {
  card: CardModel;
  headingLevel?: 2 | 3;
}) {
  const { t } = useTranslation("experience");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const maintenance =
    card.source.domain === "agent_package_installation" &&
    card.kind === "maintenance";
  const unknownMaintenance =
    maintenance && card.evidence.includes("unknown_outcome");
  const coreMaintenance = card.source.domain === "readiness" && card.kind === "maintenance";
  const memoryMaintenance = card.source.domain === "memory_job" && card.kind === "maintenance";
  const runtimeRecovery = card.source.domain === "runtime_cell" && card.kind === "recovery";
  const connectorRecovery = card.source.domain === "connection" && card.kind === "recovery";
  const personalConnector = connectorRecovery && card.evidence.includes("connector_personal_access_review");
  const connectorAccess = connectorRecovery && (personalConnector || card.evidence.includes("connector_access_review"));
  const workflowRecovery = card.source.domain === "workflow" && card.kind === "recovery";
  const runtimeCapacity = runtimeRecovery && card.evidence.includes("runtime_capacity_review");
  const cardNamespace = coreMaintenance ? "coreMaintenance" : memoryMaintenance ? "memoryMaintenanceAttention" : connectorRecovery ? "connectorRecovery" : workflowRecovery ? "workflowRecovery" : runtimeRecovery ? "runtimeRecovery" : null;
  function evidenceText(item: string) {
    if (coreMaintenance) return t("coreMaintenance.evidence");
    if (memoryMaintenance) return t("memoryMaintenanceAttention.evidence");
    if (connectorRecovery) return t(connectorAccess ? "connectorRecovery.accessEvidence" : "connectorRecovery.evidence");
    if (workflowRecovery) return t(["workflow_live_run", "workflow_test_run", "workflow_failed", "workflow_recovering", "workflow_waiting"].includes(item) ? `workflowRecovery.${item}` : "workflowRecovery.evidence");
    if (runtimeRecovery) return t("runtimeRecovery.evidence");
    if (card.source.domain === "task") return t(`taskStatus.${item}`, { defaultValue: item });
    if (maintenance) return t("maintenanceAttentionEvidence");
    return item;
  }
  const title = cardNamespace
    ? t(runtimeCapacity ? "runtimeRecovery.capacityTitle" : `${cardNamespace}.title`)
    : maintenance
    ? t(
        unknownMaintenance
          ? "maintenanceUnknownTitle"
          : "maintenanceAttentionTitle",
      )
    : card.title;
  return (
    <article
      className="space-y-2 rounded-lg border border-border bg-card p-4"
      aria-label={title}
    >
      <Heading className="font-medium text-foreground">{title}</Heading>
      {card.whyYou && (
        <p className="text-sm text-foreground">
          {personalConnector ? t("connectorRecovery.personalWhy") : cardNamespace ? t(`${cardNamespace}.why`) : maintenance ? t("maintenanceAttentionWhy") : card.whyYou}
        </p>
      )}
      {card.consequence && (
        <p className="text-sm text-muted-foreground">
          {cardNamespace ? t(`${cardNamespace}.consequence`) : maintenance
            ? t(
                unknownMaintenance
                  ? "maintenanceUnknownConsequence"
                  : "maintenanceAttentionConsequence",
              )
            : card.consequence}
        </p>
      )}
      {card.evidence.length > 0 && (
        <ul className="text-sm text-muted-foreground">
          {card.evidence.map((item, i) => (
            <li key={i}>
              {evidenceText(item)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {card.actions
          .filter((action) => action.operation === "open")
          .map((action) => (
            <Link
              key={action.id}
              to={action.href}
              className="inline-flex min-h-11 items-center rounded-md font-medium text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-ring"
            >
              {action.labelKey
                ? t(`cardAction.${action.labelKey}`)
                : action.label}
            </Link>
          ))}
      </div>
      {card.freshness !== "fresh" && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("refreshRequired")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("checkedAt", {
          time: new Date(card.source.observedAt).toLocaleTimeString(),
        })}
      </p>
    </article>
  );
}
