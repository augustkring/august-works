import { z } from "zod";
export const customerSupportHistorySchema = z
  .strictObject({
    companyId: z.uuid(),
    observedAt: z.iso.datetime(),
    hasMore: z.boolean(),
    entries: z
      .array(
        z.strictObject({
          sessionId: z.uuid(),
          operatorReference: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^\u0000-\u001f\u007f]+$/),
          approvedAt: z.iso.datetime(),
          expiresAt: z.iso.datetime(),
          revokedAt: z.iso.datetime().nullable(),
          state: z.enum(["recorded", "expired", "revoked"]),
          scopes: z
            .array(
              z.enum([
                "status:read",
                "runtime:manage",
                "billing:override",
                "backup:restore",
              ]),
            )
            .min(1)
            .max(4)
            .refine((value) => new Set(value).size === value.length),
          origin: z.literal("native_v6_approval"),
        }),
      )
      .max(10),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.entries.map((entry) => entry.sessionId)).size !==
      value.entries.length
    )
      context.addIssue({
        code: "custom",
        message: "Native support history contains duplicate records",
      });
    for (const entry of value.entries) {
      const expected =
        entry.revokedAt !== null
          ? "revoked"
          : Date.parse(entry.expiresAt) <= Date.parse(value.observedAt)
            ? "expired"
            : "recorded";
      if (
        entry.state !== expected ||
        Date.parse(entry.expiresAt) <= Date.parse(entry.approvedAt)
      )
        context.addIssue({
          code: "custom",
          message: "Native support history state is inconsistent",
        });
    }
  });
export type CustomerSupportHistory = z.infer<
  typeof customerSupportHistorySchema
>;

/** Native command review metadata only; it never establishes scoped access. */
export const nativeSupportReviewSchema = z.strictObject({
  companyId: z.uuid(),
  approvalId: z.uuid(),
  reviewedAt: z.iso.datetime(),
  state: z.enum(["pending", "cancelled", "recorded"]),
});
export type NativeSupportReview = z.infer<typeof nativeSupportReviewSchema>;

/** Customer cases are separate from V6 privileged-access approvals. These
 * published limits and labels are shared by intake, replies and their UI. */
export const SUPPORT_CASE_LIMITS = {
  description: 10000,
  subject: 200,
  reply: 10000,
  timelinePage: 50,
} as const;
export const supportCaseCategorySchema = z.enum([
  "not_working", "access", "apps_connections", "account_billing", "using_blentera", "other",
]);
export const supportCaseImpactSchema = z.enum(["blocked", "limited", "question"]);
export const supportCaseStatusSchema = z.enum([
  "RECEIVED", "INVESTIGATING", "WORKING_ON_IT", "WAITING_FOR_YOU", "RESOLVED", "CLOSED",
]);
export type SupportCaseCategory = z.infer<typeof supportCaseCategorySchema>;
export type SupportCaseImpact = z.infer<typeof supportCaseImpactSchema>;
export type SupportCaseStatus = z.infer<typeof supportCaseStatusSchema>;

export const SUPPORT_CASE_COPY = {
  en: {
    title: "Contact support",
    description: "What do you need help with?",
    descriptionHelp: "Tell us what you wanted to do and what happened.",
    categories: {
      not_working: "Something is not working", access: "Access", apps_connections: "Apps and connections",
      account_billing: "Account and billing", using_blentera: "Using Blentera", other: "Other",
    },
    impacts: { blocked: "I am blocked", limited: "I can continue with limitations", question: "I have a question" },
    statuses: {
      RECEIVED: "Received", INVESTIGATING: "Investigating", WORKING_ON_IT: "Working on it",
      WAITING_FOR_YOU: "Waiting for you", RESOLVED: "Resolved", CLOSED: "Closed",
    },
    deliveryPending: "Received; delivery pending",
  },
  da: {
    title: "Kontakt support",
    description: "Hvad har du brug for hjælp til?",
    descriptionHelp: "Fortæl, hvad du ville gøre, og hvad der skete.",
    categories: {
      not_working: "Noget virker ikke", access: "Adgang", apps_connections: "Apps og forbindelser",
      account_billing: "Konto og betaling", using_blentera: "Hjælp til Blentera", other: "Andet",
    },
    impacts: { blocked: "Jeg kan ikke komme videre", limited: "Jeg kan fortsætte med begrænsninger", question: "Jeg har et spørgsmål" },
    statuses: {
      RECEIVED: "Modtaget", INVESTIGATING: "Vi undersøger sagen", WORKING_ON_IT: "Vi arbejder på en løsning",
      WAITING_FOR_YOU: "Afventer dit svar", RESOLVED: "Løst", CLOSED: "Afsluttet",
    },
    deliveryPending: "Modtaget; afventer levering",
  },
} as const satisfies Record<"en" | "da", {
  title: string; description: string; descriptionHelp: string;
  categories: Record<SupportCaseCategory, string>;
  impacts: Record<SupportCaseImpact, string>;
  statuses: Record<SupportCaseStatus, string>;
  deliveryPending: string;
}>;

