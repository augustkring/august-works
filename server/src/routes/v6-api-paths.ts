import { z } from "zod";
import * as shared from "@paperclipai/shared";
import { supportCaseOperatorBodySchema, supportCaseOperatorReceiptSchema } from "../services/saas/support-case-operator.js";

const noQuery = z.strictObject({});
const expectedUserQuery = z.strictObject({ expectedUserId: z.string().min(1).max(300) });
const projectAccessMemberRowSchema = z.strictObject({ id: z.uuid(), companyId: z.uuid(), projectId: z.uuid(),
  subjectType: z.enum(["user", "agent"]), subjectId: z.string().min(1), createdAt: z.iso.datetime() });
const projectAccessMemberViewSchema = projectAccessMemberRowSchema.extend({ subjectDisplayName: z.null(), subjectAvatarUrl: z.null() });
const issueAccessReasonSchema = z.strictObject({
  id: z.string().min(1), companyId: z.uuid(), issueId: z.uuid(), subjectType: z.enum(["user", "agent"]),
  subjectId: z.string().min(1).max(255), source: z.enum(["explicit", "assignment", "project", "owner"]), inherited: z.boolean().optional(),
  grantedByUserId: z.string().nullable(), grantedByAgentId: z.uuid().nullable(), createdAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable(),
  subjectDisplayName: z.null(), subjectAvatarUrl: z.null(), subjectInitials: z.null(), agentVisibility: z.null(),
});
const issueAccessGrantBodySchema = z.strictObject({ subjectType: z.enum(["user", "agent"]), subjectId: z.string().trim().min(1).max(255) });
const issueAccessGrantRevokeBodySchema = z.strictObject({}).default({});
const issuePrivacyConstraintsSchema = z.strictObject({ publicBlockedBy: z.enum(["parent", "project"]).nullable(), leavesPersonalProject: z.boolean() });
const importJobId = z.string().regex(/^(?:tenant-)?import-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const importOperationReceiptSchema = z.strictObject({ id: importJobId, operationType: z.literal("company_import"), domain: z.literal("company_portability"),
  domainOperationRef: z.string().nullable(), status: z.enum(["admitted", "running", "cancel_requested", "cancelled", "succeeded", "failed", "inconclusive"]),
  progressStage: z.string().min(1).max(100), attempt: z.number().int().min(1), unknownOutcome: z.boolean(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable() });
const importJobResultSchema = z.strictObject({ companyId: z.uuid(), agentCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(), companyAction: z.enum(["none", "create", "update"]) });
const importJobListItemSchema = z.strictObject({
  job: z.strictObject({ id: importJobId, status: z.enum(["running", "cancelled", "succeeded", "failed", "needs_reconciliation"]),
    createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), completedAt: z.iso.datetime().optional(),
    target: z.strictObject({ mode: z.literal("new_company"), result: z.literal("not_confirmed") }).optional(),
    result: importJobResultSchema.optional(), error: z.strictObject({ message: z.string() }).optional() }),
  operation: importOperationReceiptSchema,
});
const importJobListSchema = z.strictObject({ jobs: z.array(importJobListItemSchema).max(50), nextCursor: z.string().max(512).nullable() });
const importJobListQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(512).optional(), expectedUserId: z.string().optional() });

