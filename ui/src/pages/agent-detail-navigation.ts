import { auditSectionHref, type AuditSection } from "./audit/audit-navigation";

import { screenText } from "../i18n/value-labels";

export type AgentDetailView =
  | "overview"
  | "instructions"
  | "skills"
  | "runtime"
  | "secrets"
  | "tools"
  | "channels"
  | "permissions"
  | "api-keys"
  | "revisions"
  | "run-detail";

export type AgentLocalDetailView = Exclude<AgentDetailView, "run-detail">;

export const AGENT_DETAIL_NAVIGATION: ReadonlyArray<{
  readonly label: string;
  items: ReadonlyArray<{ value: AgentLocalDetailView; readonly label: string }>;
}> = [
  {
    get label() { return screenText("agent.nav.Agent"); },
    items: [
      { value: "overview", get label() { return screenText("agent.nav.overview"); } },
      { value: "instructions", get label() { return screenText("agent.nav.instructions"); } },
      { value: "skills", get label() { return screenText("agent.nav.skills"); } },
    ],
  },
  {
    get label() { return screenText("agent.nav.Runtime"); },
    items: [
      { value: "runtime", get label() { return screenText("agent.nav.runtime"); } },
      { value: "secrets", get label() { return screenText("agent.nav.secrets"); } },
      { value: "tools", get label() { return screenText("agent.nav.tools"); } },
      { value: "channels", get label() { return screenText("agent.nav.channels"); } },
    ],
  },
  {
    get label() { return screenText("agent.nav.Governance"); },
    items: [
      { value: "permissions", get label() { return screenText("agent.nav.permissions"); } },
      { value: "api-keys", get label() { return screenText("agent.nav.api-keys"); } },
      { value: "revisions", get label() { return screenText("agent.nav.revisions"); } },
    ],
  },
] as const;

export function parseAgentDetailView(value: string | null): AgentLocalDetailView {
  if (value === "instructions" || value === "prompts") return "instructions";
  if (value === "skills") return "skills";
  if (value === "runtime" || value === "configure" || value === "configuration") return "runtime";
  if (value === "secrets") return "secrets";
  if (value === "tools") return "tools";
  if (value === "channels") return "channels";
  if (value === "permissions" || value === "trust") return "permissions";
  if (value === "api-keys" || value === "keys") return "api-keys";
  if (value === "revisions" || value === "history") return "revisions";
  return "overview";
}

export function agentDetailHref(agentRef: string, view: AgentLocalDetailView = "overview") {
  return `/agents/${agentRef}/${view}`;
}

export function agentLegacyAuditSection(value: string | null): AuditSection | null {
  if (value === "runs") return "runs";
  if (value === "audit" || value === "activity") return "activity";
  if (value === "cost" || value === "costs") return "costs";
  if (value === "budget" || value === "budgets") return "budgets";
  return null;
}

export function agentScopedAuditHref(agentId: string, section: AuditSection) {
  return auditSectionHref(section, {
    mode: section === "activity" ? "agents" : undefined,
    agentId,
  });
}
