import type { AgentDraftTestReview } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";

export function AgentSelectedKnowledge({ sources }: { sources: AgentDraftTestReview["selectedKnowledge"] }) {
  const { t } = useTranslation("experience");
  if (!sources?.length) return null;
  return <><dt>{t("customAgent.sources")}</dt><dd><ul className="max-h-40 overflow-y-auto" tabIndex={0}
    aria-label={t("customAgent.sources")}>{sources.map(source => <li key={source.foundationDocumentId}>
      {t("customAgent.selectedApprovedSource", { title: source.title, revision: source.revisionNumber, sensitivity: source.sensitivity })}
    </li>)}</ul><p>{t("customAgent.sourceBoundary")}</p></dd></>;
}
