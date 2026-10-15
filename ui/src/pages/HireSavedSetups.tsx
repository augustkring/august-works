import { useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import type { V9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";

export function HireSavedSetups({
  company,
  principal,
  authority,
}: {
  company: string;
  principal: string;
  authority: V9AuthoringAuthority;
}) {
  const { t } = useTranslation("experience");
  const client = useQueryClient(),
    epoch = useRef(0);
  const [checking, setChecking] = useState(false);
  const key = ["agent-authoring", company, principal, "list", authority.epoch];
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ signal, pageParam }) =>
      authority.read(() => agentAuthoringApi.list(
        company,
        principal,
        signal,
        pageParam ?? undefined,
      )),
    enabled: authority.readReady,
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    gcTime: 0,
  });
  useCompanyLiveEvent((event) => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.payload.entityType === "company_membership" ||
      action.includes("permission") ||
      action.includes("erased") ||
      action.endsWith("deleted") ||
      action.startsWith("resource_membership.")
    ) {
      setChecking(true);
      const current = ++epoch.current;
      void client.resetQueries({ queryKey: key, exact: true }).then(() => {
        if (current === epoch.current) setChecking(false);
      });
    }
  });
  const items =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === "hire") ?? [];
  if (!authority.readReady || (query.isFetching && !query.isFetchingNextPage))
    return <p role={authority.failed ? "alert" : "status"}>{t("hireSaved.checking")}</p>;
  return (
    <section className="space-y-3" aria-labelledby="saved-hire-setups">
      <h2 id="saved-hire-setups" className="text-lg font-semibold">
        {t("hireSaved.title")}
      </h2>
      {(checking || query.isPending) && (
        <p role="status">{t("hireSaved.loading")}</p>
      )}
      {query.isError && (
        <div role="alert">
          <p>{t("hireSaved.failed")}</p>
          <Button className="min-h-11" onClick={() => void query.refetch()}>
            {t("hireCatalog.tryAgain")}
          </Button>
        </div>
      )}
      {!checking && query.isSuccess && (
        <>
          {items.length === 0 && !query.hasNextPage && (
            <p>{t("hireSaved.empty")}</p>
          )}
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  className="inline-flex min-h-11 items-center underline"
                  to={`/agents/hire/drafts/${item.id}/${item.step}`}
                >
                  {item.name || t("hireSaved.untitled")} · {t("hireSaved.version", { version: item.version })}
                </Link>
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <Button
              className="min-h-11"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("hireSaved.older")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
