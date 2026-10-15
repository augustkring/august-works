import { useQuery } from "@tanstack/react-query";
import { useV9PrivateReadAuthority } from "./useV9PrivateReadAuthority";
import { experienceObservationsApi } from "../api/experience-observations";

export function useExperienceObservationPreference(company: string, principal: string) {
  const authority = useV9PrivateReadAuthority(principal);
  const key = ["experience-observation-preference", company, principal, authority.epoch] as const;
  const query = useQuery({ queryKey: key, enabled: !!company && !!principal && authority.readReady,
    retry: false, gcTime: 0, staleTime: 0,
    queryFn: ({ signal }) => authority.read(() => experienceObservationsApi.get(company, principal, signal)),
  });
  return { authority, query, key };
}
