import { z } from "zod";
export const notificationPolicySchema = z.strictObject({
  version: z.literal(1),
  cadence: z.enum(["immediate", "digest", "in_app_only"]),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Select a valid timezone"),
  quietHours: z
    .strictObject({
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(0).max(1439),
    })
    .nullable()
    .refine(
      (value) => !value || value.startMinute !== value.endMinute,
      "Quiet hours must leave delivery time available",
    ),
  digestMinute: z.number().int().min(0).max(1439),
});
export type NotificationPolicy = z.infer<typeof notificationPolicySchema>;
export const notificationPreferenceUpdateSchema = z.strictObject({
  category: z.enum([
    "security",
    "billing",
    "runtime",
    "approval",
    "work_update",
  ]),
  emailEnabled: z.boolean(),
  policy: notificationPolicySchema.optional(),
});

/** A conversation may propose an own-account preference; only the Human's
 * current Original account owner may apply it after baseline review. */
export const notificationPreferenceProposalInputSchema = z.strictObject({
  idempotencyKey:z.string().trim().min(1).max(120).regex(/^[^\u0000\uD800-\uDFFF]*$/u),
  preference:notificationPreferenceUpdateSchema,
});
export const notificationPreferenceProposalInputJsonSchema=z.toJSONSchema(notificationPreferenceProposalInputSchema);
export const notificationPreferenceProposalConfirmSchema=z.strictObject({
  requestId:z.uuid(),expectedProposalVersion:z.number().int().positive(),expectedBaselineHash:z.string().regex(/^[a-f0-9]{64}$/),
});

export const notificationPreferenceProposalViewSchema=z.strictObject({
  id:z.uuid(),companyId:z.uuid(),version:z.number().int().positive(),
  status:z.enum(["pending","applied","discarded"]),category:notificationPreferenceUpdateSchema.shape.category,
  preference:notificationPreferenceUpdateSchema,baselineHash:z.string().regex(/^[a-f0-9]{64}$/),
  baselineChanged:z.boolean(),preferenceApplied:z.boolean(),requiresHumanReview:z.boolean(),
  confirmationRequestId:z.uuid().nullable(),
}).superRefine((value,ctx)=>{
  if(value.category!==value.preference.category||value.preferenceApplied!==(value.status==="applied")||value.requiresHumanReview!==(value.status==="pending"))
    ctx.addIssue({code:"custom",message:"Use the actual owned notification proposal state"});
});
export type NotificationPreferenceProposalView=z.infer<typeof notificationPreferenceProposalViewSchema>;
