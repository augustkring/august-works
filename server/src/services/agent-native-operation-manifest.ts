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
  domain: "Tasks" | "Projects" | "Work" | "Agents" | "Apps" | "Insights" | "Decisions" | "Support" | "Workflows" | "Foundation" | "Memory" | "Notifications" | "Co-workers" | "Routines";
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
 * First-party operations currently projected by Tool Gateway. The manifest
 * records the existing owner and authority boundary; it does not grant access
 * or claim that an unqualified runtime is supported.
 */
export const AGENT_NATIVE_OPERATION_MANIFEST: readonly AgentNativeOperationManifestEntry[] = Object.freeze([
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
    operationId: "blentera.agent.get_self_context", domain: "Agents", customerJob: "Read the current Co-worker identity and operating state.",
    canonicalService: "agentService.getById", webSurface: "Co-worker detail", apiOperation: "Tool Gateway operation",
    toolId: "blentera.agent.get_self_context", legacyAliases: ["paperclip-self:get_my_agent_context"], principalTypes: ["agent"],
    experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary", requiredPermissions: ["current Agent credential", "current represented Human", "current run"],
    resourceScope: "Only the Agent bound to the current verified gateway session.", approvalPolicy: "Read-only; no credentials, configuration, permissions, or other Agents are returned.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current verified Agent session and active run.", postcondition: "A bounded identity/status projection for the current Agent.", recovery: "Refresh current Agent state; stop on identity or run mismatch.",
    channelProjection: [], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/agents.ts",
  },
  {
    operationId: "blentera.apps.list_authorized_tools", domain: "Apps", customerJob: "Discover the Apps and tools currently authorized in this session.",
    canonicalService: "Tool Gateway session tool resolution", webSurface: "Apps and task tool picker", apiOperation: "MCP tools/list",
    toolId: "MCP tools/list", legacyAliases: [], principalTypes: ["agent"], experienceProfiles: ["agent_tool_gateway"], mode: "DIRECT_AGENT", criticality: "ordinary",
    requiredPermissions: ["current Agent credential", "current session profile and tool policy", "current connection/grant eligibility"],
    resourceScope: "Only descriptors resolved for this exact session; no connection secrets or unrelated company catalog.", approvalPolicy: "Discovery only; execution rechecks grants, policy, and approval on every call.", idempotency: "Not applicable to reads.",
    expectedVersionOrPrecondition: "Current session tool profile and active connection state.", postcondition: "A bounded catalog of tools available in this session.", recovery: "Refresh tool discovery; a missing tool is not evidence that an external account is disconnected.",
    channelProjection: ["MCP tools/list"], mcpExposed: true, openclawQualified: false, tests: ["server/src/__tests__/tool-gateway-service.test.ts"], owner: "server/src/services/tool-gateway.ts",
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
    operationId: "blentera.support.case.manage", domain: "Support", customerJob: "Open, reply to, or close a customer Support case.",
    canonicalService: "customerSupportCaseService", webSurface: "Help and Support cases", apiOperation: "Authenticated Human Support API",
    toolId: "Human Support API only", legacyAliases: [], principalTypes: ["human"], experienceProfiles: ["authenticated_human"], mode: "HUMAN_ONLY", criticality: "material",
    requiredPermissions: ["current authenticated Human account", "current company membership", "case ownership or support administration"],
    resourceScope: "The current Human's own cases, or cases within explicit support administration authority.", approvalPolicy: "Human account action is required; an Agent cannot create or mutate customer Support cases.", idempotency: "Canonical case API request identity.",
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
