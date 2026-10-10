import { z } from "zod";

/** Current Native issue fields only. A missing receipt is never permission to
 * submit another create request. No model text, execution or grant is accepted. */
export const experienceTaskReceiptSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  title: z.string().min(1).max(2000),
});
export type ExperienceTaskReceipt = z.infer<typeof experienceTaskReceiptSchema>;
