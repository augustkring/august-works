import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { v8FeatureEnabled, type V8FeatureKey } from "@paperclipai/shared";
import { Navigate } from "@/lib/router";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
export function V8FeatureGate({ feature, children }: { feature: V8FeatureKey; children: ReactNode }) {
  const query = useQuery({ queryKey: queryKeys.instance.experimentalSettings, queryFn: () => instanceSettingsApi.getExperimental() });
  if (query.isError) return <div role="alert" className="space-y-4"><p>Availability could not be loaded.</p><Button onClick={() => void query.refetch()}>Try again</Button></div>;
  if (!query.data) return <p role="status">Loading…</p>;
  if (!v8FeatureEnabled(query.data, feature)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
