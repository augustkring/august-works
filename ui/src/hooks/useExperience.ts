import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccountIdentity } from "../api/companies-query";
import { experienceApi, experienceQueryKey } from "../api/experience";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { queryKeys } from "../lib/queryKeys";
export function useExperience(companyId: string | null) {
  const client = useQueryClient();
  const identity = useAccountIdentity();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const scope = `${companyId ?? ""}:${principal ?? "unresolved"}`;
  const [revision, setRevision] = useState({ scope, epoch: 0 });
  const epoch = revision.scope === scope ? revision.epoch : 0;
  const prefix = experienceQueryKey(companyId ?? "", principal ?? "unresolved");
  const query = useQuery({
    queryKey: [...prefix, epoch],
    queryFn: ({ signal }) => experienceApi.home(companyId!, principal!, signal),
    enabled: !!companyId && identity.settled && !!principal,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useCompanyLiveEvent((event) => {
    if (!companyId || event.companyId !== companyId) return;
    const action =
      typeof event.payload.action === "string" ? event.payload.action : "";
    if (
      event.type !== "analytical.context.access_lost" &&
      !(
        event.type === "activity.logged" &&
        (/permission|membership|privacy|erased|deleted|withdraw|experimental|instance_settings/i.test(
          action,
        ) ||
          event.payload.entityType === "company_membership")
      )
    )
      return;
    // A cancelled transport may still settle. Separate epochs prevent an old
    // receipt from restoring titles/actions after a native access-loss event.
    setRevision((previous) => ({
      scope,
      epoch: (previous.scope === scope ? previous.epoch : 0) + 1,
    }));
    void client.cancelQueries({ queryKey: prefix });
    client.removeQueries({ queryKey: prefix });
  });
  const retry = async () => {
    if (!identity.settled || !principal) {
      await client.refetchQueries({ queryKey: queryKeys.auth.session });
      return;
    }
    await query.refetch();
  };
  const loading =
    !identity.settled || !principal || query.isPending || query.isFetching;
  return { query, identity, retry, loading, scope };
}
