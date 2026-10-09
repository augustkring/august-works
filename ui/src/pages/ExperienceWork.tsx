import { useTranslation } from "react-i18next";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { useExperienceHeading } from "../hooks/useExperienceHeading";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { ExperienceCard } from "../components/ExperienceCard";
import { ExperienceReadError } from "../components/ExperienceReadError";
import { Button } from "../components/ui/button";
import { Link, Navigate } from "../lib/router";

export function WorkEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  const { t } = useTranslation("experience");
  if (feature.query.isPending) return <p role="status">{t("loading")}</p>;
  return feature.enabled ? (
    <ExperienceWork />
  ) : (
    <Navigate to="/issues" replace />
  );
}
export function ExperienceWork() {
  const { selectedCompanyId } = useCompany();
  const { t } = useTranslation("experience");
  const { query, identity, retry, loading, scope } =
    useExperience(selectedCompanyId);
  const heading = useExperienceHeading(
    scope,
    loading,
    query.isError || identity.failed,
  );
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (query.isError || identity.failed)
    return (
      <ExperienceReadError
        message={t("workLoadFailed")}
        retry={() => void retry()}
      />
    );
  if (loading || !query.data) return <p role="status">{t("loading")}</p>;
  const tasks = query.data.dependencies.find(
    (dependency) => dependency.domain === "tasks",
  );
  const unavailable = !tasks || tasks.state !== "fresh";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("nav.work")}
      </h1>
      <Button
        className="min-h-11"
        onClick={() =>
          document.dispatchEvent(new Event("paperclip:open-command"))
        }
      >
        {t("ask")}
      </Button>
      <nav aria-label={t("workObjects")} className="flex flex-wrap gap-4">
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/projects"
        >
          {t("projects")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/issues"
        >
          {t("tasks")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center underline"
          to="/routines"
        >
          {t("routines")}
        </Link>
      </nav>
      {unavailable && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-border p-4"
        >
          <p>{t("workUnavailable")}</p>
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("tryAgain")}
          </Button>
        </div>
      )}
      {(["inProgress", "done"] as const).map(
        (section) =>
          query.data[section].length > 0 && (
            <section
              key={section}
              aria-labelledby={`work-${section}`}
              className="space-y-3"
            >
              <h2 id={`work-${section}`} className="text-lg font-medium">
                {t(section)}
              </h2>
              <div className="grid gap-3">
                {query.data[section].map((card) => (
                  <ExperienceCard key={card.id} card={card} />
                ))}
              </div>
            </section>
          ),
      )}
      {!unavailable &&
        query.data.inProgress.length === 0 &&
        query.data.done.length === 0 && <p>{t("workEmptyView")}</p>}
      <p className="text-sm text-muted-foreground">{t("workBounded")}</p>
    </div>
  );
}