// Explicit profile-specific contracts; the route coverage gate checks this catalogue against mounted handlers.
export const v6ApiPaths: {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  successStatus: number;
  additionalSuccessStatuses?: number[];
  auth: "session" | "host" | "provider" | "native";
  query?: z.ZodType;
  body?: z.ZodType;
  bodyRequired?: boolean;
  result?: z.ZodType;
  privateResponse?: boolean;
}[] = [
  {
    method: "get",
    path: "/api/saas/capabilities",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/companies",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/onboarding",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "patch",
    path: "/api/companies/{companyId}/onboarding",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/onboarding/first-agent",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/onboarding/starter-task",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/notifications",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/notifications/page",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "patch",
    path: "/api/companies/{companyId}/notifications/preferences",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "patch",
    path: "/api/companies/{companyId}/notifications/{notificationId}",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/account/notification-preferences",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/saas-invitations",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/billing",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/billing/checkout",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/billing/portal",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/billing/checkouts/{intentId}",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/usage",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/deletion",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/support-sessions",
    successStatus: 200,
    auth: "session",
    privateResponse: true,
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/support-sessions",
    successStatus: 201,
    auth: "session",
    privateResponse: true,
  },
  {
    method: "delete",
    path: "/api/companies/{companyId}/support-sessions/{sessionId}",
    successStatus: 200,
    auth: "session",
    privateResponse: true,
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/support-sessions/pending-review",
    successStatus: 200,
    auth: "session",
    result: shared.nativeSupportReviewSchema.nullable(),
    privateResponse: true,
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/support-sessions/reviews",
    successStatus: 201,
    auth: "session",
    result: shared.nativeSupportReviewSchema,
    privateResponse: true,
  },
  {
    method: "delete",
    path: "/api/companies/{companyId}/support-sessions/reviews/{approvalId}",
    successStatus: 200,
    auth: "session",
    result: shared.nativeSupportReviewSchema,
    privateResponse: true,
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/support-sessions/{sessionId}",
    successStatus: 200,
    auth: "session",
    privateResponse: true,
  },
  {
    method: "get",
    path: "/api/saas/internal/support/{sessionId}/status",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/support-cases/{caseId}/respond",
    successStatus: 200,
    auth: "session",
    query: z.strictObject({}),
    body: supportCaseOperatorBodySchema,
    result: supportCaseOperatorReceiptSchema,
    privateResponse: true,
  },
  {
    method: "get", path: "/api/companies/{companyId}/import/jobs", successStatus: 200, auth: "native",
    query: importJobListQuerySchema, result: importJobListSchema,
  },
  {
    method: "post", path: "/api/companies/import/jobs/{jobId}/cancel", successStatus: 200, auth: "native",
    query: z.strictObject({}), body: z.strictObject({}), result: z.unknown(), privateResponse: true,
  },
  {
    method: "get", path: "/api/companies/{companyId}/support/assistant", successStatus: 200, auth: "native",
    query: shared.supportAssistantAvailabilityQuerySchema, result: shared.supportAssistantAvailabilitySchema, privateResponse: true,
  },
  {
    method: "post", path: "/api/companies/{companyId}/support/assistant/answers", successStatus: 200, auth: "native",
    query: noQuery, body: shared.supportAssistantRequestSchema, result: shared.supportAssistantResponseSchema, privateResponse: true,
  },
  {
    method: "get", path: "/api/companies/{companyId}/support/policy", successStatus: 200, auth: "native",
    query: expectedUserQuery, result: shared.supportCaseIntakePolicySchema, privateResponse: true,
  },
  {
    method: "get", path: "/api/companies/{companyId}/support/cases", successStatus: 200, auth: "native",
    query: shared.supportCaseReadQuerySchema, result: shared.supportCaseListSchema, privateResponse: true,
  },
  {
    method: "post", path: "/api/companies/{companyId}/support/cases", successStatus: 201, auth: "native",
    query: noQuery, body: shared.createSupportCaseSchema, result: shared.supportCaseDetailSchema, privateResponse: true,
  },
  {
    method: "get", path: "/api/companies/{companyId}/support/cases/requests/{requestKey}", successStatus: 200, auth: "native",
    query: expectedUserQuery, result: shared.supportCaseDetailSchema, privateResponse: true,
  },
  {
    method: "get", path: "/api/companies/{companyId}/support/cases/{caseId}", successStatus: 200, auth: "native",
    query: shared.supportCaseReadQuerySchema, result: shared.supportCaseDetailSchema, privateResponse: true,
  },
  {
    method: "post", path: "/api/companies/{companyId}/support/cases/{caseId}/replies", successStatus: 201, auth: "native",
    query: noQuery, body: shared.replySupportCaseSchema, result: shared.supportCaseDetailSchema, privateResponse: true,
  },
  {
    method: "post", path: "/api/companies/{companyId}/support/cases/{caseId}/close", successStatus: 200, auth: "native",
    query: noQuery, body: shared.closeSupportCaseSchema, result: shared.supportCaseDetailSchema, privateResponse: true,
  },
  {
    method: "get", path: "/api/projects/{id}/access-members", successStatus: 200, auth: "native",
    query: noQuery, result: z.array(projectAccessMemberViewSchema),
  },
  {
    method: "post", path: "/api/projects/{id}/access-members", successStatus: 201, additionalSuccessStatuses: [200], auth: "native",
    query: noQuery, body: shared.addProjectAccessMemberSchema, result: projectAccessMemberViewSchema,
  },
  {
    method: "delete", path: "/api/projects/{id}/access-members/{memberId}", successStatus: 200, auth: "native",
    query: noQuery, result: projectAccessMemberRowSchema,
  },
  {
    method: "get", path: "/api/issues/{id}/privacy-constraints", successStatus: 200, auth: "native",
    query: noQuery, result: issuePrivacyConstraintsSchema,
  },
  {
    method: "get", path: "/api/issues/{id}/access-grants", successStatus: 200, auth: "native",
    query: noQuery, result: z.array(issueAccessReasonSchema),
  },
  {
    method: "post", path: "/api/issues/{id}/access-grants", successStatus: 201, additionalSuccessStatuses: [200], auth: "native",
    query: noQuery, body: issueAccessGrantBodySchema, result: issueAccessReasonSchema,
  },
  {
    method: "post", path: "/api/issues/{id}/access-grants/{grantId}/revoke", successStatus: 200, auth: "native",
    query: noQuery, body: issueAccessGrantRevokeBodySchema, bodyRequired: false, result: issueAccessReasonSchema,
  },
  {
    method: "post",
    path: "/api/saas/internal/support/{sessionId}/overrides",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/account/deletion-receipts",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/account/deletion",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/support/{sessionId}/runtime-cells/{cellId}/operations",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/internal/support/{sessionId}/runtime-cells/{cellId}/backups",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/runtime-versions",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/runtime-versions/status",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/runtime-capacity",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/support/{sessionId}/canary-runtime",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/internal/operations",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/internal/costs",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/costs",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/internal/fleet",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/internal/fleet/inventory",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/fleet/hosts",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/fleet/hosts/{hostId}/drain",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/fleet/hosts/{hostId}/fence",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/saas/internal/fleet/hosts/{hostId}/retire",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/account/sessions",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/runtime-options",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "put",
    path: "/api/companies/{companyId}/runtime-cells/{cellId}/model-provider",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/runtime-cells/{cellId}/binding",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/runtime-cells/{cellId}/backups",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/runtime-cells",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/companies/{companyId}/runtime-cells/{cellId}/backup-policy",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "put",
    path: "/api/companies/{companyId}/runtime-cells/{cellId}/backup-policy",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/runtime-cells",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/runtime-cells/{cellId}/operations",
    successStatus: 202,
    auth: "session",
  },
  {
    method: "delete",
    path: "/api/saas/account/sessions/{sessionId}",
    successStatus: 204,
    auth: "session",
  },
  {
    method: "post",
    path: "/api/internal/runtime/enrollment-context",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/enroll",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/enrollment-recovery",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/commands/recovery",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/commands/{commandId}/recovery",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/heartbeat",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/commands/claim",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/commands/{commandId}/renew",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/internal/runtime/hosts/{hostId}/commands/{commandId}/complete",
    successStatus: 200,
    auth: "host",
  },
  {
    method: "post",
    path: "/api/webhooks/paddle",
    successStatus: 200,
    auth: "provider",
  },
  {
    method: "post",
    path: "/api/webhooks/mailgun",
    successStatus: 200,
    auth: "provider",
  },
];

