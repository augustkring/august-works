import { useTranslation } from "react-i18next";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link } from "../lib/router";
export function MaintenanceHistoryLink({
  installationId,
}: {
  installationId: string;
}) {
  const feature = useV9FeatureEnabled("maintenance_autopilot_v9"),
    { t } = useTranslation("experience");
  return feature.enabled ? (
    <Link
      className="inline-flex min-h-11 items-center underline"
      to={`/agents/packages/installations/${installationId}/maintenance`}
    >
      {t("maintenanceHistoryOpen")}
    </Link>
  ) : null;
}
