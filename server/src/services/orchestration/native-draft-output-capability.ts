import { orchestrationCompletionSchema } from "@paperclipai/shared";
import { forbidden } from "../../errors.js";

/** Provider identity returned only by current worker-model transport qualification. */
export type QualifiedNativeDraftProvider = "aw_text_only" | "opencode";

/** Minimum tool-action headroom for a cost-capped native worker. Preserve the
 * existing two-action minimum for one declared document and account for every
 * additional declared write. Caller must pass providerKind from the installed
 * gateway qualification, never from a plan, request or execution DTO. */
export function minimumNativeDraftToolActions(
  provider: QualifiedNativeDraftProvider,
  outputs: readonly { kind: string; key: string }[],
): number {
  const parsed = orchestrationCompletionSchema.shape.requiredOutputs.parse(outputs);
  if (new Set(parsed.map((output) => output.key)).size !== parsed.length)
    throw forbidden("Native draft completion output keys must be distinct");
  if (parsed.some((output) => output.kind !== "task_document"))
    throw forbidden("The bounded native draft requires declared Task document outputs");
  if (provider !== "aw_text_only" && provider !== "opencode")
    throw forbidden("The native draft provider is not a qualified worker transport");
  if (provider === "aw_text_only" && parsed.length !== 1)
    throw forbidden("The one-call draft requires one declared canonical output");
  return parsed.length + 1;
}

/** Shared start/admission comparison so both gates reserve the same minimum. */
export function nativeDraftToolActionBudgetFits(
  used: number,
  maximum: number,
  minimum: number,
): boolean {
  return Number.isSafeInteger(used) && Number.isSafeInteger(maximum) &&
    Number.isSafeInteger(minimum) && used >= 0 && maximum >= 0 && minimum >= 0 &&
    used + minimum <= maximum;
}