const bodies: Record<string, z.ZodType> = {
  "POST /api/companies/{companyId}/support-sessions":
    shared.supportSessionSchema,
  "POST /api/companies/{companyId}/support-sessions/reviews":
    shared.prepareSupportApprovalSchema,
  "POST /api/internal/runtime/enroll": shared.runtimeEnrollmentSchema,
  "POST /api/saas/internal/runtime-capacity":
    shared.runtimeCapacityQualificationSchema,
  "POST /api/companies/{companyId}/runtime-cells/{cellId}/binding":
    shared.runtimeCellBindingSchema,
  "POST /api/saas/account/deletion": shared.accountDeletionRequestSchema,
  "POST /api/saas/companies": shared.createSaasCompanySchema,
  "PATCH /api/companies/{companyId}/onboarding": shared.updateOnboardingSchema,
  "POST /api/companies/{companyId}/billing/checkout": shared.checkoutSchema,
  "POST /api/companies/{companyId}/runtime-cells":
    shared.runtimeCellCreateSchema,
  "POST /api/companies/{companyId}/runtime-cells/{cellId}/operations":
    shared.runtimeOperationSchema,
  "PUT /api/companies/{companyId}/runtime-cells/{cellId}/backup-policy":
    shared.runtimeBackupPolicySchema,
  "POST /api/companies/{companyId}/onboarding/first-agent": z
    .object({
      expectedVersion: z.number().int().positive(),
      name: z.string().trim().min(1).max(100),
    })
    .strict(),
  "POST /api/companies/{companyId}/onboarding/starter-task": z
    .object({ expectedVersion: z.number().int().positive() })
    .strict(),
  "POST /api/saas/internal/runtime-versions":
    shared.runtimeVersionCandidateSchema,
  "POST /api/saas/internal/runtime-versions/status":
    shared.runtimeVersionTransitionSchema,
  "POST /api/saas/internal/support-cases/{caseId}/respond":
    supportCaseOperatorBodySchema,
  "POST /api/companies/{companyId}/support/cases": shared.createSupportCaseSchema,
  "POST /api/companies/{companyId}/support/cases/{caseId}/replies": shared.replySupportCaseSchema,
  "POST /api/companies/{companyId}/support/cases/{caseId}/close": shared.closeSupportCaseSchema,
  "POST /api/projects/{id}/access-members": shared.addProjectAccessMemberSchema,
  "POST /api/issues/{id}/access-grants": issueAccessGrantBodySchema,
  "POST /api/issues/{id}/access-grants/{grantId}/revoke": issueAccessGrantRevokeBodySchema,
};
for (const operation of v6ApiPaths)
  operation.body =
    bodies[operation.method.toUpperCase() + " " + operation.path];
