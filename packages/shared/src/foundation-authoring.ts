import { z } from "zod";

const text = (max: number) => z.string().max(max).regex(/^[^\u0000\uD800-\uDFFF]*$/u);
/** A proposed replacement against the exact existing Native revision.
 * Approval and publication remain separate Foundation decisions. */
export const foundationAuthoringProposeInputSchema = z.strictObject({
  idempotencyKey: text(120).trim().min(1),
  foundationDocumentId: z.uuid(),
  baseRevisionId: z.uuid(),
  proposedBody: text(16000).min(1),
  changeSummary: text(1000).trim().min(1),
  reason: text(2000).trim().min(1),
});
export const foundationAuthoringProposeInputJsonSchema = z.toJSONSchema(foundationAuthoringProposeInputSchema);
export type FoundationAuthoringProposeInput = z.infer<typeof foundationAuthoringProposeInputSchema>;
