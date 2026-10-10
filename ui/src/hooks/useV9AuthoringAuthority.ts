import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v9FeatureEnabled } from "@paperclipai/shared";
import { instanceSettingsApi } from "../api/instanceSettings";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { useV9CurrentAccount } from "./useV9CurrentAccount";

/** Authoring drafts retain their original owners. A cached session or rollout
 * cannot admit a read/write or certify an acknowledgement across a recheck. */
export function useV9AuthoringAuthority(company: string, principal: string) {
  const identity = useV9CurrentAccount();
  // Observe the original settings query without restarting it when a nested
  // saved-setups view mounts. Its owner/focus refresh still fences every scope.
  const flags = useQuery({ queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(), refetchOnMount: false });
  const { selectedCompanyId } = useCompany();
  const client = useQueryClient();
  const readReady = identity.settled && !identity.localImplicit &&
    identity.userId === principal && selectedCompanyId === company &&
    flags.isSuccess && !flags.isFetching;
  const writeReady = readReady && !!flags.data && v9FeatureEnabled(flags.data, "hire_agent_v9");
  const context = useRef({ readReady, writeReady, accountEpoch: identity.authorityEpoch, epoch: 0 });
  if (context.current.readReady !== readReady || context.current.writeReady !== writeReady ||
    context.current.accountEpoch !== identity.authorityEpoch) {
    context.current = { readReady, writeReady, accountEpoch: identity.authorityEpoch,
      epoch: context.current.epoch + 1 };
  }
  const acknowledgements = useRef(new WeakMap<object, { epoch: number; requiresRollout: boolean }>());
  const canRead = () => context.current.readReady &&
    client.getQueryState(queryKeys.auth.session)?.fetchStatus !== "fetching" &&
    client.getQueryState(queryKeys.instance.experimentalSettings)?.fetchStatus !== "fetching";
  const canWrite = () => canRead() && context.current.writeReady;
  async function mutation<T extends object>(operation: () => Promise<T>, requiresRollout: boolean): Promise<T> {
    const admitted = () => requiresRollout ? canWrite() : canRead();
    if (!admitted()) throw new Error("Current authoring access is unresolved");
    const epoch = context.current.epoch;
    const value = await operation();
    if (!admitted() || epoch !== context.current.epoch)
      throw new Error("The authoring request needs current confirmation");
    acknowledgements.current.set(value, { epoch, requiresRollout });
    return value;
  }
  return {
    readReady, writeReady, epoch: context.current.epoch,
    failed: identity.failed || flags.isError,
    canRead, canWrite,
    async read<T>(operation: () => Promise<T>): Promise<T> {
      if (!canRead()) throw new Error("Current authoring access is unresolved");
      const epoch = context.current.epoch;
      const value = await operation();
      if (!canRead() || epoch !== context.current.epoch)
        throw new Error("Authoring access changed during the read");
      return value;
    },
    write: <T extends object>(operation: () => Promise<T>) => mutation(operation, true),
    // The original Native owner permits discarding a private unpublished draft
    // after rollout withdrawal. Current identity/access and epoch still apply.
    discard: <T extends object>(operation: () => Promise<T>) => mutation(operation, false),
    confirmed(value: object) {
      const receipt = acknowledgements.current.get(value);
      return canRead() && receipt?.epoch === context.current.epoch &&
        (!receipt.requiresRollout || canWrite());
    },
  };
}
export type V9AuthoringAuthority = ReturnType<typeof useV9AuthoringAuthority>;
