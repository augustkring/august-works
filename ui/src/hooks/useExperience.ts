import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountIdentity } from "../api/companies-query";
import { experienceApi, experienceQueryKey } from "../api/experience";
import { queryKeys } from "../lib/queryKeys";
export function useExperience(companyId: string | null) {
  const client = useQueryClient();
  const identity = useAccountIdentity();
  const principal = identity.localImplicit ? "local-board" : identity.userId;
  const query = useQuery({
    queryKey: experienceQueryKey(companyId ?? "", principal ?? "unresolved"),
    queryFn: ({ signal }) => experienceApi.home(companyId!, principal!, signal),
    enabled: !!companyId && identity.settled && !!principal,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const retry = async () => {
    if (!identity.settled || !principal) {
      await client.refetchQueries({ queryKey: queryKeys.auth.session });
      return;
    }
    await query.refetch();
  };
  return { query, identity, retry };
}
