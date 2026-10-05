import { z } from "zod";
import * as shared from "@paperclipai/shared";

// Explicit profile-specific contracts; the route coverage gate checks this catalogue against mounted handlers.
export const v6ApiPaths: {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  successStatus: number;
  auth: "session" | "host" | "provider";
  body?: z.ZodType;
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
  },
  {
    method: "post",
    path: "/api/companies/{companyId}/support-sessions",
    successStatus: 201,
    auth: "session",
  },
  {
    method: "delete",
    path: "/api/companies/{companyId}/support-sessions/{sessionId}",
    successStatus: 200,
    auth: "session",
  },
  {
    method: "get",
    path: "/api/saas/internal/support/{sessionId}/status",
    successStatus: 200,
    auth: "session",
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
};
for (const operation of v6ApiPaths)
  operation.body =
    bodies[operation.method.toUpperCase() + " " + operation.path];
