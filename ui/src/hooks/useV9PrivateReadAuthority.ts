import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { hasCurrentV9Session, useV9CurrentAccount } from "./useV9CurrentAccount";
import { queryKeys } from "../lib/queryKeys";

/** Private history is checked by its original Native owner. This client fence
 * prevents cached identity or a late response from displaying another session's
 * data; it grants no company or platform-operator permission. */
export function useV9PrivateReadAuthority(principal: string, allowLocalImplicit = false) {
  const identity = useV9CurrentAccount(), client = useQueryClient();
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(event => {
    // This authority observes the Original session only. Building an unrelated
    // private reader during another surface's render must not notify this one.
    if (event.query.queryHash === hashKey(queryKeys.auth.session)) changed();
  }), [client]);
  const sessionCurrent = useSyncExternalStore(subscribe,
    () => hasCurrentV9Session(client, principal, identity.sessionId, allowLocalImplicit),
    () => false);
  const sessionFailed = useSyncExternalStore(subscribe,
    () => client.getQueryState(queryKeys.auth.session)?.status === "error",
    () => false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const readReady = identity.settled &&
    (identity.localImplicit ? allowLocalImplicit && principal === "local-board" : identity.userId === principal) &&
    sessionCurrent;
  const context = useRef({ readReady, authorityEpoch: identity.authorityEpoch, epoch: 0 });
  if (context.current.readReady !== readReady || context.current.authorityEpoch !== identity.authorityEpoch)
    context.current = { readReady, authorityEpoch: identity.authorityEpoch, epoch: context.current.epoch + 1 };
  const canRead = () => alive.current && context.current.readReady &&
    hasCurrentV9Session(client, principal, identity.sessionId, allowLocalImplicit);
  const acknowledgements = useRef(new WeakMap<object, number>());
  async function read<T>(operation: () => Promise<T>): Promise<T> {
    if (!canRead()) throw new Error("Current private-history access is unresolved");
    const epoch = context.current.epoch;
    const value = await operation();
    if (!canRead() || epoch !== context.current.epoch)
      throw new Error("Private-history access changed during the request");
    return value;
  }
  return {
    readReady, epoch: context.current.epoch, failed: identity.failed || sessionFailed, rechecking: identity.rechecking, canRead, read,
    async recheck() {
      if (!alive.current) return;
      // Retry only the original session owner. Fresh private queries are enabled
      // by the subsequent current-account render; no cached grant or write is replayed.
      await client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true, type: "active" },
        { cancelRefetch: false, throwOnError: true });
    },
    async write<T extends object>(operation: () => Promise<T>): Promise<T> {
      const epoch = context.current.epoch;
      const value = await read(operation);
      acknowledgements.current.set(value, epoch);
      return value;
    },
    confirmed(value: object) {
      return canRead() && acknowledgements.current.get(value) === context.current.epoch;
    },
  };
}
export type V9PrivateReadAuthority = ReturnType<typeof useV9PrivateReadAuthority>;
