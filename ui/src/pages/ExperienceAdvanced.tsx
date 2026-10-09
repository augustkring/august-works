import { useTranslation } from "react-i18next";
import { useCompany } from "../context/CompanyContext";
import { useExperience } from "../hooks/useExperience";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";
export function ExperienceAdvanced() {
  const { t } = useTranslation("experience"),
    { selectedCompanyId } = useCompany(),
    { query, identity, retry } = useExperience(selectedCompanyId);
  if (!selectedCompanyId) return <p>{t("selectCompany")}</p>;
  if (query.isError || identity.failed)
    return (
      <div role="alert">
        <p>{t("loadFailed")}</p>
        <Button className="min-h-11" onClick={() => void retry()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (query.isPending) return <p role="status">{t("loading")}</p>;
  const links = query.data.advancedLinks ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("advanced.title")}</h1>
      <p>{t("advanced.description")}</p>
      {!links.length ? (
        <p>{t("advanced.none")}</p>
      ) : (
        <ul className="space-y-3">
          {links.map((link) => (
            <li key={link.id}>
              <Link
                className="inline-flex min-h-11 items-center rounded-md text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                to={link.href}
              >
                {t(`advanced.${link.id}`)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
