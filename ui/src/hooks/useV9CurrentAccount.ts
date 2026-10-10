import { useRef } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useAccountIdentity } from "../api/companies-query";
import { queryKeys } from "../lib/queryKeys";

/** Cached identity is insufficient while a current session request is unresolved.
 * Keep drafts scoped to the same principal, but use a new source epoch before
 * displaying private reads again. Native APIs still mediate every operation. */
export function useV9CurrentAccount() {
  const identity = useAccountIdentity();
  const rechecking =
    useIsFetching({ queryKey: queryKeys.auth.session, exact: true }) > 0;
  const settled = identity.settled && !identity.failed && !rechecking;
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const state = useRef({ principal, settled, epoch: 0 });
  if (state.current.principal !== principal)
    state.current = { principal, settled, epoch: 0 };
  else if (state.current.settled !== settled)
    state.current = { principal, settled, epoch: state.current.epoch + 1 };
  return {
    ...identity,
    settled,
    rechecking,
    authorityEpoch: state.current.epoch,
  };
}
