import { useTranslation } from "react-i18next";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link } from "../lib/router";
export function AgentMonitorLink({ agentId }: { agentId: string }) {
  const { t } = useTranslation("experience");
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  return feature.enabled ? (
    <Link
      className="inline-flex min-h-11 items-center underline"
      to={`/agents/${agentId}/monitor`}
    >
      {t("agentMonitorOpen")}
    </Link>
  ) : null;
}
