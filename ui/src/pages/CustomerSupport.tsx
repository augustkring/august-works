import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { customerSupportHistorySchema, FEEDBACK_CONTACTS } from "@paperclipai/shared";
import { api } from "../api/client";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { Link } from "../lib/router";
import { Button } from "../components/ui/button";

export function CustomerSupport() {
  const { t } = useTranslation("experience"),
    { selectedCompanyId } = useCompany(),
    identity = useV9CurrentAccount(),
    feature = useV9FeatureEnabled("progressive_shell_v9");
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  if (!selectedCompanyId) return <p role="status">{t("selectCompany")}</p>;
  if (identity.failed || feature.query.isError)
    return <p role="alert">{t("supportHistory.unavailable")}</p>;
  if (
    !identity.settled ||
    !principal ||
    feature.query.isPending ||
    feature.query.isFetching
  )
    return <p role="status">{t("supportHistory.loading")}</p>;
  if (!feature.enabled)
    return <p role="status">{t("supportHistory.unavailable")}</p>;
  return (
    <CustomerSupportHistory
      key={`${selectedCompanyId}:${principal}`}
      companyId={selectedCompanyId}
      principal={principal}
    />
  );
}
export function CustomerSupportHistory({
  companyId,
  principal,
}: {
  companyId: string;
  principal: string;
}) {
  const { t } = useTranslation("experience"),
    client = useQueryClient(),
    heading = useRef<HTMLHeadingElement>(null),
    error = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLElement>(null),
    restoreFocus = useRef<string | null>(null),
    initiallyFocused = useRef(false);
  const [epoch, setEpoch] = useState(0),
    prefix = ["customer-support-history", companyId, principal];
  function retainFocus() {
    if (
      typeof document !== "undefined" &&
      region.current?.contains(document.activeElement)
    ) {
      const key = document.activeElement?.getAttribute("data-support-focus");
      restoreFocus.current =
        key && ["heading", "company", "native", "contact"].includes(key)
          ? key
          : null;
    }
  }
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: async ({ signal }) => {
      retainFocus();
      const result = customerSupportHistorySchema.parse(
        await api.get(
          `/companies/${companyId}/experience/support-access?expectedUserId=${encodeURIComponent(principal)}`,
          { signal, cache: "no-store" },
        ),
      );
      if (result.companyId !== companyId)
        throw new Error("Support source changed");
      return result;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  useCompanyLiveEvent((event) => {
    if (
      event.companyId !== companyId ||
      (event.type !== "activity.logged" &&
        event.type !== "analytical.context.access_lost")
    )
      return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type === "activity.logged" &&
      !/support|permission|membership|privacy|erased|deleted|withdraw|company|experimental|instance_settings/i.test(
        action,
      ) &&
      event.payload.entityType !== "company_membership"
    )
      return;
    retainFocus();
    setEpoch((value) => value + 1);
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  useEffect(() => {
    if (document.querySelector('[role="dialog"]')) {
      if (!query.isFetching && query.data) initiallyFocused.current = true;
      restoreFocus.current = null;
      return;
    }
    if (query.isError) {
      restoreFocus.current = null;
      error.current?.focus();
    } else if (!query.isFetching && query.data) {
      if (!initiallyFocused.current) {
        initiallyFocused.current = true;
        heading.current?.focus();
      } else if (restoreFocus.current) {
        if (
          document.activeElement === document.body ||
          region.current?.contains(document.activeElement)
        )
          region.current
            ?.querySelector<HTMLElement>(
              `[data-support-focus="${restoreFocus.current}"]`,
            )
            ?.focus();
        restoreFocus.current = null;
      }
    }
  }, [query.isError, query.isFetching, query.data]);
  if (query.isError)
    return (
      <div ref={error} role="alert" tabIndex={-1} className="space-y-3">
        <p>{t("supportHistory.unavailable")}</p>
        <Button className="min-h-11" onClick={() => void query.refetch()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  if (query.isPending || query.isFetching)
    return <p role="status">{t("supportHistory.loading")}</p>;
  return (
    <section ref={region} className="space-y-6">
      <header className="space-y-2">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
          {t("supportHistory.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("supportHistory.disclosure")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("supportHistory.observed")}{" "}
          <time dateTime={query.data.observedAt}>{query.data.observedAt}</time>
        </p>
      </header>
      {query.data.entries.length === 0 ? (
        <p role="status">{t("supportHistory.empty")}</p>
      ) : (
        <section aria-labelledby="support-records" className="space-y-4">
          <h2 id="support-records" className="text-lg font-medium">
            {t("supportHistory.records")}
          </h2>
          <ul className="space-y-4">
            {query.data.entries.map((entry) => (
              <li
                key={entry.sessionId}
                className="space-y-2 border-b border-border pb-4"
              >
                <p className="font-medium">
                  {t(`supportHistory.state.${entry.state}`)}
                </p>
                <p className="break-words text-sm">
                  {t("supportHistory.operator")}: {entry.operatorReference}
                </p>
                <p className="text-sm">
                  {t("supportHistory.approved")}:{" "}
                  <time dateTime={entry.approvedAt}>{entry.approvedAt}</time>
                </p>
                <p className="text-sm">
                  {t("supportHistory.expires")}:{" "}
                  <time dateTime={entry.expiresAt}>{entry.expiresAt}</time>
                </p>
                {entry.revokedAt && (
                  <p className="text-sm">
                    {t("supportHistory.revoked")}:{" "}
                    <time dateTime={entry.revokedAt}>{entry.revokedAt}</time>
                  </p>
                )}
                <ul className="list-inside list-disc text-sm">
                  {entry.scopes.map((scope) => (
                    <li key={scope}>
                      {t(`supportHistory.scope.${scope.replace(":", "_")}`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {query.data.hasMore && <p role="status">{t("supportHistory.more")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/company/settings"
          data-support-focus="company"
          className="inline-flex min-h-11 items-center underline"
        >
          {t("supportHistory.back")}
        </Link>
        <Link
          to="/company/settings/support"
          data-support-focus="native"
          className="inline-flex min-h-11 items-center underline"
        >
          {t("supportHistory.nativeControls")}
        </Link>
      </div>
      <a
        href={FEEDBACK_CONTACTS.support}
        data-support-focus="contact"
        className="inline-flex min-h-11 items-center underline"
      >
        {t("supportHistory.contact")}
      </a>
    </section>
  );
}
