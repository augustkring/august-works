import { useTranslation } from "react-i18next";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link } from "../lib/router";

/** The activation owner admits this link; the destination repeats current access. */
export function ActivationMeasuresLink() {
  const feature = useV9FeatureEnabled("experience_analytics_v9");
  const { t } = useTranslation("experience");
  if (!feature.enabled || feature.query.isFetching || feature.query.isError) return null;
  return <Link className="inline-flex min-h-11 items-center underline" to="/company/measures">{t("measures.open")}</Link>;
}
