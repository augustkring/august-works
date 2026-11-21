import { z } from "zod";

/** The original transfer ledger owns work and private artifact availability. */
export const companyExportRequestIdSchema = z.string().uuid();
export const companyExportTransferReceiptSchema = z.strictObject({
  transferId: z.string().uuid(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  acceptedExpiresAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().optional(),
  artifact: z.discriminatedUnion("availability", [
    z.strictObject({ availability: z.literal("ready"), byteSize: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime() }),
    z.strictObject({ availability: z.literal("expired"), expiresAt: z.string().datetime().nullable() }),
    z.strictObject({ availability: z.literal("unavailable") }),
    z.strictObject({ availability: z.literal("not_ready") }),
  ]),
  error: z.strictObject({ code: z.string().regex(/^[a-z0-9_]{1,80}$/) }).optional(),
});
export const companyExportTransferAcceptedSchema = companyExportTransferReceiptSchema.extend({ alreadyCompleted: z.boolean() });
export type CompanyExportTransferReceipt = z.infer<typeof companyExportTransferReceiptSchema>;
export type CompanyExportTransferAccepted = z.infer<typeof companyExportTransferAcceptedSchema>;
