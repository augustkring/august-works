import { nativeSha256 } from "./native-runtime/canonical.js";

export type AgentNativeOperationMode =
  | "DIRECT_AGENT"
  | "PROPOSAL_ONLY"
  | "HUMAN_CONFIRMATION"
  | "HUMAN_ONLY"
  | "OPERATOR_ONLY"
  | "NOT_APPLICABLE";

export interface AgentNativeOperationManifestEntry {
  operationId: string;
  domain: "Tasks" | "Projects" | "Work" | "Agents" | "Apps" | "Insights" | "Decisions" | "Support" | "Skills" | "Workflows" | "Foundation" | "Memory" | "Notifications" | "Co-workers" | "Routines";
  customerJob: string;
  canonicalService: string;
  webSurface: string;
  apiOperation: string;
  toolId: string;
  legacyAliases: readonly string[];
  principalTypes: readonly ("agent" | "human")[];
  experienceProfiles: readonly string[];
  mode: AgentNativeOperationMode;
  criticality: "ordinary" | "material";
  requiredPermissions: readonly string[];
  resourceScope: string;
  approvalPolicy: string;
  idempotency: string;
  expectedVersionOrPrecondition: string;
  postcondition: string;
  recovery: string;
  channelProjection: readonly string[];
  mcpExposed: boolean;
  openclawQualified: boolean;
  tests: readonly string[];
  owner: string;
}

/**
 * Agent-native operation coverage across the existing Tool Gateway and the
 * managed Native Runner. The manifest records existing owners and authority
 * boundaries; it does not grant access or claim that an unqualified runtime
 * is supported.
 */
