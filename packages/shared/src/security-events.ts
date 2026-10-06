import { z } from "zod";
// Fixed native action vocabulary prevents free-form audit details entering SIEM.
export const SECURITY_EVENT_ACTIONS = [
  "secret.created",
  "secret.rotated",
  "secret.deleted",
  "secret.proposal.approved",
  "secret.proposal.rejected",
  "enterprise.identity_policy_configured",
  "enterprise.identity_qualified",
  "enterprise.identity_suspended",
  "enterprise.subject_bound",
  "enterprise.subject_revoked",
  "enterprise.scim_credential_rotated",
  "enterprise.scim_decommissioned",
  "enterprise.membership_lifecycle_changed",
  "governance.purpose_changed",
  "governance.assessment_recorded",
  "governance.deployment_bound",
  "governance.deployment_review_required",
] as const;
export const securityEventExportConfigurationSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    endpoint: z
      .string()
      .url()
      .max(2000)
      .refine((value) => {
        try {
          const u = new URL(value);
          return u.protocol === "https:" && !u.username && !u.password &&
            !u.hash && !u.search && (!u.port || u.port === "443");
        } catch {
          return false;
        }
      }, "A fixed public HTTPS endpoint is required"),
    signingSecretId: z.string().uuid(),
    signingSecretVersion: z.number().int().positive(),
    actions: z
      .array(z.enum(SECURITY_EVENT_ACTIONS))
      .min(1)
      .max(SECURITY_EVENT_ACTIONS.length)
      .refine((values) => new Set(values).size === values.length),
    enabled: z.boolean(),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export type SecurityEventExportConfigurationInput = z.input<
  typeof securityEventExportConfigurationSchema
>;
export interface SecurityEventExportConfigurationView {
  id: string;
  companyId: string;
  version: number;
  endpoint: string;
  signingSecretId: string;
  signingSecretVersion: number;
  actions: string[];
  enabled: boolean;
  droppedEvents: number;
  delivery?: {
    pending: number;
    delivered: number;
    failed: number;
    cancelled: number;
    lastDeliveredAt: string | null;
  };
}
export interface SecurityEventEnvelope {
  schemaVersion: "aw.security-event.v1";
  eventId: string;
  companyId: string;
  action: (typeof SECURITY_EVENT_ACTIONS)[number];
  occurredAt: string;
}
