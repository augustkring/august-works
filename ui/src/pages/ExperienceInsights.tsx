import { useTranslation } from "react-i18next";
import { v8FeatureEnabled, type V8FeatureKey } from "@paperclipai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
const destinations: { feature: V8FeatureKey; href: string; key: string }[] = [
  { feature: "business_metrics_v8", href: "/business-metrics", key: "metrics" },
  {
    feature: "process_intelligence_v8",
    href: "/process-intelligence",
    key: "process",
  },
  {
    feature: "business_forecasting_v8",
    href: "/business-forecasts",
    key: "forecasts",
  },
  {
    feature: "scenario_planning_v8",
    href: "/business-scenarios",
    key: "scenarios",
  },
  {
    feature: "management_reviews_v8",
    href: "/management-reviews",
    key: "reviews",
  },
];
export function ExperienceInsights() {
  const { t } = useTranslation("experience");
  const { selectedCompanyId } = useCompany();
  const { query, identity } = useExperience(selectedCompanyId);
  const flags = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (query.isError || flags.isError || identity.failed)
    return <p role="alert">{t("loadFailed")}</p>;
  if (query.isPending || flags.isPending)
    return <p role="status">{t("loading")}</p>;
  if (query.data.profile === "member")
    return <p role="alert">{t("insightsDenied")}</p>;
  const visible = destinations.filter((item) =>
    v8FeatureEnabled(flags.data, item.feature),
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("nav.insights")}</h1>
      {visible.length === 0 ? (
        <p>{t("noInsights")}</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((item) => (
            <li key={item.key}>
              <Link
                className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                to={item.href}
              >
                {t(`insights.${item.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
