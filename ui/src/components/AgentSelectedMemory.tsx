import type { AgentDraftTestReview } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
export function AgentSelectedMemory({ sources }: { sources: AgentDraftTestReview["selectedMemory"] }) {
  const { t, i18n } = useTranslation("experience");
  if (!sources?.length) return null;
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "en", { dateStyle: "medium", timeStyle: "short" });
  return <><dt>{t("customAgent.approvedPreferences")}</dt><dd><ul className="max-h-40 overflow-y-auto" tabIndex={0}
    aria-label={t("customAgent.approvedPreferences")}>{sources.map(source => <li key={source.recordId}>
      {t("customAgent.preferenceSource", { title: source.title, sensitivity: source.sensitivity })}
      <p>{t("customAgent.preferenceExpires", { time: date.format(new Date(source.expiresAt)) })}</p>
    </li>)}</ul><p>{t("customAgent.memoryBoundary")}</p></dd></>;
}
