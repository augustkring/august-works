import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FEEDBACK_CONTACTS, PRODUCT_IDENTITY } from "@paperclipai/shared";
import { Link, useLocation, useNavigate } from "../lib/router";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { checkedCompanyHelpResults, searchApi } from "../api/search";
import { useCompany } from "../context/CompanyContext";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { queryKeys } from "../lib/queryKeys";
import { CustomerSupportAssistant } from "../components/CustomerSupportAssistant";
import { ServiceHealth } from "../components/ServiceHealth";
import { TrustGatedEvidence } from "../components/TrustGatedEvidence";

const HELP_SEARCH_LIMIT = 8;

const linkClass = "inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CustomerHelpCenter({ navigationState }: { navigationState?: unknown } = {}) {
  const { t, i18n } = useTranslation("experience");
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("da") ? "da" : "en";
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const identity = useV9CurrentAccount();
  const principal = identity.localImplicit ? "local-board" : identity.userId ?? "";
  const authority = useV9PrivateReadAuthority(principal, true);
  const active = location.pathname.endsWith("/company/help");
  const activeRef = useRef(active);
  activeRef.current = active;
  const [searchText, setSearchText] = useState("");
  const [submitted, setSubmitted] = useState<{ query: string; scope: string } | null>(null);
  const scope = JSON.stringify([selectedCompanyId, principal, identity.sessionId, identity.authorityEpoch, authority.epoch]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => { setSearchText(""); setSubmitted(null); }, [scope]);
  const submittedMatchesScope = submitted?.scope === scope;
  const ready = active && !!selectedCompanyId && !!principal && identity.settled && !identity.failed && !!identity.sessionId && authority.readReady;
  const searchToken = submittedMatchesScope && submitted ? `${scope}:${locale}:${submitted.query}` : "";
  const searchTokenRef = useRef(searchToken);
  searchTokenRef.current = searchToken;
  const query = useQuery({
    queryKey: [...queryKeys.companySearch.search(selectedCompanyId ?? "__no-company__", submittedMatchesScope ? submitted?.query ?? "" : "", "help", HELP_SEARCH_LIMIT, 0),
      principal, identity.sessionId, identity.authorityEpoch, authority.epoch, locale],
    enabled: ready && !!searchToken && !!submitted,
    queryFn: async ({ signal }) => {
      const requestedScope = scopeRef.current;
      const requestedToken = searchToken;
      const current = () => activeRef.current && scopeRef.current === requestedScope &&
        searchTokenRef.current === requestedToken && authority.canRead();
      if (!current() || !submitted) throw new Error("Current Help search access is unavailable");
      const response = await authority.read(() => searchApi.search(selectedCompanyId!, {
        q: submitted.query, scope: "help", limit: HELP_SEARCH_LIMIT, locale,
      }, signal));
      if (!current()) throw new Error("Help search access changed during the request");
      return checkedCompanyHelpResults(response, HELP_SEARCH_LIMIT, locale);
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const mayShowResults = ready && submittedMatchesScope && authority.canRead();
  const results = mayShowResults && !query.isError ? query.data ?? [] : [];
  const da = (i18n.resolvedLanguage ?? i18n.language).startsWith("da");
  const supportState = navigationState ?? location.state;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = searchText.trim();
    if (!ready || !value) return;
    setSubmitted({ query: value, scope });
  }

  return (
    <section aria-labelledby="customer-help-title" className="space-y-6">
      <header className="space-y-2">
        <h1 id="customer-help-title" tabIndex={-1} className="text-2xl font-semibold">
          {t("helpCenter.title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("helpCenter.description")}</p>
      </header>
      <section aria-labelledby="customer-help-search-title" aria-live="polite" aria-busy={mayShowResults && query.isFetching}
        className="space-y-3 rounded-lg border border-border p-4">
        <h2 id="customer-help-search-title" className="font-medium">{t("helpCenter.searchTitle")}</h2>
        <form role="search" aria-label={t("helpCenter.searchLabel")} className="flex flex-col gap-3 sm:flex-row" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="customer-help-search">{t("helpCenter.searchLabel")}</label>
          <Input id="customer-help-search" type="search" autoComplete="off" maxLength={200}
            placeholder={t("helpCenter.searchPlaceholder")} value={searchText}
            onChange={event => { setSearchText(event.target.value); setSubmitted(null); }} />
          <Button type="submit" variant="outline" className="min-h-11" disabled={!ready || !searchText.trim() || query.isFetching}>
            {t("helpCenter.searchButton")}
          </Button>
        </form>
        {!submittedMatchesScope && <p className="text-sm text-muted-foreground">{t("helpCenter.searchPrompt")}</p>}
        {mayShowResults && query.isFetching && <p role="status" className="text-sm text-muted-foreground">{t("helpCenter.searchLoading")}</p>}
        {mayShowResults && query.isError && <div role="alert" className="flex flex-wrap items-center gap-3">
          <p>{t("helpCenter.searchError")}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>{t("helpCenter.searchRetry")}</Button>
        </div>}
        {mayShowResults && query.isSuccess && results.length === 0 && <p className="text-sm text-muted-foreground">{t("helpCenter.searchEmpty")}</p>}
        {results.length > 0 && <ul className="divide-y divide-border" aria-label={t("helpCenter.searchLabel")}>
          {results.map(result => {
            const article = result.helpArticle!;
            const maturity = article.maturity === "ga" ? "GA" : da ? "Forhåndsvisning" : "Preview";
            return <li key={result.id} className="space-y-1 py-3">
              <a className="font-medium text-primary underline underline-offset-4" href={result.href} target="_blank" rel="noreferrer">{result.title}</a>
              {result.snippet && <p className="text-sm text-muted-foreground">{result.snippet}</p>}
              <p className="text-xs text-muted-foreground">{t("helpCenter.searchPreview", {
                maturity,
                versions: article.applicableProductVersions.join(", "),
                locale: article.locale,
                date: article.lastVerifiedAt,
              })}</p>
            </li>;
          })}
        </ul>}
      </section>
      <div className="flex flex-wrap gap-3">
        <a className={linkClass} href={locale === "da" ? `${PRODUCT_IDENTITY.docsOrigin}/da/help/index` : PRODUCT_IDENTITY.docsOrigin} target="_blank" rel="noreferrer">
          {t("helpCenter.browse")}
        </a>
        <Link className={linkClass} to="/company/support" state={supportState} replace data-support-help-entry
          onClick={event => { event.preventDefault(); navigate("/company/support", { replace: true, state: supportState }); }}>
          {t("helpCenter.cases")}
        </Link>
        <Link className={linkClass} to="/company/imports" state={supportState} replace data-import-history-entry
          onClick={event => { event.preventDefault(); navigate("/company/imports", { replace: true, state: supportState }); }}>{t("helpCenter.imports")}</Link>
        <a className={linkClass} href={PRODUCT_IDENTITY.statusOrigin} target="_blank" rel="noreferrer">
          {t("helpCenter.status")}
        </a>
        <a className={linkClass} href={PRODUCT_IDENTITY.trustOrigin} target="_blank" rel="noreferrer">
          {t("helpCenter.trust")}
        </a>
      </div>
      <TrustGatedEvidence companyId={selectedCompanyId} active={active} />
      <section aria-labelledby="customer-help-contact" className="space-y-2 rounded-lg border border-border p-4">
        <h2 id="customer-help-contact" className="font-medium">{t("helpCenter.humanTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("helpCenter.humanDescription")}</p>
        <div className="flex flex-wrap gap-3">
          <a className={linkClass} href={FEEDBACK_CONTACTS.support}>{t("supportCases.contactSupport")}</a>
          <a className={linkClass} href={FEEDBACK_CONTACTS.security}>{t("helpCenter.security")}</a>
          <a className={linkClass} href={FEEDBACK_CONTACTS.privacy}>{t("helpCenter.privacy")}</a>
        </div>
      </section>
      <ServiceHealth />
      <CustomerSupportAssistant key={`${scope}:${locale}`} companyId={selectedCompanyId} principal={principal}
        locale={locale} ready={ready} authority={authority} />
    </section>
  );
}
