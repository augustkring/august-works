import { useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useAccountIdentity } from "@/api/companies-query";
import { saasApi } from "@/api/saas";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useEffect, useRef } from "react";
export function SaasNotifications() {
  const identity = useAccountIdentity(),
    capabilities = useSaasCapabilities(),
    { selectedCompanyId } = useCompany();
  const scope = identity.userId + ":" + selectedCompanyId;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const query = useInfiniteQuery({
    queryKey: ["saas-notifications", identity.userId, selectedCompanyId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      saasApi.notificationsPage(
        selectedCompanyId!,
        identity.userId!,
        pageParam,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(
      identity.userId && selectedCompanyId && capabilities.data?.notifications,
    ),
    refetchInterval: 30000,
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      saasApi.readNotification(selectedCompanyId!, identity.userId!, id),
    onSuccess: () => currentScope.current === scope && query.refetch(),
  });
  useEffect(() => {
    read.reset();
  }, [scope]);
  const notes = query.data?.pages.flatMap((page) => page.items);
  if (!capabilities.data?.notifications || !selectedCompanyId) return null;
  return (
    <section className="saas-section" aria-label="Account and runtime updates">
      <h2 className="saas-subtitle">Account and runtime updates</h2>
      {(query.error || read.error) && (
        <p className="saas-error" role="alert">
          {(query.error ?? read.error)?.message}
        </p>
      )}
      {query.isPending && <p role="status">Loading updates…</p>}
      {notes?.filter((note) => !note.readAt).length === 0 && (
        <p className="saas-muted">You are up to date.</p>
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
              disabled={read.isPending}
              onClick={() => read.mutate(note.id)}
            >
              Mark read
            </Button>
          </div>
        ))}
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more updates
        </Button>
      )}
    </section>
  );
}
