import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSaasCapabilities } from "./useSaasCapabilities";
import { hasCurrentV9Session, useV9CurrentAccount } from "./useV9CurrentAccount";

type AccountCapability = "notifications" | "deletion";

/** Presentation/acknowledgement fence over the original account and capability
 * queries. The Native API remains the authority for each read and mutation. */
export function useV9AccountScope(principal: string) {
  const identity = useV9CurrentAccount();
  const capabilities = useSaasCapabilities();
  const client = useQueryClient();
  const ready = identity.settled && !identity.localImplicit && identity.userId === principal &&
    capabilities.isSuccess && !!capabilities.data && !capabilities.isFetching;
  const current = useRef({ ready, accountEpoch: identity.authorityEpoch, sessionId: identity.sessionId, epoch: 0 });
  if (current.current.ready !== ready || current.current.accountEpoch !== identity.authorityEpoch ||
    current.current.sessionId !== identity.sessionId)
    current.current = { ready, accountEpoch: identity.authorityEpoch, sessionId: identity.sessionId, epoch: current.current.epoch + 1 };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const canUse = (capability?: AccountCapability) => {
    const state = client.getQueryState(["saas-capabilities"]);
    const data = client.getQueryData<Record<AccountCapability, boolean> | null>(["saas-capabilities"]);
    return alive.current && current.current.ready &&
      hasCurrentV9Session(client, principal, identity.sessionId) &&
      state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated && !!data &&
      (!capability || data[capability] === true);
  };
  return {
    ready,
    failed: identity.failed || capabilities.isError,
    epoch: current.current.epoch,
    isMounted: () => alive.current,
    canUse,
    isCurrent: (epoch: number, capability?: AccountCapability) => canUse(capability) && epoch === current.current.epoch,
    async read<T>(operation: () => Promise<T>, capability?: AccountCapability): Promise<T> {
      if (!canUse(capability)) throw new Error("Current account access is unresolved");
      const epoch = current.current.epoch;
      const value = await operation();
      if (!canUse(capability) || current.current.epoch !== epoch)
        throw new Error("Account access changed during the read");
      return value;
    },
  };
}
