import { z } from "zod";

export const FEEDBACK_CONTACTS = {
  support: "mailto:support@blentera.com",
  security: "mailto:security@blentera.com",
  privacy: "mailto:privacy@blentera.com",
} as const;
export const feedbackCategorySchema = z.enum([
  "BUG",
  "IMPROVEMENT",
  "IDEA",
  "OTHER",
]);
export const feedbackStatusSchema = z.enum([
  "RECEIVED",
  "REVIEWING",
  "NEEDS_INFO",
  "RESOLVED",
  "CLOSED",
]);
export const feedbackInternalStateSchema = z.enum([
  "RECEIVED",
  "CLASSIFIED",
  "UNDER_REVIEW",
  "ACTIONABLE",
  "NEEDS_INFO",
  "LINKED_DUPLICATE",
  "CLOSED_NO_ACTION",
  "RESOLVED_FIXED",
  "RESOLVED_SHIPPED",
  "RESOLVED_OTHER",
]);
export const FEEDBACK_CUSTOMER_STATUS = {
  RECEIVED: "RECEIVED",
  CLASSIFIED: "REVIEWING",
  UNDER_REVIEW: "REVIEWING",
  ACTIONABLE: "REVIEWING",
  NEEDS_INFO: "NEEDS_INFO",
  LINKED_DUPLICATE: "REVIEWING",
  CLOSED_NO_ACTION: "CLOSED",
  RESOLVED_FIXED: "RESOLVED",
  RESOLVED_SHIPPED: "RESOLVED",
  RESOLVED_OTHER: "RESOLVED",
} as const;
export const feedbackSurfaceSchema = z.enum([
  "home",
  "needs_you",
  "work",
  "agents",
  "apps",
  "company",
  "onboarding",
  "workflow",
  "support",
  "other",
]);
// Reported presentation metadata, never authorization or proof of client state.
export const feedbackClientEnvironmentSchema = z
  .strictObject({
    source: z.literal("reported_user_agent"),
    browser: z.strictObject({
      family: z.enum([
        "edge",
        "opera",
        "chrome",
        "chromium",
        "firefox",
        "safari",
        "unknown",
      ]),
      majorVersion: z.number().int().min(1).max(999).nullable(),
    }),
    operatingSystem: z.strictObject({
      family: z.enum([
        "windows",
        "android",
        "ios",
        "macos",
        "chromeos",
        "linux",
        "unknown",
      ]),
      majorVersion: z.number().int().min(1).max(999).nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    for (const key of ["browser", "operatingSystem"] as const)
      if (value[key].family === "unknown" && value[key].majorVersion !== null)
        ctx.addIssue({
          code: "custom",
          path: [key, "majorVersion"],
          message: "Unknown family has no reported version",
        });
  });
export const FEEDBACK_CONTEXT_FEATURE_IDS = [
  "experience_projection_v9",
  "progressive_shell_v9",
  "home_v9",
  "customer_feedback_v9",
  "activation_v9",
  "hire_agent_v9",
  "ambient_commands_v9",
] as const;
export const feedbackContextScreenSchema = z.enum([
  "HOME",
  "NEEDS-YOU",
  "WORK",
  "APPS",
  "COMPANY",
  "WORKFLOW",
  "AGENT-MONITOR",
  "MY-FEEDBACK",
  "SUPPORT-ACCESS",
  "SETTINGS-GENERAL",
]);
const contextScreenSurfaces: Record<
  z.infer<typeof feedbackContextScreenSchema>,
  z.infer<typeof feedbackSurfaceSchema>
> = {
  HOME: "home",
  "NEEDS-YOU": "needs_you",
  WORK: "work",
  APPS: "apps",
  COMPANY: "company",
  WORKFLOW: "workflow",
  "AGENT-MONITOR": "agents",
  "MY-FEEDBACK": "other",
  "SUPPORT-ACCESS": "support",
  "SETTINGS-GENERAL": "company",
};
export const feedbackContextSchema = z.strictObject({
  surfaceKey: feedbackSurfaceSchema,
  locale: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/)
    .max(24),
  timezone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  viewportClass: z.enum(["compact", "medium", "wide"]),
  // Optional preserves old immutable request hashes during an upgrade/retry.
  screenContractId: feedbackContextScreenSchema.optional(),
  clientEnvironment: feedbackClientEnvironmentSchema.optional(),
  clientReleaseBuildId: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable()
    .optional(),
});
export const feedbackDiagnosticsSchema = z.strictObject({
  safeErrorCodes: z
    .array(
      z.enum([
        "NETWORK_UNAVAILABLE",
        "REQUEST_TIMEOUT",
        "ACCESS_CHANGED",
        "DEPENDENCY_UNAVAILABLE",
      ]),
    )
    .max(8),
  correlationIds: z.array(z.uuid()).max(8),
});
export const createCustomerFeedbackSchema = z
  .strictObject({
    idempotencyKey: z.uuid(),
    category: feedbackCategorySchema,
    body: z.string().trim().min(1).max(10000),
    goal: z.string().trim().max(2000).default(""),
    blocksWork: z.boolean().default(false),
    omitName: z.boolean().default(false),
    context: feedbackContextSchema,
    includeDiagnostics: z.boolean().default(false),
    diagnostics: feedbackDiagnosticsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.context.screenContractId &&
      contextScreenSurfaces[value.context.screenContractId] !==
        value.context.surfaceKey
    )
      ctx.addIssue({
        code: "custom",
        path: ["context", "screenContractId"],
        message: "Screen category does not match",
      });
    if (value.diagnostics && !value.includeDiagnostics)
      ctx.addIssue({
        code: "custom",
        path: ["diagnostics"],
        message: "Diagnostics require explicit consent",
      });
    if (value.blocksWork && value.category !== "BUG")
      ctx.addIssue({
        code: "custom",
        path: ["blocksWork"],
        message: "Work blocker applies to bugs",
      });
  });
