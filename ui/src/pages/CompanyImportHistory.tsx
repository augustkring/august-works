import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { companiesApi, type CompanyImportJobStatus } from "../api/companies";
import { useCompany } from "../context/CompanyContext";
import { hasCurrentV9Session, useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { Button } from "../components/ui/button";
import { Link } from "../lib/router";

function isUnconfirmedNewCompany(job: CompanyImportJobStatus["job"]) {
  return job.target?.mode === "new_company" && job.target.result === "not_confirmed" &&
    (job.status === "running" || job.status === "cancelled" || job.status === "needs_reconciliation") && !job.result && !job.importResult;
}

/** Saved receipts only. Reading this page never dispatches or retries an import. */
export function CompanyImportHistory({ active = true }: { active?: boolean } = {}) {
  const { selectedCompanyId } = useCompany();
  const identity = useV9CurrentAccount();
  const client = useQueryClient();
  const { i18n } = useTranslation("experience");
  const da = (i18n.resolvedLanguage ?? i18n.language).startsWith("da");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const ready = active && !!selectedCompanyId && !!principal && identity.settled && !identity.failed && !!identity.sessionId;
  const current = () => ready && hasCurrentV9Session(client, principal!, identity.sessionId, identity.localImplicit);
  const query = useInfiniteQuery({
    queryKey: ["company-import-history", selectedCompanyId, principal, identity.sessionId, identity.authorityEpoch],
    initialPageParam: undefined as string | undefined,
    enabled: ready,
    queryFn: async ({ pageParam, signal }) => {
      if (!current()) throw new Error("Account changed");
      const page = await companiesApi.importHistory(selectedCompanyId!, principal!, pageParam, signal);
      if (!current()) throw new Error("Account changed");
      return page;
    },
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 0, gcTime: 0, retry: false,
  });
  const labels = da ? {
    running: "Import i gang", cancelled: "Import annulleret", succeeded: "Import fuldført", failed: "Afvist før import", needs_reconciliation: "Udfaldet er ikke bekræftet",
  } : {
    running: "Import in progress", cancelled: "Import cancelled", succeeded: "Import complete", failed: "Rejected before import", needs_reconciliation: "Outcome not confirmed",
  };
  const newCompanyNotConfirmed = da ? "Ny virksomhed, resultatet er endnu ikke bekræftet" : "New company, result not yet confirmed";
  const jobs = current() ? query.data?.pages.flatMap(page => page.jobs) ?? [] : [];

  return <section className="space-y-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">{da ? "Importhistorik" : "Import history"}</h1>
      <p className="text-sm text-muted-foreground">{da ? "Dine gemte importkvitteringer for dette firma. Statuskontrol starter aldrig en ny import." : "Your saved import receipts for this company. Checking status never starts another import."}</p>
    </header>
    {!ready ? <p role="status">{da ? "Bekræft din konto, og vælg et firma for at se dine importer." : "Confirm your account and select a company to view your imports."}</p> : <>
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>{da ? "Opdater status" : "Refresh status"}</Button>
      {query.isPending && <p role="status">{da ? "Henter importstatus…" : "Loading import status…"}</p>}
      {query.isError && <p role="alert">{da ? "Importstatus kunne ikke hentes. Prøv at opdatere status." : "Import status could not be loaded. Try refreshing status."}</p>}
      {!query.isPending && !query.isError && jobs.length === 0 && <p>{da ? "Ingen gemte importer for denne konto og dette firma." : "No saved imports for this account and company."}</p>}
      <ul className="space-y-4">{jobs.map(({ job }) => <li key={job.id} className="space-y-2 rounded-lg border border-border p-4">
        {isUnconfirmedNewCompany(job)
          ? <><h2 className="font-medium">{newCompanyNotConfirmed}</h2><p className="text-sm">{labels[job.status]}</p></>
          : <h2 className="font-medium">{labels[job.status]}</h2>}
        {job.createdAt && <time className="text-sm text-muted-foreground" dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString(da ? "da-DK" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</time>}
        <p className="break-all text-sm">{da ? "Kvittering" : "Receipt"}: {job.id}</p>
        {job.error && <p className="text-sm">{job.error.message}</p>}
        {job.status === "needs_reconciliation" && <p className="text-sm">{da ? "Nogle ændringer kan allerede være gemt. Behold kvitteringen, og kontakt support, før du importerer igen." : "Some changes may already be saved. Keep this receipt and contact support before importing again."}</p>}
        {job.status === "cancelled" && <p className="text-sm">{da ? "Annulleringen blev bekræftet, før importændringerne begyndte." : "Cancellation was confirmed before import changes began."}</p>}
      </li>)}</ul>
      {query.hasNextPage && <Button variant="outline" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{da ? "Vis flere" : "Show more"}</Button>}
    </>}
    <Link className="text-sm underline" to="/company/support">{da ? "Kontakt support" : "Contact support"}</Link>
  </section>;
}
