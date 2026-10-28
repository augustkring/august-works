import type { AgentNativeApiOperationContract } from "./agent-native-operation-manifest.js";

/** Existing mounted-client API contracts; source inventory only, unqualified, and no tools are exposed. */
const entries: AgentNativeApiOperationContract[] = [
  {
    "operationId": "existing-api:0026cd4280ff723f6f38",
    "domain": "Work",
    "customerJob": "acknowledgeDrift through the mounted client for /api/cases/${caseId}/acknowledge-drift",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/acknowledge-drift",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/acknowledge-drift. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2366,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.acknowledgeDrift"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2366,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2555,
        "clientCall": "pipelinesApi.acknowledgeDrift",
        "routeSignatures": [
          "post:`/cases/${caseId}/acknowledge-drift`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:004f30c0691c8d1b54dc",
    "domain": "Workflows",
    "customerJob": "cancelRun through the mounted client for /api/companies/${companyId}/workflow-runs/${runId}/cancel",
    "canonicalService": "server/src/services/workflows/workflow-executor.ts",
    "webSurface": "ui/src/pages/WorkflowRun.tsx",
    "apiOperation": "POST /api/companies/${companyId}/workflow-runs/${runId}/cancel",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "workflows:run"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/workflow-runs/${runId}/cancel. Owner: server/src/services/workflows/workflow-executor.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/workflows/workflow-executor.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/workflows/workflow-executor.ts",
        "claim": "The existing workflow executor starts or changes an active workflow run under current route authorization."
      }
    ],
    "clientMethods": [
      "workflowsApi.cancelRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/workflows.ts",
        "line": 687,
        "claim": "The route authorizes workflows:run and passes runActor(req), which retains Agent principals; executor.cancelRun applies current actor scope."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 228,
        "claim": "runActor preserves Agent principals; no board-only restriction is applied to these run lifecycle endpoints."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 294,
        "claim": "decidePermission passes the current actor into accessService.decide for workflows:run authorization."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/WorkflowRun.tsx",
        "line": 196,
        "clientCall": "workflowsApi.cancelRun",
        "routeSignatures": [
          "post:`/companies/${companyId}/workflow-runs/${runId}/cancel`"
        ]
      }
    ],
    "authorizationRationale": "The route authorizes workflows:run and passes runActor(req), which retains Agent principals; executor.cancelRun applies current actor scope. Existing Agent-capable run cancellation is not represented by a matching manifest operation ID.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:01031eb224dfa39d8104",
    "domain": "Tasks",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/issues",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/NewIssueDialog.tsx, ui/src/components/OnboardingWizard.tsx, ui/src/components/RunWorkspaceRecoverySurface.tsx, ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/companies/${companyId}/issues",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/issues. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 12277,
        "claim": "issue create route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12283,
        "claim": "route checks company access"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12301,
        "claim": "route rejects low-trust control-plane writes"
      }
    ],
    "clientMethods": [
      "issuesApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 12277,
        "claim": "issue create route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12283,
        "claim": "route checks company access"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12301,
        "claim": "route rejects low-trust control-plane writes"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/NewIssueDialog.tsx",
        "line": 661,
        "clientCall": "issuesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/issues`"
        ]
      },
      {
        "path": "ui/src/components/OnboardingWizard.tsx",
        "line": 1735,
        "clientCall": "issuesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/issues`"
        ]
      },
      {
        "path": "ui/src/components/RunWorkspaceRecoverySurface.tsx",
        "line": 272,
        "clientCall": "issuesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/issues`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 6651,
        "clientCall": "issuesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/issues`"
        ]
      }
    ],
    "authorizationRationale": "Issue creation requires company scope and applies server-side low-trust/control-plane, workspace-command, and attribution checks. Agent create remains an existing API contract, with no native manifest mapping asserted here.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:046b5b5e989c4791584c",
    "domain": "Work",
    "customerJob": "update through the mounted client for /api/pipelines/${pipelineId}",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/pages/PipelineSettings.tsx",
    "apiOperation": "PATCH /api/pipelines/${pipelineId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/pipelines/${pipelineId}. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1506,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "clientMethods": [
      "pipelinesApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1506,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2126,
        "clientCall": "pipelinesApi.update",
        "routeSignatures": [
          "patch:`/pipelines/${pipelineId}`"
        ]
      },
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2141,
        "clientCall": "pipelinesApi.update",
        "routeSignatures": [
          "patch:`/pipelines/${pipelineId}`"
        ]
      },
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2157,
        "clientCall": "pipelinesApi.update",
        "routeSignatures": [
          "patch:`/pipelines/${pipelineId}`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:064ede3b2d072637bdd8",
    "domain": "Agents",
    "customerJob": "saveInstructionsFile through the mounted client for /api/instructions-bundle/file",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/pages/AgentDetail.tsx",
    "apiOperation": "PUT /api/instructions-bundle/file",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/instructions-bundle/file. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5191,
        "claim": "calls assertCanManageInstructionsPath -> assertCanApplyProtectedAgentChange with requiresChangeGrant."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5193,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5191,
        "claim": "router.put(\"/agents/:id/instructions-bundle/file\", validate(upsertAgentInstructionsFileSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.saveInstructionsFile"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5191,
        "claim": "calls assertCanManageInstructionsPath -> assertCanApplyProtectedAgentChange with requiresChangeGrant."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5193,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5191,
        "claim": "router.put(\"/agents/:id/instructions-bundle/file\", validate(upsertAgentInstructionsFileSchema), async (req, res) => {"
      },
      {
        "path": "ui/src/api/agents.ts",
        "line": 169,
        "claim": "saveInstructionsFile"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 2331,
        "clientCall": "agentsApi.saveInstructionsFile",
        "routeSignatures": [
          "put:agentPath(id, companyId, \"/instructions-bundle/file\")"
        ]
      }
    ],
    "authorizationRationale": "Agent can directly write an instruction file only with direct agent_config:update change grant and required consent. This mutation has no proposal state.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:083a4d1a142933665206",
    "domain": "Decisions",
    "customerJob": "addItem through the mounted client for /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items",
    "canonicalService": "server/src/services/decision-queues.ts",
    "webSurface": "ui/src/components/DecisionTriageStrip.tsx",
    "apiOperation": "POST /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "decision_queue:manage",
      "decision_triage:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items. Owner: server/src/services/decision-queues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/decision-queues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 113,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "decisionQueuesApi.addItem"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 113,
        "claim": "router.post("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/DecisionTriageStrip.tsx",
        "line": 115,
        "clientCall": "decisionQueuesApi.addItem",
        "routeSignatures": [
          "post:`/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items`"
        ]
      }
    ],
    "authorizationRationale": "Route helper assertDecisionAccess first requires Board-or-Agent and same-company scope, then calls authorizationService.decide for decision_queue:manage or decision_triage:manage. The current standard-scope policy explicitly allows active company Agents for these actions; each mutation persists actor/run attribution. It is direct queue/triage work, not a proposal or Human confirmation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:08c868325fc8af48408d",
    "domain": "Tasks",
    "customerJob": "getIssueSummaries through the mounted client for /api/companies/${companyId}/issues/external-object-summaries",
    "canonicalService": "server/src/services/external-objects.ts",
    "webSurface": "ui/src/hooks/useIssueExternalObjects.ts",
    "apiOperation": "POST /api/companies/${companyId}/issues/external-object-summaries",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "ordinary",
    "sourceMateriality": "nonmaterial",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/issues/external-object-summaries. Owner: server/src/services/external-objects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/external-objects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 10326,
        "claim": "POST summary route performs current Task reader filtering then reads summaries"
      }
    ],
    "clientMethods": [
      "externalObjectsApi.getIssueSummaries"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 10326,
        "claim": "POST summary route performs current Task reader filtering then reads summaries"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useIssueExternalObjects.ts",
        "line": 24,
        "clientCall": "externalObjectsApi.getIssueSummaries",
        "routeSignatures": [
          "post:`/companies/${companyId}/issues/external-object-summaries`"
        ]
      }
    ],
    "authorizationRationale": "Despite POST transport this is a summary read: the route filters requested current-company Tasks through filterIssuesForActor before calling externalObjectsSvc.getIssueSummaries. It does not mutate an external object.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:09f3bfc65f85bccf1d3f",
    "domain": "Tasks",
    "customerJob": "lockDocument through the mounted client for /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/lock",
    "canonicalService": "server/src/routes/cases.ts",
    "webSurface": "ui/src/pages/CaseDetail.tsx",
    "apiOperation": "POST /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/lock",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/lock. Owner: server/src/routes/cases.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/cases.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1026,
        "claim": "router.post(\"/cases/:id/documents/:key/lock\", async (req, res, next) => {"
      }
    ],
    "clientMethods": [
      "casesApi.lockDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1026,
        "claim": "router.post(\"/cases/:id/documents/:key/lock\", async (req, res, next) => {"
      },
      {
        "path": "ui/src/api/cases.ts",
        "line": 315,
        "claim": "lockDocument"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 536,
        "clientCall": "casesApi.lockDocument",
        "routeSignatures": [
          "post:`/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/lock`"
        ]
      }
    ],
    "authorizationRationale": "The case route resolves the case, requires the Cases feature, and calls assertCompanyAccess; it has no additional Board or action-permission guard. Document/status mutation uses current getActorInfo identity and records Agent attribution. Same-company Agents can perform this operation directly under the current route contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:0a3833a6f49fb6adb871",
    "domain": "Tasks",
    "customerJob": "upsertWatchdog through the mounted client for /api/issues/${id}/watchdog",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/issue-properties/IssueProperties.tsx",
    "apiOperation": "PUT /api/issues/${id}/watchdog",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/issues/${id}/watchdog. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 9486,
        "claim": "watchdog upsert route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9499,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9500,
        "claim": "route rejects watchdog config mutation in the scoped watchdog context"
      }
    ],
    "clientMethods": [
      "issuesApi.upsertWatchdog"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 9486,
        "claim": "watchdog upsert route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9499,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9500,
        "claim": "route rejects watchdog config mutation in the scoped watchdog context"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/issue-properties/IssueProperties.tsx",
        "line": 1099,
        "clientCall": "issuesApi.upsertWatchdog",
        "routeSignatures": [
          "put:`/issues/${id}/watchdog`"
        ]
      }
    ],
    "authorizationRationale": "Watchdog configuration applies issue mutation authority and rejects low-trust control-plane callers before persisting actor-attributed configuration.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:0a5fd4ba527e63206b5a",
    "domain": "Tasks",
    "customerJob": "updateStatusForTarget through the mounted client for /api/issues/${id}/documents/${key}/annotations/${threadId}",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "PATCH /api/issues/${id}/documents/${key}/annotations/${threadId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/issues/${id}/documents/${key}/annotations/${threadId}. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.updateStatusForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 84,
        "claim": "updateStatusForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 102,
        "clientCall": "documentAnnotationsApi.updateStatusForTarget",
        "routeSignatures": [
          "patch:`${targetBasePath(target)}/${threadId}`"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:0b1c5526c91ce79fa05f",
    "domain": "Routines",
    "customerJob": "updateTrigger through the mounted client for /api/routine-triggers/${id}",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/components/routine-triggers/RoutineTriggers.tsx, ui/src/pages/RoutineDetail.production.tsx, ui/src/pages/RoutineDetail.tsx",
    "apiOperation": "PATCH /api/routine-triggers/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/routine-triggers/${id}. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 3368,
        "claim": "Routine trigger update changes whether and when automation executes."
      }
    ],
    "clientMethods": [
      "routinesApi.updateTrigger"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "assertCanManageExistingRoutine permits the assigned Agent and company scope; mutation routes additionally call assertBoardCanAssignTasks, which leaves Agent actors intact."
      },
      {
        "path": "server/src/services/routines.ts",
        "claim": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 181,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 265,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 278,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 301,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 406,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 552,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 556,
        "clientCall": "routinesApi.updateTrigger",
        "routeSignatures": [
          "patch:`/routine-triggers/${id}`"
        ]
      }
    ],
    "authorizationRationale": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:0b97ef0728b2ca3e256e",
    "domain": "Tasks",
    "customerJob": "rerunCurrentStageAutomation through the mounted client for /api/cases/${caseId}/automation/current-stage/rerun",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/automation/current-stage/rerun",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/automation/current-stage/rerun. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2708,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.rerunCurrentStageAutomation"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2708,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2675,
        "clientCall": "pipelinesApi.rerunCurrentStageAutomation",
        "routeSignatures": [
          "post:`/cases/${caseId}/automation/current-stage/rerun`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:0d2d01112f716130ac4c",
    "domain": "Skills",
    "customerJob": "update through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "PATCH /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 429,
        "claim": "router.patch("
      }
    ],
    "clientMethods": [
      "companySkillsApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 429,
        "claim": "router.patch("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4545,
        "clientCall": "companySkillsApi.update",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:0d7c7b8538902f2bb071",
    "domain": "Skills",
    "customerJob": "scanProjects through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/scan-projects",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/skills/ImportSkillsFromProjectDialog.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/scan-projects",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/scan-projects. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1263,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.scanProjects"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1263,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 225,
        "claim": "scanProjects"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4428,
        "clientCall": "companySkillsApi.scanProjects",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/scan-projects`"
        ]
      },
      {
        "path": "ui/src/pages/skills/ImportSkillsFromProjectDialog.tsx",
        "line": 336,
        "clientCall": "companySkillsApi.scanProjects",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/scan-projects`"
        ]
      },
      {
        "path": "ui/src/pages/skills/ImportSkillsFromProjectDialog.tsx",
        "line": 355,
        "clientCall": "companySkillsApi.scanProjects",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/scan-projects`"
        ]
      },
      {
        "path": "ui/src/pages/skills/ImportSkillsFromProjectDialog.tsx",
        "line": 443,
        "clientCall": "companySkillsApi.scanProjects",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/scan-projects`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:13eefceae1e06cfa8f6e",
    "domain": "Skills",
    "customerJob": "updateTestRunTemplate through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "PATCH /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 515,
        "claim": "router.patch("
      }
    ],
    "clientMethods": [
      "companySkillsApi.updateTestRunTemplate"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 515,
        "claim": "router.patch("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 115,
        "claim": "updateTestRunTemplate"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 2427,
        "clientCall": "companySkillsApi.updateTestRunTemplate",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:15e82e29e39b8f08c0cd",
    "domain": "Tasks",
    "customerJob": "uploadAttachment through the mounted client for /api/companies/${companyId}/issues/${issueId}/attachments",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/NewIssueDialog.tsx, ui/src/components/chat/ExternallyConnectedTaskBanner.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/companies/${companyId}/issues/${issueId}/attachments",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/issues/${issueId}/attachments. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 19282,
        "claim": "attachment upload route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 19303,
        "claim": "route applies issue mutation guard"
      }
    ],
    "clientMethods": [
      "issuesApi.uploadAttachment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 19282,
        "claim": "attachment upload route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 19303,
        "claim": "route applies issue mutation guard"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/NewIssueDialog.tsx",
        "line": 675,
        "clientCall": "issuesApi.uploadAttachment",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/issues/${issueId}/attachments`"
        ]
      },
      {
        "path": "ui/src/components/chat/ExternallyConnectedTaskBanner.tsx",
        "line": 396,
        "clientCall": "issuesApi.uploadAttachment",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/issues/${issueId}/attachments`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5400,
        "clientCall": "issuesApi.uploadAttachment",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/issues/${issueId}/attachments`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5404,
        "clientCall": "issuesApi.uploadAttachment",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/issues/${issueId}/attachments`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2461,
        "clientCall": "issuesApi.uploadAttachment",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/issues/${issueId}/attachments`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2469,
        "clientCall": "issuesApi.uploadAttachment",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/issues/${issueId}/attachments`"
        ]
      }
    ],
    "authorizationRationale": "Attachment upload applies issue mutation and deliverable run-context checks before admitting attachment content.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:1c9857ab3a70af3680bd",
    "domain": "Tasks",
    "customerJob": "resolveRecoveryAction through the mounted client for /api/issues/${id}/recovery-actions/resolve",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/RunWorkspaceRecoverySurface.tsx, ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/issues/${id}/recovery-actions/resolve",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "issue:mutate"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/recovery-actions/resolve. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 9654,
        "claim": "recovery-action resolve route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9676,
        "claim": "Agent must pass issue:mutate decision"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9691,
        "claim": "Agent run ID required"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9693,
        "claim": "cross-issue mutation budget enforced"
      }
    ],
    "clientMethods": [
      "issuesApi.resolveRecoveryAction"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 9654,
        "claim": "recovery-action resolve route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9676,
        "claim": "Agent must pass issue:mutate decision"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9691,
        "claim": "Agent run ID required"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9693,
        "claim": "cross-issue mutation budget enforced"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/RunWorkspaceRecoverySurface.tsx",
        "line": 318,
        "clientCall": "issuesApi.resolveRecoveryAction",
        "routeSignatures": [
          "post:`/issues/${id}/recovery-actions/resolve`"
        ]
      },
      {
        "path": "ui/src/components/RunWorkspaceRecoverySurface.tsx",
        "line": 339,
        "clientCall": "issuesApi.resolveRecoveryAction",
        "routeSignatures": [
          "post:`/issues/${id}/recovery-actions/resolve`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4236,
        "clientCall": "issuesApi.resolveRecoveryAction",
        "routeSignatures": [
          "post:`/issues/${id}/recovery-actions/resolve`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4270,
        "clientCall": "issuesApi.resolveRecoveryAction",
        "routeSignatures": [
          "post:`/issues/${id}/recovery-actions/resolve`"
        ]
      }
    ],
    "authorizationRationale": "Agent recovery resolution requires issue mutation authorization, a run id, and cross-issue influence budget; low-trust control-plane actors are denied.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:1cc141fcaa46925bdd99",
    "domain": "Skills",
    "customerJob": "unstar through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 798,
        "claim": "and 819-829 call assertCompanyAccess, pass skillActor(req) to starSkill/unstarSkill; company-scope auth admits same-company Agent actors."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 822,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 819,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/star\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.unstar"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 798,
        "claim": "and 819-829 call assertCompanyAccess, pass skillActor(req) to starSkill/unstarSkill; company-scope auth admits same-company Agent actors."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 822,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 819,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/star\", async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4524,
        "clientCall": "companySkillsApi.unstar",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star`"
        ]
      }
    ],
    "authorizationRationale": "The handler requires current same-company access and passes the authenticated actor through skillActor(req) to the per-user favorite mutation. Same-company Agents are admitted by company-scope auth; this is direct favorite/unfavorite work, not a proposal.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:1d67d035602fd9f1b230",
    "domain": "Agents",
    "customerJob": "invoke through the mounted client for /api/heartbeat/invoke",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/AgentActionButtons.tsx",
    "apiOperation": "POST /api/heartbeat/invoke",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "agent:wake"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/heartbeat/invoke. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 6062,
        "claim": "invokes getAccessibleResource and for Agent actors rejects unless req.actor.agentId === target id; Board actor separately requires agent:wake."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6074,
        "claim": "const agent = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6087,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6062,
        "claim": "router.post(\"/agents/:id/heartbeat/invoke\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.invoke"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 6062,
        "claim": "invokes getAccessibleResource and for Agent actors rejects unless req.actor.agentId === target id; Board actor separately requires agent:wake."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6074,
        "claim": "const agent = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6087,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6062,
        "claim": "router.post(\"/agents/:id/heartbeat/invoke\", async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AgentActionButtons.tsx",
        "line": 279,
        "clientCall": "agentsApi.invoke",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/heartbeat/invoke\")"
        ]
      },
      {
        "path": "ui/src/components/AgentActionButtons.tsx",
        "line": 307,
        "clientCall": "agentsApi.invoke",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/heartbeat/invoke\")"
        ]
      }
    ],
    "authorizationRationale": "Agent may invoke itself only; the current-run authorization is not inherited from generic tenant access. Human Board calls require agent:wake permission. Raw provider trace has an additional instance-admin gate.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:1e67abd8ecfc25d53f36",
    "domain": "Agents",
    "customerJob": "rollbackConfigRevision through the mounted client for /api/config-revisions/${revisionId}/rollback",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/pages/AgentDetail.tsx",
    "apiOperation": "POST /api/config-revisions/${revisionId}/rollback",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "agent_config:update"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/config-revisions/${revisionId}/rollback. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 4354,
        "claim": "calls assertCanUpdateAgent; Agent access depends on agent_config:update decision and protected config checks."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4357,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4354,
        "claim": "router.post(\"/agents/:id/config-revisions/:revisionId/rollback\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.rollbackConfigRevision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 4354,
        "claim": "calls assertCanUpdateAgent; Agent access depends on agent_config:update decision and protected config checks."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4357,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4354,
        "claim": "router.post(\"/agents/:id/config-revisions/:revisionId/rollback\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/agents.ts",
        "line": 143,
        "claim": "rollbackConfigRevision"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 1902,
        "clientCall": "agentsApi.rollbackConfigRevision",
        "routeSignatures": [
          "post:agentPath(id, companyId, `/config-revisions/${revisionId}/rollback`)"
        ]
      }
    ],
    "authorizationRationale": "An Agent may rollback the target config only if current agent_config:update authorization passes and subsequent config safety checks pass; the service applies the revision directly.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:1f42721721b4ab3d4dfa",
    "domain": "Projects",
    "customerJob": "removeWorkspace through the mounted client for /api/workspaces/${encodeURIComponent(workspaceId)}",
    "canonicalService": "server/src/routes/projects.ts",
    "webSurface": "ui/src/components/LegacyProjectRepository.tsx, ui/src/components/ProjectProperties.tsx",
    "apiOperation": "DELETE /api/workspaces/${encodeURIComponent(workspaceId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "project:read"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/workspaces/${encodeURIComponent(workspaceId)}. Owner: server/src/routes/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 200,
        "claim": "getReadableProject applies project:read authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 1017,
        "claim": "workspace deletion handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 1022,
        "claim": "deletes workspace after project access check"
      }
    ],
    "clientMethods": [
      "projectsApi.removeWorkspace"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 200,
        "claim": "getReadableProject applies project:read authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 1017,
        "claim": "workspace deletion handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 1022,
        "claim": "deletes workspace after project access check"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/LegacyProjectRepository.tsx",
        "line": 17,
        "clientCall": "projectsApi.removeWorkspace",
        "routeSignatures": [
          "delete:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)"
        ]
      },
      {
        "path": "ui/src/components/ProjectProperties.tsx",
        "line": 318,
        "clientCall": "projectsApi.removeWorkspace",
        "routeSignatures": [
          "delete:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)"
        ]
      }
    ],
    "authorizationRationale": "The route requires project:read through getReadableProject and accepts the authenticated actor without a Board-only mutation guard before deleting the workspace.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:1f9c303cdaf3a1265269",
    "domain": "Skills",
    "customerJob": "updateTestInput through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "PATCH /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 429,
        "claim": "router.patch("
      }
    ],
    "clientMethods": [
      "companySkillsApi.updateTestInput"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 429,
        "claim": "router.patch("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 91,
        "claim": "updateTestInput"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 1984,
        "clientCall": "companySkillsApi.updateTestInput",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:202c2cabc2a7078ec2e2",
    "domain": "Skills",
    "customerJob": "deleteTestRunTemplate through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 544,
        "claim": "router.delete(\"/companies/:companyId/skill-test-run-templates/:templateId\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.deleteTestRunTemplate"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 544,
        "claim": "router.delete(\"/companies/:companyId/skill-test-run-templates/:templateId\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 120,
        "claim": "deleteTestRunTemplate"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 2444,
        "clientCall": "companySkillsApi.deleteTestRunTemplate",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/skill-test-run-templates/${encodeURIComponent(templateId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:228848221960382f497c",
    "domain": "Tasks",
    "customerJob": "upsertDocument through the mounted client for /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}",
    "canonicalService": "server/src/routes/cases.ts",
    "webSurface": "ui/src/pages/CaseDetail.tsx",
    "apiOperation": "PUT /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}. Owner: server/src/routes/cases.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/cases.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 885,
        "claim": "router.put(\"/cases/:id/documents/:key\", async (req, res, next) => {"
      }
    ],
    "clientMethods": [
      "casesApi.upsertDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 885,
        "claim": "router.put(\"/cases/:id/documents/:key\", async (req, res, next) => {"
      },
      {
        "path": "ui/src/api/cases.ts",
        "line": 306,
        "claim": "upsertDocument"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 526,
        "clientCall": "casesApi.upsertDocument",
        "routeSignatures": [
          "put:`/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}`"
        ]
      }
    ],
    "authorizationRationale": "The case route resolves the case, requires the Cases feature, and calls assertCompanyAccess; it has no additional Board or action-permission guard. Document/status mutation uses current getActorInfo identity and records Agent attribution. Same-company Agents can perform this operation directly under the current route contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:24fc5c5dc7f2d64d9531",
    "domain": "Skills",
    "customerJob": "deleteTestRun through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 731,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/test-runs/:runId\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.deleteTestRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 731,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/test-runs/:runId\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 147,
        "claim": "deleteTestRun"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3078,
        "clientCall": "companySkillsApi.deleteTestRun",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:28dfbcbf578ed03b7dce",
    "domain": "Tasks",
    "customerJob": "deleteWatchdog through the mounted client for /api/issues/${id}/watchdog",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/issue-properties/IssueProperties.tsx",
    "apiOperation": "DELETE /api/issues/${id}/watchdog",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/issues/${id}/watchdog. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 9548,
        "claim": "watchdog delete route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9558,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9560,
        "claim": "route rejects low-trust control-plane mutation"
      }
    ],
    "clientMethods": [
      "issuesApi.deleteWatchdog"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 9548,
        "claim": "watchdog delete route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9558,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 9560,
        "claim": "route rejects low-trust control-plane mutation"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/issue-properties/IssueProperties.tsx",
        "line": 1109,
        "clientCall": "issuesApi.deleteWatchdog",
        "routeSignatures": [
          "delete:`/issues/${id}/watchdog`"
        ]
      }
    ],
    "authorizationRationale": "Watchdog deletion applies the issue mutation guard and rejects low-trust control-plane callers; Agent changes retain run and issue scope checks.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:29220ff0a9b3f66cba12",
    "domain": "Tasks",
    "customerJob": "archiveFromInbox through the mounted client for /api/issues/${id}/inbox-archive",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/SidebarRecentTasks.tsx, ui/src/pages/Inbox.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/LegacyInbox.tsx",
    "apiOperation": "POST /api/issues/${id}/inbox-archive",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "inbox:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/inbox-archive. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 12097,
        "claim": "inbox archive endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12033,
        "claim": "target resolver admits Agent only after inbox:manage decision"
      }
    ],
    "clientMethods": [
      "issuesApi.archiveFromInbox"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 12097,
        "claim": "inbox archive endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12033,
        "claim": "target resolver admits Agent only after inbox:manage decision"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/SidebarRecentTasks.tsx",
        "line": 163,
        "clientCall": "issuesApi.archiveFromInbox",
        "routeSignatures": [
          "post:`/issues/${id}/inbox-archive`"
        ]
      },
      {
        "path": "ui/src/pages/Inbox.tsx",
        "line": 1871,
        "clientCall": "issuesApi.archiveFromInbox",
        "routeSignatures": [
          "post:`/issues/${id}/inbox-archive`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5470,
        "clientCall": "issuesApi.archiveFromInbox",
        "routeSignatures": [
          "post:`/issues/${id}/inbox-archive`"
        ]
      },
      {
        "path": "ui/src/pages/LegacyInbox.tsx",
        "line": 1749,
        "clientCall": "issuesApi.archiveFromInbox",
        "routeSignatures": [
          "post:`/issues/${id}/inbox-archive`"
        ]
      }
    ],
    "authorizationRationale": "The endpoint resolves the target user from the Board principal or, for Agents, requires a scoped inbox:manage authorization for the explicit/on-behalf-of user.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:2cbfdd41daa148e06096",
    "domain": "Work",
    "customerJob": "refresh through the mounted client for /api/status-cards/${id}/refresh",
    "canonicalService": "server/src/services/status-cards.ts",
    "webSurface": "ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx, ui/src/pages/StatusCards/index.tsx",
    "apiOperation": "POST /api/status-cards/${id}/refresh",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/status-cards/${id}/refresh. Owner: server/src/services/status-cards.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/status-cards.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 236,
        "claim": "POST refresh route"
      }
    ],
    "clientMethods": [
      "statusCardsApi.refresh"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 236,
        "claim": "POST refresh route"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx",
        "line": 122,
        "clientCall": "statusCardsApi.refresh",
        "routeSignatures": [
          "post:`/status-cards/${id}/refresh`"
        ]
      },
      {
        "path": "ui/src/pages/StatusCards/index.tsx",
        "line": 75,
        "clientCall": "statusCardsApi.refresh",
        "routeSignatures": [
          "post:`/status-cards/${id}/refresh`"
        ]
      }
    ],
    "authorizationRationale": "The refresh route checks author ownership for Agents and requests a status-card refresh; the API is Agent-capable and has no current manifest operation mapping.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:332d440e710432ff46f0",
    "domain": "Tasks",
    "customerJob": "ingestCasesBatch through the mounted client for /api/pipelines/${pipelineId}/cases/batch",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/pipelines/${pipelineId}/cases/batch",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/pipelines/${pipelineId}/cases/batch. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1826,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.ingestCasesBatch"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1826,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 4298,
        "clientCall": "pipelinesApi.ingestCasesBatch",
        "routeSignatures": [
          "post:`/pipelines/${pipelineId}/cases/batch`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:334bfa21fb522af945fb",
    "domain": "Routines",
    "customerJob": "restoreRevision through the mounted client for /api/routines/${id}/revisions/${revisionId}/restore",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/components/RoutineHistoryTab.tsx",
    "apiOperation": "POST /api/routines/${id}/revisions/${revisionId}/restore",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/routines/${id}/revisions/${revisionId}/restore. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 3535,
        "claim": "Revision restore can restore the routine execution target and trigger configuration."
      }
    ],
    "clientMethods": [
      "routinesApi.restoreRevision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "assertCanManageExistingRoutine permits the assigned Agent and company scope; mutation routes additionally call assertBoardCanAssignTasks, which leaves Agent actors intact."
      },
      {
        "path": "server/src/services/routines.ts",
        "claim": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/RoutineHistoryTab.tsx",
        "line": 124,
        "clientCall": "routinesApi.restoreRevision",
        "routeSignatures": [
          "post:`/routines/${id}/revisions/${revisionId}/restore`"
        ]
      }
    ],
    "authorizationRationale": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:33f4168ebd8d4cc791a9",
    "domain": "Routines",
    "customerJob": "addCommentForTarget through the mounted client for /api/routines/${id}/description/annotations/${threadId}/comments",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "POST /api/routines/${id}/description/annotations/${threadId}/comments",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/routines/${id}/description/annotations/${threadId}/comments. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.addCommentForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 69,
        "claim": "addCommentForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 80,
        "clientCall": "documentAnnotationsApi.addCommentForTarget",
        "routeSignatures": [
          "post:`${targetBasePath(target)}/${threadId}/comments`"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:370bc5d0ed528e7676ad",
    "domain": "Agents",
    "customerJob": "resume through the mounted client for /api/resume",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/AgentActionButtons.tsx, ui/src/components/SidebarAgents.production.tsx, ui/src/components/SidebarAgents.tsx, ui/src/components/SummarySlotCard.tsx, ui/src/pages/CompanyImport.tsx, ui/src/pages/Dashboard.tsx, ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/resume",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "agent_config:update"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/resume. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5514,
        "claim": "resume handler checks resource access, then assertCanResumeAgent; Agent caller must pass agent_config:update with requiresChangeGrant."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5514,
        "claim": "router.post(\"/agents/:id/resume\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.resume"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5514,
        "claim": "resume handler checks resource access, then assertCanResumeAgent; Agent caller must pass agent_config:update with requiresChangeGrant."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5514,
        "claim": "router.post(\"/agents/:id/resume\", async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AgentActionButtons.tsx",
        "line": 282,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      },
      {
        "path": "ui/src/components/SidebarAgents.production.tsx",
        "line": 519,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      },
      {
        "path": "ui/src/components/SidebarAgents.tsx",
        "line": 519,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      },
      {
        "path": "ui/src/components/SummarySlotCard.tsx",
        "line": 212,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      },
      {
        "path": "ui/src/pages/CompanyImport.tsx",
        "line": 1628,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      },
      {
        "path": "ui/src/pages/Dashboard.tsx",
        "line": 104,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 6537,
        "clientCall": "agentsApi.resume",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/resume\")"
        ]
      }
    ],
    "authorizationRationale": "The route admits an Agent only through agent_config:update with requiresChangeGrant for the target; policy must explicitly grant direct config-change authority. Otherwise denied. This is direct lifecycle action, not proposal creation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:39d92f52dd7881b22912",
    "domain": "Work",
    "customerJob": "restoreDocumentRevision through the mounted client for /api/pipelines/${pipelineId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/components/PipelineStageHistoryPanel.tsx",
    "apiOperation": "POST /api/pipelines/${pipelineId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/pipelines/${pipelineId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1744,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "clientMethods": [
      "pipelinesApi.restoreDocumentRevision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1744,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/PipelineStageHistoryPanel.tsx",
        "line": 52,
        "clientCall": "pipelinesApi.restoreDocumentRevision",
        "routeSignatures": [
          "post:`/pipelines/${pipelineId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:3ba09a62432c60bf5fca",
    "domain": "Projects",
    "customerJob": "planProposal through the mounted client for /api/companies/${companyId}/projects/${projectId}/roadmap/proposals",
    "canonicalService": "server/src/services/project-control.ts",
    "webSurface": "ui/src/pages/ProjectRoadmap.tsx",
    "apiOperation": "POST /api/companies/${companyId}/projects/${projectId}/roadmap/proposals",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/projects/${projectId}/roadmap/proposals. Owner: server/src/services/project-control.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/project-control.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/project-control.ts",
        "line": 36,
        "claim": "proposal route calls projectControlService.propose; service accepts Agent and may auto-apply only when explicit policy allows low-risk schedule updates, otherwise creates a pending proposal."
      },
      {
        "path": "server/src/services/project-control.ts",
        "claim": "This is an existing Agent-capable planning API, but it is not always proposal-only because the service can auto-apply under policy. No exact manifest operation match was verified."
      }
    ],
    "clientMethods": [
      "v5Api.planProposal"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/project-control.ts",
        "line": 36,
        "claim": "proposal route calls projectControlService.propose; service accepts Agent and may auto-apply only when explicit policy allows low-risk schedule updates, otherwise creates a pending proposal."
      },
      {
        "path": "server/src/services/project-control.ts",
        "claim": "This is an existing Agent-capable planning API, but it is not always proposal-only because the service can auto-apply under policy. No exact manifest operation match was verified."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/ProjectRoadmap.tsx",
        "line": 45,
        "clientCall": "v5Api.planProposal",
        "routeSignatures": [
          "post:`${roadmap(cid, pid)}/proposals`"
        ]
      }
    ],
    "authorizationRationale": "This is an existing Agent-capable planning API, but it is not always proposal-only because the service can auto-apply under policy. No exact manifest operation match was verified.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:3c3efaa996648b7df8a6",
    "domain": "Decisions",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/decision-queues",
    "canonicalService": "server/src/services/decision-queues.ts",
    "webSurface": "ui/src/components/DecisionTriageStrip.tsx",
    "apiOperation": "POST /api/companies/${companyId}/decision-queues",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "decision_queue:manage",
      "decision_triage:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/decision-queues. Owner: server/src/services/decision-queues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/decision-queues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 83,
        "claim": "router.post(\"/companies/:companyId/decision-queues\", validate(createDecisionQueueSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "decisionQueuesApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 83,
        "claim": "router.post(\"/companies/:companyId/decision-queues\", validate(createDecisionQueueSchema), async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/DecisionTriageStrip.tsx",
        "line": 328,
        "clientCall": "decisionQueuesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/decision-queues`"
        ]
      }
    ],
    "authorizationRationale": "Route helper assertDecisionAccess first requires Board-or-Agent and same-company scope, then calls authorizationService.decide for decision_queue:manage or decision_triage:manage. The current standard-scope policy explicitly allows active company Agents for these actions; each mutation persists actor/run attribution. It is direct queue/triage work, not a proposal or Human confirmation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4011bf50e0fa7d561cb2",
    "domain": "Decisions",
    "customerJob": "setKeep through the mounted client for /api/companies/${companyId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}",
    "canonicalService": "server/src/services/decision-queues.ts",
    "webSurface": "ui/src/components/DecisionShelf.tsx",
    "apiOperation": "PATCH /api/companies/${companyId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "decision_queue:manage",
      "decision_triage:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${companyId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}. Owner: server/src/services/decision-queues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/decision-queues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 185,
        "claim": "router.patch("
      }
    ],
    "clientMethods": [
      "decisionQueuesApi.setKeep"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 185,
        "claim": "router.patch("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/DecisionShelf.tsx",
        "line": 77,
        "clientCall": "decisionQueuesApi.setKeep",
        "routeSignatures": [
          "patch:`/companies/${companyId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`"
        ]
      }
    ],
    "authorizationRationale": "Route helper assertDecisionAccess first requires Board-or-Agent and same-company scope, then calls authorizationService.decide for decision_queue:manage or decision_triage:manage. The current standard-scope policy explicitly allows active company Agents for these actions; each mutation persists actor/run attribution. It is direct queue/triage work, not a proposal or Human confirmation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4178be5efa732b5da4ab",
    "domain": "Co-workers",
    "customerJob": "rejectJoinRequest through the mounted client for /api/companies/${companyId}/join-requests/${requestId}/reject",
    "canonicalService": "server/src/routes/access.ts",
    "webSurface": "ui/src/components/AttentionQueueRow.tsx, ui/src/pages/CompanyAccess.tsx, ui/src/pages/Inbox.tsx, ui/src/pages/JoinRequestQueue.tsx, ui/src/pages/LegacyInbox.tsx",
    "apiOperation": "POST /api/companies/${companyId}/join-requests/${requestId}/reject",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "joins:approve"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/join-requests/${requestId}/reject. Owner: server/src/routes/access.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/access.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission explicitly accepts req.actor.type === \"agent\" iff access.hasPermission(..., permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4325,
        "claim": "reject handler calls assertCompanyPermission(...,\"joins:approve\") before setting rejected status."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4325,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "accessApi.rejectJoinRequest"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission explicitly accepts req.actor.type === \"agent\" iff access.hasPermission(..., permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4325,
        "claim": "reject handler calls assertCompanyPermission(...,\"joins:approve\") before setting rejected status."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4325,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/access.ts",
        "line": 411,
        "claim": "rejectJoinRequest"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AttentionQueueRow.tsx",
        "line": 501,
        "clientCall": "accessApi.rejectJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/reject`"
        ]
      },
      {
        "path": "ui/src/components/AttentionQueueRow.tsx",
        "line": 891,
        "clientCall": "accessApi.rejectJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/CompanyAccess.tsx",
        "line": 337,
        "clientCall": "accessApi.rejectJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/Inbox.tsx",
        "line": 1780,
        "clientCall": "accessApi.rejectJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/JoinRequestQueue.tsx",
        "line": 52,
        "clientCall": "accessApi.rejectJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/LegacyInbox.tsx",
        "line": 1658,
        "clientCall": "accessApi.rejectJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/reject`"
        ]
      }
    ],
    "authorizationRationale": "The route checks joins:approve via assertCompanyPermission, whose Agent branch explicitly checks the current Agent principal grant. An Agent with that grant can reject pending join requests; no Human-only guard is present.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:421112790f8be0da84ea",
    "domain": "Tasks",
    "customerJob": "checkMonitorNow through the mounted client for /api/issues/${id}/monitor/check-now",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/issues/${id}/monitor/check-now",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "runtime:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/monitor/check-now. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 13283,
        "claim": "monitor check-now route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 2225,
        "claim": "monitor guard requires runtime:manage and limits Agent to issue assignee"
      }
    ],
    "clientMethods": [
      "issuesApi.checkMonitorNow"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 13283,
        "claim": "monitor check-now route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 2225,
        "claim": "monitor guard requires runtime:manage and limits Agent to issue assignee"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4578,
        "clientCall": "issuesApi.checkMonitorNow",
        "routeSignatures": [
          "post:`/issues/${id}/monitor/check-now`"
        ]
      }
    ],
    "authorizationRationale": "The monitor action accepts Board actors or an Agent with runtime:manage who is the issue assignee; the route records the caller identity with the trigger.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:423efdbe5b19ed5e3416",
    "domain": "Projects",
    "customerJob": "controlWorkspaceCommands through the mounted client for /api/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}",
    "canonicalService": "server/src/routes/projects.ts",
    "webSurface": "ui/src/pages/ProjectWorkspaceDetail.tsx",
    "apiOperation": "POST /api/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "runtime:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}. Owner: server/src/routes/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 737,
        "claim": "workspace command handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 754,
        "claim": "requires runtime:manage authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 765,
        "claim": "applies workspace runtime control authorization"
      }
    ],
    "clientMethods": [
      "projectsApi.controlWorkspaceCommands"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 737,
        "claim": "workspace command handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 754,
        "claim": "requires runtime:manage authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 765,
        "claim": "applies workspace runtime control authorization"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/ProjectWorkspaceDetail.tsx",
        "line": 375,
        "clientCall": "projectsApi.controlWorkspaceCommands",
        "routeSignatures": [
          "post:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}`)"
        ]
      }
    ],
    "authorizationRationale": "The route accepts Agent actors with runtime:manage authorization and then applies the task/workspace-specific runtime guard; no Board-only guard appears in this handler.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4562674287ffca1f359b",
    "domain": "Work",
    "customerJob": "updateStageAutomationEnv through the mounted client for /api/pipelines/${pipelineId}/stages/${stageId}/automation-env",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/PipelineSettings.tsx",
    "apiOperation": "PATCH /api/pipelines/${pipelineId}/stages/${stageId}/automation-env",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/pipelines/${pipelineId}/stages/${stageId}/automation-env. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1571,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "clientMethods": [
      "pipelinesApi.updateStageAutomationEnv"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1571,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2021,
        "clientCall": "pipelinesApi.updateStageAutomationEnv",
        "routeSignatures": [
          "patch:`/pipelines/${pipelineId}/stages/${stageId}/automation-env`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:45d633ce3dde9afaf91a",
    "domain": "Work",
    "customerJob": "deleteStage through the mounted client for /api/pipelines/${pipelineId}/stages/${stageId}${qs ? ",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/PipelineSettings.tsx",
    "apiOperation": "DELETE /api/pipelines/${pipelineId}/stages/${stageId}${qs ? ",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/pipelines/${pipelineId}/stages/${stageId}${qs ? . Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1587,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "clientMethods": [
      "pipelinesApi.deleteStage"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1587,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2101,
        "clientCall": "pipelinesApi.deleteStage",
        "routeSignatures": [
          "delete:`/pipelines/${pipelineId}/stages/${stageId}${qs ? `?${qs}` : \"\"}`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:47c9a3d4d61d2b464a79",
    "domain": "Workflows",
    "customerJob": "retryRun through the mounted client for /api/companies/${companyId}/workflow-runs/${runId}/retry",
    "canonicalService": "server/src/services/workflows/workflow-executor.ts",
    "webSurface": "ui/src/pages/WorkflowRun.tsx",
    "apiOperation": "POST /api/companies/${companyId}/workflow-runs/${runId}/retry",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "workflows:run"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/workflow-runs/${runId}/retry. Owner: server/src/services/workflows/workflow-executor.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/workflows/workflow-executor.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/workflows/workflow-executor.ts",
        "claim": "The existing workflow executor starts or changes an active workflow run under current route authorization."
      }
    ],
    "clientMethods": [
      "workflowsApi.retryRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/workflows.ts",
        "line": 703,
        "claim": "The route authorizes workflows:run, requires idempotency key and passes runActor(req), which retains Agent principals; executor applies actor/run scope."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 228,
        "claim": "runActor preserves Agent principals; no board-only restriction is applied to these run lifecycle endpoints."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 294,
        "claim": "decidePermission passes the current actor into accessService.decide for workflows:run authorization."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/WorkflowRun.tsx",
        "line": 215,
        "clientCall": "workflowsApi.retryRun",
        "routeSignatures": [
          "post:`/companies/${companyId}/workflow-runs/${runId}/retry`"
        ]
      }
    ],
    "authorizationRationale": "The route authorizes workflows:run, requires idempotency key and passes runActor(req), which retains Agent principals; executor applies actor/run scope. Existing Agent-capable workflow retry is not represented by a matching manifest operation ID.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4aeda5c26aea038299d7",
    "domain": "Work",
    "customerJob": "update through the mounted client for /api/goals/${id}",
    "canonicalService": "server/src/services/goals.ts",
    "webSurface": "ui/src/pages/GoalDetail.tsx",
    "apiOperation": "PATCH /api/goals/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/goals/${id}. Owner: server/src/services/goals.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/goals.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/goals.ts",
        "line": 50,
        "claim": "current company access then Goal service mutation"
      }
    ],
    "clientMethods": [
      "goalsApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/goals.ts",
        "line": 50,
        "claim": "current company access then Goal service mutation"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/GoalDetail.tsx",
        "line": 87,
        "clientCall": "goalsApi.update",
        "routeSignatures": [
          "patch:`/goals/${id}`"
        ]
      }
    ],
    "authorizationRationale": "The existing Goal create/update route uses current company resource access and goalService, with actor attribution; it has no Board-only guard. This review does not claim a registered gateway tool or Native parity receipt.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4b88c8a251d12f20c6f6",
    "domain": "Tasks",
    "customerJob": "upsertDocument through the mounted client for /api/issues/${id}/documents/${encodeURIComponent(key)}",
    "canonicalService": "server/src/services/documents.ts",
    "webSurface": "ui/src/components/IssueDocumentsSection.tsx, ui/src/components/NewIssueDialog.tsx, ui/src/pages/IssueDetail.tsx",
    "apiOperation": "PUT /api/issues/${id}/documents/${encodeURIComponent(key)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/issues/${id}/documents/${encodeURIComponent(key)}. Owner: server/src/services/documents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/documents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 10809,
        "claim": "issue document upsert route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 10821,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 10823,
        "claim": "route applies deliverable run-context guard"
      }
    ],
    "clientMethods": [
      "issuesApi.upsertDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 10809,
        "claim": "issue document upsert route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 10821,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 10823,
        "claim": "route applies deliverable run-context guard"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/IssueDocumentsSection.tsx",
        "line": 215,
        "clientCall": "issuesApi.upsertDocument",
        "routeSignatures": [
          "put:`/issues/${id}/documents/${encodeURIComponent(key)}`"
        ]
      },
      {
        "path": "ui/src/components/NewIssueDialog.tsx",
        "line": 668,
        "clientCall": "issuesApi.upsertDocument",
        "routeSignatures": [
          "put:`/issues/${id}/documents/${encodeURIComponent(key)}`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5432,
        "clientCall": "issuesApi.upsertDocument",
        "routeSignatures": [
          "put:`/issues/${id}/documents/${encodeURIComponent(key)}`"
        ]
      }
    ],
    "authorizationRationale": "Document upsert applies issue mutation and deliverable run-context checks, binds revision authorship to the authenticated actor, and uses safe create-new behavior for Agent writes to locked documents.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4d07b9c6b5cf7ae4c3be",
    "domain": "Skills",
    "customerJob": "createTestRun through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/components/SkillEvaluationEvidence.tsx, ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 592,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.createTestRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 592,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 137,
        "claim": "createTestRun"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/SkillEvaluationEvidence.tsx",
        "line": 26,
        "clientCall": "companySkillsApi.createTestRun",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 2480,
        "clientCall": "companySkillsApi.createTestRun",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3066,
        "clientCall": "companySkillsApi.createTestRun",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4d49b49107641031a5a9",
    "domain": "Tasks",
    "customerJob": "deleteDocument through the mounted client for /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}",
    "canonicalService": "server/src/routes/cases.ts",
    "webSurface": "ui/src/pages/CaseDetail.tsx",
    "apiOperation": "DELETE /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}. Owner: server/src/routes/cases.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/cases.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1160,
        "claim": "router.delete(\"/cases/:id/documents/:key\", async (req, res, next) => {"
      }
    ],
    "clientMethods": [
      "casesApi.deleteDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1160,
        "claim": "router.delete(\"/cases/:id/documents/:key\", async (req, res, next) => {"
      },
      {
        "path": "ui/src/api/cases.ts",
        "line": 326,
        "claim": "deleteDocument"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 529,
        "clientCall": "casesApi.deleteDocument",
        "routeSignatures": [
          "delete:`/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}`"
        ]
      }
    ],
    "authorizationRationale": "The case route resolves the case, requires the Cases feature, and calls assertCompanyAccess; it has no additional Board or action-permission guard. Document/status mutation uses current getActorInfo identity and records Agent attribution. Same-company Agents can perform this operation directly under the current route contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:4de2df684a298912dad8",
    "domain": "Tasks",
    "customerJob": "restoreCaseDocumentRevision through the mounted client for /api/cases/${caseId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/components/PipelineItemBodyDocument.tsx",
    "apiOperation": "POST /api/cases/${caseId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2158,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.restoreCaseDocumentRevision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2158,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/PipelineItemBodyDocument.tsx",
        "line": 200,
        "clientCall": "pipelinesApi.restoreCaseDocumentRevision",
        "routeSignatures": [
          "post:`/cases/${caseId}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:55ffb67a2858730f2acc",
    "domain": "Work",
    "customerJob": "setTransitions through the mounted client for /api/pipelines/${pipelineId}/transitions",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/pages/PipelineSettings.tsx",
    "apiOperation": "PUT /api/pipelines/${pipelineId}/transitions",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/pipelines/${pipelineId}/transitions. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1603,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "clientMethods": [
      "pipelinesApi.setTransitions"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1603,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 1984,
        "clientCall": "pipelinesApi.setTransitions",
        "routeSignatures": [
          "put:`/pipelines/${pipelineId}/transitions`"
        ]
      },
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2085,
        "clientCall": "pipelinesApi.setTransitions",
        "routeSignatures": [
          "put:`/pipelines/${pipelineId}/transitions`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:562ea81fc2903b0fa84f",
    "domain": "Work",
    "customerJob": "uploadImage through the mounted client for /api/companies/${companyId}/assets/images",
    "canonicalService": "server/src/routes/assets.ts",
    "webSurface": "ui/src/components/AgentConfigForm.tsx, ui/src/components/NewGoalDialog.tsx, ui/src/components/NewIssueDialog.tsx, ui/src/pages/AgentDetail.tsx, ui/src/pages/GoalDetail.tsx, ui/src/pages/ProfileSettings.tsx, ui/src/pages/ProjectDetail.tsx",
    "apiOperation": "POST /api/companies/${companyId}/assets/images",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/assets/images. Owner: server/src/routes/assets.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/assets.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/assets.ts",
        "line": 115,
        "claim": "handler calls assertCompanyAccess, writes the asset with createdByAgentId/createdByUserId, and logs actorType/actorId."
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 117,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 226,
        "claim": "assertCompanyAccess(req, companyId);"
      }
    ],
    "clientMethods": [
      "assetsApi.uploadImage"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/assets.ts",
        "line": 115,
        "claim": "handler calls assertCompanyAccess, writes the asset with createdByAgentId/createdByUserId, and logs actorType/actorId."
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 117,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 226,
        "claim": "assertCompanyAccess(req, companyId);"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AgentConfigForm.tsx",
        "line": 466,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      },
      {
        "path": "ui/src/components/NewGoalDialog.tsx",
        "line": 74,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      },
      {
        "path": "ui/src/components/NewIssueDialog.tsx",
        "line": 713,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      },
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 2364,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      },
      {
        "path": "ui/src/pages/GoalDetail.tsx",
        "line": 103,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      },
      {
        "path": "ui/src/pages/ProfileSettings.tsx",
        "line": 104,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      },
      {
        "path": "ui/src/pages/ProjectDetail.tsx",
        "line": 484,
        "clientCall": "assetsApi.uploadImage",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/assets/images`"
        ]
      }
    ],
    "authorizationRationale": "The exact upload handler calls assertCompanyAccess and then persists a company asset with actor agent/user attribution. This guard enforces same-company access but adds no Human-only or per-action permission gate; the endpoint therefore admits a same-company Agent directly.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:5758b7f5c576aa0aebd5",
    "domain": "Skills",
    "customerJob": "importFromSource through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/import",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/import",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/import. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1175,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.importFromSource"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1175,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 215,
        "claim": "importFromSource"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4408,
        "clientCall": "companySkillsApi.importFromSource",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/import`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:5794c596f6c1aac20251",
    "domain": "Agents",
    "customerJob": "provision through the mounted client for /api/companies/${companyId}/built-in-agents/${key}/provision",
    "canonicalService": "server/src/services/built-in-agents.ts",
    "webSurface": "ui/src/components/ConfigureBuiltInAgentModal.tsx",
    "apiOperation": "POST /api/companies/${companyId}/built-in-agents/${key}/provision",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "agents:create"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/built-in-agents/${key}/provision. Owner: server/src/services/built-in-agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/built-in-agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 85,
        "claim": "assertCanProvisionBuiltInAgents checks req.actor via agents:create."
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 86,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 97,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 98,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 150,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 159,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 184,
        "claim": "assertBuiltInAgentsEnabled + assertCanProvisionBuiltInAgents"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 83,
        "claim": "assertCanProvisionBuiltInAgents checks same-company and agents:create"
      },
      {
        "path": "server/src/services/built-in-agents.ts",
        "line": 1695,
        "claim": "provision policy branches"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 179,
        "claim": "POST /companies/:companyId/built-in-agents/:key/provision"
      }
    ],
    "clientMethods": [
      "builtInAgentsApi.provision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 85,
        "claim": "assertCanProvisionBuiltInAgents checks req.actor via agents:create."
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 86,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 97,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 98,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 150,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 159,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 184,
        "claim": "assertBuiltInAgentsEnabled + assertCanProvisionBuiltInAgents"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 83,
        "claim": "assertCanProvisionBuiltInAgents checks same-company and agents:create"
      },
      {
        "path": "server/src/services/built-in-agents.ts",
        "line": 1695,
        "claim": "provision policy branches"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 179,
        "claim": "POST /companies/:companyId/built-in-agents/:key/provision"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/ConfigureBuiltInAgentModal.tsx",
        "line": 129,
        "clientCall": "builtInAgentsApi.provision",
        "routeSignatures": [
          "post:`/companies/${companyId}/built-in-agents/${key}/provision`"
        ]
      }
    ],
    "authorizationRationale": "The route checks agents:create for req.actor and accepts an authorized same-company Agent. The service branches on company.requireBoardApprovalForNewAgents: when enabled a new agent is created pending_approval with an approval record; when disabled it ensures/provisions directly. With the policy enabled, setup of an incomplete existing row can be applied directly, while changing an already-configured adapter is rejected pending Board approval. Classification is therefore direct Agent-accessible behavior with the exact company policy conditions described here.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:5838496d2c28d006bae7",
    "domain": "Tasks",
    "customerJob": "respondToInteraction through the mounted client for /api/issues/${id}/interactions/${interactionId}/respond",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/AttentionInteractionResolver.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx, ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/issues/${id}/interactions/${interactionId}/respond",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/interactions/${interactionId}/respond. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17169,
        "claim": "interaction respond route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolver authorization evaluates effective audience"
      }
    ],
    "clientMethods": [
      "issuesApi.respondToInteraction"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17169,
        "claim": "interaction respond route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolver authorization evaluates effective audience"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AttentionInteractionResolver.tsx",
        "line": 110,
        "clientCall": "issuesApi.respondToInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/respond`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4924,
        "clientCall": "issuesApi.respondToInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/respond`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2527,
        "clientCall": "issuesApi.respondToInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/respond`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3358,
        "clientCall": "issuesApi.respondToInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/respond`"
        ]
      }
    ],
    "authorizationRationale": "Response requires current run attribution, containment and the effective resolver audience decision; Agent access is limited by that policy.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:5d92eb972f5920f77120",
    "domain": "Workflows",
    "customerJob": "startTaskRun through the mounted client for /api/companies/${companyId}/issues/${issueId}/workflows/${workflowId}/run",
    "canonicalService": "server/src/services/workflows/workflow-executor.ts",
    "webSurface": "ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/companies/${companyId}/issues/${issueId}/workflows/${workflowId}/run",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "issue:mutate",
      "workflows:run"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/issues/${issueId}/workflows/${workflowId}/run. Owner: server/src/services/workflows/workflow-executor.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/workflows/workflow-executor.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/workflows/workflow-executor.ts",
        "claim": "The existing workflow executor starts or changes an active workflow run under current route authorization."
      }
    ],
    "clientMethods": [
      "workflowsApi.startTaskRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/workflows.ts",
        "line": 476,
        "claim": "The route authorizes workflows:run and issue:mutate on the selected Task before passing runActor(req) to the executor."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 228,
        "claim": "runActor preserves Agent principals; no board-only restriction is applied to these run lifecycle endpoints."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 294,
        "claim": "decidePermission passes the current actor into accessService.decide for workflows:run authorization."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 3109,
        "clientCall": "workflowsApi.startTaskRun",
        "routeSignatures": [
          "post:`/companies/${companyId}/issues/${issueId}/workflows/${workflowId}/run`"
        ]
      }
    ],
    "authorizationRationale": "The route authorizes workflows:run and issue:mutate on the selected Task before passing runActor(req) to the executor. Existing Agent-capable Task workflow execution is not represented by a matching manifest operation ID.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:5e7c95761d7259bdb9da",
    "domain": "Skills",
    "customerJob": "createTestRunTemplate through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skill-test-run-templates. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 491,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.createTestRunTemplate"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 491,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 110,
        "claim": "createTestRunTemplate"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 2407,
        "clientCall": "companySkillsApi.createTestRunTemplate",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skill-test-run-templates`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:5ff1cc8026806c441767",
    "domain": "Tasks",
    "customerJob": "createLabel through the mounted client for /api/companies/${companyId}/labels",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/issue-properties/IssueProperties.tsx, ui/src/pages/CaseDetail.tsx",
    "apiOperation": "POST /api/companies/${companyId}/labels",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/labels. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 8735,
        "claim": "label creation route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 8740,
        "claim": "route checks company scope and then creates label"
      }
    ],
    "clientMethods": [
      "issuesApi.createLabel"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 8735,
        "claim": "label creation route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 8740,
        "claim": "route checks company scope and then creates label"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/issue-properties/IssueProperties.tsx",
        "line": 475,
        "clientCall": "issuesApi.createLabel",
        "routeSignatures": [
          "post:`/companies/${companyId}/labels`"
        ]
      },
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 252,
        "clientCall": "issuesApi.createLabel",
        "routeSignatures": [
          "post:`/companies/${companyId}/labels`"
        ]
      }
    ],
    "authorizationRationale": "Label creation checks company access and records the authenticated actor; no Board-only check appears on this route.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:615582e8359cccdd5ed7",
    "domain": "Routines",
    "customerJob": "update through the mounted client for /api/routines/${id}${expectedUserId ? ",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/components/RoutineManagementReviewEditor.tsx, ui/src/pages/CompanyImport.tsx, ui/src/pages/RoutineDetail.production.tsx, ui/src/pages/RoutineDetail.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "PATCH /api/routines/${id}${expectedUserId ? ",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/routines/${id}${expectedUserId ? . Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 3072,
        "claim": "Routine update can change active status and execution target."
      }
    ],
    "clientMethods": [
      "routinesApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "assertCanManageExistingRoutine permits the assigned Agent and company scope; mutation routes additionally call assertBoardCanAssignTasks, which leaves Agent actors intact."
      },
      {
        "path": "server/src/services/routines.ts",
        "claim": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/RoutineManagementReviewEditor.tsx",
        "line": 33,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/CompanyImport.tsx",
        "line": 1630,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 424,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 491,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 427,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 495,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 567,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 622,
        "clientCall": "routinesApi.update",
        "routeSignatures": [
          "patch:`/routines/${id}${expectedUserId ? `?expectedUserId=${encodeURIComponent(expectedUserId)}` : \"\"}`"
        ]
      }
    ],
    "authorizationRationale": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:61a8a675c46ed0c056fc",
    "domain": "Tasks",
    "customerJob": "upsertCaseDocument through the mounted client for /api/cases/${caseId}/documents/${encodeURIComponent(key)}",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/components/PipelineItemBodyDocument.tsx",
    "apiOperation": "PUT /api/cases/${caseId}/documents/${encodeURIComponent(key)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/cases/${caseId}/documents/${encodeURIComponent(key)}. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1969,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.upsertCaseDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1969,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/PipelineItemBodyDocument.tsx",
        "line": 189,
        "clientCall": "pipelinesApi.upsertCaseDocument",
        "routeSignatures": [
          "put:`/cases/${caseId}/documents/${encodeURIComponent(key)}`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:698e2fe96238a9f8591d",
    "domain": "Agents",
    "customerJob": "execute through the mounted client for /api/companies/${companyId}/agents/${agentId}/runtime/execute",
    "canonicalService": "server/src/services/agent-runtime-fabric.ts",
    "webSurface": "ui/src/pages/AgentRuntimeFabric.tsx",
    "apiOperation": "POST /api/companies/${companyId}/agents/${agentId}/runtime/execute",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "agent:wake"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/agents/${agentId}/runtime/execute. Owner: server/src/services/agent-runtime-fabric.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agent-runtime-fabric.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/agent-runtime-fabric.ts",
        "claim": "The existing runtime execution service dispatches a company-scoped Agent execution."
      }
    ],
    "clientMethods": [
      "v5Api.execute"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agent-runtime-fabric.ts",
        "line": 18,
        "claim": "POST /agents/:agentId/runtime/execute calls requestScope then heartbeat.wakeup"
      },
      {
        "path": "server/src/services/agent-runtime-fabric.ts",
        "line": 244,
        "claim": "requestScope asserts agent:wake, stores scope request"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentRuntimeFabric.tsx",
        "line": 45,
        "clientCall": "v5Api.execute",
        "routeSignatures": [
          "post:`${company(cid)}/agents/${encodeURIComponent(aid)}/runtime/execute`"
        ]
      }
    ],
    "authorizationRationale": "`server/src/routes/agent-runtime-fabric.ts` calls `requestScope` and then `heartbeat.wakeup`; `requestScope` authorizes `agent:wake` and stores an execution scope. This starts Agent execution and no current manifest operation identifies its scope contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:69ca94a54aab5e9d85a5",
    "domain": "Agents",
    "customerJob": "reset through the mounted client for /api/companies/${companyId}/built-in-agents/${key}/reset",
    "canonicalService": "server/src/services/built-in-agents.ts",
    "webSurface": "ui/src/pages/AgentDetail.tsx",
    "apiOperation": "POST /api/companies/${companyId}/built-in-agents/${key}/reset",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "agents:create"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/built-in-agents/${key}/reset. Owner: server/src/services/built-in-agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/built-in-agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 85,
        "claim": "assertCanProvisionBuiltInAgents checks req.actor via agents:create."
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 86,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 97,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 98,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 150,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 159,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/services/built-in-agents.ts",
        "line": 1842,
        "claim": "async function reset(companyId: string, key: string, input: { resources?: Array<\"agent\" | \"instructions\" | \"skill\" | \"routine\"> } = {}) {"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 215,
        "claim": "router.post(\"/companies/:companyId/built-in-agents/:key/reset\", validate(builtInAgentResetSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "builtInAgentsApi.reset"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 85,
        "claim": "assertCanProvisionBuiltInAgents checks req.actor via agents:create."
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 86,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 97,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 98,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 150,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 159,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/services/built-in-agents.ts",
        "line": 1842,
        "claim": "async function reset(companyId: string, key: string, input: { resources?: Array<\"agent\" | \"instructions\" | \"skill\" | \"routine\"> } = {}) {"
      },
      {
        "path": "server/src/routes/built-in-agents.ts",
        "line": 215,
        "claim": "router.post(\"/companies/:companyId/built-in-agents/:key/reset\", validate(builtInAgentResetSchema), async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 869,
        "clientCall": "builtInAgentsApi.reset",
        "routeSignatures": [
          "post:`/companies/${companyId}/built-in-agents/${key}/reset`"
        ]
      },
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 876,
        "clientCall": "builtInAgentsApi.reset",
        "routeSignatures": [
          "post:`/companies/${companyId}/built-in-agents/${key}/reset`"
        ]
      }
    ],
    "authorizationRationale": "The route calls assertCanProvisionBuiltInAgents, which checks same-company access and authorizationService agents:create for req.actor, then persists the operation and logs the originating Agent/User. An authorized Agent may request/provision/reset this built-in Agent; this is direct behavior, not inferred from UI.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:6b921f93fc9d50535907",
    "domain": "Agents",
    "customerJob": "updatePermissions through the mounted client for /api/permissions",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/pages/AgentDetail.tsx, ui/src/pages/apps/chat/EmailEndpointSetup.tsx",
    "apiOperation": "PATCH /api/permissions",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/permissions. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 4977,
        "claim": "permission handler explicitly allows a same-company Agent only when actor role is CEO; Board path requires assertBoardCanManageAgentsForCompany."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4979,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4977,
        "claim": "router.patch(\"/agents/:id/permissions\", validate(updateAgentPermissionsSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.updatePermissions"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 4977,
        "claim": "permission handler explicitly allows a same-company Agent only when actor role is CEO; Board path requires assertBoardCanManageAgentsForCompany."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4979,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4977,
        "claim": "router.patch(\"/agents/:id/permissions\", validate(updateAgentPermissionsSchema), async (req, res) => {"
      },
      {
        "path": "ui/src/api/agents.ts",
        "line": 151,
        "claim": "updatePermissions"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 1041,
        "clientCall": "agentsApi.updatePermissions",
        "routeSignatures": [
          "patch:agentPath(id, companyId, \"/permissions\")"
        ]
      },
      {
        "path": "ui/src/pages/apps/chat/EmailEndpointSetup.tsx",
        "line": 142,
        "clientCall": "agentsApi.updatePermissions",
        "routeSignatures": [
          "patch:agentPath(id, companyId, \"/permissions\")"
        ]
      }
    ],
    "authorizationRationale": "Current source explicitly admits a same-company CEO Agent to update Agent permissions and records actor attribution. This is direct-agent authority as implemented; it intersects the brief invariant that an Agent must not approve its own authority expansion and should be reviewed as a policy risk.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:6bd8cdf5eb2c2089ed90",
    "domain": "Projects",
    "customerJob": "update through the mounted client for /api/projects/${projectId}?companyId=${companyId}",
    "canonicalService": "server/src/services/projects.ts",
    "webSurface": "ui/src/pages/ProjectDetail.tsx",
    "apiOperation": "PATCH /api/projects/${projectId}?companyId=${companyId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/projects/${projectId}?companyId=${companyId}. Owner: server/src/services/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 514,
        "claim": "project patch handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 516,
        "claim": "handler requires project read access"
      },
      {
        "path": "server/src/services/projects.ts",
        "line": 1003,
        "claim": "service pins project mutation and checks source visibility"
      }
    ],
    "clientMethods": [
      "projectsApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 514,
        "claim": "project patch handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 516,
        "claim": "handler requires project read access"
      },
      {
        "path": "server/src/services/projects.ts",
        "line": 1003,
        "claim": "service pins project mutation and checks source visibility"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/ProjectDetail.tsx",
        "line": 452,
        "clientCall": "projectsApi.update",
        "routeSignatures": [
          "patch:projectPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/ProjectDetail.tsx",
        "line": 458,
        "clientCall": "projectsApi.update",
        "routeSignatures": [
          "patch:projectPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/ProjectDetail.tsx",
        "line": 582,
        "clientCall": "projectsApi.update",
        "routeSignatures": [
          "patch:projectPath(id, companyId)"
        ]
      }
    ],
    "authorizationRationale": "Project update uses authenticated project read access and passes the actor into the canonical project service; service performs privacy/source checks. This is existing API access and has no native manifest parity claim.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:6c717d1ea118f76c78eb",
    "domain": "Decisions",
    "customerJob": "update through the mounted client for /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}",
    "canonicalService": "server/src/services/decision-queues.ts",
    "webSurface": "ui/src/pages/DecisionQueuePage.tsx",
    "apiOperation": "PATCH /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "decision_queue:manage",
      "decision_triage:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}. Owner: server/src/services/decision-queues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/decision-queues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 95,
        "claim": "router.patch(\"/companies/:companyId/decision-queues/:key\", validate(updateDecisionQueueSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "decisionQueuesApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 95,
        "claim": "router.patch(\"/companies/:companyId/decision-queues/:key\", validate(updateDecisionQueueSchema), async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/DecisionQueuePage.tsx",
        "line": 204,
        "clientCall": "decisionQueuesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}/decision-queues/${encodeURIComponent(key)}`"
        ]
      }
    ],
    "authorizationRationale": "Route helper assertDecisionAccess first requires Board-or-Agent and same-company scope, then calls authorizationService.decide for decision_queue:manage or decision_triage:manage. The current standard-scope policy explicitly allows active company Agents for these actions; each mutation persists actor/run attribution. It is direct queue/triage work, not a proposal or Human confirmation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:6db8fc509432bec51811",
    "domain": "Routines",
    "customerJob": "createTrigger through the mounted client for /api/routines/${id}/triggers",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/components/routine-triggers/RoutineTriggers.tsx, ui/src/pages/RoutineDetail.production.tsx, ui/src/pages/RoutineDetail.tsx",
    "apiOperation": "POST /api/routines/${id}/triggers",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/routines/${id}/triggers. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 3287,
        "claim": "Routine trigger creation persists a schedule or webhook execution source."
      }
    ],
    "clientMethods": [
      "routinesApi.createTrigger"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "assertCanManageExistingRoutine permits the assigned Agent and company scope; mutation routes additionally call assertBoardCanAssignTasks, which leaves Agent actors intact."
      },
      {
        "path": "server/src/services/routines.ts",
        "claim": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 364,
        "clientCall": "routinesApi.createTrigger",
        "routeSignatures": [
          "post:`/routines/${id}/triggers`"
        ]
      },
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 398,
        "clientCall": "routinesApi.createTrigger",
        "routeSignatures": [
          "post:`/routines/${id}/triggers`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 516,
        "clientCall": "routinesApi.createTrigger",
        "routeSignatures": [
          "post:`/routines/${id}/triggers`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 520,
        "clientCall": "routinesApi.createTrigger",
        "routeSignatures": [
          "post:`/routines/${id}/triggers`"
        ]
      }
    ],
    "authorizationRationale": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:6e03c0ae8bd0f2267eaa",
    "domain": "Agents",
    "customerJob": "testEnvironment through the mounted client for /api/companies/${companyId}/adapters/${type}/test-environment",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/AgentConfigForm.tsx, ui/src/components/OnboardingWizard.tsx, ui/src/lib/test-agent-setup.ts",
    "apiOperation": "POST /api/companies/${companyId}/adapters/${type}/test-environment",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "agents:create"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/adapters/${type}/test-environment. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 1767,
        "claim": "assertCanCreateAgentsForCompany checks agents:create for req.actor and same-company Agent identity."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3418,
        "claim": "test-environment handler calls that helper and then assertCanUpdateAgent for a supplied saved Agent."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3424,
        "claim": "await assertCanCreateAgentsForCompany(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3433,
        "claim": "? await getAccessibleResource(req, res, svc.getById(savedAgentId), \"Agent not found\")"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3418,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "agentsApi.testEnvironment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 1767,
        "claim": "assertCanCreateAgentsForCompany checks agents:create for req.actor and same-company Agent identity."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3418,
        "claim": "test-environment handler calls that helper and then assertCanUpdateAgent for a supplied saved Agent."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3424,
        "claim": "await assertCanCreateAgentsForCompany(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3433,
        "claim": "? await getAccessibleResource(req, res, svc.getById(savedAgentId), \"Agent not found\")"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3418,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/agents.ts",
        "line": 223,
        "claim": "testEnvironment"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AgentConfigForm.tsx",
        "line": 1076,
        "clientCall": "agentsApi.testEnvironment",
        "routeSignatures": [
          "post:`/companies/${companyId}/adapters/${type}/test-environment`"
        ]
      },
      {
        "path": "ui/src/components/OnboardingWizard.tsx",
        "line": 1952,
        "clientCall": "agentsApi.testEnvironment",
        "routeSignatures": [
          "post:`/companies/${companyId}/adapters/${type}/test-environment`"
        ]
      },
      {
        "path": "ui/src/lib/test-agent-setup.ts",
        "line": 24,
        "clientCall": "agentsApi.testEnvironment",
        "routeSignatures": [
          "post:`/companies/${companyId}/adapters/${type}/test-environment`"
        ]
      },
      {
        "path": "ui/src/lib/test-agent-setup.ts",
        "line": 38,
        "clientCall": "agentsApi.testEnvironment",
        "routeSignatures": [
          "post:`/companies/${companyId}/adapters/${type}/test-environment`"
        ]
      }
    ],
    "authorizationRationale": "The handler calls assertCanCreateAgentsForCompany, which checks the req.actor agents:create decision and verifies a same-company Agent identity. Saved-agent tests additionally require agent_config:update for that target. The route is Agent-accessible under these current grants; raw/provider credential and environment checks remain enforced.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:73330dfbf7943737cc5b",
    "domain": "Co-workers",
    "customerJob": "approveJoinRequest through the mounted client for /api/companies/${companyId}/join-requests/${requestId}/approve",
    "canonicalService": "server/src/routes/access.ts",
    "webSurface": "ui/src/components/AttentionQueueRow.tsx, ui/src/pages/CompanyAccess.tsx, ui/src/pages/Inbox.tsx, ui/src/pages/JoinRequestQueue.tsx, ui/src/pages/LegacyInbox.tsx",
    "apiOperation": "POST /api/companies/${companyId}/join-requests/${requestId}/approve",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "joins:approve"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/join-requests/${requestId}/approve. Owner: server/src/routes/access.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/access.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission explicitly accepts req.actor.type === \"agent\" iff access.hasPermission(..., permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4175,
        "claim": "approve handler calls assertCompanyPermission(...,\"joins:approve\") before status transition and membership/Agent creation."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4175,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "accessApi.approveJoinRequest"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission explicitly accepts req.actor.type === \"agent\" iff access.hasPermission(..., permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4175,
        "claim": "approve handler calls assertCompanyPermission(...,\"joins:approve\") before status transition and membership/Agent creation."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4175,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/access.ts",
        "line": 408,
        "claim": "approveJoinRequest"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AttentionQueueRow.tsx",
        "line": 500,
        "clientCall": "accessApi.approveJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/approve`"
        ]
      },
      {
        "path": "ui/src/components/AttentionQueueRow.tsx",
        "line": 887,
        "clientCall": "accessApi.approveJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/approve`"
        ]
      },
      {
        "path": "ui/src/pages/CompanyAccess.tsx",
        "line": 315,
        "clientCall": "accessApi.approveJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/approve`"
        ]
      },
      {
        "path": "ui/src/pages/Inbox.tsx",
        "line": 1765,
        "clientCall": "accessApi.approveJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/approve`"
        ]
      },
      {
        "path": "ui/src/pages/JoinRequestQueue.tsx",
        "line": 42,
        "clientCall": "accessApi.approveJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/approve`"
        ]
      },
      {
        "path": "ui/src/pages/LegacyInbox.tsx",
        "line": 1643,
        "clientCall": "accessApi.approveJoinRequest",
        "routeSignatures": [
          "post:`/companies/${companyId}/join-requests/${requestId}/approve`"
        ]
      }
    ],
    "authorizationRationale": "The route checks joins:approve via assertCompanyPermission; its Agent branch explicitly checks the current Agent principal grant. If granted, the Agent may approve the request, including granting the membership requested, as implemented. The resulting authority expansion is real and should remain visible in policy review; no Human-only check is present.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:7413c718c3b3aad1e0de",
    "domain": "Skills",
    "customerJob": "create through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 404,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 404,
        "claim": "router.post("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4472,
        "clientCall": "companySkillsApi.create",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 473,
        "clientCall": "companySkillsApi.create",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:74b7adb26f03dac65657",
    "domain": "Skills",
    "customerJob": "star through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 798,
        "claim": "and 819-829 call assertCompanyAccess, pass skillActor(req) to starSkill/unstarSkill; company-scope auth admits same-company Agent actors."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 801,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 798,
        "claim": "router.post(\"/companies/:companyId/skills/:skillId/star\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.star"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 798,
        "claim": "and 819-829 call assertCompanyAccess, pass skillActor(req) to starSkill/unstarSkill; company-scope auth admits same-company Agent actors."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 801,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 798,
        "claim": "router.post(\"/companies/:companyId/skills/:skillId/star\", async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4525,
        "clientCall": "companySkillsApi.star",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/star`"
        ]
      }
    ],
    "authorizationRationale": "The handler requires current same-company access and passes the authenticated actor through skillActor(req) to the per-user favorite mutation. Same-company Agents are admitted by company-scope auth; this is direct favorite/unfavorite work, not a proposal.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:75b118e46dfc43d21b36",
    "domain": "Agents",
    "customerJob": "updateInstructionsBundle through the mounted client for /api/instructions-bundle",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/pages/AgentDetail.tsx",
    "apiOperation": "PATCH /api/instructions-bundle",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/instructions-bundle. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5127,
        "claim": "calls assertCanManageInstructionsPath -> assertCanApplyProtectedAgentChange with requiresChangeGrant; mode=external has assertInstanceAdmin."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5129,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5133,
        "claim": "if (req.body.mode === \"external\") assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5127,
        "claim": "router.patch(\"/agents/:id/instructions-bundle\", validate(updateAgentInstructionsBundleSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.updateInstructionsBundle"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5127,
        "claim": "calls assertCanManageInstructionsPath -> assertCanApplyProtectedAgentChange with requiresChangeGrant; mode=external has assertInstanceAdmin."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5129,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5133,
        "claim": "if (req.body.mode === \"external\") assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5127,
        "claim": "router.patch(\"/agents/:id/instructions-bundle\", validate(updateAgentInstructionsBundleSchema), async (req, res) => {"
      },
      {
        "path": "ui/src/api/agents.ts",
        "line": 155,
        "claim": "updateInstructionsBundle"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 2316,
        "clientCall": "agentsApi.updateInstructionsBundle",
        "routeSignatures": [
          "patch:agentPath(id, companyId, \"/instructions-bundle\")"
        ]
      }
    ],
    "authorizationRationale": "Agent can directly update instructions only with direct agent_config:update change grant and required consent; external instruction mode has a stricter operator-only submode. This handler creates no proposal.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:768adf372ebff58686ec",
    "domain": "Tasks",
    "customerJob": "deleteAttachment through the mounted client for /api/attachments/${id}",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/pages/IssueDetail.tsx",
    "apiOperation": "DELETE /api/attachments/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/attachments/${id}. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 19540,
        "claim": "attachment delete endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 19554,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 19555,
        "claim": "route applies deliverable run-context authorization"
      }
    ],
    "clientMethods": [
      "issuesApi.deleteAttachment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 19540,
        "claim": "attachment delete endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 19554,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 19555,
        "claim": "route applies deliverable run-context authorization"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5456,
        "clientCall": "issuesApi.deleteAttachment",
        "routeSignatures": [
          "delete:`/attachments/${id}`"
        ]
      }
    ],
    "authorizationRationale": "Attachment deletion applies issue mutation authority plus the run-context deliverable guard before deleting stored content.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:76e1166114e7d0663090",
    "domain": "Tasks",
    "customerJob": "createForTarget through the mounted client for /api/issues/${id}/documents/${key}/annotations",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "POST /api/issues/${id}/documents/${key}/annotations",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/documents/${key}/annotations. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.createForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 58,
        "claim": "createForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 48,
        "clientCall": "documentAnnotationsApi.createForTarget",
        "routeSignatures": [
          "post:targetBasePath(target)"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:770b85da8c46632fd99a",
    "domain": "Tasks",
    "customerJob": "createIssueLink through the mounted client for /api/cases/${caseId}/open-conversation",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/open-conversation",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/open-conversation. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2498,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.createIssueLink"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2498,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2371,
        "clientCall": "pipelinesApi.createIssueLink",
        "routeSignatures": [
          "post:`/cases/${caseId}/issue-links`",
          "post:`/cases/${caseId}/open-conversation`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2384,
        "clientCall": "pipelinesApi.createIssueLink",
        "routeSignatures": [
          "post:`/cases/${caseId}/issue-links`",
          "post:`/cases/${caseId}/open-conversation`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:7964f9127ae705be01ed",
    "domain": "Decisions",
    "customerJob": "updateTriage through the mounted client for /api/companies/${companyId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}",
    "canonicalService": "server/src/services/decision-queues.ts",
    "webSurface": "ui/src/components/DecisionTriageStrip.tsx",
    "apiOperation": "PUT /api/companies/${companyId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "decision_queue:manage",
      "decision_triage:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: PUT /api/companies/${companyId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}. Owner: server/src/services/decision-queues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/decision-queues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      }
    ],
    "clientMethods": [
      "decisionQueuesApi.updateTriage"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "ui/src/api/decisionQueues.ts",
        "line": 117,
        "claim": "updateTriage"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/DecisionTriageStrip.tsx",
        "line": 104,
        "clientCall": "decisionQueuesApi.updateTriage",
        "routeSignatures": [
          "put:`/companies/${companyId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`"
        ]
      },
      {
        "path": "ui/src/components/DecisionTriageStrip.tsx",
        "line": 110,
        "clientCall": "decisionQueuesApi.updateTriage",
        "routeSignatures": [
          "put:`/companies/${companyId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`"
        ]
      }
    ],
    "authorizationRationale": "Route helper assertDecisionAccess first requires Board-or-Agent and same-company scope, then calls authorizationService.decide for decision_queue:manage or decision_triage:manage. The current standard-scope policy explicitly allows active company Agents for these actions; each mutation persists actor/run attribution. It is direct queue/triage work, not a proposal or Human confirmation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:79d5aa0c6e3f1f17d8da",
    "domain": "Work",
    "customerJob": "createRun through the mounted client for /api/companies/${companyId}/smoke-lab/runs",
    "canonicalService": "server/src/services/smoke-lab.ts",
    "webSurface": "ui/src/pages/tools/SmokeLabTab.tsx",
    "apiOperation": "POST /api/companies/${companyId}/smoke-lab/runs",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/smoke-lab/runs. Owner: server/src/services/smoke-lab.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/smoke-lab.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/smoke-lab.ts",
        "line": 198,
        "claim": "Run creation route admits board or Agent actors and checks company access; smoke lab feature service gates the test facility."
      },
      {
        "path": "server/src/services/smoke-lab.ts",
        "claim": "This writes test-run evidence in the optional Smoke Lab, not customer workflow state; no manifest operation match."
      }
    ],
    "clientMethods": [
      "smokeLabApi.createRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/smoke-lab.ts",
        "line": 198,
        "claim": "Run creation route admits board or Agent actors and checks company access; smoke lab feature service gates the test facility."
      },
      {
        "path": "server/src/services/smoke-lab.ts",
        "claim": "This writes test-run evidence in the optional Smoke Lab, not customer workflow state; no manifest operation match."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/tools/SmokeLabTab.tsx",
        "line": 150,
        "clientCall": "smokeLabApi.createRun",
        "routeSignatures": [
          "post:`${base(companyId)}/runs`"
        ]
      }
    ],
    "authorizationRationale": "This writes test-run evidence in the optional Smoke Lab, not customer workflow state; no manifest operation match.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:7cf6715bfece301dbba8",
    "domain": "Tasks",
    "customerJob": "acceptInteraction through the mounted client for /api/issues/${id}/interactions/${interactionId}/accept",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/AttentionInteractionResolver.tsx, ui/src/components/AttentionQueueRow.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx, ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/issues/${id}/interactions/${interactionId}/accept",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/interactions/${interactionId}/accept. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 16730,
        "claim": "accept interaction route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment before lookup"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolution helper evaluates effective resolver audience and governed-action status"
      }
    ],
    "clientMethods": [
      "issuesApi.acceptInteraction"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 16730,
        "claim": "accept interaction route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment before lookup"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolution helper evaluates effective resolver audience and governed-action status"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AttentionInteractionResolver.tsx",
        "line": 94,
        "clientCall": "issuesApi.acceptInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/accept`"
        ]
      },
      {
        "path": "ui/src/components/AttentionQueueRow.tsx",
        "line": 506,
        "clientCall": "issuesApi.acceptInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/accept`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4837,
        "clientCall": "issuesApi.acceptInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/accept`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2509,
        "clientCall": "issuesApi.acceptInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/accept`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3351,
        "clientCall": "issuesApi.acceptInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/accept`"
        ]
      }
    ],
    "authorizationRationale": "Resolution is admitted only after current issue/run containment and the interaction’s effective resolver audience decision. An Agent can use this endpoint only when that decision authorizes its principal; governed tool actions use the downstream approval callback.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:7e9f55e785fa8916faac",
    "domain": "Work",
    "customerJob": "delete through the mounted client for /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}",
    "canonicalService": "server/src/services/folders.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}. Owner: server/src/services/folders.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/folders.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "clientMethods": [
      "foldersApi.delete"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4847,
        "clientCall": "foldersApi.delete",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 523,
        "clientCall": "foldersApi.delete",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 586,
        "clientCall": "foldersApi.delete",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}`"
        ]
      }
    ],
    "authorizationRationale": "The existing company folder route admits current company actors and directly invokes folderService with activity attribution. This is existing API accessibility, not proof of a matching Agent tool contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:818c457807a034cb8813",
    "domain": "Skills",
    "customerJob": "deleteFile through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      }
    ],
    "clientMethods": [
      "companySkillsApi.deleteFile"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 1380,
        "clientCall": "companySkillsApi.deleteFile",
        "routeSignatures": [
          "deleteWithBody:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:87fd886b2e24d7c05046",
    "domain": "Projects",
    "customerJob": "controlWorkspaceRuntimeServices through the mounted client for /api/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}",
    "canonicalService": "server/src/routes/projects.ts",
    "webSurface": "ui/src/components/ProjectWorkspacesContent.tsx",
    "apiOperation": "POST /api/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "runtime:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}. Owner: server/src/routes/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 737,
        "claim": "workspace runtime control handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 754,
        "claim": "requires runtime:manage authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 765,
        "claim": "applies workspace runtime control authorization"
      }
    ],
    "clientMethods": [
      "projectsApi.controlWorkspaceRuntimeServices"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 737,
        "claim": "workspace runtime control handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 754,
        "claim": "requires runtime:manage authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 765,
        "claim": "applies workspace runtime control authorization"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/ProjectWorkspacesContent.tsx",
        "line": 38,
        "clientCall": "projectsApi.controlWorkspaceRuntimeServices",
        "routeSignatures": [
          "post:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`)"
        ]
      }
    ],
    "authorizationRationale": "The runtime-services route uses the same handler, which authorizes runtime:manage and applies workspace-specific Agent or Human runtime authorization.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:88d19f8a82230154992a",
    "domain": "Routines",
    "customerJob": "deleteTrigger through the mounted client for /api/routine-triggers/${id}",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/pages/RoutineDetail.production.tsx, ui/src/pages/RoutineDetail.tsx",
    "apiOperation": "DELETE /api/routine-triggers/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/routine-triggers/${id}. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 3440,
        "claim": "Routine trigger deletion removes an execution source."
      }
    ],
    "clientMethods": [
      "routinesApi.deleteTrigger"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "assertCanManageExistingRoutine permits the assigned Agent and company scope; mutation routes additionally call assertBoardCanAssignTasks, which leaves Agent actors intact."
      },
      {
        "path": "server/src/services/routines.ts",
        "claim": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 571,
        "clientCall": "routinesApi.deleteTrigger",
        "routeSignatures": [
          "delete:`/routine-triggers/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 575,
        "clientCall": "routinesApi.deleteTrigger",
        "routeSignatures": [
          "delete:`/routine-triggers/${id}`"
        ]
      }
    ],
    "authorizationRationale": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:898c61b839da9afc9f32",
    "domain": "Skills",
    "customerJob": "post through the mounted client for /api/companies/${companyId}/skills/${skillId}/lifecycle/promote",
    "canonicalService": "server/src/services/skill-lifecycle.ts",
    "webSurface": "ui/src/pages/SkillGovernance.tsx",
    "apiOperation": "POST /api/companies/${companyId}/skills/${skillId}/lifecycle/promote",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/skills/${skillId}/lifecycle/promote. Owner: server/src/services/skill-lifecycle.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/skill-lifecycle.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/skill-lifecycle.ts",
        "line": 18,
        "claim": "Promotion route passes actor and expected promotion input to canonical lifecycle service."
      },
      {
        "path": "server/src/services/skill-lifecycle.ts",
        "line": 37,
        "claim": "Agent promotion requires explicit enabled feature, local owner match, allowAutonomousPromotion and no required Human review."
      },
      {
        "path": "server/src/services/skill-lifecycle.ts",
        "line": 213,
        "claim": "Promotion compares expected active version; subsequent checks require a passed paired evaluation, configured suites, safety/process/outcome/cost thresholds, retained traces, and current dependencies."
      }
    ],
    "clientMethods": [
      "api.post"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/skill-lifecycle.ts",
        "line": 18,
        "claim": "Promotion route passes actor and expected promotion input to canonical lifecycle service."
      },
      {
        "path": "server/src/services/skill-lifecycle.ts",
        "line": 37,
        "claim": "Agent promotion requires explicit enabled feature, local owner match, allowAutonomousPromotion and no required Human review."
      },
      {
        "path": "server/src/services/skill-lifecycle.ts",
        "line": 213,
        "claim": "Promotion compares expected active version; subsequent checks require a passed paired evaluation, configured suites, safety/process/outcome/cost thresholds, retained traces, and current dependencies."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillGovernance.tsx",
        "line": 41,
        "clientCall": "api.post",
        "routeSignatures": [
          "post:`${base}/lifecycle/promote`"
        ]
      }
    ],
    "authorizationRationale": "Agent promotion is possible only under explicit local owner policy and extensive promotion evidence; this does not establish a separate tool mapping.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:898ede8581ce83bc7ce6",
    "domain": "Tasks",
    "customerJob": "retryAutomation through the mounted client for /api/cases/${caseId}/automations/${automationId}/retry",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/automations/${automationId}/retry",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/automations/${automationId}/retry. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2699,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.retryAutomation"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2699,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2673,
        "clientCall": "pipelinesApi.retryAutomation",
        "routeSignatures": [
          "post:`/cases/${caseId}/automations/${automationId}/retry`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:8a09b5971e316b7afc83",
    "domain": "Tasks",
    "customerJob": "ensureWorkProductReviewDocument through the mounted client for /api/issues/${id}/work-products/${workProductId}/review-document",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/issue-properties/IssuePropertiesArtifactsTab.tsx",
    "apiOperation": "POST /api/issues/${id}/work-products/${workProductId}/review-document",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/work-products/${workProductId}/review-document. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 11605,
        "claim": "work-product review document route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11617,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11619,
        "claim": "route applies deliverable run-context guard"
      }
    ],
    "clientMethods": [
      "issuesApi.ensureWorkProductReviewDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 11605,
        "claim": "work-product review document route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11617,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11619,
        "claim": "route applies deliverable run-context guard"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/issue-properties/IssuePropertiesArtifactsTab.tsx",
        "line": 113,
        "clientCall": "issuesApi.ensureWorkProductReviewDocument",
        "routeSignatures": [
          "post:`/issues/${id}/work-products/${workProductId}/review-document`"
        ]
      }
    ],
    "authorizationRationale": "Materializing a work-product review document applies issue mutation and deliverable run-context guards, then checks that the product belongs to the issue/company.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:8ac96b55f808bc022228",
    "domain": "Agents",
    "customerJob": "deleteInstructionsFile through the mounted client for /api/instructions-bundle/file?path=${encodeURIComponent(relativePath)}",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/pages/AgentDetail.tsx",
    "apiOperation": "DELETE /api/instructions-bundle/file?path=${encodeURIComponent(relativePath)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/instructions-bundle/file?path=${encodeURIComponent(relativePath)}. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5239,
        "claim": "calls assertCanManageInstructionsPath -> assertCanApplyProtectedAgentChange with requiresChangeGrant."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5241,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5239,
        "claim": "router.delete(\"/agents/:id/instructions-bundle/file\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.deleteInstructionsFile"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5239,
        "claim": "calls assertCanManageInstructionsPath -> assertCanApplyProtectedAgentChange with requiresChangeGrant."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5241,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 5239,
        "claim": "router.delete(\"/agents/:id/instructions-bundle/file\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/agents.ts",
        "line": 174,
        "claim": "deleteInstructionsFile"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 2347,
        "clientCall": "agentsApi.deleteInstructionsFile",
        "routeSignatures": [
          "delete:agentPath(id, companyId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}`)"
        ]
      }
    ],
    "authorizationRationale": "Agent can directly delete an instruction file only with direct agent_config:update change grant and required consent. This mutation has no proposal state.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:8c8bfe32fec9be3689be",
    "domain": "Skills",
    "customerJob": "deleteTestInput through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 459,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/test-inputs/:inputId\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.deleteTestInput"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 459,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/test-inputs/:inputId\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 101,
        "claim": "deleteTestInput"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 2002,
        "clientCall": "companySkillsApi.deleteTestInput",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:8d917d514dcb2f3838ca",
    "domain": "Work",
    "customerJob": "bulkReviewCases through the mounted client for /api/companies/${companyId}/review-cases/bulk",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/companies/${companyId}/review-cases/bulk",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/review-cases/bulk. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1216,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      }
    ],
    "clientMethods": [
      "pipelinesApi.bulkReviewCases"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1216,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 5056,
        "clientCall": "pipelinesApi.bulkReviewCases",
        "routeSignatures": [
          "post:`/companies/${companyId}/review-cases/bulk`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:8e4b9bd4563bbdc689c5",
    "domain": "Agents",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/agents",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/AgentActionButtons.tsx",
    "apiOperation": "POST /api/companies/${companyId}/agents",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "agents:create"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/agents. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 1767,
        "claim": "assertCanCreateAgentsForCompany checks same-company scope and authorization decision agents:create for req.actor."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4807,
        "claim": "/companies/:companyId/agents checks company.requireBoardApprovalForNewAgents and rejects direct create if enabled."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3957,
        "claim": "const agent = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4807,
        "claim": "router.post(\"/companies/:companyId/agents\",...)"
      }
    ],
    "clientMethods": [
      "agentsApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 1767,
        "claim": "assertCanCreateAgentsForCompany checks same-company scope and authorization decision agents:create for req.actor."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4807,
        "claim": "/companies/:companyId/agents checks company.requireBoardApprovalForNewAgents and rejects direct create if enabled."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3957,
        "claim": "const agent = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4807,
        "claim": "router.post(\"/companies/:companyId/agents\",...)"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AgentActionButtons.tsx",
        "line": 331,
        "clientCall": "agentsApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/agents`"
        ]
      }
    ],
    "authorizationRationale": "The direct create route calls assertCanCreateAgentsForCompany, which authorizes req.actor through the agents:create decision and confirms an Agent actor belongs to the same company. This operation is denied when requireBoardApprovalForNewAgents is true (it directs callers to agent-hires); when policy is off it creates an idle Agent immediately. This direct operation therefore has a clear company-policy precondition, not an implicit proposal contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9452231a9fdc70260cc8",
    "domain": "Work",
    "customerJob": "recompile through the mounted client for /api/status-cards/${id}/recompile",
    "canonicalService": "server/src/services/status-cards.ts",
    "webSurface": "ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx, ui/src/pages/StatusCards/index.tsx",
    "apiOperation": "POST /api/status-cards/${id}/recompile",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/status-cards/${id}/recompile. Owner: server/src/services/status-cards.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/status-cards.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 223,
        "claim": "POST recompile route"
      }
    ],
    "clientMethods": [
      "statusCardsApi.recompile"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 223,
        "claim": "POST recompile route"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx",
        "line": 135,
        "clientCall": "statusCardsApi.recompile",
        "routeSignatures": [
          "post:`/status-cards/${id}/recompile`"
        ]
      },
      {
        "path": "ui/src/pages/StatusCards/index.tsx",
        "line": 81,
        "clientCall": "statusCardsApi.recompile",
        "routeSignatures": [
          "post:`/status-cards/${id}/recompile`"
        ]
      }
    ],
    "authorizationRationale": "The recompile route queues a Task and wakeup under the current authorized actor; the API is Agent-capable and has no current manifest operation mapping.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:96a7b1008510294e3674",
    "domain": "Tasks",
    "customerJob": "createForTarget through the mounted client for /api/cases/${id}/documents/${key}/annotations",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "POST /api/cases/${id}/documents/${key}/annotations",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${id}/documents/${key}/annotations. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.createForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 58,
        "claim": "createForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 48,
        "clientCall": "documentAnnotationsApi.createForTarget",
        "routeSignatures": [
          "post:targetBasePath(target)"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:97153b8a0048ed659d65",
    "domain": "Decisions",
    "customerJob": "removeItem through the mounted client for /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}",
    "canonicalService": "server/src/services/decision-queues.ts",
    "webSurface": "ui/src/components/DecisionTriageStrip.tsx, ui/src/pages/DecisionQueuePage.tsx",
    "apiOperation": "DELETE /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "decision_queue:manage",
      "decision_triage:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}. Owner: server/src/services/decision-queues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/decision-queues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 131,
        "claim": "router.delete("
      }
    ],
    "clientMethods": [
      "decisionQueuesApi.removeItem"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 28,
        "claim": "assertDecisionAccess calls assertBoardOrAgent, assertCompanyAccess, and authorizationService.decide."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 4816,
        "claim": "decision_queue:manage/decision_triage:manage allows active standard-scope same-company Agent actors."
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 47,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/decision-queues.ts",
        "line": 131,
        "claim": "router.delete("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/DecisionTriageStrip.tsx",
        "line": 120,
        "clientCall": "decisionQueuesApi.removeItem",
        "routeSignatures": [
          "delete:`/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`"
        ]
      },
      {
        "path": "ui/src/pages/DecisionQueuePage.tsx",
        "line": 437,
        "clientCall": "decisionQueuesApi.removeItem",
        "routeSignatures": [
          "delete:`/companies/${companyId}/decision-queues/${encodeURIComponent(key)}/items/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`"
        ]
      }
    ],
    "authorizationRationale": "Route helper assertDecisionAccess first requires Board-or-Agent and same-company scope, then calls authorizationService.decide for decision_queue:manage or decision_triage:manage. The current standard-scope policy explicitly allows active company Agents for these actions; each mutation persists actor/run attribution. It is direct queue/triage work, not a proposal or Human confirmation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:97cf9dadf6f7f6481b9c",
    "domain": "Tasks",
    "customerJob": "patch through the mounted client for /api/cases/${idOrIdentifier}",
    "canonicalService": "server/src/routes/cases.ts",
    "webSurface": "ui/src/pages/CaseDetail.tsx, ui/src/pages/Cases.tsx",
    "apiOperation": "PATCH /api/cases/${idOrIdentifier}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/cases/${idOrIdentifier}. Owner: server/src/routes/cases.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/cases.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 846,
        "claim": "router.patch("
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1408,
        "claim": "router.patch(\"/cases/:id\", async (req, res, next) => {"
      }
    ],
    "clientMethods": [
      "casesApi.patch"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 846,
        "claim": "router.patch("
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1408,
        "claim": "router.patch(\"/cases/:id\", async (req, res, next) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 483,
        "clientCall": "casesApi.patch",
        "routeSignatures": [
          "patch:`/cases/${idOrIdentifier}`"
        ]
      },
      {
        "path": "ui/src/pages/Cases.tsx",
        "line": 821,
        "clientCall": "casesApi.patch",
        "routeSignatures": [
          "patch:`/cases/${idOrIdentifier}`"
        ]
      }
    ],
    "authorizationRationale": "The case route resolves the case, requires the Cases feature, and calls assertCompanyAccess; it has no additional Board or action-permission guard. Document/status mutation uses current getActorInfo identity and records Agent attribution. Same-company Agents can perform this operation directly under the current route contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9a541902a6746603e9ba",
    "domain": "Tasks",
    "customerJob": "updateStatusForTarget through the mounted client for /api/cases/${id}/documents/${key}/annotations/${threadId}",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "PATCH /api/cases/${id}/documents/${key}/annotations/${threadId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/cases/${id}/documents/${key}/annotations/${threadId}. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.updateStatusForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 84,
        "claim": "updateStatusForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 102,
        "clientCall": "documentAnnotationsApi.updateStatusForTarget",
        "routeSignatures": [
          "patch:`${targetBasePath(target)}/${threadId}`"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9ae09c579f05721f7409",
    "domain": "Work",
    "customerJob": "update through the mounted client for /api/execution-workspaces/${id}",
    "canonicalService": "server/src/services/execution-workspaces.ts",
    "webSurface": "ui/src/components/ExecutionWorkspaceCloseDialog.tsx, ui/src/pages/ExecutionWorkspaceDetail.tsx",
    "apiOperation": "PATCH /api/execution-workspaces/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "runtime:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/execution-workspaces/${id}. Owner: server/src/services/execution-workspaces.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/execution-workspaces.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 110,
        "claim": "assertRuntimeManageAllowed evaluates runtime:manage for req.actor and company."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 267,
        "claim": "runtime command handler calls runtime:manage and assertCanManageExecutionWorkspaceRuntimeServices with workspace/source issue."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "update handler resolves workspace then enforces runtime:manage before applying patch."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 123,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 140,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 187,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1053,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1141,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Execution workspace not found\");"
      },
      {
        "path": "server/src/services/execution-workspaces.ts",
        "line": 573,
        "claim": ".update(stableStringify({"
      },
      {
        "path": "server/src/services/execution-workspaces.ts",
        "line": 1748,
        "claim": ".update(executionWorkspaces)"
      },
      {
        "path": "server/src/services/execution-workspaces.ts",
        "line": 1783,
        "claim": ".update(executionWorkspaces)"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "router.patch(\"/execution-workspaces/:id\", validate(updateExecutionWorkspaceSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "executionWorkspacesApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 110,
        "claim": "assertRuntimeManageAllowed evaluates runtime:manage for req.actor and company."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 267,
        "claim": "runtime command handler calls runtime:manage and assertCanManageExecutionWorkspaceRuntimeServices with workspace/source issue."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "update handler resolves workspace then enforces runtime:manage before applying patch."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 123,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 140,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 187,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1053,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1141,
        "claim": "const existing = await getAccessibleResource(req, res, svc.getById(id), \"Execution workspace not found\");"
      },
      {
        "path": "server/src/services/execution-workspaces.ts",
        "line": 573,
        "claim": ".update(stableStringify({"
      },
      {
        "path": "server/src/services/execution-workspaces.ts",
        "line": 1748,
        "claim": ".update(executionWorkspaces)"
      },
      {
        "path": "server/src/services/execution-workspaces.ts",
        "line": 1783,
        "claim": ".update(executionWorkspaces)"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "router.patch(\"/execution-workspaces/:id\", validate(updateExecutionWorkspaceSchema), async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/ExecutionWorkspaceCloseDialog.tsx",
        "line": 58,
        "clientCall": "executionWorkspacesApi.update",
        "routeSignatures": [
          "patch:`/execution-workspaces/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/ExecutionWorkspaceDetail.tsx",
        "line": 920,
        "clientCall": "executionWorkspacesApi.update",
        "routeSignatures": [
          "patch:`/execution-workspaces/${id}`"
        ]
      }
    ],
    "authorizationRationale": "The handler resolves the workspace and checks authorizationService runtime:manage for req.actor; runtime command routes additionally call assertCanManageExecutionWorkspaceRuntimeServices with the exact workspace/source issue. Current Agent runtime policy admits only authorized runtime control; request execution is persisted with agent/run identity. It is direct, gated runtime control, not a proposal.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9b6dbe1776d465d14f80",
    "domain": "Skills",
    "customerJob": "delete through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 459,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/test-inputs/:inputId\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.delete"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 459,
        "claim": "router.delete(\"/companies/:companyId/skills/:skillId/test-inputs/:inputId\", async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 5102,
        "clientCall": "companySkillsApi.delete",
        "routeSignatures": [
          "delete:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9b776e3d092f9cec8c52",
    "domain": "Skills",
    "customerJob": "installUpdate through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/install-update",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/install-update",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/install-update. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1365,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.installUpdate"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1365,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 230,
        "claim": "installUpdate"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4571,
        "clientCall": "companySkillsApi.installUpdate",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/install-update`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9c290a8c9a5e767af559",
    "domain": "Tasks",
    "customerJob": "addCommentForTarget through the mounted client for /api/cases/${id}/documents/${key}/annotations/${threadId}/comments",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "POST /api/cases/${id}/documents/${key}/annotations/${threadId}/comments",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${id}/documents/${key}/annotations/${threadId}/comments. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.addCommentForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 69,
        "claim": "addCommentForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 80,
        "clientCall": "documentAnnotationsApi.addCommentForTarget",
        "routeSignatures": [
          "post:`${targetBasePath(target)}/${threadId}/comments`"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9d0f873d3a2b8d2d5414",
    "domain": "Tasks",
    "customerJob": "unarchiveFromInbox through the mounted client for /api/issues/${id}/inbox-archive",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/issue-properties/IssueProperties.tsx, ui/src/pages/Inbox.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/LegacyInbox.tsx",
    "apiOperation": "DELETE /api/issues/${id}/inbox-archive",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "inbox:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/issues/${id}/inbox-archive. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 12143,
        "claim": "inbox unarchive endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12033,
        "claim": "target resolver admits Agent only after inbox:manage decision"
      }
    ],
    "clientMethods": [
      "issuesApi.unarchiveFromInbox"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 12143,
        "claim": "inbox unarchive endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 12033,
        "claim": "target resolver admits Agent only after inbox:manage decision"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/issue-properties/IssueProperties.tsx",
        "line": 492,
        "clientCall": "issuesApi.unarchiveFromInbox",
        "routeSignatures": [
          "delete:`/issues/${id}/inbox-archive`"
        ]
      },
      {
        "path": "ui/src/pages/Inbox.tsx",
        "line": 1921,
        "clientCall": "issuesApi.unarchiveFromInbox",
        "routeSignatures": [
          "delete:`/issues/${id}/inbox-archive`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4039,
        "clientCall": "issuesApi.unarchiveFromInbox",
        "routeSignatures": [
          "delete:`/issues/${id}/inbox-archive`"
        ]
      },
      {
        "path": "ui/src/pages/LegacyInbox.tsx",
        "line": 1799,
        "clientCall": "issuesApi.unarchiveFromInbox",
        "routeSignatures": [
          "delete:`/issues/${id}/inbox-archive`"
        ]
      }
    ],
    "authorizationRationale": "The endpoint resolves the target user from the Board principal or, for Agents, requires scoped inbox:manage authorization.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9dfb80c0cc860c0fcec3",
    "domain": "Tasks",
    "customerJob": "cancelComment through the mounted client for /api/issues/${id}/comments/${commentId}?mode=cancel",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx",
    "apiOperation": "DELETE /api/issues/${id}/comments/${commentId}?mode=cancel",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/issues/${id}/comments/${commentId}?mode=cancel. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17638,
        "claim": "comment delete/cancel endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17648,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17656,
        "claim": "cancel ownership compares comment author to authenticated actor"
      }
    ],
    "clientMethods": [
      "issuesApi.cancelComment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17638,
        "claim": "comment delete/cancel endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17648,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17656,
        "claim": "cancel ownership compares comment author to authenticated actor"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4724,
        "clientCall": "issuesApi.cancelComment",
        "routeSignatures": [
          "delete:`/issues/${id}/comments/${commentId}?mode=cancel`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5119,
        "clientCall": "issuesApi.cancelComment",
        "routeSignatures": [
          "delete:`/issues/${id}/comments/${commentId}?mode=cancel`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5240,
        "clientCall": "issuesApi.cancelComment",
        "routeSignatures": [
          "delete:`/issues/${id}/comments/${commentId}?mode=cancel`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2492,
        "clientCall": "issuesApi.cancelComment",
        "routeSignatures": [
          "delete:`/issues/${id}/comments/${commentId}?mode=cancel`"
        ]
      }
    ],
    "authorizationRationale": "The delete/cancel route requires issue mutation authority and, for cancellation of queued content, checks that the actor owns the comment.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:9f52603c661e8de86134",
    "domain": "Work",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/status-cards",
    "canonicalService": "server/src/services/status-cards.ts",
    "webSurface": "ui/src/pages/StatusCards/CreateStatusCardDialog.tsx",
    "apiOperation": "POST /api/companies/${companyId}/status-cards",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/status-cards. Owner: server/src/services/status-cards.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/status-cards.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 150,
        "claim": "POST status cards mutation route"
      }
    ],
    "clientMethods": [
      "statusCardsApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 150,
        "claim": "POST status cards mutation route"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/StatusCards/CreateStatusCardDialog.tsx",
        "line": 56,
        "clientCall": "statusCardsApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/status-cards`"
        ]
      }
    ],
    "authorizationRationale": "`server/src/routes/status-cards.ts` allows authorized Agent actors to author cards and scopes them to their creator; this is an existing Agent-capable write route with no matching operation ID in the typed manifest.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:a0d88ae047341370d164",
    "domain": "Tasks",
    "customerJob": "rejectInteraction through the mounted client for /api/issues/${id}/interactions/${interactionId}/reject",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/AttentionInteractionResolver.tsx, ui/src/components/AttentionQueueRow.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx, ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/issues/${id}/interactions/${interactionId}/reject",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/interactions/${interactionId}/reject. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17058,
        "claim": "interaction reject route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolver authorization evaluates effective audience"
      }
    ],
    "clientMethods": [
      "issuesApi.rejectInteraction"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17058,
        "claim": "interaction reject route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolver authorization evaluates effective audience"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AttentionInteractionResolver.tsx",
        "line": 104,
        "clientCall": "issuesApi.rejectInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/reject`"
        ]
      },
      {
        "path": "ui/src/components/AttentionQueueRow.tsx",
        "line": 507,
        "clientCall": "issuesApi.rejectInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4893,
        "clientCall": "issuesApi.rejectInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2518,
        "clientCall": "issuesApi.rejectInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/reject`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3363,
        "clientCall": "issuesApi.rejectInteraction",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/reject`"
        ]
      }
    ],
    "authorizationRationale": "Resolution requires current run attribution, issue containment and the effective resolver audience decision. Agent resolution is permitted only when the interaction policy admits that Agent.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:a34e89bf62aa48046432",
    "domain": "Agents",
    "customerJob": "update through the mounted client for /api/agents/${id}?companyId=${companyId}",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/OnboardingWizard.tsx, ui/src/pages/AgentDetail.tsx, ui/src/pages/CompanyEnvironments.tsx, ui/src/pages/Secrets.tsx",
    "apiOperation": "PATCH /api/agents/${id}?companyId=${companyId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/agents/${id}?companyId=${companyId}. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5417,
        "claim": "update handler uses assertCanApplyAgentProfileChange for profile-only fields and assertCanUpdateAgent for other fields; both call authorizationService for req.actor."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      }
    ],
    "clientMethods": [
      "agentsApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5417,
        "claim": "update handler uses assertCanApplyAgentProfileChange for profile-only fields and assertCanUpdateAgent for other fields; both call authorizationService for req.actor."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/OnboardingWizard.tsx",
        "line": 2275,
        "clientCall": "agentsApi.update",
        "routeSignatures": [
          "patch:agentPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 1029,
        "clientCall": "agentsApi.update",
        "routeSignatures": [
          "patch:agentPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 2013,
        "clientCall": "agentsApi.update",
        "routeSignatures": [
          "patch:agentPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/CompanyEnvironments.tsx",
        "line": 1545,
        "clientCall": "agentsApi.update",
        "routeSignatures": [
          "patch:agentPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/Secrets.tsx",
        "line": 4459,
        "clientCall": "agentsApi.update",
        "routeSignatures": [
          "patch:agentPath(id, companyId)"
        ]
      },
      {
        "path": "ui/src/pages/Secrets.tsx",
        "line": 4486,
        "clientCall": "agentsApi.update",
        "routeSignatures": [
          "patch:agentPath(id, companyId)"
        ]
      }
    ],
    "authorizationRationale": "Authenticated Agent can update an Agent resource only when authorization permits agent_config:update; protected profile/instruction fields additionally require direct change grant and consent. Route persists the change directly with revision attribution; no proposal is created.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:a3ed2c8e247ed8575ac7",
    "domain": "Work",
    "customerJob": "moveFolder through the mounted client for /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}/move",
    "canonicalService": "server/src/services/folders.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}/move",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}/move. Owner: server/src/services/folders.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/folders.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "clientMethods": [
      "foldersApi.moveFolder"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4828,
        "clientCall": "foldersApi.moveFolder",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}/move`"
        ]
      }
    ],
    "authorizationRationale": "The existing company folder route admits current company actors and directly invokes folderService with activity attribution. This is existing API accessibility, not proof of a matching Agent tool contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:a56f3797749c80f7545e",
    "domain": "Projects",
    "customerJob": "updateWorkspace through the mounted client for /api/workspaces/${encodeURIComponent(workspaceId)}",
    "canonicalService": "server/src/routes/projects.ts",
    "webSurface": "ui/src/components/LegacyProjectRepository.tsx, ui/src/components/ProjectProperties.tsx, ui/src/pages/ProjectWorkspaceDetail.tsx",
    "apiOperation": "PATCH /api/workspaces/${encodeURIComponent(workspaceId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/workspaces/${encodeURIComponent(workspaceId)}. Owner: server/src/routes/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 694,
        "claim": "workspace update handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 700,
        "claim": "handler requires project read access"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 702,
        "claim": "workspace command-path mutation restrictions"
      }
    ],
    "clientMethods": [
      "projectsApi.updateWorkspace"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 694,
        "claim": "workspace update handler"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 700,
        "claim": "handler requires project read access"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 702,
        "claim": "workspace command-path mutation restrictions"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/LegacyProjectRepository.tsx",
        "line": 18,
        "clientCall": "projectsApi.updateWorkspace",
        "routeSignatures": [
          "patch:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)"
        ]
      },
      {
        "path": "ui/src/components/ProjectProperties.tsx",
        "line": 328,
        "clientCall": "projectsApi.updateWorkspace",
        "routeSignatures": [
          "patch:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)"
        ]
      },
      {
        "path": "ui/src/pages/ProjectWorkspaceDetail.tsx",
        "line": 352,
        "clientCall": "projectsApi.updateWorkspace",
        "routeSignatures": [
          "patch:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)"
        ]
      },
      {
        "path": "ui/src/pages/ProjectWorkspaceDetail.tsx",
        "line": 363,
        "clientCall": "projectsApi.updateWorkspace",
        "routeSignatures": [
          "patch:projectPath(projectId, companyId, `/workspaces/${encodeURIComponent(workspaceId)}`)"
        ]
      }
    ],
    "authorizationRationale": "The workspace update handler requires project:read, rejects unsafe command paths, then updates the workspace without a Board-only mutation guard.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:a6cbdff9edce9b2a9850",
    "domain": "Skills",
    "customerJob": "createTestInput through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 404,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.createTestInput"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 404,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 86,
        "claim": "createTestInput"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 2223,
        "clientCall": "companySkillsApi.createTestInput",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-inputs`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:a987cb66e76a63b4f619",
    "domain": "Agents",
    "customerJob": "wakeup through the mounted client for /api/wakeup",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/IssueRunLedger.tsx, ui/src/components/SidebarRecentTasks.tsx, ui/src/pages/AgentDetail.tsx, ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/wakeup",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "agent:wake"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/wakeup. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5817,
        "claim": "handleWakeupRoute allows an Agent actor only when req.actor.agentId === target id; Board actor requires agent:wake. failedRunId submode requires Board."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6055,
        "claim": "router.post(\"/agents/:id/wakeup\", validate(wakeAgentSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "agentsApi.wakeup"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 5817,
        "claim": "handleWakeupRoute allows an Agent actor only when req.actor.agentId === target id; Board actor requires agent:wake. failedRunId submode requires Board."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 6055,
        "claim": "router.post(\"/agents/:id/wakeup\", validate(wakeAgentSchema), async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/IssueRunLedger.tsx",
        "line": 530,
        "clientCall": "agentsApi.wakeup",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/wakeup\")"
        ]
      },
      {
        "path": "ui/src/components/SidebarRecentTasks.tsx",
        "line": 191,
        "clientCall": "agentsApi.wakeup",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/wakeup\")"
        ]
      },
      {
        "path": "ui/src/components/SidebarRecentTasks.tsx",
        "line": 212,
        "clientCall": "agentsApi.wakeup",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/wakeup\")"
        ]
      },
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 3304,
        "clientCall": "agentsApi.wakeup",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/wakeup\")"
        ]
      },
      {
        "path": "ui/src/pages/AgentDetail.tsx",
        "line": 3349,
        "clientCall": "agentsApi.wakeup",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/wakeup\")"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 6551,
        "clientCall": "agentsApi.wakeup",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/wakeup\")"
        ]
      }
    ],
    "authorizationRationale": "Agent may wake itself only; Board caller must pass agent:wake. Exact failed-run retry is a separate Human-only branch. Raw provider trace requires instance admin.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:aaf0b03d2d120eb9cdf9",
    "domain": "Tasks",
    "customerJob": "retryStageAutomation through the mounted client for /api/cases/${caseId}/automation/retry",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/automation/retry",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/automation/retry. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2674,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.retryStageAutomation"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2674,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2601,
        "clientCall": "pipelinesApi.retryStageAutomation",
        "routeSignatures": [
          "post:`/cases/${caseId}/automation/retry`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2619,
        "clientCall": "pipelinesApi.retryStageAutomation",
        "routeSignatures": [
          "post:`/cases/${caseId}/automation/retry`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:ac3ff6c41562a658df9b",
    "domain": "Apps",
    "customerJob": "bridgePerformAction through the mounted client for /api/plugins/${pluginId}/actions/${encodeURIComponent(key)}",
    "canonicalService": "server/src/routes/plugins.ts",
    "webSurface": "ui/src/plugins/bridge.ts, ui/src/plugins/launchers.tsx",
    "apiOperation": "POST /api/plugins/${pluginId}/actions/${encodeURIComponent(key)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/plugins/${pluginId}/actions/${encodeURIComponent(key)}. Owner: server/src/routes/plugins.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/plugins.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/plugins.ts",
        "line": 1675,
        "claim": "plugin action bridge endpoint"
      },
      {
        "path": "server/src/routes/plugins.ts",
        "line": 1676,
        "claim": "endpoint requires authentication without Board-only guard"
      },
      {
        "path": "server/src/routes/plugins.ts",
        "line": 1714,
        "claim": "authorized company scope and actor context passed to action execution"
      }
    ],
    "clientMethods": [
      "pluginsApi.bridgePerformAction"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/plugins.ts",
        "line": 1675,
        "claim": "plugin action bridge endpoint"
      },
      {
        "path": "server/src/routes/plugins.ts",
        "line": 1676,
        "claim": "endpoint requires authentication without Board-only guard"
      },
      {
        "path": "server/src/routes/plugins.ts",
        "line": 1714,
        "claim": "authorized company scope and actor context passed to action execution"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/plugins/bridge.ts",
        "line": 461,
        "clientCall": "pluginsApi.bridgePerformAction",
        "routeSignatures": [
          "post:`/plugins/${pluginId}/actions/${encodeURIComponent(key)}`"
        ]
      },
      {
        "path": "ui/src/plugins/launchers.tsx",
        "line": 691,
        "clientCall": "pluginsApi.bridgePerformAction",
        "routeSignatures": [
          "post:`/plugins/${pluginId}/actions/${encodeURIComponent(key)}`"
        ]
      }
    ],
    "authorizationRationale": "The action bridge endpoint uses assertAuthenticated (which admits Agent callers), validates the authorized company scope, and passes the actual actor context to the plugin worker. This proves API access only; no native operation manifest parity is claimed.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:accd8a68e1dabca8b4a4",
    "domain": "Skills",
    "customerJob": "syncSkills through the mounted client for /api/skills/sync",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/skill-studio/AgentsUsingSkillDialog.tsx, ui/src/pages/CompanySkills.tsx, ui/src/pages/agent-skills/AgentSkillsTab.tsx",
    "apiOperation": "POST /api/skills/sync",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/skills/sync. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 3951,
        "claim": "requiresAgentSkillAssignmentMode, getAccessibleResource, then assertCanUpdateAgent; activity/revision retain actor identity."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3957,
        "claim": "const agent = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3951,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "agentsApi.syncSkills"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 3951,
        "claim": "requiresAgentSkillAssignmentMode, getAccessibleResource, then assertCanUpdateAgent; activity/revision retain actor identity."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3957,
        "claim": "const agent = await getAccessibleResource(req, res, svc.getById(id), \"Agent not found\");"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 3951,
        "claim": "router.post("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/skill-studio/AgentsUsingSkillDialog.tsx",
        "line": 192,
        "clientCall": "agentsApi.syncSkills",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/skills/sync\")"
        ]
      },
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4728,
        "clientCall": "agentsApi.syncSkills",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/skills/sync\")"
        ]
      },
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 5035,
        "clientCall": "agentsApi.syncSkills",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/skills/sync\")"
        ]
      },
      {
        "path": "ui/src/pages/agent-skills/AgentSkillsTab.tsx",
        "line": 116,
        "clientCall": "agentsApi.syncSkills",
        "routeSignatures": [
          "post:agentPath(id, companyId, \"/skills/sync\")"
        ]
      }
    ],
    "authorizationRationale": "Agent skill assignment is direct only when the feature mode and agent_config:update authorization allow it; route persists the new desired skill assignment, with no separate proposal state.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:ae984eaa362ded251b5f",
    "domain": "Work",
    "customerJob": "moveItem through the mounted client for /api/companies/${encodeURIComponent(companyId)}/folders/items/move",
    "canonicalService": "server/src/services/folders.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/folders/items/move",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/folders/items/move. Owner: server/src/services/folders.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/folders.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "clientMethods": [
      "foldersApi.moveItem"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4783,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4867,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4887,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4985,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 479,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 543,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 756,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 542,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 606,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 854,
        "clientCall": "foldersApi.moveItem",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders/items/move`"
        ]
      }
    ],
    "authorizationRationale": "The existing company folder route admits current company actors and directly invokes folderService with activity attribution. This is existing API accessibility, not proof of a matching Agent tool contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:afa139debf2e142670d5",
    "domain": "Co-workers",
    "customerJob": "createCompanyInvite through the mounted client for /api/companies/${companyId}/invites",
    "canonicalService": "server/src/routes/access.ts",
    "webSurface": "ui/src/components/access/InvitesSection.tsx, ui/src/components/new-agent/ExternalAgentInviteDialog.tsx",
    "apiOperation": "POST /api/companies/${companyId}/invites",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "users:invite"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/invites. Owner: server/src/routes/access.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/access.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission calls assertCompanyAccess and for req.actor.type === \"agent\" checks access.hasPermission(companyId,\"agent\",agentId,permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 3293,
        "claim": "createCompanyInvite handler calls assertCompanyPermission(...,\"users:invite\")."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 3293,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "accessApi.createCompanyInvite"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission calls assertCompanyAccess and for req.actor.type === \"agent\" checks access.hasPermission(companyId,\"agent\",agentId,permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 3293,
        "claim": "createCompanyInvite handler calls assertCompanyPermission(...,\"users:invite\")."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 3293,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/access.ts",
        "line": 264,
        "claim": "createCompanyInvite"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/access/InvitesSection.tsx",
        "line": 122,
        "clientCall": "accessApi.createCompanyInvite",
        "routeSignatures": [
          "post:`/companies/${companyId}/invites`"
        ]
      },
      {
        "path": "ui/src/components/new-agent/ExternalAgentInviteDialog.tsx",
        "line": 37,
        "clientCall": "accessApi.createCompanyInvite",
        "routeSignatures": [
          "post:`/companies/${companyId}/invites`"
        ]
      }
    ],
    "authorizationRationale": "Route invokes assertCompanyPermission(users:invite), which explicitly checks a current same-company Agent principal’s users:invite grant (or the Board user’s permission). The actor is recorded as agent/user in activity. For bootstrap invites revoke is separately instance-admin only; this ordinary company invite operation is Agent-accessible when permission is granted, with invite join types constrained by the invite record.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:afac171967bfaaae15f0",
    "domain": "Agents",
    "customerJob": "hire through the mounted client for /api/companies/${companyId}/agent-hires",
    "canonicalService": "server/src/services/agents.ts",
    "webSurface": "ui/src/components/AgentActionButtons.tsx, ui/src/components/OnboardingWizard.tsx, ui/src/components/new-agent/NewAgentSetup.tsx",
    "apiOperation": "POST /api/companies/${companyId}/agent-hires",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "agents:create"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/agent-hires. Owner: server/src/services/agents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/agents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 1767,
        "claim": "assertCanCreateAgentsForCompany checks agents:create for req.actor and same-company Agent identity."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4487,
        "claim": "hire handler calls that helper before creating."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4638,
        "claim": "derives status from company.requireBoardApprovalForNewAgents (pending_approval vs idle)."
      },
      {
        "path": "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
        "line": 862,
        "claim": "dispatches hire_agent to POST /api/companies/{companyId}/agent-hires (related manifest route only)."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4489,
        "claim": "await assertCanCreateAgentsForCompany(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4487,
        "claim": "router.post(\"/companies/:companyId/agent-hires\",...)"
      }
    ],
    "clientMethods": [
      "agentsApi.hire"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 1767,
        "claim": "assertCanCreateAgentsForCompany checks agents:create for req.actor and same-company Agent identity."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4487,
        "claim": "hire handler calls that helper before creating."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4638,
        "claim": "derives status from company.requireBoardApprovalForNewAgents (pending_approval vs idle)."
      },
      {
        "path": "server/src/services/native-runtime/paperclip-runner-tool-authority.ts",
        "line": 862,
        "claim": "dispatches hire_agent to POST /api/companies/{companyId}/agent-hires (related manifest route only)."
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1768,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1786,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1787,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1798,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 1800,
        "claim": "assertCompanyAccess(req, agent.companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4489,
        "claim": "await assertCanCreateAgentsForCompany(req, companyId);"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 4487,
        "claim": "router.post(\"/companies/:companyId/agent-hires\",...)"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AgentActionButtons.tsx",
        "line": 334,
        "clientCall": "agentsApi.hire",
        "routeSignatures": [
          "post:`/companies/${companyId}/agent-hires`"
        ]
      },
      {
        "path": "ui/src/components/OnboardingWizard.tsx",
        "line": 2199,
        "clientCall": "agentsApi.hire",
        "routeSignatures": [
          "post:`/companies/${companyId}/agent-hires`"
        ]
      },
      {
        "path": "ui/src/components/new-agent/NewAgentSetup.tsx",
        "line": 503,
        "clientCall": "agentsApi.hire",
        "routeSignatures": [
          "post:`/companies/${companyId}/agent-hires`"
        ]
      }
    ],
    "authorizationRationale": "The exact hire route calls assertCanCreateAgentsForCompany and allows an Agent actor when its current agents:create decision allows. This route is also used by native hire_agent (related manifest operation blentera.native.agent.hire, but no exact manifest parity claimed). The company setting requireBoardApprovalForNewAgents selects the persisted postcondition: pending_approval with approval record when on, idle immediately when off. Therefore it is direct Agent-capable subject to permission, safety validation, and company approval policy; under the approval-on policy it creates a pending hire requiring later Human approval.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:afe475bdde43ca8143f1",
    "domain": "Work",
    "customerJob": "decide through the mounted client for /api/companies/${companyId}/work-signals/${id}/${action}",
    "canonicalService": "server/src/services/work-signals/work-signal-service.ts",
    "webSurface": "ui/src/pages/WorkSignals.tsx",
    "apiOperation": "POST /api/companies/${companyId}/work-signals/${id}/${action}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/work-signals/${id}/${action}. Owner: server/src/services/work-signals/work-signal-service.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/work-signals/work-signal-service.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/work-signals.ts",
        "line": 11,
        "claim": "decision route passes current req.actor into workSignalService.decide; company scope is checked at route boundary."
      },
      {
        "path": "server/src/services/work-signals/work-signal-service.ts",
        "line": 144,
        "claim": "decide rechecks owner/version/source and creates a project control proposal only for explicit permitted dates"
      }
    ],
    "clientMethods": [
      "workSignalsApi.decide"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/work-signals.ts",
        "line": 11,
        "claim": "decision route passes current req.actor into workSignalService.decide; company scope is checked at route boundary."
      },
      {
        "path": "server/src/services/work-signals/work-signal-service.ts",
        "line": 144,
        "claim": "decide rechecks owner/version/source and creates a project control proposal only for explicit permitted dates"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/WorkSignals.tsx",
        "line": 20,
        "clientCall": "workSignalsApi.decide",
        "routeSignatures": [
          "post:`/companies/${companyId}/work-signals/${id}/${action}`"
        ]
      }
    ],
    "authorizationRationale": "`workSignalService.decide` applies source retention, owner, version and Task ACL checks. `apply` only creates a Roadmap proposal for an explicit shared-source date and requires later Human planning review; this is a candidate proposal operation absent from the typed manifest.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b0094a3bc9b114fbbb60",
    "domain": "Work",
    "customerJob": "createStage through the mounted client for /api/pipelines/${pipelineId}/stages",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/PipelineSettings.tsx",
    "apiOperation": "POST /api/pipelines/${pipelineId}/stages",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/pipelines/${pipelineId}/stages. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1524,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 382,
        "claim": "actorForMutation accepts Board or Agent with agentId and required runId"
      }
    ],
    "clientMethods": [
      "pipelinesApi.createStage"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1524,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 382,
        "claim": "actorForMutation accepts Board or Agent with agentId and required runId"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 2057,
        "clientCall": "pipelinesApi.createStage",
        "routeSignatures": [
          "post:`/pipelines/${pipelineId}/stages`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b0ab650fd3386aa6f771",
    "domain": "Skills",
    "customerJob": "projectSkill through the mounted client for /api/companies/${companyId}/playbooks/${playbookId}/compile-skill-candidate",
    "canonicalService": "server/src/services/playbooks.ts",
    "webSurface": "ui/src/pages/Playbooks.tsx",
    "apiOperation": "POST /api/companies/${companyId}/playbooks/${playbookId}/compile-skill-candidate",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/playbooks/${playbookId}/compile-skill-candidate. Owner: server/src/services/playbooks.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/playbooks.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/playbooks.ts",
        "line": 26,
        "claim": "projectSkill route delegates to the Playbook service; it requires a current approved source revision and calls Skill lifecycle proposal creation, without activating the candidate."
      },
      {
        "path": "server/src/services/playbooks.ts",
        "claim": "The operation creates a Skill candidate from an approved Playbook, but exact identity with the manifest native skill-create tool contract was not established; keep it unmapped."
      }
    ],
    "clientMethods": [
      "v5Api.projectSkill"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/playbooks.ts",
        "line": 26,
        "claim": "projectSkill route delegates to the Playbook service; it requires a current approved source revision and calls Skill lifecycle proposal creation, without activating the candidate."
      },
      {
        "path": "server/src/services/playbooks.ts",
        "claim": "The operation creates a Skill candidate from an approved Playbook, but exact identity with the manifest native skill-create tool contract was not established; keep it unmapped."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Playbooks.tsx",
        "line": 49,
        "clientCall": "v5Api.projectSkill",
        "routeSignatures": [
          "post:`${playbook(cid, id)}/compile-skill-candidate`"
        ]
      }
    ],
    "authorizationRationale": "The operation creates a Skill candidate from an approved Playbook, but exact identity with the manifest native skill-create tool contract was not established; keep it unmapped.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b18def561045f289c944",
    "domain": "Tasks",
    "customerJob": "createIssueLink through the mounted client for /api/cases/${caseId}/issue-links",
    "canonicalService": "server/src/routes/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/issue-links",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/issue-links. Owner: server/src/routes/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2498,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.createIssueLink"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2498,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2371,
        "clientCall": "pipelinesApi.createIssueLink",
        "routeSignatures": [
          "post:`/cases/${caseId}/issue-links`",
          "post:`/cases/${caseId}/open-conversation`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2384,
        "clientCall": "pipelinesApi.createIssueLink",
        "routeSignatures": [
          "post:`/cases/${caseId}/issue-links`",
          "post:`/cases/${caseId}/open-conversation`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b24fc1544cc407a808c4",
    "domain": "Work",
    "customerJob": "exportPreview through the mounted client for /api/companies/${companyId}/exports/preview",
    "canonicalService": "server/src/services/companies.ts",
    "webSurface": "ui/src/pages/CompanyExport.tsx",
    "apiOperation": "POST /api/companies/${companyId}/exports/preview",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/exports/preview. Owner: server/src/services/companies.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/companies.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/companies.ts",
        "line": 419,
        "claim": "assertSameCompanyCeoAgentOrBoard delegates to authorization.assertCompanyCeoAgentOrBoard."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 118,
        "claim": "allows only same-company CEO Agent or Board."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 594,
        "claim": "and 1271-1278 export handlers call CEO/Board guard; assertSupportCaseExportAccess and V7 expectedUserId gate restrict Human-only variants."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 392,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 413,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 416,
        "claim": "assertCompanyAccess(req, target.companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 420,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 426,
        "claim": "if (req.actor.type !== \"board\" || req.actor.source === \"local_implicit\" || req.actor.isInstanceAdmin) return;"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 1271,
        "claim": "router.post(\"/:companyId/exports/preview\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companiesApi.exportPreview"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/companies.ts",
        "line": 419,
        "claim": "assertSameCompanyCeoAgentOrBoard delegates to authorization.assertCompanyCeoAgentOrBoard."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 118,
        "claim": "allows only same-company CEO Agent or Board."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 594,
        "claim": "and 1271-1278 export handlers call CEO/Board guard; assertSupportCaseExportAccess and V7 expectedUserId gate restrict Human-only variants."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 392,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 413,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 416,
        "claim": "assertCompanyAccess(req, target.companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 420,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 426,
        "claim": "if (req.actor.type !== \"board\" || req.actor.source === \"local_implicit\" || req.actor.isInstanceAdmin) return;"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 1271,
        "claim": "router.post(\"/:companyId/exports/preview\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/companies.ts",
        "line": 142,
        "claim": "exportPreview"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanyExport.tsx",
        "line": 755,
        "clientCall": "companiesApi.exportPreview",
        "routeSignatures": [
          "post:`/companies/${companyId}/exports/preview`"
        ]
      }
    ],
    "authorizationRationale": "The exact route calls assertSameCompanyCeoAgentOrBoard for company exports, which admits a same-company CEO Agent or Board. The export service receives req.actor and applies narrower per-domain filters; support-case and V7-state export options require a matching Human Board user. Base company export is direct Agent-capable subject to CEO role, with those Human-only export variants blocked.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b2bb628c6f9f84262c4b",
    "domain": "Work",
    "customerJob": "patch through the mounted client for /api/status-cards/${id}",
    "canonicalService": "server/src/services/status-cards.ts",
    "webSurface": "ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx, ui/src/pages/StatusCards/index.tsx",
    "apiOperation": "PATCH /api/status-cards/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/status-cards/${id}. Owner: server/src/services/status-cards.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/status-cards.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 177,
        "claim": "PATCH status-card route"
      }
    ],
    "clientMethods": [
      "statusCardsApi.patch"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 50,
        "claim": "assertCanManageCard restricts agents to cards they authored"
      },
      {
        "path": "server/src/routes/status-cards.ts",
        "line": 177,
        "claim": "PATCH status-card route"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/StatusCards/StatusCardDetailDrawer.tsx",
        "line": 152,
        "clientCall": "statusCardsApi.patch",
        "routeSignatures": [
          "patch:`/status-cards/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/StatusCards/index.tsx",
        "line": 87,
        "clientCall": "statusCardsApi.patch",
        "routeSignatures": [
          "patch:`/status-cards/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/StatusCards/index.tsx",
        "line": 93,
        "clientCall": "statusCardsApi.patch",
        "routeSignatures": [
          "patch:`/status-cards/${id}`"
        ]
      }
    ],
    "authorizationRationale": "The patch route checks current `tasks:assign` authority and restricts Agents to cards they authored; the API is Agent-capable but no current manifest operation classifies this mutation.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b424a3804c120dfea073",
    "domain": "Work",
    "customerJob": "update through the mounted client for /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}",
    "canonicalService": "server/src/services/folders.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "PATCH /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}. Owner: server/src/services/folders.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/folders.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "clientMethods": [
      "foldersApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4812,
        "clientCall": "foldersApi.update",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 508,
        "clientCall": "foldersApi.update",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 571,
        "clientCall": "foldersApi.update",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/folders/${encodeURIComponent(folderId)}`"
        ]
      }
    ],
    "authorizationRationale": "The existing company folder route admits current company actors and directly invokes folderService with activity attribution. This is existing API accessibility, not proof of a matching Agent tool contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b53daedb5c09dae18993",
    "domain": "Skills",
    "customerJob": "createVersion through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/versions",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/versions",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/versions. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 769,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.createVersion"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 769,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 76,
        "claim": "createVersion"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3454,
        "clientCall": "companySkillsApi.createVersion",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/versions`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b53dea5b4ac0c26e92aa",
    "domain": "Projects",
    "customerJob": "patch through the mounted client for /api/companies/${cid}/projects/${pid}/roadmap/tasks/${editor.id}/forecast",
    "canonicalService": "server/src/services/project-control.ts",
    "webSurface": "ui/src/pages/ProjectRoadmap.tsx",
    "apiOperation": "PATCH /api/companies/${cid}/projects/${pid}/roadmap/tasks/${editor.id}/forecast",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${cid}/projects/${pid}/roadmap/tasks/${editor.id}/forecast. Owner: server/src/services/project-control.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/project-control.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/project-control.ts",
        "line": 38,
        "claim": "Forecast route checks company access and dispatches forecast update."
      },
      {
        "path": "server/src/services/project-control.ts",
        "line": 173,
        "claim": "forecast rejects Agent updates unless project policy allowAgentForecast is true and forecast ownership is internal."
      }
    ],
    "clientMethods": [
      "api.patch"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/project-control.ts",
        "line": 38,
        "claim": "Forecast route checks company access and dispatches forecast update."
      },
      {
        "path": "server/src/services/project-control.ts",
        "line": 173,
        "claim": "forecast rejects Agent updates unless project policy allowAgentForecast is true and forecast ownership is internal."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/ProjectRoadmap.tsx",
        "line": 96,
        "clientCall": "api.patch",
        "routeSignatures": [
          "patch:`/companies/${cid}/projects/${pid}/roadmap/tasks/${editor.id}/forecast`"
        ]
      }
    ],
    "authorizationRationale": "Canonical service permits an Agent only under project forecast ownership/policy checks; no manifest ID asserted.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b563265def119abe5f8f",
    "domain": "Projects",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/projects",
    "canonicalService": "server/src/routes/projects.ts",
    "webSurface": "ui/src/components/NewProjectDialog.tsx, ui/src/components/OnboardingWizard.tsx",
    "apiOperation": "POST /api/companies/${companyId}/projects",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/projects. Owner: server/src/routes/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 346,
        "claim": "project create route"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 355,
        "claim": "Agent needs current task-bound projectToolContext"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 359,
        "claim": "source task is bound to created project"
      }
    ],
    "clientMethods": [
      "projectsApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 346,
        "claim": "project create route"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 355,
        "claim": "Agent needs current task-bound projectToolContext"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 359,
        "claim": "source task is bound to created project"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/NewProjectDialog.tsx",
        "line": 38,
        "clientCall": "projectsApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/projects`"
        ]
      },
      {
        "path": "ui/src/components/OnboardingWizard.tsx",
        "line": 1721,
        "clientCall": "projectsApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/projects`"
        ]
      }
    ],
    "authorizationRationale": "Project creation permits an Agent only with a current task-bound run context, and binds source issue provenance to that run.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:b693680869f57a562fd9",
    "domain": "Work",
    "customerJob": "hypothesis through the mounted client for /api/companies/${companyId}/learning/cycles/${id}/hypotheses",
    "canonicalService": "server/src/services/learning/learning-service.ts",
    "webSurface": "ui/src/pages/OrganizationalLearning.tsx",
    "apiOperation": "POST /api/companies/${companyId}/learning/cycles/${id}/hypotheses",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/learning/cycles/${id}/hypotheses. Owner: server/src/services/learning/learning-service.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/learning/learning-service.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 88,
        "claim": "propose admission uses Agent worker guard"
      },
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 193,
        "claim": "addHypothesis performs propose admission"
      }
    ],
    "clientMethods": [
      "learningApi.hypothesis"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 88,
        "claim": "propose admission uses Agent worker guard"
      },
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 193,
        "claim": "addHypothesis performs propose admission"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/OrganizationalLearning.tsx",
        "line": 91,
        "clientCall": "learningApi.hypothesis",
        "routeSignatures": [
          "post:`/companies/${companyId}/learning/cycles/${id}/hypotheses`"
        ]
      }
    ],
    "authorizationRationale": "Hypothesis creation uses the same propose admission for Agent workers and records the hypothesis as a candidate for later evaluation/review.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:ba02f4fab7dc0af94b88",
    "domain": "Tasks",
    "customerJob": "deleteComment through the mounted client for /api/issues/${id}/comments/${commentId}",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx",
    "apiOperation": "DELETE /api/issues/${id}/comments/${commentId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: DELETE /api/issues/${id}/comments/${commentId}. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17638,
        "claim": "comment delete endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17648,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17656,
        "claim": "actor ownership is checked against comment author"
      }
    ],
    "clientMethods": [
      "issuesApi.deleteComment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17638,
        "claim": "comment delete endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17648,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 17656,
        "claim": "actor ownership is checked against comment author"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5273,
        "clientCall": "issuesApi.deleteComment",
        "routeSignatures": [
          "delete:`/issues/${id}/comments/${commentId}`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2474,
        "clientCall": "issuesApi.deleteComment",
        "routeSignatures": [
          "delete:`/issues/${id}/comments/${commentId}`"
        ]
      }
    ],
    "authorizationRationale": "Comment deletion applies issue mutation authority; the route limits cancellation/deletion of queued comments to their authenticated author.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:bcb36fb05bb6fa3908b9",
    "domain": "Tasks",
    "customerJob": "restoreDocumentRevision through the mounted client for /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "canonicalService": "server/src/routes/cases.ts",
    "webSurface": "ui/src/pages/CaseDetail.tsx",
    "apiOperation": "POST /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore. Owner: server/src/routes/cases.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/cases.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1071,
        "claim": "router.post(\"/cases/:id/documents/:key/revisions/:revisionId/restore\", async (req, res, next) => {"
      }
    ],
    "clientMethods": [
      "casesApi.restoreDocumentRevision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1071,
        "claim": "router.post(\"/cases/:id/documents/:key/revisions/:revisionId/restore\", async (req, res, next) => {"
      },
      {
        "path": "ui/src/api/cases.ts",
        "line": 319,
        "claim": "restoreDocumentRevision"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 531,
        "clientCall": "casesApi.restoreDocumentRevision",
        "routeSignatures": [
          "post:`/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore`"
        ]
      }
    ],
    "authorizationRationale": "The case route resolves the case, requires the Cases feature, and calls assertCompanyAccess; it has no additional Board or action-permission guard. Document/status mutation uses current getActorInfo identity and records Agent attribution. Same-company Agents can perform this operation directly under the current route contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:be3665b7e399fb58baae",
    "domain": "Work",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/pipelines",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/companies/${companyId}/pipelines",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/pipelines. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1150,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 382,
        "claim": "actorForMutation accepts Board or Agent with agentId and required runId"
      }
    ],
    "clientMethods": [
      "pipelinesApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1150,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 382,
        "claim": "actorForMutation accepts Board or Agent with agentId and required runId"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 969,
        "clientCall": "pipelinesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/pipelines`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 976,
        "clientCall": "pipelinesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/pipelines`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:c0bbe9aa7fc118bfc2cd",
    "domain": "Skills",
    "customerJob": "installCatalog through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/install-catalog",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/install-catalog",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/install-catalog. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1216,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.installCatalog"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1216,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 253,
        "claim": "installCatalog"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4712,
        "clientCall": "companySkillsApi.installCatalog",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/install-catalog`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:c15fbf958bcc44ca8240",
    "domain": "Decisions",
    "customerJob": "addComment through the mounted client for /api/approvals/${id}/comments",
    "canonicalService": "server/src/services/approvals.ts",
    "webSurface": "ui/src/pages/ApprovalDetail.tsx",
    "apiOperation": "POST /api/approvals/${id}/comments",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/approvals/${id}/comments. Owner: server/src/services/approvals.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/approvals.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/approvals.ts",
        "line": 523,
        "claim": "approval comment handler resolves the resource, calls assertApprovalMutationAllowedByRunContext, and stores agentId/runId attribution"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 53,
        "claim": "if (req.query.expectedUserId !== undefined) {"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 172,
        "claim": "assertCompanyAccess(req, approval.companyId);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 219,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 236,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 299,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 525,
        "claim": "const approval = await getAccessibleResource(req, res, svc.getById(id), \"Approval not found\");"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 527,
        "claim": "if (!(await assertApprovalMutationAllowedByRunContext(req, res, approval.companyId))) return;"
      },
      {
        "path": "server/src/services/approvals.ts",
        "line": 317,
        "claim": "addComment: async ("
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 523,
        "claim": "router.post(\"/approvals/:id/comments\", validate(addApprovalCommentSchema), async (req, res) => {"
      }
    ],
    "clientMethods": [
      "approvalsApi.addComment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/approvals.ts",
        "line": 523,
        "claim": "approval comment handler resolves the resource, calls assertApprovalMutationAllowedByRunContext, and stores agentId/runId attribution"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 53,
        "claim": "if (req.query.expectedUserId !== undefined) {"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 172,
        "claim": "assertCompanyAccess(req, approval.companyId);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 219,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 236,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 299,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 525,
        "claim": "const approval = await getAccessibleResource(req, res, svc.getById(id), \"Approval not found\");"
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 527,
        "claim": "if (!(await assertApprovalMutationAllowedByRunContext(req, res, approval.companyId))) return;"
      },
      {
        "path": "server/src/services/approvals.ts",
        "line": 317,
        "claim": "addComment: async ("
      },
      {
        "path": "server/src/routes/approvals.ts",
        "line": 523,
        "claim": "router.post(\"/approvals/:id/comments\", validate(addApprovalCommentSchema), async (req, res) => {"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/ApprovalDetail.tsx",
        "line": 126,
        "clientCall": "approvalsApi.addComment",
        "routeSignatures": [
          "post:`/approvals/${id}/comments`"
        ]
      }
    ],
    "authorizationRationale": "Current route uses getAccessibleResource with the Agent actor, blocks only the status-only recovery context via assertApprovalMutationAllowedByRunContext, and records the comment with agent/run attribution. This is a comment, not an approval decision.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:c40fe7212a23f07d47ab",
    "domain": "Work",
    "customerJob": "create through the mounted client for /api/companies/${encodeURIComponent(companyId)}/folders",
    "canonicalService": "server/src/services/folders.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/folders",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/folders. Owner: server/src/services/folders.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/folders.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "clientMethods": [
      "foldersApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/folders.ts",
        "line": 32,
        "claim": "ensure-my explicitly checks Board user; other folder mutations assertCompanyAccess and call folderService"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4772,
        "clientCall": "foldersApi.create",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4967,
        "clientCall": "foldersApi.create",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 469,
        "clientCall": "foldersApi.create",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 532,
        "clientCall": "foldersApi.create",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/folders`"
        ]
      }
    ],
    "authorizationRationale": "The existing company folder route admits current company actors and directly invokes folderService with activity attribution. This is existing API accessibility, not proof of a matching Agent tool contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:c79b40cc4f40b28e60d3",
    "domain": "Agents",
    "customerJob": "controlRuntimeServices through the mounted client for /api/execution-workspaces/${id}/runtime-services/${action}",
    "canonicalService": "server/src/services/execution-workspaces.ts",
    "webSurface": "ui/src/components/ProjectWorkspacesContent.tsx",
    "apiOperation": "POST /api/execution-workspaces/${id}/runtime-services/${action}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "runtime:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/execution-workspaces/${id}/runtime-services/${action}. Owner: server/src/services/execution-workspaces.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/execution-workspaces.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 110,
        "claim": "assertRuntimeManageAllowed evaluates runtime:manage for req.actor and company."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 267,
        "claim": "runtime command handler calls runtime:manage and assertCanManageExecutionWorkspaceRuntimeServices with workspace/source issue."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "update handler resolves workspace then enforces runtime:manage before applying patch."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 123,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 140,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 187,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1053,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1046,
        "claim": "router.post(\"/execution-workspaces/:id/runtime-services/:action\", validate(workspaceRuntimeControlTargetSchema), handleExecutionWorkspaceRuntimeCommand);"
      }
    ],
    "clientMethods": [
      "executionWorkspacesApi.controlRuntimeServices"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 110,
        "claim": "assertRuntimeManageAllowed evaluates runtime:manage for req.actor and company."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 267,
        "claim": "runtime command handler calls runtime:manage and assertCanManageExecutionWorkspaceRuntimeServices with workspace/source issue."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "update handler resolves workspace then enforces runtime:manage before applying patch."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 123,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 140,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 187,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1053,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1046,
        "claim": "router.post(\"/execution-workspaces/:id/runtime-services/:action\", validate(workspaceRuntimeControlTargetSchema), handleExecutionWorkspaceRuntimeCommand);"
      },
      {
        "path": "ui/src/api/execution-workspaces.ts",
        "line": 100,
        "claim": "controlRuntimeServices"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/ProjectWorkspacesContent.tsx",
        "line": 40,
        "clientCall": "executionWorkspacesApi.controlRuntimeServices",
        "routeSignatures": [
          "post:`/execution-workspaces/${id}/runtime-services/${action}`"
        ]
      }
    ],
    "authorizationRationale": "The handler resolves the workspace and checks authorizationService runtime:manage for req.actor; runtime command routes additionally call assertCanManageExecutionWorkspaceRuntimeServices with the exact workspace/source issue. Current Agent runtime policy admits only authorized runtime control; request execution is persisted with agent/run identity. It is direct, gated runtime control, not a proposal.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:cbfae083e10cff3ac407",
    "domain": "Routines",
    "customerJob": "run through the mounted client for /api/routines/${id}/run",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/pages/ExecutionWorkspaceDetail.tsx, ui/src/pages/RoutineDetail.production.tsx, ui/src/pages/RoutineDetail.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "POST /api/routines/${id}/run",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/routines/${id}/run. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 4300,
        "claim": "Routine run dispatches an execution through the canonical routine scheduler."
      }
    ],
    "clientMethods": [
      "routinesApi.run"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 673,
        "claim": "run route verifies managed routine and dispatches runRoutine"
      },
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "Agent routine authority is restricted to the assigned agent"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/ExecutionWorkspaceDetail.tsx",
        "line": 674,
        "clientCall": "routinesApi.run",
        "routeSignatures": [
          "post:`/routines/${id}/run`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 458,
        "clientCall": "routinesApi.run",
        "routeSignatures": [
          "post:`/routines/${id}/run`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 461,
        "clientCall": "routinesApi.run",
        "routeSignatures": [
          "post:`/routines/${id}/run`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 590,
        "clientCall": "routinesApi.run",
        "routeSignatures": [
          "post:`/routines/${id}/run`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 645,
        "clientCall": "routinesApi.run",
        "routeSignatures": [
          "post:`/routines/${id}/run`"
        ]
      }
    ],
    "authorizationRationale": "The route checks routine ownership and company access, then dispatches `runRoutine`; Agents may run only their own assigned routine. This is a real Agent-accessible execution operation, distinct from the inactive `blentera.routine.draft.create` contract, and lacks its own manifest ID.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:cce1072434afdc7c5b0f",
    "domain": "Tasks",
    "customerJob": "submitInteractionVerdicts through the mounted client for /api/issues/${id}/interactions/${interactionId}/verdicts",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/AttentionInteractionResolver.tsx, ui/src/pages/IssueDetail.tsx",
    "apiOperation": "POST /api/issues/${id}/interactions/${interactionId}/verdicts",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/interactions/${interactionId}/verdicts. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17254,
        "claim": "interaction verdict submission route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolver authorization evaluates effective audience"
      }
    ],
    "clientMethods": [
      "issuesApi.submitInteractionVerdicts"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 17254,
        "claim": "interaction verdict submission route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 6018,
        "claim": "resolution helper checks run attribution and containment"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 5961,
        "claim": "resolver authorization evaluates effective audience"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/AttentionInteractionResolver.tsx",
        "line": 124,
        "clientCall": "issuesApi.submitInteractionVerdicts",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/verdicts`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4955,
        "clientCall": "issuesApi.submitInteractionVerdicts",
        "routeSignatures": [
          "post:`/issues/${id}/interactions/${interactionId}/verdicts`"
        ]
      }
    ],
    "authorizationRationale": "Verdict submission requires current run attribution, issue containment and the effective resolver audience decision; Agent access is policy-limited.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:ccf887bf4b215e48c846",
    "domain": "Projects",
    "customerJob": "createWorkspace through the mounted client for /api/workspaces",
    "canonicalService": "server/src/routes/projects.ts",
    "webSurface": "ui/src/components/ProjectProperties.tsx",
    "apiOperation": "POST /api/workspaces",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "project:read"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/workspaces. Owner: server/src/routes/projects.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/projects.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 200,
        "claim": "getReadableProject applies project:read authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 659,
        "claim": "workspace creation handler accepts readable project"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 663,
        "claim": "workspace command-path mutation restrictions"
      }
    ],
    "clientMethods": [
      "projectsApi.createWorkspace"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/projects.ts",
        "line": 200,
        "claim": "getReadableProject applies project:read authorization"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 659,
        "claim": "workspace creation handler accepts readable project"
      },
      {
        "path": "server/src/routes/projects.ts",
        "line": 663,
        "claim": "workspace command-path mutation restrictions"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/ProjectProperties.tsx",
        "line": 308,
        "clientCall": "projectsApi.createWorkspace",
        "routeSignatures": [
          "post:projectPath(projectId, companyId, \"/workspaces\")"
        ]
      }
    ],
    "authorizationRationale": "The route requires project:read through getReadableProject and accepts the authenticated actor without a Board-only mutation guard; it applies workspace-path and managed-sandbox restrictions.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:cdfde9240dd6f50fefce",
    "domain": "Skills",
    "customerJob": "fork through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/fork",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/components/skill-studio/ForkSkillDialog.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/fork",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/fork. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 840,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.fork"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 840,
        "claim": "router.post("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/skill-studio/ForkSkillDialog.tsx",
        "line": 97,
        "clientCall": "companySkillsApi.fork",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/fork`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:cf7a019e1321f5baccb2",
    "domain": "Tasks",
    "customerJob": "restoreDocumentRevision through the mounted client for /api/issues/${id}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "canonicalService": "server/src/services/documents.ts",
    "webSurface": "ui/src/components/IssueDocumentsSection.tsx",
    "apiOperation": "POST /api/issues/${id}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore. Owner: server/src/services/documents.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/documents.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 11128,
        "claim": "document revision restore route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11141,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11143,
        "claim": "route applies deliverable run-context guard"
      }
    ],
    "clientMethods": [
      "issuesApi.restoreDocumentRevision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 11128,
        "claim": "document revision restore route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11141,
        "claim": "route applies issue mutation guard"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 11143,
        "claim": "route applies deliverable run-context guard"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/IssueDocumentsSection.tsx",
        "line": 217,
        "clientCall": "issuesApi.restoreDocumentRevision",
        "routeSignatures": [
          "post:`/issues/${id}/documents/${encodeURIComponent(key)}/revisions/${revisionId}/restore`"
        ]
      }
    ],
    "authorizationRationale": "Document restore applies issue mutation and deliverable run-context checks, and records the authenticated Agent/Human author on the restored revision.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d0aa29d6b47e9bcfe175",
    "domain": "Work",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/learning/cycles",
    "canonicalService": "server/src/services/learning/learning-service.ts",
    "webSurface": "ui/src/pages/OrganizationalLearning.tsx",
    "apiOperation": "POST /api/companies/${companyId}/learning/cycles",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/learning/cycles. Owner: server/src/services/learning/learning-service.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/learning/learning-service.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 88,
        "claim": "propose admission sends Agent actors through assertDerivedWorker"
      },
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 127,
        "claim": "cycle create uses propose admission and attributes Agent identity"
      }
    ],
    "clientMethods": [
      "learningApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 88,
        "claim": "propose admission sends Agent actors through assertDerivedWorker"
      },
      {
        "path": "server/src/services/learning/learning-service.ts",
        "line": 127,
        "claim": "cycle create uses propose admission and attributes Agent identity"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/OrganizationalLearning.tsx",
        "line": 86,
        "clientCall": "learningApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/learning/cycles`"
        ]
      }
    ],
    "authorizationRationale": "The service admits Agent actors through assertDerivedWorker for proposal-scoped learning-cycle creation, then stores agent attribution. It does not grant policy publication.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d1aa2cc7bccda422083f",
    "domain": "Workflows",
    "customerJob": "startRun through the mounted client for /api/companies/${companyId}/workflows/${workflowId}/run",
    "canonicalService": "server/src/services/workflows/workflow-executor.ts",
    "webSurface": "ui/src/pages/WorkflowBuilder.tsx",
    "apiOperation": "POST /api/companies/${companyId}/workflows/${workflowId}/run",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "workflows:run"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/workflows/${workflowId}/run. Owner: server/src/services/workflows/workflow-executor.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/workflows/workflow-executor.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/workflows/workflow-executor.ts",
        "claim": "The existing workflow executor starts or changes an active workflow run under current route authorization."
      }
    ],
    "clientMethods": [
      "workflowsApi.startRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/workflows.ts",
        "line": 513,
        "claim": "The route authorizes workflows:run and passes runActor(req), which retains Agent principals; executor creates the durable run."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 228,
        "claim": "runActor preserves Agent principals; no board-only restriction is applied to these run lifecycle endpoints."
      },
      {
        "path": "server/src/routes/workflows.ts",
        "line": 294,
        "claim": "decidePermission passes the current actor into accessService.decide for workflows:run authorization."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/WorkflowBuilder.tsx",
        "line": 724,
        "clientCall": "workflowsApi.startRun",
        "routeSignatures": [
          "post:`/companies/${companyId}/workflows/${workflowId}/run`"
        ]
      }
    ],
    "authorizationRationale": "The route authorizes workflows:run and passes runActor(req), which retains Agent principals; executor creates the durable run. Existing Agent-capable manual workflow execution is not represented by a matching manifest operation ID.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d31c7ac05a38cc39a764",
    "domain": "Routines",
    "customerJob": "createForTarget through the mounted client for /api/routines/${id}/description/annotations",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "POST /api/routines/${id}/description/annotations",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/routines/${id}/description/annotations. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.createForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 58,
        "claim": "createForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 48,
        "clientCall": "documentAnnotationsApi.createForTarget",
        "routeSignatures": [
          "post:targetBasePath(target)"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d4783ba79d4fe373634e",
    "domain": "Tasks",
    "customerJob": "actOnRunnerGoal through the mounted client for /api/issues/${id}/runner-goal/actions",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/task-chat/RunnerGoalWidget.tsx",
    "apiOperation": "POST /api/issues/${id}/runner-goal/actions",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/runner-goal/actions. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 8815,
        "claim": "runner-goal action route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 8828,
        "claim": "Agent actor must match requested goal agent"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 8837,
        "claim": "route checks issue write influence"
      }
    ],
    "clientMethods": [
      "issuesApi.actOnRunnerGoal"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 8815,
        "claim": "runner-goal action route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 8828,
        "claim": "Agent actor must match requested goal agent"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 8837,
        "claim": "route checks issue write influence"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/task-chat/RunnerGoalWidget.tsx",
        "line": 70,
        "clientCall": "issuesApi.actOnRunnerGoal",
        "routeSignatures": [
          "post:`/issues/${id}/runner-goal/actions`"
        ]
      }
    ],
    "authorizationRationale": "An Agent may act only on its own assigned session goal; the route also checks issue write influence before dispatch.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d687840f28d33a866e75",
    "domain": "Work",
    "customerJob": "exportBundle through the mounted client for /api/companies/${companyId}/exports",
    "canonicalService": "server/src/services/companies.ts",
    "webSurface": "ui/src/pages/CompanyExport.tsx",
    "apiOperation": "POST /api/companies/${companyId}/exports",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/exports. Owner: server/src/services/companies.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/companies.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/companies.ts",
        "line": 419,
        "claim": "assertSameCompanyCeoAgentOrBoard delegates to authorization.assertCompanyCeoAgentOrBoard."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 118,
        "claim": "allows only same-company CEO Agent or Board."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 594,
        "claim": "and 1271-1278 export handlers call CEO/Board guard; assertSupportCaseExportAccess and V7 expectedUserId gate restrict Human-only variants."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 392,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 413,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 416,
        "claim": "assertCompanyAccess(req, target.companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 420,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 426,
        "claim": "if (req.actor.type !== \"board\" || req.actor.source === \"local_implicit\" || req.actor.isInstanceAdmin) return;"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 592,
        "claim": "router.post(\"/:companyId/export\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companiesApi.exportBundle"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/companies.ts",
        "line": 419,
        "claim": "assertSameCompanyCeoAgentOrBoard delegates to authorization.assertCompanyCeoAgentOrBoard."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 118,
        "claim": "allows only same-company CEO Agent or Board."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 594,
        "claim": "and 1271-1278 export handlers call CEO/Board guard; assertSupportCaseExportAccess and V7 expectedUserId gate restrict Human-only variants."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 392,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 413,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 416,
        "claim": "assertCompanyAccess(req, target.companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 420,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 426,
        "claim": "if (req.actor.type !== \"board\" || req.actor.source === \"local_implicit\" || req.actor.isInstanceAdmin) return;"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 592,
        "claim": "router.post(\"/:companyId/export\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/companies.ts",
        "line": 137,
        "claim": "exportBundle"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanyExport.tsx",
        "line": 817,
        "clientCall": "companiesApi.exportBundle",
        "routeSignatures": [
          "post:`/companies/${companyId}/exports`"
        ]
      }
    ],
    "authorizationRationale": "The exact route calls assertSameCompanyCeoAgentOrBoard for company exports, which admits a same-company CEO Agent or Board. The export service receives req.actor and applies narrower per-domain filters; support-case and V7-state export options require a matching Human Board user. Base company export is direct Agent-capable subject to CEO role, with those Human-only export variants blocked.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d7c9911eabe839ac992f",
    "domain": "Work",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/goals",
    "canonicalService": "server/src/services/goals.ts",
    "webSurface": "ui/src/components/NewGoalDialog.tsx",
    "apiOperation": "POST /api/companies/${companyId}/goals",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/goals. Owner: server/src/services/goals.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/goals.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/goals.ts",
        "line": 28,
        "claim": "current company access then Goal service mutation"
      }
    ],
    "clientMethods": [
      "goalsApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/goals.ts",
        "line": 28,
        "claim": "current company access then Goal service mutation"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/NewGoalDialog.tsx",
        "line": 63,
        "clientCall": "goalsApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/goals`"
        ]
      }
    ],
    "authorizationRationale": "The existing Goal create/update route uses current company resource access and goalService, with actor attribution; it has no Board-only guard. This review does not claim a registered gateway tool or Native parity receipt.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:d9abeeda15a51c3ef071",
    "domain": "Tasks",
    "customerJob": "transitionCase through the mounted client for /api/cases/${caseId}/transition",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/transition",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/transition. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2325,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.transitionCase"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2325,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 1683,
        "clientCall": "pipelinesApi.transitionCase",
        "routeSignatures": [
          "post:`/cases/${caseId}/transition`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2708,
        "clientCall": "pipelinesApi.transitionCase",
        "routeSignatures": [
          "post:`/cases/${caseId}/transition`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2726,
        "clientCall": "pipelinesApi.transitionCase",
        "routeSignatures": [
          "post:`/cases/${caseId}/transition`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:dd8137d03f5a0dd756cc",
    "domain": "Work",
    "customerJob": "uploadCompanyLogo through the mounted client for /api/companies/${companyId}/logo",
    "canonicalService": "server/src/routes/assets.ts",
    "webSurface": "ui/src/pages/CompanySettings.tsx",
    "apiOperation": "POST /api/companies/${companyId}/logo",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/logo. Owner: server/src/routes/assets.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/assets.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/assets.ts",
        "line": 224,
        "claim": "handler calls assertCompanyAccess, writes the asset with createdByAgentId/createdByUserId, and logs actorType/actorId."
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 117,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 226,
        "claim": "assertCompanyAccess(req, companyId);"
      }
    ],
    "clientMethods": [
      "assetsApi.uploadCompanyLogo"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/assets.ts",
        "line": 224,
        "claim": "handler calls assertCompanyAccess, writes the asset with createdByAgentId/createdByUserId, and logs actorType/actorId."
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 117,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/assets.ts",
        "line": 226,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "ui/src/api/assets.ts",
        "line": 24,
        "claim": "uploadCompanyLogo"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySettings.tsx",
        "line": 126,
        "clientCall": "assetsApi.uploadCompanyLogo",
        "routeSignatures": [
          "postForm:`/companies/${companyId}/logo`"
        ]
      }
    ],
    "authorizationRationale": "The exact upload handler calls assertCompanyAccess and then persists a company asset with actor agent/user attribution. This guard enforces same-company access but adds no Human-only or per-action permission gate; the endpoint therefore admits a same-company Agent directly.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:df97808d27709b688f43",
    "domain": "Tasks",
    "customerJob": "resolveSuggestion through the mounted client for /api/cases/${caseId}/resolve-suggestion",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/resolve-suggestion",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/resolve-suggestion. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2350,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.resolveSuggestion"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2350,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2539,
        "clientCall": "pipelinesApi.resolveSuggestion",
        "routeSignatures": [
          "post:`/cases/${caseId}/resolve-suggestion`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 4997,
        "clientCall": "pipelinesApi.resolveSuggestion",
        "routeSignatures": [
          "post:`/cases/${caseId}/resolve-suggestion`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 5066,
        "clientCall": "pipelinesApi.resolveSuggestion",
        "routeSignatures": [
          "post:`/cases/${caseId}/resolve-suggestion`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:dffb52d05f1108349c54",
    "domain": "Routines",
    "customerJob": "create through the mounted client for /api/companies/${companyId}/routines",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "POST /api/companies/${companyId}/routines",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/routines. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 2894,
        "claim": "Routine creation validates execution target and active status before persistence."
      }
    ],
    "clientMethods": [
      "routinesApi.create"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 175,
        "claim": "create route calls assertBoardCanAssignTasks and assertCanManageCompanyRoutine"
      },
      {
        "path": "server/src/routes/routines.ts",
        "line": 100,
        "claim": "Agent routine authority is restricted to self-assigned target"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 441,
        "clientCall": "routinesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/routines`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 502,
        "clientCall": "routinesApi.create",
        "routeSignatures": [
          "post:`/companies/${companyId}/routines`"
        ]
      }
    ],
    "authorizationRationale": "The UI route admits an Agent only for a self-assigned routine and applies routine authoring/source guards. This general creation route can configure targets and differs from the manifest draft operation, which always creates a paused, targetless conversation draft.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e2114096e8e135a49ffa",
    "domain": "Tasks",
    "customerJob": "unlockDocument through the mounted client for /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/unlock",
    "canonicalService": "server/src/routes/cases.ts",
    "webSurface": "ui/src/pages/CaseDetail.tsx",
    "apiOperation": "POST /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/unlock",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/unlock. Owner: server/src/routes/cases.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/cases.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1049,
        "claim": "router.post(\"/cases/:id/documents/:key/unlock\", async (req, res, next) => {"
      }
    ],
    "clientMethods": [
      "casesApi.unlockDocument"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/cases.ts",
        "line": 158,
        "claim": "assertCaseAccess/resolveSharedPathCase enforce resource company scope, Cases feature, then assertCompanyAccess; no actor-type restriction."
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 161,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 174,
        "claim": "assertCompanyAccess(req, row.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 597,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 674,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1381,
        "claim": "assertCompanyAccess(req, issue.companyId);"
      },
      {
        "path": "server/src/routes/cases.ts",
        "line": 1049,
        "claim": "router.post(\"/cases/:id/documents/:key/unlock\", async (req, res, next) => {"
      },
      {
        "path": "ui/src/api/cases.ts",
        "line": 317,
        "claim": "unlockDocument"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CaseDetail.tsx",
        "line": 537,
        "clientCall": "casesApi.unlockDocument",
        "routeSignatures": [
          "post:`/cases/${idOrIdentifier}/documents/${encodeURIComponent(key)}/unlock`"
        ]
      }
    ],
    "authorizationRationale": "The case route resolves the case, requires the Cases feature, and calls assertCompanyAccess; it has no additional Board or action-permission guard. Document/status mutation uses current getActorInfo identity and records Agent attribution. Same-company Agents can perform this operation directly under the current route contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e3989a90ea37ec7e133b",
    "domain": "Skills",
    "customerJob": "cancelTestRun through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}/cancel",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/SkillStudio.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}/cancel",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}/cancel. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 688,
        "claim": "router.post(\"/companies/:companyId/skills/:skillId/test-runs/:runId/cancel\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "companySkillsApi.cancelTestRun"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 688,
        "claim": "router.post(\"/companies/:companyId/skills/:skillId/test-runs/:runId/cancel\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 142,
        "claim": "cancelTestRun"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3050,
        "clientCall": "companySkillsApi.cancelTestRun",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}/cancel`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e47d171198e2e2abecde",
    "domain": "Skills",
    "customerJob": "browseProject through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/browse-project",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/skills/ImportSkillsFromProjectDialog.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/skills/browse-project",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/skills/browse-project. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1252,
        "claim": "router.post("
      }
    ],
    "clientMethods": [
      "companySkillsApi.browseProject"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1252,
        "claim": "router.post("
      },
      {
        "path": "ui/src/api/companySkills.ts",
        "line": 220,
        "claim": "browseProject"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/skills/ImportSkillsFromProjectDialog.tsx",
        "line": 799,
        "clientCall": "companySkillsApi.browseProject",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/skills/browse-project`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e4f5f4e1cb2b59b486ba",
    "domain": "Tasks",
    "customerJob": "reviewCase through the mounted client for /api/cases/${caseId}/review",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/cases/${caseId}/review",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/cases/${caseId}/review. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2378,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "clientMethods": [
      "pipelinesApi.reviewCase"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 2378,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 711,
        "claim": "assertCaseAccess applies company scope and required case-body source privacy proof"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2762,
        "clientCall": "pipelinesApi.reviewCase",
        "routeSignatures": [
          "post:`/cases/${caseId}/review`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 5006,
        "clientCall": "pipelinesApi.reviewCase",
        "routeSignatures": [
          "post:`/cases/${caseId}/review`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e6f5ba9118c05b3a23e6",
    "domain": "Agents",
    "customerJob": "controlRuntimeCommands through the mounted client for /api/execution-workspaces/${id}/runtime-commands/${action}",
    "canonicalService": "server/src/services/execution-workspaces.ts",
    "webSurface": "ui/src/components/issue-properties/IssueProperties.tsx, ui/src/pages/ExecutionWorkspaceDetail.tsx",
    "apiOperation": "POST /api/execution-workspaces/${id}/runtime-commands/${action}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "runtime:manage"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/execution-workspaces/${id}/runtime-commands/${action}. Owner: server/src/services/execution-workspaces.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/execution-workspaces.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 110,
        "claim": "assertRuntimeManageAllowed evaluates runtime:manage for req.actor and company."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 267,
        "claim": "runtime command handler calls runtime:manage and assertCanManageExecutionWorkspaceRuntimeServices with workspace/source issue."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "update handler resolves workspace then enforces runtime:manage before applying patch."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 123,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 140,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 187,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1053,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1046,
        "claim": "router.post(\"/execution-workspaces/:id/runtime-services/:action\", validate(workspaceRuntimeControlTargetSchema), handleExecutionWorkspaceRuntimeCommand);"
      }
    ],
    "clientMethods": [
      "executionWorkspacesApi.controlRuntimeCommands"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 110,
        "claim": "assertRuntimeManageAllowed evaluates runtime:manage for req.actor and company."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 267,
        "claim": "runtime command handler calls runtime:manage and assertCanManageExecutionWorkspaceRuntimeServices with workspace/source issue."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1139,
        "claim": "update handler resolves workspace then enforces runtime:manage before applying patch."
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 123,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 140,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 187,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1053,
        "claim": "assertBoard(req);"
      },
      {
        "path": "server/src/routes/execution-workspaces.ts",
        "line": 1046,
        "claim": "router.post(\"/execution-workspaces/:id/runtime-services/:action\", validate(workspaceRuntimeControlTargetSchema), handleExecutionWorkspaceRuntimeCommand);"
      },
      {
        "path": "ui/src/api/execution-workspaces.ts",
        "line": 109,
        "claim": "controlRuntimeCommands"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/issue-properties/IssueProperties.tsx",
        "line": 623,
        "clientCall": "executionWorkspacesApi.controlRuntimeCommands",
        "routeSignatures": [
          "post:`/execution-workspaces/${id}/runtime-commands/${action}`"
        ]
      },
      {
        "path": "ui/src/pages/ExecutionWorkspaceDetail.tsx",
        "line": 957,
        "clientCall": "executionWorkspacesApi.controlRuntimeCommands",
        "routeSignatures": [
          "post:`/execution-workspaces/${id}/runtime-commands/${action}`"
        ]
      }
    ],
    "authorizationRationale": "The handler resolves the workspace and checks authorizationService runtime:manage for req.actor; runtime command routes additionally call assertCanManageExecutionWorkspaceRuntimeServices with the exact workspace/source issue. Current Agent runtime policy admits only authorized runtime control; request execution is persisted with agent/run identity. It is direct, gated runtime control, not a proposal.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e9d45707cc9cc6b61101",
    "domain": "Routines",
    "customerJob": "rotateTriggerSecret through the mounted client for /api/routine-triggers/${id}/rotate-secret",
    "canonicalService": "server/src/services/routines.ts",
    "webSurface": "ui/src/components/routine-triggers/RoutineTriggers.tsx, ui/src/pages/RoutineDetail.production.tsx, ui/src/pages/RoutineDetail.tsx",
    "apiOperation": "POST /api/routine-triggers/${id}/rotate-secret",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/routine-triggers/${id}/rotate-secret. Owner: server/src/services/routines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/routines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/routines.ts",
        "line": 3473,
        "claim": "Webhook secret rotation changes the active external execution credential."
      }
    ],
    "clientMethods": [
      "routinesApi.rotateTriggerSecret"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/routines.ts",
        "line": 126,
        "claim": "assertCanManageExistingRoutine permits the assigned Agent and company scope; mutation routes additionally call assertBoardCanAssignTasks, which leaves Agent actors intact."
      },
      {
        "path": "server/src/services/routines.ts",
        "claim": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 436,
        "clientCall": "routinesApi.rotateTriggerSecret",
        "routeSignatures": [
          "post:`/routine-triggers/${id}/rotate-secret`"
        ]
      },
      {
        "path": "ui/src/components/routine-triggers/RoutineTriggers.tsx",
        "line": 613,
        "clientCall": "routinesApi.rotateTriggerSecret",
        "routeSignatures": [
          "post:`/routine-triggers/${id}/rotate-secret`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.production.tsx",
        "line": 590,
        "clientCall": "routinesApi.rotateTriggerSecret",
        "routeSignatures": [
          "post:`/routine-triggers/${id}/rotate-secret`"
        ]
      },
      {
        "path": "ui/src/pages/RoutineDetail.tsx",
        "line": 594,
        "clientCall": "routinesApi.rotateTriggerSecret",
        "routeSignatures": [
          "post:`/routine-triggers/${id}/rotate-secret`"
        ]
      }
    ],
    "authorizationRationale": "Existing routine management APIs permit the assigned Agent to change their own routine configuration. These are distinct from the manifest’s paused, targetless routine draft contract and are not assumed covered by it.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:e9f21c0686d9933e9a70",
    "domain": "Skills",
    "customerJob": "updateFile through the mounted client for /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files",
    "canonicalService": "server/src/services/company-skills.ts",
    "webSurface": "ui/src/pages/CompanySkills.tsx, ui/src/pages/SkillStudio.tsx",
    "apiOperation": "PATCH /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "tasks:assign"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files. Owner: server/src/services/company-skills.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/company-skills.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1108,
        "claim": "router.patch("
      }
    ],
    "clientMethods": [
      "companySkillsApi.updateFile"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 208,
        "claim": "assertCanMutateCompanySkills rejects unauthenticated/cross-company Agent actors and evaluates the configured skill-policy action/resource for req.actor."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 252,
        "claim": "assertCanOrchestrateSkillTestHarness evaluates tasks:assign for the authenticated actor on the test-run assignment scope (test-run create/cancel/delete only)."
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 102,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 220,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 257,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 324,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 349,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/company-skills.ts",
        "line": 1108,
        "claim": "router.patch("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/CompanySkills.tsx",
        "line": 4491,
        "clientCall": "companySkillsApi.updateFile",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 1341,
        "clientCall": "companySkillsApi.updateFile",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 1359,
        "clientCall": "companySkillsApi.updateFile",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`"
        ]
      },
      {
        "path": "ui/src/pages/SkillStudio.tsx",
        "line": 3452,
        "clientCall": "companySkillsApi.updateFile",
        "routeSignatures": [
          "patch:`/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`"
        ]
      }
    ],
    "authorizationRationale": "The handler invokes assertCanMutateCompanySkills with the operation-specific skills.* action and resource; that helper checks authenticated actor/company boundary, then the company skill policy for req.actor. Where test harness orchestration applies, it separately requires authorizationService tasks:assign for the assigned agent/issue. The service persists the requested skill/test action and records actor attribution; there is no Human-only check or separate proposal state. Classify DIRECT_AGENT conditional on the company policy and applicable assignment permission.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:ea3e3d6dd1e236c75d33",
    "domain": "Tasks",
    "customerJob": "addCommentForTarget through the mounted client for /api/issues/${id}/documents/${key}/annotations/${threadId}/comments",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "POST /api/issues/${id}/documents/${key}/annotations/${threadId}/comments",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/documents/${key}/annotations/${threadId}/comments. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.addCommentForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 69,
        "claim": "addCommentForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 80,
        "clientCall": "documentAnnotationsApi.addCommentForTarget",
        "routeSignatures": [
          "post:`${targetBasePath(target)}/${threadId}/comments`"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:ee9fc8546e34e6337381",
    "domain": "Tasks",
    "customerJob": "addComment through the mounted client for /api/issues/${id}/comments",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/DecisionTriageStrip.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/Pipelines.tsx",
    "apiOperation": "POST /api/issues/${id}/comments",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/issues/${id}/comments. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 18018,
        "claim": "comment create endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 18121,
        "claim": "Agent attribution spoof is rejected before ordinary Agent comment path"
      }
    ],
    "clientMethods": [
      "issuesApi.addComment"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 18018,
        "claim": "comment create endpoint"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 18121,
        "claim": "Agent attribution spoof is rejected before ordinary Agent comment path"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/DecisionTriageStrip.tsx",
        "line": 131,
        "clientCall": "issuesApi.addComment",
        "routeSignatures": [
          "post:`/issues/${id}/comments`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4658,
        "clientCall": "issuesApi.addComment",
        "routeSignatures": [
          "post:`/issues/${id}/comments`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2423,
        "clientCall": "issuesApi.addComment",
        "routeSignatures": [
          "post:`/issues/${id}/comments`"
        ]
      }
    ],
    "authorizationRationale": "Agent comments flow through issue comment authorization and actor attribution; Human-only conversation shell handling is a separate branch.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:f030948ae437362aa5fd",
    "domain": "Work",
    "customerJob": "assess through the mounted client for /api/companies/${companyId}/readiness/assess",
    "canonicalService": "server/src/services/readiness/readiness-service.ts",
    "webSurface": "ui/src/pages/Readiness.tsx",
    "apiOperation": "POST /api/companies/${companyId}/readiness/assess",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [
      "company-scope:read"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${companyId}/readiness/assess. Owner: server/src/services/readiness/readiness-service.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/readiness/readiness-service.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/readiness.ts",
        "line": 132,
        "claim": "admit uses company-scope:read, company access, and readiness feature gate; readinessOwner accepts Agent actor."
      },
      {
        "path": "server/src/services/readiness/readiness-service.ts",
        "claim": "This route admits Agent principals with company-scope:read and writes an assessment to the readiness owner. It is not currently represented by a manifest operation; source review did not find a launch-critical state transition."
      }
    ],
    "clientMethods": [
      "readinessApi.assess"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/readiness.ts",
        "line": 132,
        "claim": "admit uses company-scope:read, company access, and readiness feature gate; readinessOwner accepts Agent actor."
      },
      {
        "path": "server/src/services/readiness/readiness-service.ts",
        "claim": "This route admits Agent principals with company-scope:read and writes an assessment to the readiness owner. It is not currently represented by a manifest operation; source review did not find a launch-critical state transition."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Readiness.tsx",
        "line": 42,
        "clientCall": "readinessApi.assess",
        "routeSignatures": [
          "post:scope(`/companies/${companyId}/readiness/assess`, userId)"
        ]
      }
    ],
    "authorizationRationale": "This route admits Agent principals with company-scope:read and writes an assessment to the readiness owner. It is not currently represented by a manifest operation; source review did not find a launch-critical state transition.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:f3a792e7060dc18fec0f",
    "domain": "Co-workers",
    "customerJob": "install through the mounted client for /api/companies/${encodeURIComponent(companyId)}/teams/catalog/${encodeURIComponent(catalogRef)}/install",
    "canonicalService": "server/src/services/teams-catalog.ts",
    "webSurface": "ui/src/pages/TeamCatalog.tsx",
    "apiOperation": "POST /api/companies/${encodeURIComponent(companyId)}/teams/catalog/${encodeURIComponent(catalogRef)}/install",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "agents:create"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/companies/${encodeURIComponent(companyId)}/teams/catalog/${encodeURIComponent(catalogRef)}/install. Owner: server/src/services/teams-catalog.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/teams-catalog.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/teams-catalog.ts",
        "claim": "The existing team catalog install service applies the selected company team configuration."
      }
    ],
    "clientMethods": [
      "teamCatalogApi.install"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/teams-catalog.ts",
        "line": 109,
        "claim": "POST /teams/catalog/:catalogId/install calls assertCanInstallCatalogTeam"
      },
      {
        "path": "server/src/routes/teams-catalog.ts",
        "line": 34,
        "claim": "assertCanInstallCatalogTeam permits agent with agents:create or canCreateAgents"
      },
      {
        "path": "server/src/services/teams-catalog.ts",
        "claim": "installCatalogTeam implementation"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/TeamCatalog.tsx",
        "line": 1023,
        "clientCall": "teamCatalogApi.install",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/teams/catalog/${encodeURIComponent(catalogRef)}/install`"
        ]
      },
      {
        "path": "ui/src/pages/TeamCatalog.tsx",
        "line": 1203,
        "clientCall": "teamCatalogApi.install",
        "routeSignatures": [
          "post:`/companies/${encodeURIComponent(companyId)}/teams/catalog/${encodeURIComponent(catalogRef)}/install`"
        ]
      }
    ],
    "authorizationRationale": "`server/src/routes/teams-catalog.ts` admits an Agent with `agents:create`; installation creates a team of Agents, while the manifest `blentera.co-worker.setup.propose` creates only an unpublished setup proposal. Keep this a distinct missing operation until the exact install contract is represented.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:f4be844d1d356a82b478",
    "domain": "Decisions",
    "customerJob": "recordWatchdogDecision through the mounted client for /api/heartbeat-runs/${input.runId}/watchdog-decisions",
    "canonicalService": "server/src/services/recovery/service.ts",
    "webSurface": "ui/src/components/IssueRunLedger.tsx",
    "apiOperation": "POST /api/heartbeat-runs/${input.runId}/watchdog-decisions",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: POST /api/heartbeat-runs/${input.runId}/watchdog-decisions. Owner: server/src/services/recovery/service.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/recovery/service.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 7102,
        "claim": "watchdog decision endpoint"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 7110,
        "claim": "run access is checked before recording actor-attributed decision"
      }
    ],
    "clientMethods": [
      "heartbeatsApi.recordWatchdogDecision"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/agents.ts",
        "line": 7102,
        "claim": "watchdog decision endpoint"
      },
      {
        "path": "server/src/routes/agents.ts",
        "line": 7110,
        "claim": "run access is checked before recording actor-attributed decision"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/IssueRunLedger.tsx",
        "line": 496,
        "clientCall": "heartbeatsApi.recordWatchdogDecision",
        "routeSignatures": [
          "post:`/heartbeat-runs/${input.runId}/watchdog-decisions`"
        ]
      }
    ],
    "authorizationRationale": "The handler resolves the run through getAccessibleResource and records the decision with the authenticated actor; there is no Board-only guard, so the run-scoped Agent principal can call this API. It is not mapped to a native operation manifest entry.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:fabbb12db38e06e52e54",
    "domain": "Co-workers",
    "customerJob": "revokeInvite through the mounted client for /api/invites/${inviteId}/revoke",
    "canonicalService": "server/src/routes/access.ts",
    "webSurface": "ui/src/components/access/InvitesSection.tsx",
    "apiOperation": "POST /api/invites/${inviteId}/revoke",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "users:invite"
    ],
    "resourceScope": "Unqualified source inventory. Route: POST /api/invites/${inviteId}/revoke. Owner: server/src/routes/access.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/access.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission calls assertCompanyAccess and for req.actor.type === \"agent\" checks access.hasPermission(companyId,\"agent\",agentId,permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4112,
        "claim": "revokeInvite handler calls assertCompanyPermission(...,\"users:invite\") for company invites and assertInstanceAdmin only for bootstrap invite."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4121,
        "claim": "await assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4112,
        "claim": "router.post(\"/invites/:inviteId/revoke\", async (req, res) => {"
      }
    ],
    "clientMethods": [
      "accessApi.revokeInvite"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/access.ts",
        "line": 2991,
        "claim": "assertCompanyPermission calls assertCompanyAccess and for req.actor.type === \"agent\" checks access.hasPermission(companyId,\"agent\",agentId,permissionKey)."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4112,
        "claim": "revokeInvite handler calls assertCompanyPermission(...,\"users:invite\") for company invites and assertInstanceAdmin only for bootstrap invite."
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1184,
        "claim": "if (req.actor.type !== \"board\") {"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1287,
        "claim": "if (req.actor.type !== \"board\") return null;"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 1308,
        "claim": "if (req.actor.type !== \"board\") return \"Board access is required to remove members.\";"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2732,
        "claim": "if (req.actor.type !== \"board\") throw unauthorized();"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 2756,
        "claim": "req.actor.type !== \"board\" ||"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4121,
        "claim": "await assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/access.ts",
        "line": 4112,
        "claim": "router.post(\"/invites/:inviteId/revoke\", async (req, res) => {"
      },
      {
        "path": "ui/src/api/access.ts",
        "line": 308,
        "claim": "revokeInvite"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/access/InvitesSection.tsx",
        "line": 151,
        "clientCall": "accessApi.revokeInvite",
        "routeSignatures": [
          "post:`/invites/${inviteId}/revoke`"
        ]
      }
    ],
    "authorizationRationale": "Route invokes assertCompanyPermission(users:invite), which explicitly checks a current same-company Agent principal’s users:invite grant (or the Board user’s permission). The actor is recorded as agent/user in activity. For bootstrap invites revoke is separately instance-admin only; this ordinary company invite operation is Agent-accessible when permission is granted, with invite join types constrained by the invite record.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:fad6fa691648cdfcc98f",
    "domain": "Routines",
    "customerJob": "updateStatusForTarget through the mounted client for /api/routines/${id}/description/annotations/${threadId}",
    "canonicalService": "server/src/services/document-annotations.ts",
    "webSurface": "ui/src/hooks/useDocumentAnnotationMutations.ts",
    "apiOperation": "PATCH /api/routines/${id}/description/annotations/${threadId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/routines/${id}/description/annotations/${threadId}. Owner: server/src/services/document-annotations.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/document-annotations.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/services/document-annotations.ts",
        "claim": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution."
      }
    ],
    "clientMethods": [
      "documentAnnotationsApi.updateStatusForTarget"
    ],
    "authorityEvidence": [
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 84,
        "claim": "updateStatusForTarget"
      },
      {
        "path": "ui/src/api/document-annotations.ts",
        "line": 14,
        "claim": "The validated target union permits exactly issue, case, and routine document targets; targetBasePath dispatches only those route families."
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/hooks/useDocumentAnnotationMutations.ts",
        "line": 102,
        "clientCall": "documentAnnotationsApi.updateStatusForTarget",
        "routeSignatures": [
          "patch:`${targetBasePath(target)}/${threadId}`"
        ]
      }
    ],
    "authorizationRationale": "The callsite accepts the closed issue/case/routine target union. Each target is resolved by its own route, which applies company and resource authorization; issue and assigned-routine guards admit eligible Agents, and all target handlers delegate to the shared annotation owner with actor-derived attribution.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:fc5f8d8fb5ce199ce685",
    "domain": "Work",
    "customerJob": "updateStage through the mounted client for /api/pipelines/${pipelineId}/stages/${stageId}",
    "canonicalService": "server/src/services/pipelines.ts",
    "webSurface": "ui/src/pages/PipelineSettings.tsx",
    "apiOperation": "PATCH /api/pipelines/${pipelineId}/stages/${stageId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [
      "pipelines:write"
    ],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/pipelines/${pipelineId}/stages/${stageId}. Owner: server/src/services/pipelines.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/pipelines.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1551,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 382,
        "claim": "actorForMutation accepts Board or Agent with agentId and required runId"
      }
    ],
    "clientMethods": [
      "pipelinesApi.updateStage"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 1551,
        "claim": "route converts authenticated actor to PipelineActor before invoking the operation"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 471,
        "claim": "pipeline write helper authorizes pipelines:write for the authenticated actor and pipeline scope"
      },
      {
        "path": "server/src/routes/pipelines.ts",
        "line": 382,
        "claim": "actorForMutation accepts Board or Agent with agentId and required runId"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/PipelineSettings.tsx",
        "line": 1978,
        "clientCall": "pipelinesApi.updateStage",
        "routeSignatures": [
          "patch:`/pipelines/${pipelineId}/stages/${stageId}`"
        ]
      }
    ],
    "authorizationRationale": "The route does not require a Board principal: it accepts an Agent actor (with a run id for mutation), enforces company/case privacy and pipeline write authority where applicable, and attributes the mutation to that actor. This proves API-level Agent access only; there is no native operation manifest mapping recorded.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:fd743521a0004e818733",
    "domain": "Work",
    "customerJob": "update through the mounted client for /api/companies/${companyId}",
    "canonicalService": "server/src/services/companies.ts",
    "webSurface": "ui/src/pages/Companies.tsx, ui/src/pages/CompanySettings.tsx",
    "apiOperation": "PATCH /api/companies/${companyId}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent",
      "human"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "launchcritical",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/companies/${companyId}. Owner: server/src/services/companies.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/services/companies.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/companies.ts",
        "line": 1398,
        "claim": "update handler calls assertSameCompanyCeoAgentOrBoard; Agent branch parses updateCompanyBrandingSchema."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 118,
        "claim": "CEO Agent or Board is the exact principal gate."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 392,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 413,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 416,
        "claim": "assertCompanyAccess(req, target.companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 420,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 426,
        "claim": "if (req.actor.type !== \"board\" || req.actor.source === \"local_implicit\" || req.actor.isInstanceAdmin) return;"
      },
      {
        "path": "server/src/services/companies.ts",
        "line": 83,
        "claim": ".update(agents)"
      },
      {
        "path": "server/src/services/companies.ts",
        "line": 106,
        "claim": ".update(agentWakeupRequests)"
      },
      {
        "path": "server/src/services/companies.ts",
        "line": 337,
        "claim": "update: async ("
      }
    ],
    "clientMethods": [
      "companiesApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/companies.ts",
        "line": 1398,
        "claim": "update handler calls assertSameCompanyCeoAgentOrBoard; Agent branch parses updateCompanyBrandingSchema."
      },
      {
        "path": "server/src/services/authorization.ts",
        "line": 118,
        "claim": "CEO Agent or Board is the exact principal gate."
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 392,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 413,
        "claim": "assertInstanceAdmin(req);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 416,
        "claim": "assertCompanyAccess(req, target.companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 420,
        "claim": "assertCompanyAccess(req, companyId);"
      },
      {
        "path": "server/src/routes/companies.ts",
        "line": 426,
        "claim": "if (req.actor.type !== \"board\" || req.actor.source === \"local_implicit\" || req.actor.isInstanceAdmin) return;"
      },
      {
        "path": "server/src/services/companies.ts",
        "line": 83,
        "claim": ".update(agents)"
      },
      {
        "path": "server/src/services/companies.ts",
        "line": 106,
        "claim": ".update(agentWakeupRequests)"
      },
      {
        "path": "server/src/services/companies.ts",
        "line": 337,
        "claim": "update: async ("
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/pages/Companies.tsx",
        "line": 62,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      },
      {
        "path": "ui/src/pages/Companies.tsx",
        "line": 84,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySettings.tsx",
        "line": 84,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySettings.tsx",
        "line": 92,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySettings.tsx",
        "line": 102,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySettings.tsx",
        "line": 128,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      },
      {
        "path": "ui/src/pages/CompanySettings.tsx",
        "line": 136,
        "clientCall": "companiesApi.update",
        "routeSignatures": [
          "patch:`/companies/${companyId}`"
        ]
      }
    ],
    "authorizationRationale": "The route requires a same-company CEO Agent or Board. For Agent actor it parses only updateCompanyBrandingSchema; broader settings and lifecycle fields are only parsed for Board. Archive/delete are separate Board-only routes. This is direct Agent branding/settings-limited work under the source contract.",
    "testStatus": "NOT_REVIEWED"
  },
  {
    "operationId": "existing-api:fef6c3cdc94c78cebfbb",
    "domain": "Tasks",
    "customerJob": "update through the mounted client for /api/issues/${id}",
    "canonicalService": "server/src/routes/issues.ts",
    "webSurface": "ui/src/components/SidebarRecentTasks.tsx, ui/src/components/TaskChatThread.tsx, ui/src/components/routine-sections/operate-sections.tsx, ui/src/pages/ExecutionWorkspaceDetail.tsx, ui/src/pages/IssueDetail.tsx, ui/src/pages/Issues.tsx, ui/src/pages/Pipelines.tsx, ui/src/pages/ProjectDetail.tsx, ui/src/pages/ProjectRoadmap.tsx, ui/src/pages/Routines.production.tsx, ui/src/pages/Routines.tsx",
    "apiOperation": "PATCH /api/issues/${id}",
    "toolId": null,
    "legacyAliases": [],
    "principalTypes": [
      "agent"
    ],
    "experienceProfiles": [
      "existing_api_client"
    ],
    "mode": "DIRECT_AGENT",
    "criticality": "material",
    "sourceMateriality": "ordinary",
    "requiredPermissions": [],
    "resourceScope": "Unqualified source inventory. Route: PATCH /api/issues/${id}. Owner: server/src/routes/issues.ts. See authorityEvidence; this entry grants no new scope.",
    "approvalPolicy": "Unqualified. Existing route and service authorization behavior remains authoritative; this registration adds no approval, permission, or exposure.",
    "idempotency": "Unqualified: no idempotency guarantee is asserted. Do not automatically retry mutations; reconcile state through the owning API before retrying.",
    "expectedVersionOrPrecondition": "Unqualified: endpoint-specific schema and preconditions have not been independently qualified. Consult the current route and client source citations.",
    "postcondition": "Unqualified: resulting state is not independently specified here; verify it through the owning API.",
    "recovery": "Unqualified: do not automatically retry after an ambiguous mutation result; read current owner state and resolve through the existing UI/API recovery path.",
    "channelProjection": [],
    "mcpExposed": false,
    "openclawQualified": false,
    "tests": [],
    "owner": "server/src/routes/issues.ts",
    "apiOnly": true,
    "materialityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 13484,
        "claim": "issue patch route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 13502,
        "claim": "forged Agent on-behalf-of attribution is rejected"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 13524,
        "claim": "issue mutation authorization is enforced"
      }
    ],
    "clientMethods": [
      "issuesApi.update"
    ],
    "authorityEvidence": [
      {
        "path": "server/src/routes/issues.ts",
        "line": 13484,
        "claim": "issue patch route"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 13502,
        "claim": "forged Agent on-behalf-of attribution is rejected"
      },
      {
        "path": "server/src/routes/issues.ts",
        "line": 13524,
        "claim": "issue mutation authorization is enforced"
      }
    ],
    "qualificationStatus": "UNQUALIFIED_SOURCE_ONLY",
    "sourceCallsites": [
      {
        "path": "ui/src/components/SidebarRecentTasks.tsx",
        "line": 143,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/components/TaskChatThread.tsx",
        "line": 609,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/components/routine-sections/operate-sections.tsx",
        "line": 94,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/ExecutionWorkspaceDetail.tsx",
        "line": 555,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 3035,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4150,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4445,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 4503,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/IssueDetail.tsx",
        "line": 5041,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/Issues.tsx",
        "line": 194,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2415,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/Pipelines.tsx",
        "line": 2437,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/ProjectDetail.tsx",
        "line": 230,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/ProjectDetail.tsx",
        "line": 300,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/ProjectRoadmap.tsx",
        "line": 96,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.production.tsx",
        "line": 560,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      },
      {
        "path": "ui/src/pages/Routines.tsx",
        "line": 746,
        "clientCall": "issuesApi.update",
        "routeSignatures": [
          "patch:`/issues/${id}`"
        ]
      }
    ],
    "authorizationRationale": "Issue update applies the Agent issue mutation guard, rejects forged on-behalf attribution, and constrains writes to the current authorized issue/run scope.",
    "testStatus": "NOT_REVIEWED"
  }
];

export const AGENT_NATIVE_EXISTING_API_OPERATION_MANIFEST: readonly AgentNativeApiOperationContract[] = Object.freeze(entries);
