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
