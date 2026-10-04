import { Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { v5FeatureEnabled, V5_FEATURES, type V5FeatureKey } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";

export function V5Gate({ feature, children }: { feature: V5FeatureKey; children: ReactNode }) {
  const settings = useQuery({ queryKey: queryKeys.instance.experimentalSettings, queryFn: () => instanceSettingsApi.getExperimental() });
  const { selectedCompanyId } = useCompany();
  if (settings.isPending) return <p role="status" className="p-6 text-muted-foreground">Loading feature settings…</p>;
  if (settings.error) return <p role="alert" className="p-6 text-destructive">{settings.error.message}</p>;
  if (!v5FeatureEnabled(settings.data ?? {}, feature)) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">{V5_FEATURES[feature][0]}</h1><p className="text-muted-foreground">This feature is disabled or a required feature is disabled.</p><Link to="/company/settings/instance/experimental" className="text-primary underline">Review experimental settings</Link></div>;
  if (!selectedCompanyId) return <p className="p-6 text-muted-foreground">Select a company to continue.</p>;
  return <Fragment key={selectedCompanyId}>{children}</Fragment>;
}

export function V5Error({ error }: { error: unknown }) {
  return error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error instanceof Error ? error.message : "The operation could not be completed."}</p> : null;
}
