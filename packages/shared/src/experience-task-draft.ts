import { z } from "zod";

/** Current Native issue fields only. A missing receipt is never permission to
 * submit another create request. No model text, execution or grant is accepted. */
export const experienceTaskReceiptSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  title: z.string().min(1).max(2000),
});
export type ExperienceTaskReceipt = z.infer<typeof experienceTaskReceiptSchema>;


/** Per-tab recovery locator only; Native authorization and original receipts
 * remain authoritative. No customer intent or create body is persisted. */
export const experiencePendingTaskReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  companyId: z.uuid(),
  principal: z.string().min(1).max(512),
  idempotencyKey: z.uuid(),
});
export const experiencePendingTaskReceiptInventorySchema = z.array(experiencePendingTaskReceiptSchema).max(16);
