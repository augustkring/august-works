import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { conversationAuthoringKey, getConversationAuthoring } from "@/api/conversation-authoring";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { ConversationWorkflowPreview } from "./ConversationWorkflowPreview";
import { NotificationProposalReview } from "./NotificationProposalReview";
import { Button } from "./ui/button";

/** Current references to actual saved proposals. The domain editor owns its
 * full preview/diff and every publish or approval action. */
export function ConversationAuthoringProposals({ company, principal, conversation, agent, generation }: {
  company: string; principal: string; conversation: string; agent: string; generation: number;
}) {
  const { t } = useTranslation("experience"), authority = useV9PrivateReadAuthority(principal), client = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const [sourceEpoch, setSourceEpoch] = useState(0), source = useRef(0);
  const scope = useRef({ company, principal, conversation, agent, generation, selectedCompanyId });
  scope.current = { company, principal, conversation, agent, generation, selectedCompanyId };
  const prefix = conversationAuthoringKey(company, principal, conversation, generation);
  const key = [...prefix, agent, authority.epoch, sourceEpoch];
  const current = () => authority.canRead() && scope.current.company === company && scope.current.principal === principal &&
    scope.current.conversation === conversation && scope.current.agent === agent && scope.current.generation === generation &&
    scope.current.selectedCompanyId === company && source.current === sourceEpoch;
  const query = useQuery({ queryKey: key, enabled: authority.readReady && selectedCompanyId === company,
    retry: false, gcTime: 0, staleTime: 0, queryFn: ({ signal }) => authority.read(async () => {
      if (!current()) throw new Error("Conversation authoring scope changed");
      const result = await getConversationAuthoring(company, principal, conversation, agent, generation, signal);
      if (!current()) throw new Error("Conversation authoring scope changed"); return result;
    }) });
  useCompanyLiveEvent(event => {
    if (event.companyId !== company) return;
    const action = typeof event.payload.action === "string" ? event.payload.action : "";
    const conversationChanged = event.payload.entityType === "issue" && event.payload.entityId === conversation;
    const authoringRunChanged = event.payload.agentId === agent && /heartbeat|tool_invocation/.test(`${event.type}:${action}`);
    if (/agent_configuration|package|notification|workflow|routine|foundation|document|issue|permission|membership|erased|deleted|withdraw|conversation/i.test(`${event.payload.entityType}:${action}`) ||
      event.type === "analytical.context.access_lost" || conversationChanged || authoringRunChanged) {
      source.current++; setSourceEpoch(source.current);
      void client.cancelQueries({ queryKey: prefix });
      void client.invalidateQueries({ queryKey: prefix, refetchType: "none" });
    }
  });
  const state = client.getQueryState(key), fresh = current() && query.isSuccess && !query.isFetching && !state?.isInvalidated;
  if (!current()) return null;
  return <section className="space-y-3 rounded-md border p-4" aria-label={t("conversationAuthoring.title")}>
    <h2 className="text-lg font-semibold">{t("conversationAuthoring.title")}</h2>
    <p>{t("conversationAuthoring.boundary")}</p>
    {query.isError ? <div className="space-y-2"><p role="status">{t("conversationAuthoring.unavailable")}</p>
      <Button variant="outline" className="min-h-11" onClick={() => { if (current()) void query.refetch(); }}>{t("tryAgain")}</Button></div>
      : !fresh ? <p role="status">{t("conversationAuthoring.checking")}</p>
      : query.data.proposals.length === 0 && !query.data.savedTasks?.length && !query.data.savedRoutines?.length && !query.data.savedFoundationProposals?.length && !query.data.savedNotificationProposals?.length && !query.data.savedAgentDrafts?.length ? <p role="status">{t(
        query.data.savedTasks === undefined || query.data.savedRoutines === undefined || query.data.savedFoundationProposals === undefined || query.data.savedNotificationProposals === undefined || query.data.savedAgentDrafts === undefined ? "conversationAuthoring.workflowEmpty" : "conversationAuthoring.empty")}</p>
      : <ul className="space-y-3">{query.data.proposals.map(proposal => <li key={proposal.id} className="space-y-2 rounded-md border p-3">
        <h3 className="font-semibold">{proposal.name}</h3>
        <p>{t("conversationAuthoring.version", { version: proposal.authoredRevisionNumber, steps: proposal.stepCount, triggers: proposal.triggerCount })}</p>
        <p role="status">{t(`conversationAuthoring.state.${proposal.state}`)}</p>
        <ConversationWorkflowPreview proposal={proposal} />
        <Link className="inline-flex min-h-11 items-center underline" to={proposal.href}>{t("conversationAuthoring.review")}</Link>
      </li>)}</ul>}
    {fresh && query.data.hasMore && <p role="status">{t("conversationAuthoring.more")}</p>}
    {fresh && query.data.savedTasks === undefined && <p role="status">{t("conversationAuthoring.taskCoverageUnavailable")}</p>}
    {fresh && !!query.data.savedTasks?.length && <div className="space-y-3">
      <h3 className="font-semibold">{t("conversationAuthoring.tasksTitle")}</h3>
      <ul className="space-y-3">{query.data.savedTasks.map(task => <li key={task.id} className="space-y-2 rounded-md border p-3">
        <h4 className="font-semibold">{task.title}{task.titleTruncated && "…"}</h4>
        <p>{t(`conversationAuthoring.taskStatus.${task.status}`)}</p>
        <p>{t(task.executionStarted ? "conversationAuthoring.taskExecutionRecorded" : "conversationAuthoring.taskExecutionNotRecorded")}</p>
        <Link className="inline-flex min-h-11 items-center underline" to={task.href}>{t("conversationAuthoring.reviewTask")}</Link>
      </li>)}</ul>
    </div>}
    {fresh && query.data.hasMoreTasks && <p role="status">{t("conversationAuthoring.moreTasks")}</p>}
    {fresh && query.data.savedRoutines === undefined && <p role="status">{t("conversationAuthoring.routineCoverageUnavailable")}</p>}
    {fresh && !!query.data.savedRoutines?.length && <div className="space-y-3">
      <h3 className="font-semibold">{t("conversationAuthoring.routinesTitle")}</h3>
      <ul className="space-y-3">{query.data.savedRoutines.map(routine => <li key={routine.id} className="space-y-2 rounded-md border p-3">
        <h4 className="font-semibold">{routine.title}</h4>
        <p>{t("conversationAuthoring.routineVersion", { authored: routine.authoredRevisionNumber, current: routine.currentRevisionNumber })}</p>
        <p>{t(!routine.executionConfigured ? "conversationAuthoring.routineUnconfigured" : `conversationAuthoring.routineStatus.${routine.status}`)}</p>
        <p>{t("conversationAuthoring.routineTriggers", { total: routine.triggerCount, enabled: routine.enabledTriggerCount })}</p>
        {routine.currentRevisionId !== routine.authoredRevisionId && <p>{t("conversationAuthoring.routineChanged")}</p>}
        <Link className="inline-flex min-h-11 items-center underline" to={routine.href}>{t("conversationAuthoring.reviewRoutine")}</Link>
      </li>)}</ul>
    </div>}
    {fresh && query.data.hasMoreRoutines && <p role="status">{t("conversationAuthoring.moreRoutines")}</p>}
    {fresh && query.data.savedFoundationProposals === undefined && <p role="status">{t("conversationAuthoring.foundationCoverageUnavailable")}</p>}
    {fresh && !!query.data.savedFoundationProposals?.length && <div className="space-y-3">
      <h3 className="font-semibold">{t("conversationAuthoring.foundationTitle")}</h3>
      <ul className="space-y-3">{query.data.savedFoundationProposals.map(proposal=><li key={proposal.id} className="space-y-2 rounded-md border p-3">
        <h4 className="font-semibold">{proposal.title}</h4>
        <p role="status">{t(`conversationAuthoring.foundationStatus.${proposal.status}`)}</p>
        {proposal.baseRevisionId!==proposal.currentRevisionId&&<p>{t("conversationAuthoring.foundationChanged")}</p>}
        <Link className="inline-flex min-h-11 items-center underline" to={proposal.href}>{t("conversationAuthoring.reviewFoundation")}</Link>
      </li>)}</ul>
    </div>}
    {fresh && query.data.hasMoreFoundationProposals && <p role="status">{t("conversationAuthoring.moreFoundationProposals")}</p>}
    {fresh&&query.data.savedNotificationProposals===undefined&&<p role="status">{t("notificationProposal.coverageUnavailable")}</p>}
    {fresh&&!!query.data.savedNotificationProposals?.length&&<div className="space-y-3">
      <h3 className="font-semibold">{t("notificationProposal.title")}</h3>
      <ul className="space-y-3">{query.data.savedNotificationProposals.map(proposal=><li key={proposal.id} className="space-y-2 rounded-md border p-3">
        <h4 className="font-semibold">{t(`notifications.category.${proposal.category}`)}</h4>
        <p>{t(`notificationProposal.status.${proposal.status}`)}</p>
        <NotificationProposalReview company={company} principal={principal} id={proposal.id}/>
      </li>)}</ul>
    </div>}
    {fresh&&query.data.hasMoreNotificationProposals&&<p role="status">{t("notificationProposal.more")}</p>}
    {fresh && query.data.savedAgentDrafts === undefined && <p role="status">{t("conversationAuthoring.agentCoverageUnavailable")}</p>}
    {fresh && !!query.data.savedAgentDrafts?.length && <div className="space-y-3">
      <h3 className="font-semibold">{t("conversationAuthoring.agentDraftsTitle")}</h3>
      <p>{t("conversationAuthoring.agentDraftBoundary")}</p>
      <ul className="space-y-3">{query.data.savedAgentDrafts.map(draft => <li key={draft.id} className="space-y-2 rounded-md border p-3">
        <h4 className="font-semibold">{t(draft.setupKind === "hire" ? "conversationAuthoring.packageSetup" : "conversationAuthoring.customSetup")}</h4>
        <p>{t("conversationAuthoring.agentDraftVersion", { version: draft.version })}</p>
        <p role="status">{t(draft.status === "discarded" ? "conversationAuthoring.agentDraftDiscarded" : "conversationAuthoring.agentDraftSaved")}</p>
        <Link className="inline-flex min-h-11 items-center underline" to={draft.href}>{t("conversationAuthoring.reviewAgentDraft")}</Link>
      </li>)}</ul>
    </div>}
    {fresh && query.data.hasMoreAgentDrafts && <p role="status">{t("conversationAuthoring.moreAgentDrafts")}</p>}
  </section>;
}
