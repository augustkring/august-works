import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { companyExperienceSchema } from "@paperclipai/shared";
import { useAccountIdentity } from "../api/companies-query";
import { api } from "../api/client";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
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
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.failed)
    return (
      <CompanyReadError
        retry={() =>
          void client.refetchQueries({ queryKey: queryKeys.auth.session })
        }
      />
    );
  if (!identity.settled || !principal)
    return <p role="status">{t("company.loading")}</p>;
  return (
    <CompanyControls
      key={`${selectedCompanyId}:${principal}`}
      company={selectedCompanyId}
      principal={principal}
    />
  );
}
function CompanyReadError({ retry }: { retry: () => void }) {
  const { t } = useTranslation("experience");
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    error.current?.focus();
  }, []);
  return (
    <div ref={error} role="alert" tabIndex={-1} className="space-y-3">
      <p>{t("company.loadFailed")}</p>
      <Button className="min-h-11" onClick={retry}>
        {t("tryAgain")}
      </Button>
    </div>
  );
}
export function CompanyControls({
  company,
  principal,
}: {
  company: string;
  principal: string;
}) {
  const { t } = useTranslation("experience");
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [search, setSearch] = useState("");
  const [epoch, setEpoch] = useState(0);
  const prefix = ["experience-company", company, principal];
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: async ({ signal }) => {
      const result = companyExperienceSchema.parse(
        await api.get(
          `/companies/${company}/experience/company?expectedUserId=${encodeURIComponent(principal)}`,
          { signal, cache: "no-store" },
        ),
      );
      if (result.companyId !== company)
        throw new Error("Company context changed");
      return result;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  useCompanyLiveEvent((event) => {
    if (
      event.companyId !== company ||
      (event.type !== "activity.logged" &&
        event.type !== "analytical.context.access_lost")
    )
      return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type === "activity.logged" &&
      !/permission|membership|privacy|erased|deleted|withdraw|company|experimental|instance_settings/i.test(
        action,
      ) &&
      event.payload.entityType !== "company_membership"
    )
      return;
    setEpoch((value) => value + 1);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  useEffect(() => {
    heading.current?.focus();
  }, [query.data?.companyId, query.isFetching]);
  if (query.isError)
    return <CompanyReadError retry={() => void query.refetch()} />;
  if (query.isPending || query.isFetching)
    return <p role="status">{t("company.loading")}</p>;
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
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t("company.title")}
      </h1>
      <label className="block space-y-2">
        <span>{t("company.search")}</span>
        <Input
          className="min-h-11"
          type="search"
          maxLength={180}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {needle && (
        <p role="status">
          {t("company.matches", {
            count: sections.reduce(
              (count, section) => count + section.entries.length,
              0,
            ),
          })}
        </p>
      )}
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
                    <p className="text-sm text-muted-foreground">
                      {t("company.restricted")}
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
