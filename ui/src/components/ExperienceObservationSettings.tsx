import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ExperienceObservationPreferenceCommand } from "@paperclipai/shared";
import { experienceObservationsApi } from "../api/experience-observations";
import { useExperienceObservationPreference } from "../hooks/useExperienceObservationPreference";
import { Button } from "./ui/button";

export function ExperienceObservationSettings({ companyId, principal }: { companyId: string; principal: string }) {
  const { t } = useTranslation("experience"), client = useQueryClient();
  const { authority, query, key } = useExperienceObservationPreference(companyId, principal);
  const attempt = useRef<ExperienceObservationPreferenceCommand | null>(null), serial = useRef(0);
  const [pending, setPending] = useState(false), [unknown, setUnknown] = useState(false);
  const [erased, setErased] = useState(false);
  const current = () => {
    const state = client.getQueryState(key);
    return authority.canRead() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated;
  };
  async function check() {
    const token = ++serial.current; setPending(true);
    try {
      const result = await query.refetch({ throwOnError: true });
      if (!authority.canRead() || token !== serial.current || !result.data) return;
      if (attempt.current && result.data.lastRequestId === attempt.current.requestId) {
        setErased(!result.data.enabled); attempt.current = null; setUnknown(false);
      }
    } catch { if (authority.canRead() && token === serial.current) setUnknown(true); }
    finally { if (authority.canRead() && token === serial.current) setPending(false); }
  }
  async function save(enabled: boolean) {
    if (!authority.canRead() || enabled && (!current() || !query.data?.collectionAvailable || pending || unknown)) return;
    const token = ++serial.current;
    // A fresh explicit withdrawal supersedes an uncertain opt-in. Its new key
    // never replays or changes the body of that earlier command.
    const input = Object.freeze({ requestId: crypto.randomUUID(), enabled, expectedVersion: enabled ? query.data!.version : null });
    attempt.current = input; setPending(true); setUnknown(false); setErased(false);
    // Close the client collection fence immediately, even if the withdrawal reply is lost.
    void client.invalidateQueries({ queryKey: ["experience-observation-preference", companyId, principal], refetchType: "none" });
    try {
      const receipt = await authority.write(() => experienceObservationsApi.update(companyId, principal, input));
      if (!authority.confirmed(receipt) || token !== serial.current) return;
      // An immutable historical receipt cannot grant present collection.
      attempt.current = null;
      setErased(!enabled);
      await client.invalidateQueries({ queryKey: ["experience-observation-preference", companyId, principal] });
    } catch { if (authority.canRead() && token === serial.current) setUnknown(true); }
    finally { if (authority.canRead() && token === serial.current) setPending(false); }
  }
  const visible = authority.readReady && query.isSuccess && !query.isFetching && current();
  return <section className="saas-section" aria-label={t("observations.heading")}>
    <h2 className="saas-subtitle">{t("observations.heading")}</h2>
    <p>{t("observations.disclosure")}</p>
    {!visible ? <p role={query.isError ? "alert" : "status"}>{t(query.isError ? "observations.failed" : "observations.loading")}</p> :
      <p role="status">{t(query.data.enabled && query.data.collectionAvailable ? "observations.on" : "observations.off")}</p>}
    {unknown && <p role="alert">{t("observations.unknown")}</p>}
    {erased && <p role="status">{t("observations.erased")}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" className="min-h-11" disabled={!authority.readReady} onClick={() => { void save(false); }}>{t("observations.withdraw")}</Button>
      <Button variant="outline" className="min-h-11" disabled={!authority.readReady || pending} onClick={() => { void check(); }}>{t("observations.check")}</Button>
      {visible && !query.data.enabled && query.data.collectionAvailable && <Button className="min-h-11" disabled={pending || unknown} onClick={() => { void save(true); }}>{t("observations.enable")}</Button>}
    </div>
  </section>;
}