const AGENT_NATIVE_OPERATION_BASE_MANIFEST: readonly AgentNativeOperationManifestEntry[] = Object.freeze([
  {
    operationId: "blentera.support.intake.status", domain: "Support", customerJob: "Read whether Support intake is currently available.",
    canonicalService: "customerSupportCaseService.intakePolicyFromNative", webSurface: "Help and Support", apiOperation: "Tool Gateway operation",
    toolId: "blentera.support.intake.status", legacyAliases: ["paperclip-self:get_support_intake_status"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Native Agent run", "current represented Human company membership"],
    resourceScope: "Only the published Support intake availability and disclosure policy for the current company.", approvalPolicy: "Read-only; no case content or service incident status is returned.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current running Native run and active represented-Human membership.", postcondition: "Current intake availability and approved disclosure terms, or unavailable.", recovery: "Use direct Human Support when Agent intake is unavailable.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/experience/support-cases.ts",
  },
  {
    operationId: "blentera.task.list_assigned", domain: "Tasks", customerJob: "List Tasks assigned to the current Co-worker.",
    canonicalService: "issueService.list", webSurface: "Issue detail and company Task list", apiOperation: "GET /api/companies/{companyId}/issues",
    toolId: "blentera.task.list_assigned", legacyAliases: ["paperclip-self:list_my_issues"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company/run", "current tool policy"],
    resourceScope: "Current company and current Agent assignment; owner ACL remains authoritative.", approvalPolicy: "Read-only; current owner ACL.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current agent-scoped gateway session.", postcondition: "Bounded list of currently readable assigned Tasks.", recovery: "Refresh current Task state; do not infer missing access.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/issues.ts",
  },
  {
    operationId: "blentera.task.get_context", domain: "Tasks", customerJob: "Read the current Task and plan context.",
    canonicalService: "issueService.getById + issueDocument owner", webSurface: "Issue detail", apiOperation: "GET /api/issues/{issueId}",
    toolId: "blentera.task.get_context", legacyAliases: ["paperclip-self:get_issue_context"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company/run", "current Task ACL", "current tool policy"],
    resourceScope: "One current company Task and its authorized plan metadata.", approvalPolicy: "Read-only; current owner ACL.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current agent-scoped gateway session; Task must remain readable.", postcondition: "Bounded Task context with no unauthorized source fields.", recovery: "Refresh current Task state; do not retry through another identity.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/issues.ts",
  },
  {
    operationId: "blentera.task.create", domain: "Tasks", customerJob: "Create governed follow-up work from the current Task.",
    canonicalService: "PaperclipRunnerToolAuthority.create_task", webSurface: "Task creation", apiOperation: "MCP tools/call",
    toolId: "blentera.task.create", legacyAliases: ["paperclip-self:create_task"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Native Agent run", "current Task/source ACL", "task creation policy", "assignable target Agent"],
    resourceScope: "One current-company Task created as child work or for the current conversation; project, parent, assignment, and status remain subject to the Native Task owner.",
    approvalPolicy: "Existing Tool Gateway policy plus Native Task creation admission and source-capture checks; no broader assignment or material action authority.", idempotency: "Required semantic-operation idempotency key and outer Tool Gateway invocation identity.",
    expectedVersionOrPrecondition: "Current running Native run bound to the current Task and current responsible Human.", postcondition: "One durable Task receipt with current Agent/run attribution; wake delivery is separately reconciled.", recovery: "Reuse the same idempotency key and inspect the owner receipt before retrying.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.task.comment.add", domain: "Work", customerJob: "Add an internal progress comment to the current Task.",
    canonicalService: "PaperclipRunnerToolAuthority.report_progress", webSurface: "Task activity", apiOperation: "MCP tools/call",
    toolId: "blentera.task.comment.add", legacyAliases: ["paperclip-self:report_progress"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Native Agent run", "current Task/source ACL", "current Tool Gateway policy"],
    resourceScope: "One internal progress comment on the Task bound to the current run; it is not an external message.",
    approvalPolicy: "Existing Tool Gateway policy and Task comment owner; external publication requires its separate explicit channel path.", idempotency: "Required semantic-operation idempotency key and outer Tool Gateway invocation identity.",
    expectedVersionOrPrecondition: "Current running Native run and readable/writable current Task.", postcondition: "One durable internal comment attributed to the current Agent and run.", recovery: "Reuse the same idempotency key and inspect the owner receipt before retrying.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.task.assign", domain: "Tasks", customerJob: "Reassign an eligible Task with its current version and owner.",
    canonicalService: "PaperclipRunnerToolAuthority.reassign_task", webSurface: "Task assignment", apiOperation: "MCP tools/call",
    toolId: "blentera.task.assign", legacyAliases: ["paperclip-self:reassign_task"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Task read and write authority", "tasks:assign", "assignable target Agent", "current Task state/version"],
    resourceScope: "One eligible current-company Task other than the active caller Task; conversation, execution, and parent/child restrictions remain enforced by the owner.",
    approvalPolicy: "Existing Tool Gateway policy, canonical reassignment checks, run-stop handoff, and current Task owner authorization.", idempotency: "Required semantic-operation idempotency key and outer Tool Gateway invocation identity.",
    expectedVersionOrPrecondition: "Exact current assignee and Task status version.", postcondition: "Durable ownership handoff and receipt; successor wake is separately reconciled.", recovery: "Refresh the Task and reconcile the original receipt; never retry from stale ownership.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.task.dependencies.replace", domain: "Tasks", customerJob: "Replace the active Task's blocker set.",
    canonicalService: "PaperclipRunnerToolAuthority.set_dependencies", webSurface: "Task dependencies", apiOperation: "MCP tools/call",
    toolId: "blentera.task.dependencies.replace", legacyAliases: ["paperclip-self:set_dependencies"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Task write authority", "readable current dependency targets", "current Tool Gateway policy"],
    resourceScope: "Exact active Task and explicitly named current-company blocker Tasks.",
    approvalPolicy: "Existing Tool Gateway policy, dependency lifecycle validation, and current Task owner authorization.", idempotency: "Required semantic-operation idempotency key and outer Tool Gateway invocation identity.",
    expectedVersionOrPrecondition: "Current active Task and all dependency targets remain valid.", postcondition: "The exact requested blocker set is durable.", recovery: "Re-read blockers and retry only with current targets.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.project.list", domain: "Projects", customerJob: "List current readable Projects in this company.",
    canonicalService: "projectService.listByIds", webSurface: "Projects", apiOperation: "GET /api/companies/{companyId}/projects",
    toolId: "blentera.project.list", legacyAliases: ["paperclip-self:list_projects"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company scope", "project:read", "current Task-source ACL"],
    resourceScope: "Only current, non-archived Projects readable by the current Agent and represented Human.", approvalPolicy: "Read-only; canonical Project and source ACLs remain authoritative.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current verified Agent credential and current represented Human.", postcondition: "Bounded Project summaries with source ACL rechecked in the same read scope.", recovery: "Refresh current Project state; stop on access denial.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/projects.ts",
  },
  {
    operationId: "blentera.project.get_context", domain: "Projects", customerJob: "Read one current Project summary.",
    canonicalService: "projectService.getById", webSurface: "Project overview", apiOperation: "GET /api/projects/{id}",
    toolId: "blentera.project.get_context", legacyAliases: ["paperclip-self:get_project_context"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company scope", "project:read", "current Project and Task-source ACL"],
    resourceScope: "One exact Project in the current company, including private-project and retained-source checks.", approvalPolicy: "Read-only; canonical Project and source ACLs remain authoritative.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current verified Agent credential and current represented Human.", postcondition: "Only the currently readable Project summary is returned.", recovery: "Refresh current Project state; stop on access denial.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/projects.ts",
  },
  {
    operationId: "blentera.project.create", domain: "Projects", customerJob: "Create a governed Project for the current work.",
    canonicalService: "PaperclipRunnerToolAuthority.create_project", webSurface: "Project creation", apiOperation: "MCP tools/call",
    toolId: "blentera.project.create", legacyAliases: ["paperclip-self:create_project"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Native Agent run", "current Task/source ACL", "project creation policy", "repository access when selected"],
    resourceScope: "One current-company Project and the exact workspace, repositories, Goals, and lead selected in the typed request.",
    approvalPolicy: "Existing Tool Gateway policy and Native Project owner; material configuration and external GitHub access keep their original guards.", idempotency: "Required semantic-operation idempotency key and outer Tool Gateway invocation identity.",
    expectedVersionOrPrecondition: "Current running Native run and current Project/repository eligibility.", postcondition: "One durable Project receipt; external repository creation is never implied.", recovery: "Reuse the same idempotency key and inspect the original Project receipt before retrying.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.agent.get_self_context", domain: "Agents", customerJob: "Read the current Co-worker identity and operating state.",
    canonicalService: "agentService.getById", webSurface: "Co-worker detail", apiOperation: "Tool Gateway operation",
    toolId: "blentera.agent.get_self_context", legacyAliases: ["paperclip-self:get_my_agent_context"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent credential", "current represented Human", "current run"],
    resourceScope: "Only the Agent bound to the current verified gateway session.", approvalPolicy: "Read-only; no credentials, configuration, permissions, or other Agents are returned.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current verified Agent session and active run.", postcondition: "A bounded identity/status projection for the current Agent.", recovery: "Refresh current Agent state; stop on identity or run mismatch.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/agents.ts",
  },
  {
    operationId: "blentera.work.get_current_task", domain: "Work", customerJob: "Read the Task attached to the current run.",
    canonicalService: "issueService.getById", webSurface: "Current work", apiOperation: "GET /api/issues/{issueId}",
    toolId: "blentera.work.get_current_task", legacyAliases: ["paperclip-self:get_my_current_work"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent credential", "current represented Human", "current Task ACL"],
    resourceScope: "Only the Task bound to the current verified run.", approvalPolicy: "Read-only; current Task source access is rechecked.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current run, Task assignment, and privacy source binding.", postcondition: "Current Task status and bounded work identity.", recovery: "Refresh the current run and Task; stop on an access change.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/issues.ts",
  },
  {
    operationId: "blentera.work.document.write", domain: "Work", customerJob: "Create or revise a document on the current Task.",
    canonicalService: "PaperclipRunnerToolAuthority.write_document", webSurface: "Task documents", apiOperation: "MCP tools/call",
    toolId: "blentera.work.document.write", legacyAliases: ["paperclip-self:write_document"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Native Agent run", "current Task/source ACL", "current Task document revision"],
    resourceScope: "One revisioned document key on the Task bound to the current run.",
    approvalPolicy: "Existing Tool Gateway policy and canonical Task document owner; optimistic revision and source-capture checks remain authoritative.", idempotency: "Required semantic-operation idempotency key bound to exact document content.",
    expectedVersionOrPrecondition: "Current Task and exact current base revision (null only for a new document).", postcondition: "One durable document revision with Agent/run attribution.", recovery: "Read the current document revision and retry with a new idempotency key only after reconciling the prior receipt.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.work.question.request", domain: "Work", customerJob: "Request structured information or a governed decision on the current Task.",
    canonicalService: "PaperclipRunnerToolAuthority.request_human_input", webSurface: "Task questions and approvals", apiOperation: "MCP tools/call",
    toolId: "blentera.work.question.request", legacyAliases: ["paperclip-self:request_human_input"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway", "blentera_managed_native"], mode: "PROPOSAL_ONLY", criticality: "ordinary",
    requiredPermissions: ["current Native Agent run", "current Task/source ACL", "current interaction policy"],
    resourceScope: "One durable structured interaction bound to the current Task and run.",
    approvalPolicy: "A question is not an approval; resolution follows the original authorized Human or approver contract.", idempotency: "Required semantic-operation idempotency key bound to exact interaction content.",
    expectedVersionOrPrecondition: "Current Task, run identity, interaction target and resolver policy.", postcondition: "One durable pending interaction available through Task/channel surfaces.", recovery: "Reuse the same idempotency key and inspect the stored interaction before retry.",
    channelProjection: ["MCP tools/call"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.apps.list_authorized_tools", domain: "Apps", customerJob: "Discover Apps and connections currently authorized in this session.",
    canonicalService: "Tool Gateway session tool resolution + current connection metadata", webSurface: "Apps and task tool picker", apiOperation: "MCP tools/list",
    toolId: "blentera.apps.list_authorized_tools", legacyAliases: ["paperclip-self:list_authorized_apps"], principalTypes: ["agent"], experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Agent credential", "current session profile and tool policy", "current connection/grant eligibility"],
    resourceScope: "Only descriptors resolved for this exact session; no connection secrets or unrelated company catalog.", approvalPolicy: "Discovery only; execution rechecks grants, policy, and approval on every call.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current session tool profile and active connection state.", postcondition: "A bounded catalog of tools available in this session.", recovery: "Refresh tool discovery; a missing tool is not evidence that an external account is disconnected.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/tool-gateway.ts",
  },
  {
    operationId: "blentera.insight.findings.search", domain: "Insights", customerJob: "Search current, authorized process findings.",
    canonicalService: "processFindingService.search", webSurface: "Insights", apiOperation: "Tool Gateway operation",
    toolId: "blentera.insight.findings.search", legacyAliases: ["paperclip-self:search_process_findings"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current native analytical reader", "current source and privacy boundary"],
    resourceScope: "Only findings whose current analysis run and source lineage remain readable to the current native Agent/Human pair.", approvalPolicy: "Read-only; finding interpretation is not an authorization or operational decision.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current native analytical reader permit and unexpired finding evidence.", postcondition: "Bounded current finding summaries and admitted facts.", recovery: "Stop on source revocation or stale analysis; do not infer missing data.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/services/process-findings.ts"], owner: "server/src/services/process-findings.ts",
  },
  {
    operationId: "blentera.decision.search", domain: "Decisions", customerJob: "Search decisions readable from the current Task scope.",
    canonicalService: "decisionSearchService.search", webSurface: "Decision queue", apiOperation: "Tool Gateway operation",
    toolId: "blentera.decision.search", legacyAliases: ["paperclip-self:search_decisions"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent credential", "decision_queue:read", "read access to every origin and target Task"],
    resourceScope: "Only decisions whose origin and all referenced target Tasks are currently readable.", approvalPolicy: "Read-only; searching cannot decide, execute, or change a Decision.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current Agent/Human identity and Task ACLs.", postcondition: "Bounded authorized Decision matches.", recovery: "Refresh current Task and Decision access; stop on denial.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/decisions.ts",
  },
  {
    operationId: "blentera.support.case.request", domain: "Support", customerJob: "Create a local Support request with bounded safe context for the current Human.",
    canonicalService: "customerSupportCaseService.createFromNative", webSurface: "Help and Support cases", apiOperation: "Tool Gateway operation",
    toolId: "blentera.support.case.request", legacyAliases: ["paperclip-self:create_support_request"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "ordinary",
    requiredPermissions: ["current verified Native Agent run", "current represented Human and company membership", "current Task source ACL", "configured Support intake policy"],
    resourceScope: "One local Support case owned by the current represented Human; only submitted description and schema-whitelisted safe context are stored.",
    approvalPolicy: "Normal Tool Gateway policy applies; external delivery remains separate and is not implied by local case creation.", idempotency: "Required request key and exact content hash.",
    expectedVersionOrPrecondition: "Current running Native run, current Human membership, current Task access, unchanged Support policy revision.",
    postcondition: "Durable local Support case receipt with Agent activity attribution; no external delivery claim.", recovery: "Reconcile the same request key before retrying; use Help as the Human if unavailable.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/experience/support-cases.ts",
  },
  {
    operationId: "blentera.support.case.manage", domain: "Support", customerJob: "Read, reply to, or close an existing Support case.",
    canonicalService: "customerSupportCaseService", webSurface: "Help and Support cases", apiOperation: "Authenticated Human Support API",
    toolId: "Human Support API only", legacyAliases: [], principalTypes: ["human"], experienceProfiles: ["authenticated_human"], mode: "HUMAN_ONLY", criticality: "material",
    requiredPermissions: ["current authenticated Human account", "current company membership", "case ownership or support administration"],
    resourceScope: "The current Human's own cases, or cases within explicit support administration authority.", approvalPolicy: "Human account action is required; Agents cannot read replies or change case state.", idempotency: "Canonical case API request identity.",
    expectedVersionOrPrecondition: "Current Human credential and current case state.", postcondition: "Canonical Support case transition with durable event history.", recovery: "Use Help/Support as the authenticated Human; do not route through an Agent identity.",
    channelProjection: ["Human web/API"], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/experience/support-cases.ts"], owner: "server/src/services/experience/support-cases.ts",
  },
  {
    operationId: "blentera.memory.recall", domain: "Memory", customerJob: "Recall authorized Memory relevant to the current Task.",
    canonicalService: "memoryAgentToolsService.recall", webSurface: "Memory", apiOperation: "Tool Gateway operation",
    toolId: "blentera.memory.recall", legacyAliases: ["paperclip-self:recall"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent credential", "current Human attribution", "current Memory ACL"],
    resourceScope: "Current company, Task, and Memory grants.", approvalPolicy: "Current Memory privacy policy.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current verified Agent credential and responsible Human.", postcondition: "Only currently authorized Memory is returned.", recovery: "Refresh Memory scope; stop on revocation.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/services/context/context-engine-integration.test.ts"], owner: "server/src/services/memory/memory-agent-tools.ts",
  },
  {
    operationId: "blentera.memory.remember", domain: "Memory", customerJob: "Submit a Memory candidate from the current work.",
    canonicalService: "memoryAgentToolsService.remember", webSurface: "Memory", apiOperation: "Tool Gateway operation",
    toolId: "blentera.memory.remember", legacyAliases: ["paperclip-self:remember"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current Agent credential", "current Human attribution", "current source closure", "current Memory policy"],
    resourceScope: "Current company and exact source-supported Memory candidate.", approvalPolicy: "Memory lifecycle and privacy policy; no direct authority expansion.", idempotency: "Required operation idempotency key.",
    expectedVersionOrPrecondition: "Current run, owner ACL, exact source receipt, and non-revoked source set.", postcondition: "A governed Memory result is retained with its exact provenance.", recovery: "Reconcile durable result before retry; stop after source revocation.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/services/context/context-engine-integration.test.ts"], owner: "server/src/services/memory/memory-agent-tools.ts",
  },
  {
    operationId: "blentera.memory.correct", domain: "Memory", customerJob: "Propose a correction to an existing Memory record.",
    canonicalService: "memoryAgentToolsService.correct", webSurface: "Memory", apiOperation: "Tool Gateway operation",
    toolId: "blentera.memory.correct", legacyAliases: ["paperclip-self:correct_memory"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current Agent credential", "current Human attribution", "current Memory ACL"],
    resourceScope: "One current authorized Memory record.", approvalPolicy: "Memory correction lifecycle.", idempotency: "Required operation idempotency key.",
    expectedVersionOrPrecondition: "Exact current Memory version and current source rights.", postcondition: "A correction candidate is retained; canonical Memory changes only through its owner.", recovery: "Refresh the current Memory version before retry.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/services/context/context-engine-integration.test.ts"], owner: "server/src/services/memory/memory-agent-tools.ts",
  },
  {
    operationId: "blentera.memory.share", domain: "Memory", customerJob: "Propose an authorized Memory-sharing change.",
    canonicalService: "memoryAgentToolsService.share", webSurface: "Memory", apiOperation: "Tool Gateway operation",
    toolId: "blentera.memory.share", legacyAliases: ["paperclip-self:share_memory"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "material", requiredPermissions: ["current Agent credential", "current Human attribution", "current source ACL"],
    resourceScope: "Exact Memory record and requested recipient scope.", approvalPolicy: "Sharing policy and current Human decision where required.", idempotency: "Required operation idempotency key.",
    expectedVersionOrPrecondition: "Current Memory version, recipient membership, and sharing policy.", postcondition: "A governed sharing proposal is retained; no unapproved recipient gains access.", recovery: "Recheck recipient and source rights; stop on revocation.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/services/context/context-engine-integration.test.ts"], owner: "server/src/services/memory/memory-agent-tools.ts",
  },
  {
    operationId: "blentera.workflow.draft.create", domain: "Workflows", customerJob: "Create an unpublished Workflow draft.",
    canonicalService: "workflowAuthoringToolsService.create", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.draft.create", legacyAliases: ["paperclip-self:create_workflow"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and policy"],
    resourceScope: "Current company and draft Workflow.", approvalPolicy: "Draft-only; publishing remains a separate human-confirmed action.", idempotency: "Required request idempotency key.",
    expectedVersionOrPrecondition: "Current draft revision.", postcondition: "An inactive draft exists; no Workflow is published or triggered.", recovery: "Read the draft before retrying; never infer publication.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.foundation.change.propose", domain: "Foundation", customerJob: "Propose a change against the exact approved Foundation revision.",
    canonicalService: "foundationAuthoringToolsService.propose", webSurface: "Foundation", apiOperation: "Tool Gateway operation",
    toolId: "blentera.foundation.change.propose", legacyAliases: ["paperclip-self:propose_foundation_change"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current Agent run", "current Foundation revision"],
    resourceScope: "Current company and exact Foundation document/revision.", approvalPolicy: "Human review; proposal cannot publish or approve itself.", idempotency: "Request idempotency key.",
    expectedVersionOrPrecondition: "Exact current Foundation revision.", postcondition: "A proposal is retained for Human review.", recovery: "Refresh the base revision and submit a new proposal if changed.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/v9-foundation-authoring.integration.test.ts"], owner: "server/src/services/foundation-authoring-tools.ts",
  },
  {
    operationId: "blentera.notification.preferences.propose", domain: "Notifications", customerJob: "Propose notification preferences for the current conversation user.",
    canonicalService: "notificationPreferenceProposalService.propose", webSurface: "Notification settings", apiOperation: "Tool Gateway operation",
    toolId: "blentera.notification.preferences.propose", legacyAliases: ["paperclip-self:propose_notification_preferences"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current Agent run", "current represented Human"],
    resourceScope: "Only the current represented Human's preferences.", approvalPolicy: "The Human must explicitly apply; security delivery cannot be disabled.", idempotency: "Request idempotency key.",
    expectedVersionOrPrecondition: "Current conversation identity and preference version.", postcondition: "A proposal is stored; preferences remain unchanged.", recovery: "Read current preferences before resubmitting.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/v9-notification-proposals.integration.test.ts"], owner: "server/src/services/notification-preference-proposals.ts",
  },
  {
    operationId: "blentera.co-worker.capabilities.list", domain: "Co-workers", customerJob: "Discover bounded, current Co-worker capability options.",
    canonicalService: "agentSetupAuthoringToolsService.catalog", webSurface: "Co-worker setup", apiOperation: "Tool Gateway operation",
    toolId: "blentera.co-worker.capabilities.list", legacyAliases: ["paperclip-self:list_agent_setup_capabilities"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "current company catalog access"],
    resourceScope: "Bounded customer catalog for the current company.", approvalPolicy: "Read-only; declarations do not grant effective permissions.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current catalog and conversation identity.", postcondition: "Only bounded current candidate metadata is returned.", recovery: "Refresh the catalog; absence in a bounded page is not proof of global absence.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/v9-agent-setup-conversation.integration.test.ts"], owner: "server/src/services/agent-setup-authoring-tools.ts",
  },
  {
    operationId: "blentera.co-worker.setup.propose", domain: "Co-workers", customerJob: "Propose an unpublished Co-worker setup for the current Human.",
    canonicalService: "agentSetupAuthoringToolsService.create", webSurface: "Co-worker setup", apiOperation: "Tool Gateway operation",
    toolId: "blentera.co-worker.setup.propose", legacyAliases: ["paperclip-self:create_agent_setup_draft"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "material", requiredPermissions: ["current Agent run", "current represented Human", "approved package catalog version"],
    resourceScope: "Current Human's proposal and exact selected catalog version.", approvalPolicy: "Human configuration/review; creates no Agent, installation, runtime or permission.", idempotency: "Request idempotency key.",
    expectedVersionOrPrecondition: "Current conversation identity and exact package version.", postcondition: "An unpublished proposal exists; no capability is activated.", recovery: "Re-read the exact package version and proposal status before retry.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/v9-agent-setup-conversation.integration.test.ts"], owner: "server/src/services/agent-setup-authoring-tools.ts",
  },
  {
    operationId: "blentera.routine.draft.create", domain: "Routines", customerJob: "Create an inactive Routine draft for Human review.",
    canonicalService: "routineAuthoringToolsService.create", webSurface: "Routines", apiOperation: "Tool Gateway operation",
    toolId: "blentera.routine.draft.create", legacyAliases: ["paperclip-self:create_routine_draft"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current Agent run", "current represented Human"],
    resourceScope: "Current company and inactive draft; no execution target or schedule.", approvalPolicy: "Human configures and enables in the canonical editor.", idempotency: "Request idempotency key.",
    expectedVersionOrPrecondition: "Current conversation identity.", postcondition: "Inactive Routine draft exists.", recovery: "Read current draft before retry.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/v9-routine-authoring.integration.test.ts"], owner: "server/src/services/routine-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.trigger.add", domain: "Workflows", customerJob: "Add a trigger to an unpublished Workflow draft.",
    canonicalService: "workflowAuthoringToolsService.addTrigger", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.trigger.add", legacyAliases: ["paperclip-self:add_trigger"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and policy"],
    resourceScope: "One current company Workflow draft.", approvalPolicy: "Draft-only; no published automation effect.", idempotency: "Draft revision precondition.",
    expectedVersionOrPrecondition: "Exact Workflow draft revision.", postcondition: "Draft contains the validated trigger.", recovery: "Refresh draft and reconcile revision conflict.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.step.add", domain: "Workflows", customerJob: "Add a step to an unpublished Workflow draft.",
    canonicalService: "workflowAuthoringToolsService.addStep", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.step.add", legacyAliases: ["paperclip-self:add_step"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and policy"],
    resourceScope: "One current company Workflow draft.", approvalPolicy: "Draft-only; no published automation effect.", idempotency: "Draft revision precondition.",
    expectedVersionOrPrecondition: "Exact Workflow draft revision.", postcondition: "Draft contains the validated step.", recovery: "Refresh draft and reconcile revision conflict.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.step.update", domain: "Workflows", customerJob: "Update a step in an unpublished Workflow draft.",
    canonicalService: "workflowAuthoringToolsService.updateStep", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.step.update", legacyAliases: ["paperclip-self:update_step"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and policy"],
    resourceScope: "One current company Workflow draft.", approvalPolicy: "Draft-only; no published automation effect.", idempotency: "Draft revision precondition.",
    expectedVersionOrPrecondition: "Exact Workflow draft revision.", postcondition: "Draft step matches the validated requested change.", recovery: "Refresh draft and reconcile revision conflict.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.steps.connect", domain: "Workflows", customerJob: "Connect steps in an unpublished Workflow draft.",
    canonicalService: "workflowAuthoringToolsService.connectSteps", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.steps.connect", legacyAliases: ["paperclip-self:connect_steps"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and policy"],
    resourceScope: "One current company Workflow draft.", approvalPolicy: "Draft-only; no published automation effect.", idempotency: "Draft revision precondition.",
    expectedVersionOrPrecondition: "Exact Workflow draft revision.", postcondition: "Validated edge exists only in the draft.", recovery: "Refresh draft and reconcile revision conflict.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.step.remove", domain: "Workflows", customerJob: "Remove a step from an unpublished Workflow draft.",
    canonicalService: "workflowAuthoringToolsService.removeStep", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.step.remove", legacyAliases: ["paperclip-self:remove_step"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and policy"],
    resourceScope: "One current company Workflow draft.", approvalPolicy: "Draft-only; no published automation effect.", idempotency: "Draft revision precondition.",
    expectedVersionOrPrecondition: "Exact Workflow draft revision.", postcondition: "The validated step is absent from the draft.", recovery: "Refresh draft and reconcile revision conflict.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.step.test", domain: "Workflows", customerJob: "Run a safe test of a Workflow draft step.",
    canonicalService: "workflowAuthoringToolsService.testStep", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.step.test", legacyAliases: ["paperclip-self:test_step"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent run", "workflow authoring feature and test policy"],
    resourceScope: "One current company Workflow draft and its bounded test inputs.", approvalPolicy: "Safe workflow-test policy; test is not publication.", idempotency: "Test run idempotency.",
    expectedVersionOrPrecondition: "Exact Workflow draft revision.", postcondition: "A durable validation result is available.", recovery: "Inspect durable test result before retry.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
  {
    operationId: "blentera.workflow.publish.prepare", domain: "Workflows", customerJob: "Prepare the exact Workflow publish request for human review.",
    canonicalService: "workflowAuthoringToolsService.preparePublish", webSurface: "Workflows", apiOperation: "Tool Gateway operation",
    toolId: "blentera.workflow.publish.prepare", legacyAliases: ["paperclip-self:publish_workflow"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "HUMAN_CONFIRMATION", criticality: "material", requiredPermissions: ["current Agent run", "workflow authoring feature and publish policy"],
    resourceScope: "One exact current Workflow draft revision.", approvalPolicy: "Canonical Human publish review; tool does not publish.", idempotency: "Exact revision-bound review request.",
    expectedVersionOrPrecondition: "Exact tested draft revision and current permission.", postcondition: "Human review request is prepared; no publication occurs.", recovery: "Refresh/retest if the draft changes.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/workflows/workflow-authoring-tools.ts",
  },
]);

/**
 * Existing typed operations in the Native Runner control-plane contract. These
 * entries describe only the managed Native profile; they do not advertise MCP
 * or OpenClaw support. Raw API fallbacks are deliberately omitted.
 */
const NATIVE_RUNNER_OPERATION_ENTRIES: readonly AgentNativeOperationManifestEntry[] = [
  {
    operationId: "blentera.native.task.read_context", domain: "Tasks", customerJob: "Read the active Task and its approved plan.",
    canonicalService: "PaperclipRunnerToolAuthority.get_task_context", webSurface: "Task detail", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:get_task_context", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Native run", "current Task/source authorization"],
    resourceScope: "The active Task and its currently authorized plan revision.", approvalPolicy: "Read-only; Task and retained-source ACLs are rechecked.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current bound Task and source closure.", postcondition: "A bounded current Task context.", recovery: "Refresh current Task context; stop if access changed.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-source.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.read_history", domain: "Tasks", customerJob: "Read bounded comments on the active Task.",
    canonicalService: "PaperclipRunnerToolAuthority.get_task_history", webSurface: "Task activity", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:get_task_history", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Native run", "current Task/comment source authorization"],
    resourceScope: "Only bounded current comments on the active Task.", approvalPolicy: "Read-only; each returned comment source is revalidated.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current bound Task and exact comment owner snapshots.", postcondition: "A bounded readable history projection.", recovery: "Stop if a returned comment or Task source is unavailable.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-source.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.search", domain: "Tasks", customerJob: "Find Tasks by text and status in the current company.",
    canonicalService: "issueService.list + issueReadSqlCondition", webSurface: "Task list", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:search_tasks", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Native run", "current Task read authorization"],
    resourceScope: "Tasks in the current company satisfying current reader predicates.", approvalPolicy: "Read-only; unauthorized Tasks are excluded before projection.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current company identity and reader ACL.", postcondition: "A bounded list of readable Task summaries.", recovery: "Refresh the query; do not infer inaccessible Tasks.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.progress", domain: "Work", customerJob: "Record progress on the active Task.",
    canonicalService: "PaperclipRunnerToolAuthority.report_progress", webSurface: "Task activity", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:report_progress", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Native run", "current Task write authorization"],
    resourceScope: "One progress comment on the active Task.", approvalPolicy: "Canonical Task policy and source-write checks apply.", idempotency: "Native mutation receipt and stable request identity.",
    expectedVersionOrPrecondition: "Current Task and active run ownership.", postcondition: "One durable progress entry.", recovery: "Inspect the original mutation receipt before retrying.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.create", domain: "Tasks", customerJob: "Create a governed Task for the requested work.",
    canonicalService: "issueService.create + nativeTaskCreationAdmission", webSurface: "Task creation", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:create_task", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Native run", "current company Task creation policy", "source closure when required"],
    resourceScope: "One current-company Task with canonical project/parent and assignment constraints.", approvalPolicy: "The original Task admission and source-capture owners decide whether creation is allowed.", idempotency: "Required mutation receipt and stable idempotency key.",
    expectedVersionOrPrecondition: "Current run, project/parent policy, and exact output/source capture where required.", postcondition: "A durable Task with its canonical initial plan/source evidence.", recovery: "Reconcile the original receipt before retrying; never create a duplicate Task.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-conversation-frame.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.reassign", domain: "Tasks", customerJob: "Reassign an eligible Task with its current version.",
    canonicalService: "issueService.update + run-dispatch handoff", webSurface: "Task assignment", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:reassign_task", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "material", requiredPermissions: ["current Task write authority", "assignable target Agent", "current status/version"],
    resourceScope: "One eligible current-company Task and one independently assignable Agent.", approvalPolicy: "Canonical reassignment, lease handoff, and any matching approval policy remain authoritative.", idempotency: "Required mutation receipt and stable idempotency key.",
    expectedVersionOrPrecondition: "Current assignee and status version; the caller cannot reassign its own active Task.", postcondition: "Durable assignment handoff with original Task/evidence retained.", recovery: "Reconcile the handoff receipt; do not restart work under stale ownership.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.dependencies.replace", domain: "Tasks", customerJob: "Replace the active Task's blocker set.",
    canonicalService: "issueService dependency owner", webSurface: "Task dependencies", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:set_dependencies", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Task write authority", "readable dependency targets"],
    resourceScope: "The active Task and explicitly named current-company blocker Tasks.", approvalPolicy: "Canonical dependency validation and Task policy apply.", idempotency: "Mutation receipt bound to the requested blocker set.",
    expectedVersionOrPrecondition: "Current Task and all dependency targets remain valid.", postcondition: "The exact requested dependency set is durable.", recovery: "Re-read blockers and retry only with current targets.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.task.question", domain: "Work", customerJob: "Ask for information or a governed approval on the current Task.",
    canonicalService: "issueThreadInteractionService", webSurface: "Task questions and approvals", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:request_human_input", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current Task", "current interaction policy"],
    resourceScope: "One durable interaction bound to the current Task and run.", approvalPolicy: "Question is not approval; resolution uses the original authorized Human/approver contract.", idempotency: "Required interaction idempotency key.",
    expectedVersionOrPrecondition: "Current Task and run identity.", postcondition: "One durable pending interaction visible in the Task/channel surfaces.", recovery: "Reuse the same key and inspect the stored interaction before retrying.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.work_product.register", domain: "Work", customerJob: "Register a verified Task work product for handoff.",
    canonicalService: "PaperclipRunnerToolAuthority.register_deliverable", webSurface: "Task deliverables", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:register_deliverable", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Task write authority", "verified workspace file access"],
    resourceScope: "One bounded current-run artifact and its Task attachment metadata.", approvalPolicy: "Path, size, and workspace checks apply; registering is not proof of external delivery.", idempotency: "Artifact identity and current-run binding.",
    expectedVersionOrPrecondition: "Verified file bytes from the active workspace and current Task.", postcondition: "Durable work product and attachment metadata.", recovery: "Re-read the same artifact before retry; report uncertain delivery separately.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.project.create", domain: "Projects", customerJob: "Create an eligible Project from the current Task or conversation.",
    canonicalService: "createManagedNativeProjectOutput", webSurface: "Project creation", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:create_project", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current accountable Human", "current Task/source graph", "Project creation policy"],
    resourceScope: "One private current-company Project and its server-derived local workspace, when requested.", approvalPolicy: "Exact provider tool-use, dispatch, source graph, idempotency, and current Human checks are mandatory.", idempotency: "Required call identity and durable create receipt.",
    expectedVersionOrPrecondition: "Settled managed output capture; unchanged source graph and current Human membership.", postcondition: "One Project/workspace with exact source and public projection pins.", recovery: "Reconcile the durable create receipt before retrying.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-conversation-frame.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.project.list", domain: "Projects", customerJob: "Inspect current Projects in the company before choosing a destination.",
    canonicalService: "projectService.list", webSurface: "Projects", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:list_projects", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company/project read policy"],
    resourceScope: "Current company Projects only.", approvalPolicy: "Read-only canonical Project visibility.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current company and Project membership/privacy.", postcondition: "Bounded Project list.", recovery: "Refresh before selecting; inaccessible Projects are not inferred.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.project.repositories.list", domain: "Projects", customerJob: "List repositories authorized for Project selection.",
    canonicalService: "Project repository owner", webSurface: "Project repository selector", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:list_project_repositories", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company and repository read policy"],
    resourceScope: "Only repositories authorized for the current company and run.", approvalPolicy: "Read-only; listing does not grant repository access.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current repository catalog and grants.", postcondition: "Bounded authorized repository choices.", recovery: "Stop if a repository is not currently selectable.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.document.list", domain: "Work", customerJob: "List revisioned documents on the active Task.",
    canonicalService: "documentService.listIssueDocuments", webSurface: "Task documents", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:list_documents", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Task/document source authorization"],
    resourceScope: "Documents attached to the active Task.", approvalPolicy: "Read-only; each current revision is revalidated.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current document and retained revision source.", postcondition: "Bounded document metadata.", recovery: "Refresh document state; stop if its revision source is unavailable.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-source.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.document.read", domain: "Work", customerJob: "Read one current revisioned Task document.",
    canonicalService: "documentService.getIssueDocumentByKey", webSurface: "Task documents", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:read_document", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Task/document/revision source authorization"],
    resourceScope: "One exact document on the active Task.", approvalPolicy: "Read-only; source is captured and revalidated before use.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current document revision and complete retained source closure.", postcondition: "Current document body and bounded metadata.", recovery: "Stop on source change or access withdrawal.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-source.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.document.revisions.list", domain: "Work", customerJob: "Read bounded revision history for one Task document.",
    canonicalService: "documentService.listIssueDocumentRevisions", webSurface: "Task document history", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:list_document_revisions", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Task/document/revision source authorization"],
    resourceScope: "Revision history for one exact active-Task document.", approvalPolicy: "Read-only; each revision source is revalidated.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current document and readable revision set.", postcondition: "Bounded revision metadata.", recovery: "Stop if a returned revision is no longer readable.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/native-opencode-managed-source.integration.test.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.document.write", domain: "Work", customerJob: "Create or update a Task document safely.",
    canonicalService: "documentService revision owner", webSurface: "Task documents", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:write_document", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Task/document write authorization"],
    resourceScope: "One document on the active Task.", approvalPolicy: "Optimistic revision safety and canonical Task policy apply.", idempotency: "Required mutation receipt and expected revision.",
    expectedVersionOrPrecondition: "Current document revision and active Task/run.", postcondition: "One durable document revision.", recovery: "Re-read the latest revision and reconcile before retrying.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.agent.list", domain: "Agents", customerJob: "List redacted Agent profiles in the company.",
    canonicalService: "agentService.list", webSurface: "Co-workers", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:list_agents", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company Agent directory policy"],
    resourceScope: "Redacted Agent profiles in the current company.", approvalPolicy: "Read-only; credentials/configuration are omitted.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current company and directory policy.", postcondition: "Bounded Agent profile list.", recovery: "Refresh directory; do not infer hidden profiles.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.agent.get", domain: "Agents", customerJob: "Read one redacted Agent profile in the company.",
    canonicalService: "agentService.getById", webSurface: "Co-worker detail", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:get_agent", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company Agent directory policy"],
    resourceScope: "One current-company Agent.", approvalPolicy: "Read-only; credentials/configuration are omitted.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current company and Agent membership.", postcondition: "Bounded redacted Agent profile.", recovery: "Stop on missing/hidden Agent.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.agent.hire", domain: "Agents", customerJob: "Request a persistent Native Runner teammate for delegated work.",
    canonicalService: "native Runner hire operation", webSurface: "Co-worker setup", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:hire_agent", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "PROPOSAL_ONLY", criticality: "material", requiredPermissions: ["current company Agent administration policy", "current hiring approval policy"],
    resourceScope: "One new teammate reporting to the current Agent; runtime/credentials are server-selected.", approvalPolicy: "Canonical hiring/approval policy; caller cannot choose provider, adapter, environment, or credentials.", idempotency: "Canonical Agent creation identity.",
    expectedVersionOrPrecondition: "Current company and hiring policy.", postcondition: "A persistent teammate or explicit pending approval.", recovery: "Reconcile the Agent or approval receipt before retrying.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.skill.create", domain: "Skills", customerJob: "Create a reusable Skill draft for the company library.",
    canonicalService: "callCreateSkillTool", webSurface: "Skills", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:create_skill", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "PROPOSAL_ONLY", criticality: "ordinary", requiredPermissions: ["current company Skill authoring policy"],
    resourceScope: "One single-file company Skill candidate.", approvalPolicy: "Creation does not assign or authorize the Skill; canonical lifecycle/review remains in force.", idempotency: "Required mutation receipt.",
    expectedVersionOrPrecondition: "Valid Skill name/content and current company library policy.", postcondition: "A durable Skill candidate/card.", recovery: "Reconcile the original Skill receipt before retrying.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.approval.list", domain: "Decisions", customerJob: "List approvals visible in the current company.",
    canonicalService: "approvalService.list", webSurface: "Approvals", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:list_approvals", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current company approval-read policy"],
    resourceScope: "Approvals visible to the current company Agent.", approvalPolicy: "Read-only; visible approval state does not grant decision authority.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current company and approval visibility.", postcondition: "Bounded approval list.", recovery: "Refresh before acting; decision authority is checked separately.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.approval.get", domain: "Decisions", customerJob: "Read one approval without protected data.",
    canonicalService: "approvalService.get", webSurface: "Approval detail", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:get_approval", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current approval-read policy"],
    resourceScope: "One currently visible approval.", approvalPolicy: "Read-only; decision/approval authority is not implied.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current approval visibility.", postcondition: "Bounded approval summary.", recovery: "Stop on missing or revoked approval access.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
  {
    operationId: "blentera.native.approval.get_context", domain: "Decisions", customerJob: "Read an approval and its currently readable Task context.",
    canonicalService: "approvalService + issueReadSqlCondition", webSurface: "Approval context", apiOperation: "Native Runner semantic tool",
    toolId: "paperclip-runner:get_approval_context", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["blentera_managed_native"],
    mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current approval-read policy", "current ACL for linked Tasks"],
    resourceScope: "One approval and only currently readable linked Tasks.", approvalPolicy: "Read-only; context does not approve or resolve the item.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current approval and linked Task access.", postcondition: "Bounded approval plus authorized Task summaries.", recovery: "Stop if a linked Task is no longer readable.",
    channelProjection: [], mcpExposed: false, openclawQualified: false, tests: ["server/src/services/native-runtime/paperclip-runner-tool-authority.ts"], owner: "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
  },
];

