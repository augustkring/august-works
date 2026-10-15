import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { hasCurrentV9Session, useV9CurrentAccount } from "@/hooks/useV9CurrentAccount";
import { saasApi } from "@/api/saas";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useEffect, useRef } from "react";
import { queryKeys } from "@/lib/queryKeys";
import { useTranslation } from "react-i18next";
export function SaasNotifications() {
  const { t } = useTranslation("experience");
  const identity = useV9CurrentAccount(),
    capabilities = useSaasCapabilities(),
    { selectedCompanyId } = useCompany();
  const scope = identity.userId + ":" + selectedCompanyId;
  const client = useQueryClient();
  const ready = identity.settled && !identity.localImplicit && !!identity.userId &&
    !!selectedCompanyId && capabilities.isSuccess && !capabilities.isFetching &&
    capabilities.data?.notifications === true;
  const current = useRef({ scope, ready, accountEpoch: identity.authorityEpoch, epoch: 0 });
  if (current.current.scope !== scope || current.current.ready !== ready || current.current.accountEpoch !== identity.authorityEpoch)
    current.current = { scope, ready, accountEpoch: identity.authorityEpoch, epoch: current.current.epoch + 1 };
  const epoch = current.current.epoch;
  const canRead = () => current.current.ready &&
    hasCurrentV9Session(client, identity.userId ?? "", identity.sessionId) &&
    client.getQueryState(["saas-capabilities"])?.status === "success" &&
    client.getQueryState(["saas-capabilities"])?.fetchStatus === "idle" &&
    client.getQueryState(["saas-capabilities"])?.isInvalidated === false &&
    client.getQueryData<{ notifications?: boolean }>(["saas-capabilities"])?.notifications === true;
  const key = ["saas-notifications", identity.userId, selectedCompanyId, epoch];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!canRead() || current.current.epoch !== epoch) throw new Error("Current account access is unresolved");
      const page = await saasApi.notificationsPage(
        selectedCompanyId!,
        identity.userId!,
        pageParam,
        signal,
      );
      if (!canRead() || current.current.epoch !== epoch) throw new Error("Update access changed during the read");
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: ready,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 30000,
  });
  const read = useMutation({
    mutationFn: async (input: { id: string; epoch: number; scope: string }) => {
      if (!canRead() || current.current.epoch !== input.epoch || current.current.scope !== input.scope ||
        !query.isSuccess || client.getQueryState(key)?.fetchStatus === "fetching")
        throw new Error("Current updates must finish loading before marking one read");
      await saasApi.readNotification(selectedCompanyId!, identity.userId!, input.id);
      return input;
    },
    retry: false,
    onSuccess: (input) => {
      if (canRead() && current.current.epoch === input.epoch && current.current.scope === input.scope)
        void query.refetch();
    },
  });
  useEffect(() => {
    read.reset();
  }, [scope, epoch]);
  const visible = ready && query.isSuccess && !query.isFetching;
  const notes = visible ? query.data.pages.flatMap((page) => page.items) : undefined;
  if (!capabilities.data?.notifications || !selectedCompanyId) return null;
  return (
    <section className="saas-section" aria-label={t("notifications.updates.heading")}>
      <h2 className="saas-subtitle">{t("notifications.updates.heading")}</h2>
      {(identity.failed || (ready && (query.error || (read.variables?.epoch === epoch && read.error)))) && (
        <p className="saas-error" role="alert">
          {t("notifications.updates.failed")}
          <Button variant="outline" className="min-h-11" disabled={query.isFetching || identity.rechecking}
            onClick={() => {
              if (identity.failed) void client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true });
              else if (ready) void query.refetch();
            }}>{t("notifications.updates.retry")}</Button>
        </p>
      )}
      {!identity.failed && (!ready || query.isPending || query.isFetching) && <p role="status">{t("notifications.updates.loading")}</p>}
      {notes?.filter((note) => !note.readAt).length === 0 && (
        <p className="saas-muted">{t("notifications.updates.empty")}</p>
      )}
      {notes
        ?.filter((note) => !note.readAt)
        .map((note) => (
          <div className="saas-row" key={note.id}>
            <Link className="saas-link" to={note.relativePath}>
              {note.title}
            </Link>
            <Button
              variant="ghost"
              disabled={read.isPending || !visible}
              onClick={() => read.mutate({ id: note.id, epoch, scope })}
            >
              {t("notifications.updates.markRead")}
            </Button>
          </div>
        ))}
      {visible && query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("notifications.updates.more")}
        </Button>
      )}
    </section>
  );
}
