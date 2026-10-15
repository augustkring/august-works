import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "../lib/router";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { experienceMeasuresApi } from "../api/experience-measures";
import { Button } from "../components/ui/button";

export function ExperienceMeasuresEntry() {
  const feature = useV9FeatureEnabled("experience_analytics_v9"), identity = useV9CurrentAccount();
  const { selectedCompanyId } = useCompany(), { t } = useTranslation("experience");
  const authority = useV9PrivateReadAuthority(identity.userId ?? "");
  if (feature.query.isError || identity.failed)
    return <div role="alert" className="space-y-4"><p>{t("measures.unavailable")}</p>
      <Button className="min-h-11" disabled={authority.rechecking || feature.query.isFetching} onClick={() => {
        if (identity.failed) void authority.recheck().catch(() => {}); else void feature.query.refetch();
      }}>{t("tryAgain")}</Button></div>;
  if (feature.query.isPending || feature.query.isFetching || !identity.settled) return <p role="status">{t("loading")}</p>;
  if (!feature.enabled || !identity.userId || identity.localImplicit) return <p role="alert">{t("measures.unavailable")}</p>;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  return <ExperienceMeasures key={`${selectedCompanyId}:${identity.userId}`} company={selectedCompanyId} principal={identity.userId} />;
}

export function ExperienceMeasures({ company, principal }: { company: string; principal: string }) {
  const { t, i18n } = useTranslation("experience"), client = useQueryClient();
  const authority = useV9PrivateReadAuthority(principal);
  const [sourceEpoch, setSourceEpoch] = useState(0), heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLDivElement>(null), main = useRef<HTMLElement>(null), focused = useRef(false);
  const restoreFocus = useRef<"heading" | "link" | null>(null);
  const prefix = ["experience-measures", company, principal];
  const query = useQuery({ queryKey: [...prefix, authority.epoch, sourceEpoch],
    queryFn: ({ signal }) => authority.read(() => experienceMeasuresApi.get(company, principal, signal)),
    enabled: authority.readReady, gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: true,
    refetchInterval: () => document.visibilityState === "visible" ? 15000 : false, refetchIntervalInBackground: false });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || !["activity.logged", "analytical.context.access_lost"].includes(event.type)) return;
    void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix });
    setSourceEpoch((old) => old + 1);
  });
  const current = authority.readReady && query.isSuccess && !query.isFetching;
  if (!current && main.current?.contains(document.activeElement))
    restoreFocus.current = document.activeElement === heading.current ? "heading" : document.activeElement?.tagName === "A" ? "link" : null;
  useEffect(() => {
    if (!current) return;
    if (document.activeElement?.closest('[role="dialog"]')) { focused.current = true; restoreFocus.current = null; return; }
    const previous = restoreFocus.current; restoreFocus.current = null;
    if (previous && document.activeElement === document.body) {
      if (previous === "heading") heading.current?.focus(); else main.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    }
    if (!focused.current) { heading.current?.focus(); focused.current = true; }
  }, [current]);
  useEffect(() => {
    if ((authority.failed || query.isError) && !document.activeElement?.closest('[role="dialog"]')) alert.current?.focus();
  }, [authority.failed, query.isError]);
  if (authority.failed || query.isError)
    return <div ref={alert} role="alert" tabIndex={-1} className="space-y-4"><p>{t("measures.unavailable")}</p>
      <Button className="min-h-11" disabled={authority.rechecking} onClick={() => {
        if (authority.canRead()) void query.refetch(); else void authority.recheck().catch(() => {});
      }}>{t("tryAgain")}</Button></div>;
  if (!current) return <p role="status">{t("loading")}</p>;
  const view = query.data!;
  return <section ref={main} className="space-y-6">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">{t("measures.title")}</h1>
    <p className="text-muted-foreground">{t("measures.boundary")}</p>
    <p>{t("measures.observed")} <time dateTime={view.observedAt}>{new Date(view.observedAt).toLocaleString(i18n.resolvedLanguage)}</time></p>
    <p role="status">{t(`measures.state.${view.status}`)}</p>
    <dl className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border p-4">
        <dt className="font-medium">{t("measures.creationToVerification")}</dt>
        <dd>{view.creationToVerificationBucket ? t(`measures.duration.${view.creationToVerificationBucket}`) : t("measures.notAvailable")}</dd>
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <dt className="font-medium">{t("measures.setupChanges")}</dt>
        <dd>{view.recordedSetupChangesBucket ? t(`measures.changes.${view.recordedSetupChangesBucket}`) : t("measures.notAvailable")}</dd>
        {view.setupWindow === "bounded" && <dd>{t("measures.bounded")}</dd>}
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <dt className="font-medium">{t("measures.ttfo")}</dt><dd>{t("measures.baselineUnavailable")}</dd>
      </div>
    </dl>
    <p className="text-muted-foreground">{t("measures.processing")}</p>
    <Link className="inline-flex min-h-11 items-center underline" to="/saas/activation">{t("measures.return")}</Link>
  </section>;
}
