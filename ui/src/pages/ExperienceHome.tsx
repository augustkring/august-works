import { useTranslation } from "react-i18next";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { ExperienceCard } from "../components/ExperienceCard";
import { Button } from "../components/ui/button";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Dashboard } from "./Dashboard";

export function DashboardEntry() {
  const feature = useV9FeatureEnabled("home_v9");
  return feature.enabled ? <ExperienceHome /> : <Dashboard />;
}
export function ExperienceHome() {
  const { selectedCompanyId } = useCompany();
  const { t } = useTranslation("experience");
  const { query, identity, retry } = useExperience(selectedCompanyId);
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (query.isError || identity.failed)
    return (
      <div role="alert" className="space-y-4">
        <p>{t("loadFailed")}</p>
        <Button className="min-h-11" onClick={() => void retry()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  const model = query.data;
  const unavailable = model.dependencies.filter((d) => d.state !== "fresh");
  const empty = [
    model.needsYou,
    model.inProgress,
    model.done,
    model.watch,
  ].every((cards) => cards.length === 0);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("home")}</h1>
      <Button
        className="min-h-11"
        onClick={() =>
          document.dispatchEvent(new Event("paperclip:open-command"))
        }
      >
        {t("ask")}
      </Button>
      {unavailable.length > 0 && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-border p-4"
        >
          <p>{t("partial")}</p>
          <ul>
            {unavailable.map((d) => (
              <li key={d.domain}>
                {t(`domain.${d.domain}`)} — {t("unavailable")}
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void query.refetch()}
          >
            {t("tryAgain")}
          </Button>
        </div>
      )}
      {empty && unavailable.length === 0 && <p>{t("caughtUp")}</p>}
      {(["needsYou", "inProgress", "done", "watch"] as const).map(
        (section) =>
          model[section].length > 0 && (
            <section
              key={section}
              aria-labelledby={`home-${section}`}
              className="space-y-3"
            >
              <h2 id={`home-${section}`} className="text-lg font-medium">
                {t(`${section}`)}
              </h2>
              <div className="grid gap-3">
                {model[section].map((card) => (
                  <ExperienceCard key={card.id} card={card} />
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}
