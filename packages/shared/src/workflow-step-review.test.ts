import { expect, it } from "vitest";
import { workflowExperienceRevisionSchema, workflowStepToolAccessSchema } from "./workflow-experience.js";
import { workflowDraftStepCommandSchema } from "./workflow-draft-edit.js";
const step = { number: 1, name: "Step", operation: "Operation", effect: "pure", testMode: "safe", approval: "not_verified", retry: "none", next: [] };
const revision = { id: "10000000-0000-4000-8000-000000000001", version: 1, state: "draft", coverage: "complete", steps: [step] };
const semantics = { actor: "workflow", input: "condition_data", durationSeconds: null, approvalPolicy: "no_checkpoint", access: "no_step_grant", maxAttempts: 1, idempotency: "not_required" };
it("retains old body-free revisions and binds closed input material to its declared Native kind", () => {
  expect(workflowExperienceRevisionSchema.safeParse(revision).success).toBe(true);
  const inputReview = { kind: "condition", source: "trigger", path: ["answer"], operator: "===", value: " false " };
  const value = { ...revision, steps: [{ ...step, semantics, inputReview }] };
  expect(workflowExperienceRevisionSchema.parse(value).steps[0].inputReview).toEqual(inputReview);
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...step, inputReview }] }).success).toBe(false);
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...step, semantics: { ...semantics, input: "tool_arguments" }, inputReview }] }).success).toBe(false);
});
it("requires selected-agent semantics for visible assignment metadata", () => {
  const assignment = { state: "current", name: "Selected analyst" };
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...step, semantics, assignment }] }).success).toBe(false);
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...step, semantics: { ...semantics, actor: "selected_agent", input: "task_brief" }, assignment }] }).success).toBe(true);
});
it("binds task briefs to task input semantics and accepts only an explicit UUID assignment change without authority or completion changes", () => {
  const inputReview = { kind: "agent_task", objective: "PRIVATE task brief", waitForCompletion: true };
  const value = { ...revision, steps: [{ ...step, semantics: { ...semantics, actor: "selected_agent", input: "task_brief" }, inputReview }] };
  expect(workflowExperienceRevisionSchema.safeParse(value).success).toBe(true);
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...step, semantics, inputReview }] }).success).toBe(false);
  const command = { requestId: revision.id, expectedWorkflowId: revision.id, expectedDraftRevisionId: revision.id,
    expectedPublishedRevisionId: null, expectedUpdatedAt: "2026-10-14T00:00:00.000Z", expectedNodeId: "task", expectedNodeType: "agent.task",
    name: "Prepare summary", configuration: { kind: "agent_task", objective: "Prepare the summary" } };
  expect(workflowDraftStepCommandSchema.safeParse(command).success).toBe(true);
  expect(workflowDraftStepCommandSchema.safeParse({ ...command, configuration: { ...command.configuration, agentId: revision.id } }).success).toBe(true);
  for (const extra of [{ agentId: "another-company:agent" }, { waitForCompletion: false }, { expectedOutputSchema: {} }, { grants: ["tools:use"] }])
    expect(workflowDraftStepCommandSchema.safeParse({ ...command, configuration: { ...command.configuration, ...extra } }).success).toBe(false);
});
it("accepts only the Original local permission route and suppresses hidden connection identity", () => {
  const value = { state: "permission_required", connectionName: "Contacts", operationName: "Find", previewHref: "/apps/10000000-0000-4000-8000-000000000001/permissions" };
  expect(workflowStepToolAccessSchema.safeParse(value).success).toBe(true);
  for (const previewHref of ["https://other.invalid/permissions", "javascript:alert(1)", "/apps/------------------------------------/permissions", "/apps/id/permissions?secret=value"])
    expect(workflowStepToolAccessSchema.safeParse({ ...value, previewHref }).success).toBe(false);
  expect(workflowStepToolAccessSchema.safeParse({ ...value, state: "unavailable" }).success).toBe(false);
  expect(workflowStepToolAccessSchema.safeParse({ state: "unavailable", connectionName: null, operationName: null, previewHref: null }).success).toBe(true);
});

it("binds scalar tool input review to the connected-tool actor and its declared input semantics", () => {
  const inputReview = { kind: "connected_tool", inputSchemaHash: "a".repeat(64), fields: [{ name: "query", label: "Search", help: null, type: "string", required: true,
    options: null, minLength: null, maxLength: null, minimum: null, maximum: null }], values: { query: " PRIVATE text " } };
  const toolAccess = { state: "permission_required", connectionName: "Contacts", operationName: "Find", previewHref: "/apps/10000000-0000-4000-8000-000000000001/permissions" };
  const current = { ...step, semantics: { ...semantics, actor: "connected_tool", input: "tool_arguments" }, toolAccess, inputReview };
  expect(workflowExperienceRevisionSchema.parse({ ...revision, steps: [current] }).steps[0].inputReview).toEqual(inputReview);
  for (const state of ["connection_disabled", "catalog_changed"])
    expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...current, toolAccess: { ...toolAccess, state } }] }).success).toBe(false);
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...current, toolAccess: undefined }] }).success).toBe(false);
  for (const change of [{ actor: "human" }, { input: "approval_material" }])
    expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...current, semantics: { ...current.semantics, ...change } }] }).success).toBe(false);
  expect(workflowExperienceRevisionSchema.safeParse({ ...revision, steps: [{ ...current, inputReview: { ...inputReview, values: { unknown: "PRIVATE" } } }] }).success).toBe(false);
});

it("accepts only pinned explicit scalar tool edits, keeping connection selection, mappings, defaults and grants outside that command", () => {
  const value = { requestId: revision.id, expectedWorkflowId: revision.id, expectedDraftRevisionId: revision.id,
    expectedPublishedRevisionId: null, expectedUpdatedAt: "2026-10-14T00:00:00.000Z", expectedNodeId: "tool", expectedNodeType: "connector.action", name: "Find contacts",
    configuration: { kind: "connected_tool", inputSchemaHash: "a".repeat(64), input: { query: " PRIVATE literal ", enabled: false } } };
  expect(workflowDraftStepCommandSchema.parse(value).configuration).toEqual(value.configuration);
  for (const extra of [{ connectionId: revision.id }, { inputMapping: { query: "{{trigger.private}}" } }, { grants: ["tools:use"] }, { inputSchemaHash: "old" }])
    expect(workflowDraftStepCommandSchema.safeParse({ ...value, configuration: { ...value.configuration, ...extra } }).success).toBe(false);
});

it("allows an exact catalog-action focus without admitting arbitrary permission URLs", () => {
  const href = "/apps/10000000-0000-4000-8000-000000000001/permissions";
  const view = { state: "execution_check", connectionName: "Contacts", operationName: "Find", previewHref: href };
  expect(workflowStepToolAccessSchema.safeParse({ ...view, previewHref: href + "?focus=10000000-0000-4000-8000-000000000002" }).success).toBe(true);
  for (const suffix of ["?focus=bad", "?focus=10000000-0000-4000-8000-000000000002&allow=true", "?redirect=https://outside.invalid", "#approve", "?focus=javascript:alert(1)"])
    expect(workflowStepToolAccessSchema.safeParse({ ...view, previewHref: href + suffix }).success).toBe(false);
});
