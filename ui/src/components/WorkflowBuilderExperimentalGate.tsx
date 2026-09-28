import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@/lib/router";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";

export function WorkflowBuilderExperimentalGate({
  children,
}: {
  children: ReactNode;
}) {
  const { data: experimentalSettings, isFetched } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  if (!isFetched) return null;
  if (
    experimentalSettings?.enableWorkflowsV1 !== true ||
    experimentalSettings?.enableWorkflowBuilderV1 !== true
  ) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