export const AGENT_NATIVE_OPERATION_MANIFEST: readonly AgentNativeOperationManifestEntry[] = Object.freeze([
  ...AGENT_NATIVE_OPERATION_BASE_MANIFEST,
  ...NATIVE_RUNNER_OPERATION_ENTRIES,
]);

const byLegacyToolName = new Map<string, AgentNativeOperationManifestEntry>();
const byOperationId = new Map<string, AgentNativeOperationManifestEntry>();
for (const entry of AGENT_NATIVE_OPERATION_MANIFEST) {
  if (byOperationId.has(entry.operationId)) throw new Error("duplicate_agent_native_operation_id");
  byOperationId.set(entry.operationId, entry);
  for (const legacyName of entry.legacyAliases) {
    if (byLegacyToolName.has(legacyName)) throw new Error("duplicate_agent_native_tool_alias");
    byLegacyToolName.set(legacyName, entry);
  }
}

export function agentNativeOperationForLegacyToolName(name: string): AgentNativeOperationManifestEntry | undefined {
  return byLegacyToolName.get(name);
}

export function agentNativeOperationForToolName(name: string): AgentNativeOperationManifestEntry | undefined {
  return byOperationId.get(name) ?? byLegacyToolName.get(name);
}

export function agentNativeOperationManifestHash(): string {
  const entries = AGENT_NATIVE_OPERATION_MANIFEST.map((entry) => ({
    ...entry,
    legacyAliases: [...entry.legacyAliases].sort(),
    principalTypes: [...entry.principalTypes].sort(),
    experienceProfiles: [...entry.experienceProfiles].sort(),
    requiredPermissions: [...entry.requiredPermissions].sort(),
    channelProjection: [...entry.channelProjection].sort(),
    tests: [...entry.tests].sort(),
  })).sort((left, right) =>
    left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0);
  return nativeSha256(entries);
}

export type BlenteraToolContract = Pick<AgentNativeOperationManifestEntry, "toolId" | "operationId" | "legacyAliases"> & {
  displayName: string;
  description: string;
  inputSchema: unknown;
  risk: string;
};

export function blenteraToolCatalogContractHash(catalog: readonly BlenteraToolContract[]): string {
  return nativeSha256(catalog.map((tool) => ({
    ...tool,
    legacyAliases: [...tool.legacyAliases].sort(),
  })).sort((left, right) =>
    left.operationId < right.operationId ? -1 : left.operationId > right.operationId ? 1 : 0));
}