// Reported, removable preview fields only. No URL, body, prompt, exception,
// arbitrary metadata or credentials can enter automatic context carry-forward.
export const supportCaseSafeContextSchema = z.strictObject({
  surface: z.enum(["home", "needs_you", "work", "agents", "apps", "company", "account", "onboarding", "workflow", "support", "other"]).optional(),
  operationId: z.uuid().optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  errorCode: z.enum(["NETWORK_UNAVAILABLE", "REQUEST_TIMEOUT", "ACCESS_CHANGED", "DEPENDENCY_UNAVAILABLE"]).optional(),
});
export type SupportCaseSafeContext = z.infer<typeof supportCaseSafeContextSchema>;
const supportCommandFields = {
  idempotencyKey: z.uuid(),
  expectedUserId: z.string().min(1).max(300),
};
export const createSupportCaseSchema = z.strictObject({
  ...supportCommandFields,
  description: z.string().trim().min(1).max(SUPPORT_CASE_LIMITS.description),
  category: supportCaseCategorySchema.default("other"),
  subject: z.string().trim().min(1).max(SUPPORT_CASE_LIMITS.subject).optional(),
  impact: supportCaseImpactSchema.nullable().default(null),
  safeContext: supportCaseSafeContextSchema.optional(),
});
export const replySupportCaseSchema = z.strictObject({
  ...supportCommandFields,
  body: z.string().trim().min(1).max(SUPPORT_CASE_LIMITS.reply),
  safeContext: supportCaseSafeContextSchema.optional(),
});
export type CreateSupportCase = z.infer<typeof createSupportCaseSchema>;
export type ReplySupportCase = z.infer<typeof replySupportCaseSchema>;

/** The server derives a subject when the customer did not edit the preview. */
export function deriveSupportCaseSubject(description: string): string {
  return description.trim().split(/[\r\n]/, 1)[0]!.slice(0, SUPPORT_CASE_LIMITS.subject).replace(/[\uD800-\uDBFF]$/u, "").trimEnd();
}

/** Operator configuration, never customer-selected retention or delivery proof.
 * No duration defaults: intake requires a complete configured support policy. */
const supportPolicyKey = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
export const supportCaseDataPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  policyVersion: supportPolicyKey,
  recipientName: z.string().trim().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/),
  privacyNoticeUrl: z.url().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch { return false; }
  }),
  processingRegion: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/),
  retentionTrigger: z.literal("after_last_customer_or_support_message"),
  retentionDays: z.number().int().min(1).max(36500),
  backupMaxDays: z.number().int().min(1).max(36500),
  restoreLagDays: z.number().int().min(0).max(36500),
  deletionMarkerDays: z.number().int().min(1).max(109500),
  legalHoldPolicyId: supportPolicyKey,
}).superRefine((policy, context) => {
  if (policy.deletionMarkerDays < policy.backupMaxDays + policy.restoreLagDays) {
    context.addIssue({ code: "custom", path: ["deletionMarkerDays"], message: "Support erasure ledger must cover the backup and restore horizon" });
  }
});
export type SupportCaseDataPolicy = z.infer<typeof supportCaseDataPolicySchema>;
