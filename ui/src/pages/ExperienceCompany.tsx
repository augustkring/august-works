import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { companyExperienceSchema } from "@paperclipai/shared";
import { useAccountIdentity } from "../api/companies-query";
import { api } from "../api/client";
import { useCompany } from "../context/CompanyContext";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link } from "../lib/router";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { CompanySettings } from "./CompanySettings";
export function CompanySettingsEntry() {
  const feature = useV9FeatureEnabled("progressive_shell_v9");
  return feature.enabled ? <ExperienceCompany /> : <CompanySettings />;
}
export function ExperienceCompany() {
  const { t } = useTranslation("experience"),
    { selectedCompanyId } = useCompany(),
    identity = useAccountIdentity(),
    client = useQueryClient();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["experience-company", selectedCompanyId, principal],
    queryFn: async ({ signal }) =>
      companyExperienceSchema.parse(
        await api.get(
          `/companies/${selectedCompanyId}/experience/company?expectedUserId=${encodeURIComponent(principal!)}`,
          { signal, cache: "no-store" },
        ),
      ),
    enabled: !!selectedCompanyId && identity.settled && !!principal,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.failed || query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>{t("company.loadFailed")}</p>
        <Button
          className="min-h-11"
          onClick={() => {
            if (identity.failed || !principal)
              void client.refetchQueries({ queryKey: queryKeys.auth.session });
            else void query.refetch();
          }}
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (!query.isSuccess) return <p role="status">{t("company.loading")}</p>;
  const needle = search.trim().toLocaleLowerCase();
  const sections = query.data.sections.map((section) => ({
    ...section,
    entries: section.entries.filter(
      (entry) =>
        !needle ||
        `${t(`company.entry.${entry.id}.label`)} ${t(`company.entry.${entry.id}.purpose`)} ${t(`company.entry.${entry.id}.aliases`)} ${t(`company.section.${section.id}`)}`
          .toLocaleLowerCase()
          .includes(needle),
    ),
  }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("company.title")}</h1>
      <label className="block space-y-2">
        <span>{t("company.search")}</span>
        <Input
          className="min-h-11"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`company-${section.id}`}
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <h2 id={`company-${section.id}`} className="text-lg font-semibold">
              {t(`company.section.${section.id}`)}
            </h2>
            {section.entries.length ? (
              <ul className="space-y-3">
                {section.entries.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to={entry.href}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      {t(`company.entry.${entry.id}.label`)}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {t(`company.entry.${entry.id}.purpose`)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {needle ? t("company.noMatches") : t("company.noControls")}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
