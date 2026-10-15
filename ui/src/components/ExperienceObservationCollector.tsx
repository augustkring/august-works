import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { experienceObservationDuration, type ExperienceObservation } from "@paperclipai/shared";
import { useLocation } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useStreamlinedUiEnabled } from "../hooks/useStreamlinedUiEnabled";
import { useExperienceObservationPreference } from "../hooks/useExperienceObservationPreference";
import { experienceObservationsApi } from "../api/experience-observations";
import { experienceObservationSurface } from "../lib/experience-observation-surface";
import { queryKeys } from "../lib/queryKeys";

/** Route strings never enter an observation or persistent client storage. */
export function ExperienceObservationCollector() {
  const feature = useV9FeatureEnabled("experience_analytics_v9");
  if (!feature.enabled || !feature.query.isSuccess || feature.query.isFetching) return null;
  return <AdmittedObservationCollector />;
}

function AdmittedObservationCollector() {
  const identity = useV9CurrentAccount(), company = useCompany(), location = useLocation();
  const surface = experienceObservationSurface(location.pathname, company.selectedCompany?.issuePrefix);
  if (!identity.settled || !identity.userId || identity.localImplicit || !company.selectedCompanyId || !surface) return null;
  return <ObservationScope key={`${company.selectedCompanyId}:${identity.userId}:${identity.authorityEpoch}`}
    company={company.selectedCompanyId} principal={identity.userId} surface={surface} navigation={location.key} />;
}

export function ObservationScope({ company, principal, surface, navigation, step = null }: {
  company: string; principal: string; surface: ExperienceObservation["surface"]; navigation: string; step?: ExperienceObservation["step"];
}) {
  const client = useQueryClient(), feature = useV9FeatureEnabled("experience_analytics_v9"), variant = useStreamlinedUiEnabled();
  const { authority, query, key } = useExperienceObservationPreference(company, principal);
  const version = query.data?.version;
  const ready = authority.readReady && query.isSuccess && !query.isFetching &&
    query.data.enabled && query.data.collectionAvailable && feature.enabled && !feature.query.isFetching && variant.loaded;
  useEffect(() => {
    if (!ready || !version) return;
    let alive = true, visibleSince: number | null = null;
    const admitted = () => {
      const state = client.getQueryState(key), flags = client.getQueryState(queryKeys.instance.experimentalSettings);
      return alive && authority.canRead() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated &&
        flags?.status === "success" && flags.fetchStatus === "idle" && !flags.isInvalidated;
    };
    const emit = (kind: ExperienceObservation["kind"], durationBucket: ExperienceObservation["durationBucket"]) => {
      if (!admitted()) return;
      // C0 observation: a failure drops this sample. No retry, toast, task or
      // provider action is produced and no content is retained for later send.
      void experienceObservationsApi.record(company, principal, { requestId: crypto.randomUUID(), preferenceVersion: version,
        kind, surface, variant: variant.enabled ? "streamlined" : "classic", step: kind === "activation_step_opened" ? step : null, durationBucket }).catch(() => {});
    };
    const finish = () => {
      if (visibleSince === null) return;
      const elapsed = performance.now() - visibleSince; visibleSince = null;
      emit("active_view_interval", experienceObservationDuration(Math.max(0, elapsed)));
    };
    const visibility = () => {
      if (document.visibilityState === "visible") visibleSince ??= performance.now();
      else finish();
    };
    if (document.visibilityState === "visible") { emit(step ? "activation_step_opened" : "surface_opened", null); visibility(); }
    document.addEventListener("visibilitychange", visibility);
    return () => { finish(); alive = false; document.removeEventListener("visibilitychange", visibility); };
  }, [ready, version, company, principal, surface, navigation, authority.epoch, variant.enabled, client, step]);
  return null;
}
