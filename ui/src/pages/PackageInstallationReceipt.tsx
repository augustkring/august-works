import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { packageInstallationRequestLocatorSchema } from "@paperclipai/shared";
import { agentPackagesApi } from "../api/agent-packages";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useCompany } from "../context/CompanyContext";
import { Link, Navigate, useNavigate, useParams } from "../lib/router";
import { clearPendingPackageInstallation, readPendingPackageInstallation } from "../lib/pending-package-installations";
import { Button } from "../components/ui/button";

export function PackageInstallationReceiptEntry({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const identity = useV9CurrentAccount(), { selectedCompanyId: company } = useCompany(), { requestId: routeId } = useParams();
  const { t } = useTranslation("experience"), navigate = useNavigate();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const authority = useV9PrivateReadAuthority(principal ?? "", identity.localImplicit);
  let requestId = routeId, failed = false;
  if (pendingOnly && company && principal) {
    try { requestId = readPendingPackageInstallation(company, principal) ?? undefined; } catch { failed = true; }
  }
  if (identity.failed) return <div role="alert" className="space-y-2"><p>{t("packageWorkspaceUnavailable")}</p>
    <Button disabled={authority.rechecking} onClick={() => void authority.recheck().catch(() => {})}>{t("tryAgain")}</Button></div>;
  if (!company || !identity.userId || !principal) return <p role="status">{t("loading")}</p>;
  if (pendingOnly && !requestId && !failed) return <Navigate to="/dashboard" replace />;
  if (failed || !packageInstallationRequestLocatorSchema.safeParse({ companyId: company, requestId }).success)
    return <p role="alert">{t("packageRecovery.storageUnavailable")}</p>;
  return <PackageInstallationReceipt key={`${company}:${principal}:${requestId}`} company={company} principal={principal}
    userId={identity.userId} requestId={requestId!} allowLocalImplicit={identity.localImplicit}
    onResolved={() => { clearPendingPackageInstallation(company, principal, requestId!); navigate("/agents/packages", { replace: true }); }} />;
}

/** Original read-back plus an optional explicit, unchanged request resend owned
 * by the still-open form. A missing record never proves the first call failed. */
export function PackageInstallationReceipt({ company, principal, userId, requestId, allowLocalImplicit, inFlight = false,
  onResolved, retryOriginal }: { company: string; principal: string; userId: string; requestId: string;
    allowLocalImplicit: boolean; inFlight?: boolean; onResolved: () => void; retryOriginal?: () => void }) {
  const { t, i18n } = useTranslation("experience"), authority = useV9PrivateReadAuthority(principal, allowLocalImplicit), reader = useId();
  const [storageFailed, setStorageFailed] = useState(false), heading = useRef<HTMLHeadingElement>(null), focused = useRef(false);
  const query = useQuery({ queryKey: ["package-installation-request", company, principal, requestId, authority.epoch, reader],
    queryFn: ({ signal }) => authority.read(() => agentPackagesApi.installationRequest(company, userId, requestId, signal)),
    enabled: authority.readReady && !inFlight, retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: true });
  const current = authority.readReady && !inFlight && query.isSuccess && !query.isFetching;
  useEffect(() => {
    if (focused.current || document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return;
    heading.current?.focus(); focused.current = true;
  }, []);
  return <section className="saas-page">
    <h1 ref={heading} tabIndex={-1} className="saas-title">{t("packageRecovery.title")}</h1>
    <p>{t(retryOriginal ? "packageRecovery.retryViewBoundary" : "packageRecovery.boundary")}</p>
    {(!authority.readReady || inFlight || query.isFetching || query.isPending) && !authority.failed
      ? <p role="status">{t(inFlight ? "packageRecovery.saving" : "loading")}</p>
      : !current ? <p role="alert">{t("packageRecovery.unconfirmed")}</p> : null}
    {current && <section aria-label={t("packageRecovery.current")} className="space-y-2">
      <h2 className="saas-subtitle">{t("packageRecovery.recorded")}</h2>
      <p>{t("packageRecovery.status", { status: t(`maintenanceInstallationStatus.${query.data.installationStatus}`), version: query.data.installationVersion })}</p>
      <p>{t("checkedAt", { time: new Date(query.data.observedAt).toLocaleString(i18n.resolvedLanguage ?? i18n.language) })}</p>
    </section>}
    {storageFailed && <p role="alert">{t("packageRecovery.storageUnavailable")}</p>}
    <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" variant="outline" disabled={inFlight || authority.rechecking || query.isFetching}
        onClick={() => { if (!authority.canRead()) void authority.recheck().catch(() => {}); else void query.refetch(); }}>{t("packageRecovery.check")}</Button>
      {retryOriginal && !current && !inFlight && authority.readReady && <Button className="min-h-11" variant="outline" onClick={retryOriginal}>{t("packageRecovery.retryOriginal")}</Button>}
    </div>
    {retryOriginal && !current && !inFlight && <p>{t("packageRecovery.retryBoundary")}</p>}
    <div className="saas-row">
      <Link className="saas-link inline-flex min-h-11 items-center" to="/dashboard">{t("packageRecovery.leave")}</Link>
      <Button className="min-h-11" disabled={!current || !authority.canRead()} onClick={() => {
        if (!current || !authority.canRead()) return;
        try { onResolved(); } catch { setStorageFailed(true); }
      }}>{t("packageRecovery.return")}</Button>
    </div>
  </section>;
}
