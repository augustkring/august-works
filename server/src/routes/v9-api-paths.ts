import { z } from "zod";
import {
  activationCommandSchema,
  activationViewSchema,
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentDraftDiscardSchema,
  agentDraftAdmissionSchema,
  agentAuthoringDraftViewSchema,
  agentAuthoringDraftPageSchema,
  hireAgentCatalogSchema,
  hireAgentCapabilityStatusSchema,
  createCustomerFeedbackSchema,
  feedbackFollowUpSchema,
  feedbackTriageSchema,
  customerFeedbackSchema,
  customerFeedbackListSchema,
  feedbackInternalListSchema,
  feedbackInternalDetailSchema,
  experienceModelSchema,
  experienceProfileSchema,
  experienceCommandQuerySchema,
  experienceCommandsSchema,
  companyExperienceSchema,
  workflowExperienceSchema,
  workflowRunExperienceSchema,
  workflowLifecycleCommandSchema,
  workflowLifecycleReceiptSchema,
  workflowOperationsSchema,
  workflowLaunchCommandSchema,
  workflowLaunchReceiptSchema,
  workflowStopCommandSchema,
  workflowStopReceiptSchema,
} from "@paperclipai/shared";

/** Current mounted contracts. Listing an operation confers no rollout or execution qualification. */
export interface V9ApiOperation {
  method: "get" | "post";
  path: string;
  summary: string;
  auth: "public" | "board" | "operator";
  query?: z.ZodType;
  body?: z.ZodType;
  result?: z.ZodType;
  successStatus?: 200 | 201;
  privateResponse?: boolean;
  unavailable?: boolean;
  overloaded?: boolean;
  rateLimited?: boolean;
  blocked?: boolean;
}
const company = "/api/companies/{companyId}";
const drafts = `${company}/agent-configuration-drafts`;
const feedback = `${company}/customer-feedback`;
const internal = "/api/internal/customer-feedback/{companyId}";
const account = z.object({ expectedUserId: z.string().optional() });
const page = account.extend({ before: z.uuid().optional() });
const read = (
  path: string,
  summary: string,
  result?: z.ZodType,
  query: z.ZodType = account,
): V9ApiOperation => ({
  method: "get",
  path,
  summary,
  result,
  query,
  successStatus: 200,
  auth: "board",
  privateResponse: true,
});
const write = (
  path: string,
  summary: string,
  body: z.ZodType,
  result?: z.ZodType,
  successStatus: 200 | 201 = 200,
): V9ApiOperation => ({
  method: "post",
  path,
  summary,
  body,
  result,
  query: account,
  successStatus,
  auth: "board",
  privateResponse: true,
});
export const v9ApiPaths: V9ApiOperation[] = [
  { ...write(`${company}/workflow-runs/{runId}/experience/stop`,
    "Request native cancellation of the exact reviewed run with an original-request receipt; no completed stop or reversal is claimed",
    workflowStopCommandSchema, workflowStopReceiptSchema), query: z.strictObject({ expectedUserId: z.string().min(1).max(300) }) },
  { ...write(`${company}/workflows/{workflowId}/experience/launch`,
    "Admit a version-bound native internal run with an immutable original-request receipt; no completion or independent verification is claimed",
    workflowLaunchCommandSchema, workflowLaunchReceiptSchema), query: z.strictObject({ expectedUserId: z.string().min(1).max(300) }) },
  read(
    `${company}/workflows/{workflowId}/experience/operations`,
    "Read the native scheduled trigger and bounded run/blocker status metadata with current source admission",
    workflowOperationsSchema,
    z.strictObject({ expectedUserId: z.string().min(1).max(300) }),
  ),
  {
    ...write(
      `${company}/workflows/{workflowId}/experience/lifecycle`,
      "Pause new native admissions, resume explicitly or retire a drained unbound workflow; replay original receipts",
      workflowLifecycleCommandSchema,
      workflowLifecycleReceiptSchema,
    ),
    query: z.strictObject({ expectedUserId: z.string().min(1).max(300) }),
  },
  {
    ...read(
      `${company}/activation`,
      "Read the current creator-private native activation draft",
      activationViewSchema,
    ),
    query: undefined,
  },
  {
    ...write(
      `${company}/activation`,
      "Apply a versioned original-request activation command; execution remains unqualified",
      activationCommandSchema,
      activationViewSchema,
    ),
    query: undefined,
    unavailable: true,
  },
  {
    ...read(
      `${company}/experience`,
      "Read bounded current native work projections; partial dependencies remain explicit",
      experienceModelSchema,
      account.extend({ profile: experienceProfileSchema.optional() }),
    ),
    overloaded: true,
  },
  {
    ...read(
      `${company}/experience/commands`,
      "Resolve bounded deterministic current-authority commands; semantic authoring remains unqualified",
      experienceCommandsSchema,
      account.extend({ q: experienceCommandQuerySchema.optional() }),
    ),
    overloaded: true,
  },
  {
    ...read(
      `${company}/experience/company`,
      "Read permission-filtered native Company navigation",
      companyExperienceSchema,
    ),
    overloaded: true,
  },
  write(
    `${company}/experience/profile`,
    "Save a presentation profile within current native authority",
    z.strictObject({ profile: experienceProfileSchema }),
  ),
  read(
    drafts,
    "List creator-private saved proposals with bounded native pagination",
    agentAuthoringDraftPageSchema,
    page,
  ),
  read(
    `${drafts}/options`,
    "Read current authorized owner, approved-knowledge and runtime references",
    undefined,
    account.extend({ agentId: z.uuid().optional() }),
  ),
  read(
    `${drafts}/admission`,
    "Recheck current verified create/configure admission without returning proposed or active configuration",
    agentDraftAdmissionSchema,
    account.extend({ agentId: z.uuid().optional() }),
  ),
  read(
    `${drafts}/hire-catalog`,
    "Read current qualified customer-visible native package releases",
    hireAgentCatalogSchema,
  ),
  {
    ...write(
      drafts,
      "Create or reconcile one creator-private Custom or pinned Hire proposal; never activate",
      agentDraftCreateSchema,
      agentAuthoringDraftViewSchema,
      201,
    ),
    unavailable: true,
  },
  read(
    `${drafts}/{id}`,
    "Read one creator-private proposal after current native admission",
    agentAuthoringDraftViewSchema,
  ),
  {
    ...write(
      `${drafts}/{id}/save`,
      "Save an original-request versioned proposal without granting authority",
      agentDraftSaveSchema,
      agentAuthoringDraftViewSchema,
    ),
    unavailable: true,
  },
  write(
    `${drafts}/{id}/discard`,
    "Discard proposal content through its native owner after rollback or withdrawal",
    agentDraftDiscardSchema,
    agentAuthoringDraftViewSchema,
  ),
  read(
    `${drafts}/{id}/review`,
    "Read current proposal blockers; representative testing and publication remain unqualified",
  ),
  read(
    `${drafts}/{id}/hire-capability`,
    "Recheck the immutable pinned native package independently of new-write admission",
    hireAgentCapabilityStatusSchema,
  ),
  {
    method: "post",
    path: `${drafts}/{id}/publish`,
    summary:
      "Reject unqualified agent publication; no successful publication response exists",
    query: account,
    auth: "board",
    privateResponse: true,
    blocked: true,
  },
  {
    method: "get",
    path: "/api/customer-feedback/policy",
    summary:
      "Read configured feedback contacts and currently closed attachment admission",
    auth: "public",
    successStatus: 200,
  },
  read(
    feedback,
    "List only the submitting principal's own feedback",
    customerFeedbackListSchema,
    page,
  ),
  read(
    `${feedback}/{feedbackId}`,
    "Read the author's private feedback and customer-visible messages",
    customerFeedbackSchema,
  ),
  {
    ...write(
      feedback,
      "Reconcile one immutable original feedback submission under the native actor budget",
      createCustomerFeedbackSchema,
      customerFeedbackSchema,
      201,
    ),
    rateLimited: true,
    unavailable: true,
  },
  write(
    `${feedback}/{feedbackId}/follow-up`,
    "Append an original-request customer follow-up without replacing the original report",
    feedbackFollowUpSchema,
    customerFeedbackSchema,
  ),
  {
    ...read(
      internal,
      "List private feedback for an explicitly configured verified operator",
      feedbackInternalListSchema,
      page,
    ),
    auth: "operator",
  },
  {
    ...read(
      `${internal}/{feedbackId}`,
      "Read bounded purpose-separated triage history for a configured operator",
      feedbackInternalDetailSchema,
      account.extend({ beforeEvent: z.uuid().optional() }),
    ),
    auth: "operator",
  },
  {
    ...write(
      `${internal}/{feedbackId}/triage`,
      "Record a versioned operator triage event; duplicates retain independent report identity",
      feedbackTriageSchema,
      customerFeedbackSchema,
    ),
    auth: "operator",
  },
  read(
    `${company}/workflows/{workflowId}/experience`,
    "Read separate native published/draft revisions as bounded declarations; no authority or test result is created",
    workflowExperienceSchema,
    z.object({ expectedUserId: z.string().min(1) }),
  ),
  read(
    `${company}/workflow-runs/{runId}/experience`,
    "Read current native run status and bounded attempt metadata; no private payload or approval decision is returned",
    workflowRunExperienceSchema,
    z.object({ expectedUserId: z.string().min(1) }),
  ),
];
