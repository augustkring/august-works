import { useId } from "react";
import type { AgentAuthoringDraftView } from "@paperclipai/shared";
import type { AgentAuthoringOptions } from "@/api/agent-authoring";
import { useTranslation } from "@/i18n";

const operations = {
  read_approved_knowledge: "customAgent.readKnowledge",
  create_internal_draft: "customAgent.createInternalDrafts",
  create_task: "customAgent.createTasks",
  external_send: "customAgent.sendExternally",
  spend: "customAgent.spendMoney",
  change_permissions: "customAgent.changePermissions",
} as const;
const autonomy = {
  automatic: "customAgent.automatic",
  ask_first: "customAgent.asksBefore",
  not_allowed: "customAgent.notAllowed",
} as const;
const memory = {
  none: "customAgent.noPersonalization",
  approved_work_preferences: "customAgent.rememberPreferences",
  approved_company_knowledge: "customAgent.companyKnowledge",
} as const;
const instructions = {
  purpose: "customAgent.purpose",
  responsibilities: "customAgent.responsibilities",
  prohibited: "customAgent.prohibited",
  missingInformation: "customAgent.missingInformation",
  escalation: "customAgent.escalation",
  communication: "customAgent.communication",
} as const;

/** The parent's current authoring admission owns visibility. Only the saved
 * receipt is reviewed; unresolved resources never reuse names from old scope. */
export function AgentDraftReview({ draft, options, unsavedChanges, baselineCurrent }: {
  draft: AgentAuthoringDraftView;
  options: AgentAuthoringOptions | null;
  unsavedChanges: boolean;
  baselineCurrent: boolean | null;
}) {
  const { t } = useTranslation("experience");
  const heading = useId();
  const content = draft.content;
  if (!content) return null;
  const owner = options?.owners.find(item => item.id === content.ownerUserId);
  const runtime = options?.runtimes.some(item => item.id === content.runtimeBindingId);
  const row = (label: string, value: string) => (
    <div key={label} className="space-y-1">
      <dt className="font-medium">{t(label)}</dt>
      <dd className="whitespace-pre-wrap break-words">{value || t("customAgent.notSet")}</dd>
    </div>
  );
  return (
    <section aria-labelledby={heading} className="space-y-4">
      <h3 id={heading} className="text-lg font-semibold">{t("agentDraftReview.savedVersion", { version: draft.version })}</h3>
      <p>{t("agentDraftReview.proposedSettings")}</p>
      {unsavedChanges && <p role="status">{t("agentDraftReview.unsavedChanges")}</p>}
      {baselineCurrent === false && <p role="status">{t("agentDraftReview.baselineChanged")}</p>}
      <dl className="space-y-4">
        {row("customAgent.responsibility", content.outcome)}
        {row("customAgent.accountableOwner", owner?.name ?? t("hireSetup.ownerUnconfirmed"))}
        {row("customAgent.agentName", content.name)}
        {row("customAgent.customerDescription", content.description)}
        {row("customAgent.internalDescription", content.internalDescription)}
        {Object.entries(instructions).map(([key, label]) => row(label, content.instructions[key as keyof typeof instructions]))}
        <div className="space-y-1">
          <dt className="font-medium">{t("customAgent.sources")}</dt>
          <dd>{content.knowledgeDocumentIds.length ? <ul className="list-disc space-y-2 pl-5">
            {content.knowledgeDocumentIds.map(id => {
              const source = options?.knowledge.find(item => item.id === id);
              return <li key={id}>{source ? t(source.revision ? "customAgent.selectedApprovedSource" : "customAgent.sourceVersion", { title: source.title, sensitivity: source.sensitivity, revision: source.revision }) : t("hireSetup.sourceUnavailable")}</li>;
            })}
          </ul> : t("customAgent.none")}</dd>
        </div>
        {Object.entries(operations).map(([operation, label]) => row(label,
          t(autonomy[content.capabilities.find(item => item.operation === operation)?.autonomy ?? "not_allowed"])))}
        {row("customAgent.stepMemory", t(memory[content.memory]))}
        {!!content.memoryRecordIds?.length && <div className="space-y-1">
          <dt className="font-medium">{t("customAgent.approvedPreferences")}</dt>
          <dd><ul className="list-disc space-y-2 pl-5">{content.memoryRecordIds.map(id => {
            const source = options?.preferences?.find(item => item.id === id);
            return <li key={id}>{source ? t("customAgent.preferenceSource", { title: source.title, sensitivity: source.sensitivity }) : t("hireSetup.sourceUnavailable")}</li>;
          })}</ul></dd>
        </div>}
        {row("customAgent.delegation", t("customAgent.none"))}
        {row("customAgent.runtimeSelection", t(runtime ? "customAgent.currentRuntime" : "agentDraftReview.runtimeUnconfirmed"))}
        {row("customAgent.audience", t("customAgent.inApp"))}
        <div className="space-y-1">
          <dt className="font-medium">{t("customAgent.scenario")}</dt>
          <dd>{content.scenarios.length ? <ol className="list-decimal space-y-2 pl-5">
            {content.scenarios.map((scenario, index) => <li key={index} className="whitespace-pre-wrap break-words">{scenario}</li>)}
          </ol> : t("customAgent.notSet")}</dd>
        </div>
      </dl>
    </section>
  );
}
