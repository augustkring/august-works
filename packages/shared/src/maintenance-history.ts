import { z } from "zod";

export const maintenanceHistoryEntrySchema = z.strictObject({
  receiptId: z.uuid(),
  recordedAt: z.iso.datetime(),
  maintenanceClass: z.literal("M2"),
  outcome: z.enum(["configured_activation_required", "human_review_required"]),
});
export const maintenanceHistorySchema = z
  .strictObject({
    companyId: z.uuid(),
    installationId: z.uuid(),
    agentId: z.uuid(),
    installationVersion: z.number().int().positive(),
    installationStatus: z.enum([
      "configuring",
      "readiness_blocked",
      "ready",
      "active",
      "needs_update",
      "degraded",
      "suspended",
      "uninstalled",
    ]),
    observedAt: z.iso.datetime(),
    entries: z.array(maintenanceHistoryEntrySchema).max(10),
    hasMore: z.boolean(),
  })
  .superRefine((view, ctx) => {
    if (
      new Set(view.entries.map((entry) => entry.receiptId)).size !==
      view.entries.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate maintenance receipt",
      });
  });
export type MaintenanceHistory = z.infer<typeof maintenanceHistorySchema>;
