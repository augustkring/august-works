import { useQuery } from "@tanstack/react-query";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

export function useUserPreferences(expectedUserId?: string | null) {
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
    enabled: expectedUserId === undefined,
  });
  const userId = expectedUserId === undefined ? session.data?.user?.id ?? null : expectedUserId;
  const preferences = useQuery({
    queryKey: queryKeys.auth.preferences(userId),
    queryFn: () => authApi.getPreferences(userId!),
    enabled: !!userId,
    retry: false,
  });
  return { ...preferences, userId, data: preferences.isError ? undefined : preferences.data };
}
