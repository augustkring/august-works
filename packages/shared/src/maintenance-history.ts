import { z } from "zod";
export const MAINTENANCE_ATTEMPT_LEASE_SECONDS = 5;

export const maintenanceHistoryEntrySchema = z.strictObject({
  receiptId: z.uuid(),
  recordedAt: z.iso.datetime(),
  maintenanceClass: z.literal("M2"),
  outcome: z.enum(["configured_activation_required", "human_review_required"]),
});
export const maintenanceAttemptHistorySchema = z
  .strictObject({
    observedAt: z.iso.datetime(),
    hasMore: z.boolean(),
    entries: z
      .array(
        z.strictObject({
          attemptId: z.uuid(),
          startedAt: z.iso.datetime(),
          leaseExpiresAt: z.iso.datetime(),
          finishedAt: z.iso.datetime().nullable(),
          outcome: z.enum([
            "awaiting_receipt",
            "unconfirmed",
            "no_effect",
            "configuration_recorded",
          ]),
          sourceMatchesCurrent: z.boolean(),
        }),
      )
      .max(10),
  })
  .superRefine((view, ctx) => {
    if (
      new Set(view.entries.map((row) => row.attemptId)).size !==
      view.entries.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate maintenance attempt",
      });
    for (const entry of view.entries) {
      const start = Date.parse(entry.startedAt),
        expiry = Date.parse(entry.leaseExpiresAt),
        observed = Date.parse(view.observedAt);
      const closed =
        entry.outcome === "no_effect" ||
        entry.outcome === "configuration_recorded";
      if (
        expiry - start !== MAINTENANCE_ATTEMPT_LEASE_SECONDS * 1000 ||
        start > observed ||
        closed !== (entry.finishedAt !== null) ||
        (entry.finishedAt &&
          (Date.parse(entry.finishedAt) < start ||
            Date.parse(entry.finishedAt) > observed)) ||
        (entry.outcome === "awaiting_receipt" && observed >= expiry) ||
        (entry.outcome === "unconfirmed" && observed < expiry)
      )
        ctx.addIssue({
          code: "custom",
          message: "Inconsistent maintenance attempt observation",
        });
    }
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
    // Old responses remain distinct from an observed empty attempt history.
    attemptHistory: maintenanceAttemptHistorySchema.optional(),
  })
  .superRefine((view, ctx) => {
    if (
      view.attemptHistory &&
      Date.parse(view.attemptHistory.observedAt) !== Date.parse(view.observedAt)
    )
      ctx.addIssue({
        code: "custom",
        message: "Maintenance observations must share the native clock",
      });
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
