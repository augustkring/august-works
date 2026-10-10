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
