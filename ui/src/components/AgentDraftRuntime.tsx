import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentAuthoringDraftView } from "@paperclipai/shared";
import { agentAuthoringApi } from "@/api/agent-authoring";
import { useV9AuthoringAuthority } from "@/hooks/useV9AuthoringAuthority";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Button } from "./ui/button";

/** Read the actual Agent's current Original qualification, never a cached or
 * other Agent's success. Configuration remains with the Original save owner. */
export function AgentDraftRuntime({ company, principal, draft, enabled, canUseAuthority, selectedRuntimeBindingId,
  selectionEnabled = false, onSelectRuntime }: {
  company: string; principal: string; draft: AgentAuthoringDraftView; enabled: boolean; canUseAuthority: () => boolean;
  selectedRuntimeBindingId?: string | null; selectionEnabled?: boolean; onSelectRuntime?: (bindingId: string) => void;
}) {
  const authority = useV9AuthoringAuthority(company, principal), client = useQueryClient(), { t } = useTranslation("experience");
  const latest = useRef({ company, principal, draft, enabled, canUseAuthority });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  latest.current = { company, principal, draft, enabled, canUseAuthority };
  const agentId = draft.agentId ?? draft.preparation?.agentId ?? null;
  const current = () => alive.current && authority.canRead() && latest.current.enabled && latest.current.canUseAuthority() &&
    latest.current.company === company && latest.current.principal === principal && latest.current.draft.id === draft.id &&
    latest.current.draft.companyId === company && latest.current.draft.createdByUserId === principal && latest.current.draft.version === draft.version;
  const runtimeKey = ["agent-draft-runtime", company, principal, authority.epoch, draft.id, draft.version];
  const runtime = useQuery({ queryKey: runtimeKey,
    queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error(t("agentRuntime.changed"));
      const value = await agentAuthoringApi.runtime(company, principal, draft.id, signal);
      if (!current() || value.companyId !== company || value.draftId !== draft.id || value.version !== draft.version || value.agentId !== agentId)
        throw new Error(t("agentRuntime.changed"));
      return value;
    }), enabled: enabled && authority.readReady && !!agentId, gcTime: 0, staleTime: 0, retry: false });
  function fresh() {
    const state = client.getQueryState(runtimeKey);
    return current() && state?.status === "success" && state.fetchStatus === "idle" && !state.isInvalidated && state.data === runtime.data;
  }
  if (!agentId) return null;
  if (!enabled || !authority.readReady || !current() || runtime.isPending || runtime.isFetching)
    return <p role="status">{t("agentRuntime.checking")}</p>;
  if (runtime.isError || !runtime.data) return <div className="space-y-3">
    <p role="status">{t("agentRuntime.unavailable")}</p>
    <Button className="min-h-11" variant="outline" onClick={() => { if (current()) void runtime.refetch(); }}>{t("agentRuntime.refresh")}</Button>
  </div>;
  const selected = selectedRuntimeBindingId === undefined ? draft.content?.runtimeBindingId : selectedRuntimeBindingId;
  return <section className="space-y-3" aria-label={t("agentRuntime.title")}>
    <h2 className="text-lg font-semibold">{t("agentRuntime.title")}</h2>
    <p role="status">{t(`agentRuntime.status.${runtime.data.status}`)}</p>
    <p>{t("agentRuntime.boundary")}</p>
    {runtime.data.runtimeQualified && runtime.data.runtimeBindingId && onSelectRuntime ?
      selected === runtime.data.runtimeBindingId ? <p role="status">{t(selected === draft.content?.runtimeBindingId ? "agentRuntime.selected" : "agentRuntime.saveSelection")}</p> :
        <Button className="min-h-11" disabled={!selectionEnabled || !authority.writeReady} onClick={() => {
          if (!selectionEnabled || !authority.canWrite() || !fresh()) return;
          const value = runtime.data;
          if (value?.runtimeQualified && value.runtimeBindingId) onSelectRuntime(value.runtimeBindingId);
        }}>{t("agentRuntime.select")}</Button> : null}
    <Button className="min-h-11" variant="outline" onClick={() => { if (current()) void runtime.refetch(); }}>{t("agentRuntime.refresh")}</Button>
    <Button asChild className="min-h-11" variant="outline"><Link to={`/agents/${agentId}/configuration`}
      onClick={event => { if (!fresh()) event.preventDefault(); }}>{t("agentRuntime.configure")}</Link></Button>
    <p>{t("agentRuntime.configurationBoundary")}</p>
  </section>;
}