export const feedbackFollowUpSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  body: z.string().trim().min(1).max(10000),
  expectedVersion: z.number().int().nonnegative(),
});
export const feedbackTriageSchema = z
  .strictObject({
    idempotencyKey: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    internalState: feedbackInternalStateSchema,
    customerMessage: z.string().trim().max(10000).default(""),
    internalNote: z.string().trim().max(10000).default(""),
    link: z
      .strictObject({ type: z.enum(["issue", "duplicate"]), id: z.uuid() })
      .optional(),
  })
  .refine(
    (value) => value.internalState !== "NEEDS_INFO" || !!value.customerMessage,
    { message: "A customer question is required", path: ["customerMessage"] },
  );
export const customerFeedbackSchema = z.strictObject({
  id: z.uuid(),
  feedbackId: z.string().regex(/^AWF-[A-F0-9]{32}$/),
  companyId: z.uuid(),
  category: feedbackCategorySchema,
  body: z.string(),
  goal: z.string(),
  blocksWork: z.boolean(),
  omitName: z.boolean(),
  status: feedbackStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  messages: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(["customer_follow_up", "product_message"]),
        body: z.string(),
        createdAt: z.iso.datetime(),
      }),
    )
    .max(100),
});
/** A missing observation does not establish rejection or effect quiescence. */
export const customerFeedbackRequestReceiptSchema = z.strictObject({
  requestKey: z.uuid(), receipt: customerFeedbackSchema.nullable(),
});
export type CustomerFeedbackRequestReceipt = z.infer<typeof customerFeedbackRequestReceiptSchema>;
export type CreateCustomerFeedback = z.infer<
  typeof createCustomerFeedbackSchema
>;
export type CustomerFeedback = z.infer<typeof customerFeedbackSchema>;
export const customerFeedbackListSchema = z
  .array(customerFeedbackSchema)
  .max(25);
export const feedbackInternalSummarySchema = customerFeedbackSchema
  .pick({
    id: true,
    feedbackId: true,
    category: true,
    body: true,
    goal: true,
    version: true,
    createdAt: true,
  })
  .extend({ internalState: feedbackInternalStateSchema });
export const feedbackInternalListSchema = z
  .array(feedbackInternalSummarySchema)
  .max(25);
export const feedbackInternalDetailSchema = customerFeedbackSchema
  .extend({
    internalState: feedbackInternalStateSchema,
    submittedByUserId: z.string().min(1).optional(),
    context: feedbackContextSchema.extend({
      routeTemplate: z
        .enum([
          "/dashboard",
          "/needs-you",
          "/work",
          "/agents",
          "/apps",
          "/company/settings",
          "/saas/activation/:screen",
          "/workflows",
          "/company/settings/support",
          "/company/support-access",
        ])
        .nullable(),
      releaseBuildId: z.string().min(1).max(200),
      relevantFeatureFlagIds: z
        .array(z.enum(FEEDBACK_CONTEXT_FEATURE_IDS))
        .max(FEEDBACK_CONTEXT_FEATURE_IDS.length)
        .optional(),
    }),
    diagnostics: feedbackDiagnosticsSchema.nullable(),
    events: z
      .array(
        z.strictObject({
          id: z.uuid(),
          kind: z.enum(["customer_follow_up", "product_message"]),
          body: z.string(),
          internalNote: z.string().nullable(),
          linkType: z.enum(["issue", "duplicate"]).nullable(),
          linkId: z.uuid().nullable(),
          createdAt: z.iso.datetime(),
        }),
      )
      .max(100),
    nextEventCursor: z.uuid().nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.context.screenContractId &&
      contextScreenSurfaces[value.context.screenContractId] !==
        value.context.surfaceKey
    )
      ctx.addIssue({
        code: "custom",
        path: ["context", "screenContractId"],
        message: "Screen category does not match",
      });
    if (value.omitName && value.submittedByUserId !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["submittedByUserId"],
        message: "No-name feedback cannot expose its author",
      });
  });
