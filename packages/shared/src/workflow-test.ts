import { z } from "zod";

const readable = (value: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value) &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export const workflowSyntheticInputSchema = z.array(z.strictObject({
  path: z.array(z.string().min(1).max(160).refine(value => value.trim() === value && !/[\r\n]/u.test(value) && readable(value))).min(1).max(8),
  value: z.union([z.string().max(1000).refine(readable), z.number().finite(), z.boolean(), z.null()]),
})).max(20).superRefine((entries, context) => {
  if (new TextEncoder().encode(JSON.stringify(entries)).length > 8192) context.addIssue({ code: "custom", message: "Test input is too large" });
  for (let index = 0; index < entries.length; index++) for (let before = 0; before < index; before++) {
    const left = entries[before].path, right = entries[index].path;
    if (left.slice(0, Math.min(left.length, right.length)).every((key, level) => key === right[level]))
      context.addIssue({ code: "custom", path: [index, "path"], message: "Test field paths must not duplicate or overlap" });
  }
});
export type WorkflowSyntheticInput = z.infer<typeof workflowSyntheticInputSchema>;
/** Data construction only. No path is code, an actor, a grant or a second
 * runtime. Even prototype-looking keys remain ordinary own JSON properties. */
export function workflowSyntheticTriggerPayload(raw: WorkflowSyntheticInput = []): Record<string, unknown> {
  const entries = workflowSyntheticInputSchema.parse(raw), root: Record<string, unknown> = {};
  for (const entry of entries) {
    let cursor = root;
    for (let index = 0; index < entry.path.length; index++) {
      const key = entry.path[index], last = index === entry.path.length - 1;
      if (last) Object.defineProperty(cursor, key, { value: entry.value, enumerable: true, writable: true, configurable: true });
      else {
        if (!Object.prototype.hasOwnProperty.call(cursor, key)) Object.defineProperty(cursor, key, { value: {}, enumerable: true, writable: true, configurable: true });
        cursor = cursor[key] as Record<string, unknown>;
      }
    }
  }
  return root;
}

/** This closed command admits native internal C0 testing, never publication. */
export const workflowTestCommandSchema = z.strictObject({
  requestId: z.uuid(),
  expectedWorkflowId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  expectedDraftRevisionId: z.uuid(),
  expectedRunStatus: z.literal("succeeded"),
  acknowledgeInternalTest: z.literal(true),
  // Optional preserves retained old command hashes and exact replay semantics.
  syntheticInput: workflowSyntheticInputSchema.optional(),
});
export const workflowTestReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  workflowId: z.uuid(),
  requestId: z.uuid(),
  runId: z.uuid(),
  revisionId: z.uuid(),
  purpose: z.literal("test"),
  disposition: z.literal("admitted"),
});
export type WorkflowTestCommand = z.infer<typeof workflowTestCommandSchema>;
export type WorkflowTestReceipt = z.infer<typeof workflowTestReceiptSchema>;
