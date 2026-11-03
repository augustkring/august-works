# Paperclip MCP Server

This package targets the stable MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4.0), which implements protocol revision `2026-07-28`. The stdio entry uses `serveStdio` and keeps the SDK's legacy-client support enabled; the tool gateway still owns authorization, company scope, approvals, and audit.

Model Context Protocol server for Paperclip.

This package is a thin MCP wrapper over the existing Paperclip REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `PAPERCLIP_API_URL` - Paperclip base URL, for example `http://localhost:3100`
- `PAPERCLIP_API_KEY` - bearer token used for `/api` requests
- `PAPERCLIP_COMPANY_ID` - optional default company for company-scoped tools
- `PAPERCLIP_AGENT_ID` - optional default agent for checkout helpers
- `PAPERCLIP_RUN_ID` - optional run id forwarded on mutating requests

Inside an active heartbeat, Paperclip also injects `PAPERCLIP_RUNTIME_TOOLS_*` variables. They enable the run-scoped `connections_search` and `connection_request` tools and expire with the run.

## Usage

```sh
npx -y @paperclipai/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @paperclipai/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Run-scoped connection tools:

- `connections_search`
- `connection_request`

Read tools:

- `paperclipMe`
- `paperclipInboxLite`
- `paperclipListAgents`
- `paperclipGetAgent`
- `paperclipListIssues`
- `paperclipGetIssue`
- `paperclipGetHeartbeatContext`
- `paperclipListComments`
- `paperclipGetComment`
- `paperclipListIssueApprovals`
- `paperclipListDocuments`
- `paperclipGetDocument`
- `paperclipListDocumentRevisions`
- `paperclipListProjects`
- `paperclipGetProject`
- `paperclipGetIssueWorkspaceRuntime`
- `paperclipWaitForIssueWorkspaceService`
- `paperclipListGoals`
- `paperclipGetGoal`
- `paperclipListApprovals`
- `paperclipGetApproval`
- `paperclipGetApprovalIssues`
- `paperclipListApprovalComments`

Write tools:

- `paperclipCreateIssue`
- `paperclipUpdateIssue`
- `paperclipCheckoutIssue`
- `paperclipReleaseIssue`
- `paperclipAddComment`
- `paperclipSuggestTasks`
- `paperclipAskUserQuestions`
- `paperclipRequestConfirmation`
- `paperclipUpsertIssueDocument`
- `paperclipRestoreIssueDocumentRevision`
- `paperclipControlIssueWorkspaceServices`
- `paperclipCreateApproval`
- `paperclipLinkIssueApproval`
- `paperclipUnlinkIssueApproval`
- `paperclipApprovalDecision`
- `paperclipAddApprovalComment`

Escape hatch:

- `paperclipApiRequest`

`paperclipApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.


### AW Chat display reference

`aw_experience_card` accepts a bounded company/card/source/version reference for
a pre-approved AW Chat component. It returns only a display reference and performs
no API request, creation, execution, approval or permission grant. The receiving
client independently reads and authorizes the current Native card before showing
it; tool arguments and results cannot supply card prose, HTML or action callbacks.
The renderer accepts the exact tool name and `mcp__paperclip__aw_experience_card`.
The SDK's read-only annotations are hints, not authorization. This does not
provide an MCP Apps iframe host or qualify every interactive card form.

Retained analytical references use `source.domain: "insight"`,
`cardId: "insight:" + source.resourceId`, and the following Original identities:

| Family | Resource ID | Component | Source version |
| --- | --- | --- | --- |
| Metric | `metric:<observation UUID>` | `MetricInsightCard` | `definitionHash:inputHash` |
| Process | `process:<definition UUID>:<run UUID>:<finding UUID>` | `ProcessFindingCard` | `contentHash:version` |
| Scenario | `scenario:<scenario UUID>:<run UUID>` | `ScenarioComparisonCard` | run content hash |
| Experiment | `experiment:<experiment UUID>:<version UUID>` | `ExperimentResultCard` | `analysisReceiptHash:interpretationReceiptHash`, or `:none` |
| Forecast | `forecast:<spec UUID>:<run UUID>` | `ResultCard` | run content hash |
| Review | `review:<review UUID>` | `ResultCard` | review content hash |

These are references to existing records, not instructions to calculate or create
them. Obtain identities and hashes from authorized Original reads; do not invent
them. The receiving board client binds the read to its current principal and
rechecks the Original analytical owner. A changed source, closed rollout,
unqualified record or lost authority makes the card unavailable. Only a link to
the Original owner is returned. Chat display is not approval, causal evidence,
forecast accuracy or permission to act.
