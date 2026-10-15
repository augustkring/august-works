import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9PrivateReadAuthority } from "./useV9PrivateReadAuthority";
import { experienceObservationsApi } from "../api/experience-observations";

export function useExperienceObservationPreference(company: string, principal: string) {
  const client = useQueryClient();
  const authority = useV9PrivateReadAuthority(principal);
  const key = ["experience-observation-preference", company, principal, authority.epoch] as const;
  const query = useQuery({ queryKey: key, enabled: !!company && !!principal && authority.readReady,
    retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(() => experienceObservationsApi.get(company, principal, signal)),
  });
  useCompanyLiveEvent(event => {
    if (event.companyId !== company || event.type !== "activity.logged") return;
    const ownChoiceChanged = event.payload.action === "experience_observation_preference.updated" &&
      event.payload.actorId === principal;
    const authorityChanged = ["user", "company_membership", "principal_permission_grant"].includes(String(event.payload.entityType));
    if (ownChoiceChanged || authorityChanged)
      // Reset clears the collection fence synchronously, before the following
      // React render. The event conveys no consent value and grants no access.
      void client.resetQueries({ queryKey: ["experience-observation-preference", company, principal] });
  });
  return { authority, query, key };
}
