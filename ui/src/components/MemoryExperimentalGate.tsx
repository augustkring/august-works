import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@/lib/router";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";

export function MemoryExperimentalGate({ children }: { children: ReactNode }) {
  const {
    data: experimentalSettings,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mx-auto w-full max-w-4xl px-4 py-8 text-sm text-muted-foreground md:px-6"
      >
        Loading Memory availability…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6">
        <div role="alert" className="border-l-2 border-destructive pl-4">
          <p className="font-medium">Memory availability could not be checked</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No Memory state was changed. Retry the settings read.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  if (experimentalSettings?.enableCollectiveMemoryV1 !== true) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
