import { useRef } from "react";
import { useIsFetching, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { authSessionSchema, type AuthSession } from "@paperclipai/shared";
import { useAccountIdentity } from "../api/companies-query";
import { queryKeys } from "../lib/queryKeys";

/** Consult the original session cache at the call/acknowledgement boundary,
 * including the interval before React observes a completed account change. */
export function hasCurrentV9Session(client: QueryClient, principal: string, sessionId: string | null, allowLocalImplicit = false) {
  const state = client.getQueryState(queryKeys.auth.session);
  if (!sessionId || state?.status !== "success" || state.fetchStatus !== "idle" || state.isInvalidated) return false;
  const parsed = authSessionSchema.safeParse(state.data);
  if (!parsed.success || parsed.data.session.id !== sessionId || parsed.data.session.userId !== parsed.data.user.id) return false;
  if (parsed.data.session.localImplicit)
    return allowLocalImplicit && principal === "local-board";
  return parsed.data.user.id === principal;
}

/** Cached identity is insufficient while a current session request is unresolved.
 * Keep drafts scoped to the same principal, but use a new source epoch before
 * displaying private reads again. Native APIs still mediate every operation. */
export function useV9CurrentAccount() {
  // V9 private surfaces recheck on return even within the app's ordinary query
  // freshness window. Nested observers subscribe without restarting that read.
  const identity = useAccountIdentity({ staleTime: 0, refetchOnMount: false });
  const client = useQueryClient();
  const sessionId = client.getQueryData<AuthSession | null>(queryKeys.auth.session)?.session?.id ?? null;
  const rechecking =
    useIsFetching({ queryKey: queryKeys.auth.session, exact: true }) > 0;
  const settled = identity.settled && !identity.failed && !rechecking;
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const state = useRef({ principal, settled, sessionId, epoch: 0 });
  if (state.current.principal !== principal)
    state.current = { principal, settled, sessionId, epoch: 0 };
  else if (state.current.settled !== settled || state.current.sessionId !== sessionId)
    state.current = { principal, settled, sessionId, epoch: state.current.epoch + 1 };
  return {
    ...identity,
    settled,
    rechecking,
    authorityEpoch: state.current.epoch,
    sessionId,
  };
}
