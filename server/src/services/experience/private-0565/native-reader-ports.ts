/** PRIVATE Resource 0565 native-reader integration seam. Domain implementations
 * must live with their owning services; this registry only composes them. */
import type { AuthorizationActor } from "../../authorization.js";
import type { CurrentNativeResponsibility, NativeResponsibilityReader } from "./authorized-subset-reader.js";
import type { ResponsibilityScanKind } from "./responsibility-scan.js";

export type ResponsibilityReadPort = (actor: AuthorizationActor, companyId: string, resourceId: string) => Promise<CurrentNativeResponsibility>;
/** Native service-owned checks. Each implementation receives the actual viewer
 * actor and must return `hidden` before exposing any row-derived signal when its
 * current owner service denies that viewer. `covered...` may be true only
 * after validating canonical owner/default or a pre-existing native group; it
 * is never inferred from these provenance fields. */
export interface NativeResponsibilityReadPorts {
  /** Agent has no Human owner field: only an active, configured company default
   * with current `agents:configure` authority can cover it. */
  agent: ResponsibilityReadPort;
  /** Follow `aiUseCaseId` to its current AI Use Case owner; never use installer. */
  deployment: ResponsibilityReadPort;
  /** Call `workflowService.getDetail` under the real viewer, including complete
   * authoring-source proof; fallback must also pass source-owner checks. */
  workflow: ResponsibilityReadPort;
  /** Per-run `responsibleUserId` plus current visible workflow/revision sources. */
  workflow_run: ResponsibilityReadPort;
  /** `routineService.get` with the actual viewer; canonical responsible user. */
  routine: ResponsibilityReadPort;
  /** `toolAccessService.getConnection` plus exact creator/manager/active grant
   * read policy; owner is the Human/Agent application owner, never credential subject. */
  connector: ResponsibilityReadPort;
  /** Current published definition plus metric population/source authority;
   * `createdBy` remains provenance. */
  metric: ResponsibilityReadPort;
  /** Current experiment version/lineage/source checks; `createdBy` remains provenance. */
  experiment: ResponsibilityReadPort;
  /** Current decision queue read plus linked Issue `issue:read`; resolve only
   * via the Issue's actual `responsibleUserId`, not decider or assignee. */
  decision: ResponsibilityReadPort;
  /** Current approval read and admitted responder policy for each linked Issue;
   * never infer a responder from requester/decider/default. */
  approval: ResponsibilityReadPort;
  /** Current governance `get`, owner/default membership and governance action authority. */
  ai_use_case: ResponsibilityReadPort;
  /** Current tool profile policy access boundary; creator is provenance. */
  tool_policy: ResponsibilityReadPort;
  /** Native company skill-policy getter plus `skill_config:update` boundary. */
  skill_policy: ResponsibilityReadPort;
  /** Native active billing-account join; payer plus `billing:view`/`billing:manage`. */
  billing: ResponsibilityReadPort;
  /** Native authenticated customer getter. The case opener is not elevated to
   * a Support responder; coverage must come from a configured responder group. */
  support_case: ResponsibilityReadPort;
  /** Optional company security contact, visible only to current company access managers. */
  security_contact: ResponsibilityReadPort;
  /** Optional tenant support/incident contact; distinct from a Platform responder. */
  support_incident_contact: ResponsibilityReadPort;
}

const destinations: Record<ResponsibilityScanKind, { title: string; href: string }> = {
  agent: { title: "Co-worker", href: "/agents" },
  deployment: { title: "Agent Package deployment", href: "/agents" },
  workflow: { title: "Workflow", href: "/workflows" },
  workflow_run: { title: "Workflow run", href: "/workflows" },
  routine: { title: "Routine", href: "/company/settings/members" },
  connector: { title: "Critical connector", href: "/apps" },
  metric: { title: "Governed metric", href: "/business-metrics" },
  experiment: { title: "Experiment", href: "/business-experiments" },
  decision: { title: "Material decision", href: "/decisions" },
  approval: { title: "Pending approval", href: "/approvals" },
  ai_use_case: { title: "AI Use Case", href: "/governance/ai-use-cases" },
  tool_policy: { title: "Tool policy", href: "/settings/agent-permissions" },
  skill_policy: { title: "Company skill policy", href: "/company/settings/skills" },
  billing: { title: "Billing responsibility", href: "/settings/billing" },
  support_case: { title: "Support response", href: "/support" },
  security_contact: { title: "Security contact", href: "/company/settings/general" },
  support_incident_contact: { title: "Support and incident contact", href: "/company/settings/general" },
};

/** Exact supported kind set is checked at construction/read time. */
export function bindNativeResponsibilityReaders(ports: NativeResponsibilityReadPorts): NativeResponsibilityReader[] {
  const kinds = Object.keys(destinations) as ResponsibilityScanKind[];
  if (kinds.some(kind => typeof ports[kind] !== "function")) throw new Error("responsibility_native_reader_set_incomplete");
  return kinds.map(kind => ({
    kind, ...destinations[kind],
    inspectCurrent: (actor, companyId, resourceId) => ports[kind](actor, companyId, resourceId),
  }));
}
