import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { NewAgentSetup } from "../components/new-agent/NewAgentSetup";
import { useQuery } from "@tanstack/react-query";
import { v9FeatureEnabled } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { CustomAgent } from "./CustomAgent";
import { Button } from "../components/ui/button";

export function NewAgent() {
  const settings = useQuery({queryKey: queryKeys.instance.experimentalSettings, queryFn: () => instanceSettingsApi.getExperimental()});
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([
      { label: "Agents", href: "/agents" },
      { label: "New agent" },
    ]);
  }, [setBreadcrumbs]);
  if (settings.isPending) return <p role="status">Loading agent creation options…</p>;
  if (settings.isError) return <div role="alert"><p>Agent creation options could not be loaded.</p><Button className="min-h-11" onClick={() => void settings.refetch()}>Try again</Button></div>;
  return v9FeatureEnabled(settings.data, "hire_agent_v9") ? <CustomAgent /> : <NewAgentSetup />;
}
