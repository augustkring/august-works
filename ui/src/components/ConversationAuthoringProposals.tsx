import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { useV9PrivateReadAuthority } from "@/hooks/useV9PrivateReadAuthority";
import { conversationAuthoringKey, getConversationAuthoring } from "@/api/conversation-authoring";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { ConversationWorkflowPreview } from "./ConversationWorkflowPreview";
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
    if (/workflow|permission|membership|erased|deleted|withdraw|conversation/i.test(`${event.payload.entityType}:${action}`) ||
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
      : query.data.proposals.length === 0 ? <p role="status">{t("conversationAuthoring.empty")}</p>
      : <ul className="space-y-3">{query.data.proposals.map(proposal => <li key={proposal.id} className="space-y-2 rounded-md border p-3">
        <h3 className="font-semibold">{proposal.name}</h3>
        <p>{t("conversationAuthoring.version", { version: proposal.authoredRevisionNumber, steps: proposal.stepCount, triggers: proposal.triggerCount })}</p>
        <p role="status">{t(`conversationAuthoring.state.${proposal.state}`)}</p>
        <ConversationWorkflowPreview proposal={proposal} />
        <Link className="inline-flex min-h-11 items-center underline" to={proposal.href}>{t("conversationAuthoring.review")}</Link>
      </li>)}</ul>}
    {fresh && query.data.hasMore && <p role="status">{t("conversationAuthoring.more")}</p>}
  </section>;
}
