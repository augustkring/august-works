import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowDraftAuthorLocatorSchema } from "@paperclipai/shared";
import { workflowAuthoringExperienceApi } from "../api/workflow-authoring-experience";
import { useCompany } from "../context/CompanyContext";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { useV9FeatureEnabled } from "../hooks/useV9FeatureEnabled";
import { useV9CurrentAccount } from "../hooks/useV9CurrentAccount";
import { useTranslation } from "../i18n";
import { workflowReadSourceChanged } from "../lib/workflow-source-invalidation";
import { applyCompanyPrefix } from "../lib/company-routes";
import { Link, useActiveCompanyPrefix } from "../lib/router";
import { Button } from "./ui/button";

/** Handoff carries only exact Native locators. The normal conversation Send
 * remains the only dispatch; this component never creates a run or a grant. */
export function WorkflowAuthoringHandoff({ company, principal, workflow, agent, expectedRevision, onInsert }: {
  company: string; principal: string; workflow: string; agent?: string; expectedRevision?: string;
  onInsert?: (text: string) => boolean;
}) {
  const { t } = useTranslation("experience"), client = useQueryClient(), { selectedCompanyId } = useCompany();
  const feature = useV9FeatureEnabled("ambient_commands_v9"), identity = useV9CurrentAccount();
  const authority = useV9PrivateReadAuthority(principal), companyPrefix = useActiveCompanyPrefix();
  const reader = useId();
  const source = useRef(0), [epoch, setEpoch] = useState(0), [selected, setSelected] = useState("");
  const [inserted, setInserted] = useState(false), [insertFailed, setInsertFailed] = useState(false);
  // The read closes over this surface's lifetime and current authority. Sharing
  // its in-flight promise with a different mount would borrow that lifetime.
  const prefix = ["workflow-draft-authors", company, principal, workflow], key = [...prefix, reader, authority.epoch, epoch];
  const scope = useRef({ company, principal, workflow, selectedCompanyId, authority });
  scope.current = { company, principal, workflow, selectedCompanyId, authority };
  const current = () => scope.current.company === company && scope.current.principal === principal && scope.current.workflow === workflow &&
    scope.current.selectedCompanyId === company && scope.current.authority.canRead() && source.current === epoch;
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company && feature.enabled && !feature.query.isFetching, retry: false,
    gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Current workflow author selection changed");
      const value = await workflowAuthoringExperienceApi.authors(company, workflow, principal, signal);
      if (!current()) throw new Error("Current workflow author selection changed"); return value;
    }) });
  const fresh = () => current() && feature.enabled && !feature.query.isFetching && query.isSuccess && !query.isFetching &&
    !client.getQueryState(key)?.isInvalidated && client.getQueryState(key)?.fetchStatus === "idle";
  const view = fresh() ? query.data : null;
  useCompanyLiveEvent(event => {
    if (event.companyId !== company || !workflowReadSourceChanged(event)) return;
    source.current++; setEpoch(source.current); setInserted(false); setInsertFailed(false);
    void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix });
  });
  const choice = view?.choices.find(item => item.agentId === (agent ?? selected));
  const stale = !!view && !!expectedRevision && expectedRevision !== view.draftRevisionId;
  const draftHref = `/workflows/${workflow}?revision=draft`;
  function insert() {
    if (!fresh() || !view?.enabled || !choice || stale || inserted || !onInsert) return;
    const locator = workflowDraftAuthorLocatorSchema.parse({ workflowId: workflow, draftRevisionId: view.draftRevisionId });
    const href = applyCompanyPrefix(`${draftHref}&expectedDraftRevisionId=${locator.draftRevisionId}`, companyPrefix);
    // No described outcome, workflow/Agent name or private configuration is
    // copied into browser history or the persistent Native composer draft.
    if (!onInsert(t("workflowAuthoring.request", { href }))) { setInsertFailed(true); return; }
    setInserted(true); setInsertFailed(false);
  }
  if (!feature.enabled) return null;
  if (identity.settled && identity.localImplicit) return <p role="status">{t("workflowIntent.accountRequired")}</p>;
  return <section className="space-y-3" aria-label={t("workflowAuthoring.heading")}>
    <h2 className="text-lg font-semibold">{t("workflowAuthoring.heading")}</h2>
    {authority.failed ? <div role="alert" className="space-y-2"><p>{t("workflowIntent.accountFailed")}</p>
      <Button variant="outline" className="min-h-11" onClick={() => void authority.recheck()}>{t("tryAgain")}</Button></div>
      : !current() || query.isPending || !view && !query.isError ? <p role="status">{t("loading")}</p>
      : query.isError ? <div role="alert" className="space-y-2"><p>{t("workflowAuthoring.failed")}</p>
        <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{t("tryAgain")}</Button></div>
      : stale ? <p role="status">{t("workflowAuthoring.changed")}</p>
      : !view?.enabled || !view.choices.length || agent && !choice ? <p role="status">{t("workflowAuthoring.unavailable")}</p>
      : <>
        <p className="text-sm text-muted-foreground">{t("workflowAuthoring.boundary")}</p>
        {!agent && <div className="space-y-2">
          <label className="block font-medium" htmlFor={`workflow-author-${workflow}`}>{t("workflowAuthoring.choose")}</label>
          <select id={`workflow-author-${workflow}`} value={selected} className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
            onChange={event => setSelected(event.target.value)}>
            <option value="">{t("workflowAuthoring.choosePlaceholder")}</option>
            {view.choices.map(item => <option key={item.agentId} value={item.agentId}>{item.name}</option>)}
          </select>
          <p className="text-sm text-muted-foreground">{t("workflowAuthoring.bounded")}</p>
        </div>}
        <div className="grid grid-cols-2 items-center gap-4">
          <Link className="inline-flex min-h-11 items-center justify-self-start underline" to={draftHref}>{t("workflowAuthoring.openDraft")}</Link>
          {agent ? <Button className="min-h-11 h-auto whitespace-normal justify-self-end" disabled={!choice || inserted}
            onClick={insert}>{t(inserted ? "workflowAuthoring.insertedButton" : "workflowAuthoring.insert")}</Button>
            : choice ? <Link className="inline-flex min-h-11 items-center justify-self-end text-right underline"
              to={`/chats/${choice.agentId}?${new URLSearchParams({ workflowDraft: workflow, draftRevision: view.draftRevisionId })}`}
              onClick={event => { if (!fresh()) event.preventDefault(); }}>{t("workflowAuthoring.openChat")}</Link> : <span />}
        </div>
        {inserted && <p role="status">{t("workflowAuthoring.inserted")}</p>}
        {insertFailed && <p role="alert">{t("workflowAuthoring.insertFailed")}</p>}
      </>}
    {(stale || view && (!view.enabled || !view.choices.length || agent && !choice)) &&
      <Link className="inline-flex min-h-11 items-center underline" to={draftHref}>{t("workflowAuthoring.openDraft")}</Link>}
  </section>;
}
