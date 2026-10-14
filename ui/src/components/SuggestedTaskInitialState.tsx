import { useTranslation } from "react-i18next";
import type { SuggestedTaskDraft } from "@paperclipai/shared";
import { IssueStatusBadge } from "./StatusBadge";

export function SuggestedTaskInitialState({ task }: { task: Pick<SuggestedTaskDraft, "status" | "placement"> }) {
  const { t } = useTranslation("experience");
  if (!task.status) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <IssueStatusBadge status={task.status} />
      {task.placement === "company_backlog" && (
        <span className="text-xs text-muted-foreground">{t("customAgent.separateTaskPlacement")}</span>
      )}
    </div>
  );
}
