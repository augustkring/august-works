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
