import { z } from "zod";

export const memoryMaintenanceHistoryQuerySchema = z.strictObject({
  expectedUserId: z.string().min(1).max(300), jobId: z.uuid().optional(),
});

/** Only historical native index checks are M1. A successful job alone is not
 * a verified postcondition, and this projection never authorizes another job. */
export const memoryMaintenanceHistorySchema = z.strictObject({
  companyId: z.uuid(),
  observedAt: z.iso.datetime(),
  hasMore: z.boolean(),
  entries: z.array(z.strictObject({
    jobId: z.uuid(),
    maintenanceClass: z.literal("M1"),
    attemptNumber: z.number().int().positive(),
    submittedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    leaseExpiresAt: z.iso.datetime().nullable(),
    outcome: z.enum(["queued", "running", "unconfirmed", "review_required",
      "verified_index_check", "verification_unavailable", "source_unavailable"]),
    receiptId: z.uuid().nullable(),
    indexedRecordCount: z.number().int().min(1).max(64).nullable(),
  })).max(10),
}).superRefine((view, ctx) => {
  const observed = Date.parse(view.observedAt);
  if (new Set(view.entries.map((entry) => entry.jobId)).size !== view.entries.length)
    ctx.addIssue({ code: "custom", message: "Duplicate native Memory job" });
  for (const entry of view.entries) {
    const submitted = Date.parse(entry.submittedAt);
    const started = entry.startedAt === null ? null : Date.parse(entry.startedAt);
    const finished = entry.finishedAt === null ? null : Date.parse(entry.finishedAt);
    const lease = entry.leaseExpiresAt === null ? null : Date.parse(entry.leaseExpiresAt);
    const verified = entry.outcome === "verified_index_check";
    if (submitted > observed || (started !== null && (started < submitted || started > observed)) ||
      (finished !== null && (finished < (started ?? submitted) || finished > observed)) ||
      verified !== (entry.receiptId !== null && entry.indexedRecordCount !== null) ||
      (!verified && (entry.receiptId !== null || entry.indexedRecordCount !== null)) ||
      (verified && (started === null || finished === null || lease !== null)) ||
      (entry.outcome === "queued" && (started !== null || finished !== null || lease !== null)) ||
      (["running", "unconfirmed"].includes(entry.outcome) &&
        (started === null || finished !== null || lease === null || lease <= started)) ||
      (entry.outcome === "running" && lease !== null && lease <= observed) ||
      (entry.outcome === "unconfirmed" && lease !== null && lease > observed) ||
      (["review_required", "verification_unavailable"].includes(entry.outcome) && (finished === null || lease !== null)))
      ctx.addIssue({ code: "custom", message: "Inconsistent native Memory observation" });
  }
});
export type MemoryMaintenanceHistory = z.infer<typeof memoryMaintenanceHistorySchema>;
