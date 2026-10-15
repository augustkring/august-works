import { useTranslation } from "react-i18next";
import { v8FeatureEnabled, type V8FeatureKey } from "@paperclipai/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { ExperienceReadError } from "../components/ExperienceReadError";
import { ExperienceMetricObservations } from "../components/ExperienceMetricObservations";
import { ExperienceProcessFindings } from "../components/ExperienceProcessFindings";
import { ExperienceScenarioComparisons } from "../components/ExperienceScenarioComparisons";
import { ExperienceExperimentResults } from "../components/ExperienceExperimentResults";
import { ExperienceForecastResults } from "../components/ExperienceForecastResults";
import { ExperienceManagementReviews } from "../components/ExperienceManagementReviews";
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
  { feature: "business_experiments_v8", href: "/business-experiments", key: "experiments" },
];
export function ExperienceInsights() {
  const { t } = useTranslation("experience");
  const { selectedCompanyId } = useCompany();
  const { query, identity, loading: experienceLoading, retry, scope } = useExperience(selectedCompanyId);
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const flags = useQuery({
    queryKey: [...queryKeys.instance.experimentalSettings, "experience-insights", selectedCompanyId, principal, identity.authorityEpoch],
    queryFn: ({ signal }) => instanceSettingsApi.getCurrentExperimental(signal),
    enabled: !!selectedCompanyId && identity.settled && !!principal,
    gcTime: 0,
    retry: false,
  });
  const failed = query.isError || flags.isError || identity.failed;
  const loading = experienceLoading || !identity.settled || !principal || flags.isPending || flags.isFetching;
  const heading = useExperienceHeading(scope, loading, failed);
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (failed)
    return <ExperienceReadError message={t("loadFailed")} retry={() => {
      void Promise.allSettled([retry(), identity.settled ? flags.refetch() : Promise.resolve()]);
    }} />;
  if (loading || !query.data || !flags.data)
    return <p role="status">{t("loading")}</p>;
  if (query.data.profile === "member")
    return <p role="alert">{t("insightsDenied")}</p>;
  const visible = destinations.filter((item) =>
    v8FeatureEnabled(flags.data, item.feature),
  );
  return (
    <div className="space-y-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("nav.insights")}</h1>
      <p>{t("insightDirectory.intro")}</p>
      {visible.some(item => item.key === "metrics") && <ExperienceMetricObservations key={`${scope}:metrics`}
        companyId={selectedCompanyId} userId={identity.localImplicit ? null : identity.userId} scope={`${scope}:${identity.authorityEpoch}`} />}
      {visible.some(item => item.key === "process") && <ExperienceProcessFindings key={`${scope}:process`}
        companyId={selectedCompanyId} userId={identity.localImplicit ? null : identity.userId} scope={`${scope}:${identity.authorityEpoch}`} />}
      {visible.some(item => item.key === "forecasts") && <ExperienceForecastResults key={`${scope}:forecasts`}
        companyId={selectedCompanyId} userId={identity.localImplicit ? null : identity.userId} scope={`${scope}:${identity.authorityEpoch}`} />}
      {visible.some(item => item.key === "scenarios") && <ExperienceScenarioComparisons key={`${scope}:scenarios`}
        companyId={selectedCompanyId} userId={identity.localImplicit ? null : identity.userId} scope={`${scope}:${identity.authorityEpoch}`} />}
      {visible.some(item => item.key === "experiments") && <ExperienceExperimentResults key={`${scope}:experiments`}
        companyId={selectedCompanyId} userId={identity.localImplicit ? null : identity.userId} scope={`${scope}:${identity.authorityEpoch}`} />}
      {visible.some(item => item.key === "reviews") && <ExperienceManagementReviews key={`${scope}:reviews`}
        companyId={selectedCompanyId} userId={identity.localImplicit ? null : identity.userId} scope={`${scope}:${identity.authorityEpoch}`} />}
      {visible.length === 0 ? (
        <p role="status">{t("insightDirectory.unavailable")}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {visible.map((item) => (
            <li key={item.key} className="min-w-0 space-y-2 border-b py-4">
                <h2 className="text-lg font-semibold"><Link
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                  to={item.href}
                >{t(`insights.${item.key}`)}</Link></h2>
                <p>{t(`insightDirectory.${item.key}`)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
