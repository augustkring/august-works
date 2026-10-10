import { useQuery } from "@tanstack/react-query";
import { v9FeatureEnabled, type V9FeatureKey } from "@paperclipai/shared";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
export function useV9FeatureEnabled(feature: V9FeatureKey) {
  const query = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  return {
    enabled: !!query.data && v9FeatureEnabled(query.data, feature),
    query,
  };
}
