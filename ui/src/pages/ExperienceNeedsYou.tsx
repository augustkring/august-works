import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { ExperienceCard } from "../components/ExperienceCard";
import { Button } from "../components/ui/button";
import { Link, useSearchParams } from "../lib/router";
import { WhatNeedsMe } from "./WhatNeedsMe";

/** Exact-item links keep the native resolver; the ordinary entry is a read projection. */
export function NeedsYouEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  const [params] = useSearchParams();
  const { t } = useTranslation("experience");
  if (
    feature.query.isPending &&
    !params.has("decisionId") &&
    !params.has("attentionId")
  )
    return <p role="status">{t("loading")}</p>;
  return feature.enabled &&
    !params.has("decisionId") &&
    !params.has("attentionId") ? (
    <ExperienceNeedsYou />
  ) : (
    <WhatNeedsMe />
  );
}
export function ExperienceNeedsYou() {
  const { selectedCompanyId } = useCompany();
  const { t } = useTranslation("experience");
  const { query, identity, retry } = useExperience(selectedCompanyId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [selectedCompanyId, query.isPending]);
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (query.isError || identity.failed)
    return (
      <div role="alert" className="space-y-4">
        <p>{t("needsYouLoadFailed")}</p>
        <Button className="min-h-11" onClick={() => void retry()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  const attention = query.data.dependencies.find(
    (dependency) => dependency.domain === "attention",
  );
  const bounded =
    attention?.state === "partial" &&
    attention.reason === "more_items_available";
  const unavailable = !attention || (attention.state !== "fresh" && !bounded);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("needsYou")}
      </h1>
      {unavailable && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-border p-4"
        >
          <p>{t("needsYouUnavailable")}</p>
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("tryAgain")}
          </Button>
        </div>
      )}
      {!unavailable && !bounded && query.data.needsYou.length === 0 && (
        <p>{t("needsYouEmpty")}</p>
      )}
      <div className="grid gap-3">
        {query.data.needsYou.map((card) => (
          <ExperienceCard key={card.id} card={card} headingLevel={2} />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("needsYouBounded")}</p>
      <Link
        className="inline-flex min-h-11 items-center underline"
        to="/decisions"
      >
        {t("openFullQueue")}
      </Link>
    </div>
  );
}
