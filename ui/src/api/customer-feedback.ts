import {
  customerFeedbackSchema,
  customerFeedbackListSchema,
  type CreateCustomerFeedback,
} from "@paperclipai/shared";
import { api, ApiError } from "./client";
/** Only canonical validation/version refusals establish that this request did not apply. */
export function isRejectedFeedbackRequest(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if ([400, 413, 422].includes(error.status)) return true;
  const message = (error.body as { error?: unknown } | null)?.error;
  return (
    error.status === 409 &&
    (message === "Feedback changed; refresh before responding" ||
      message === "Feedback changed; refresh before triage" ||
      message === "Feedback is not awaiting a response")
  );
}
const scope = (companyId: string, principal: string) =>
  `/companies/${customerFeedbackSchema.shape.companyId.parse(companyId).toLowerCase()}/customer-feedback?expectedUserId=${encodeURIComponent(principal)}`;
const report = (companyId: string, id: string) =>
  `/companies/${customerFeedbackSchema.shape.companyId.parse(companyId).toLowerCase()}/customer-feedback/${customerFeedbackSchema.shape.id.parse(id).toLowerCase()}`;
function receipt(raw: unknown, companyId: string, id?: string) {
  const result = customerFeedbackSchema.parse(raw);
  if (
    result.companyId.toLowerCase() !== companyId.toLowerCase() ||
    (id && result.id.toLowerCase() !== id.toLowerCase())
  )
    throw new Error("Feedback context changed");
  return result;
}
export const customerFeedbackApi = {
  create: async (
    companyId: string,
    principal: string,
    input: CreateCustomerFeedback,
  ) => receipt(await api.post(scope(companyId, principal), input), companyId),
  list: async (
    companyId: string,
    principal: string,
    signal?: AbortSignal,
    before?: string,
  ) => {
    const results = customerFeedbackListSchema.parse(
      await api.get(
        scope(companyId, principal) +
          (before ? `&before=${encodeURIComponent(before)}` : ""),
        { signal, cache: "no-store" },
      ),
    );
    if (
      results.some(
        (item) => item.companyId.toLowerCase() !== companyId.toLowerCase(),
      )
    )
      throw new Error("Feedback context changed");
    return results;
  },
  get: async (
    companyId: string,
    principal: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    receipt(
      await api.get(
        `${report(companyId, id)}?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
      companyId,
      id,
    ),
  followUp: async (
    companyId: string,
    principal: string,
    id: string,
    input: { body: string; expectedVersion: number; idempotencyKey: string },
  ) =>
    receipt(
      await api.post(
        `${report(companyId, id)}/follow-up?expectedUserId=${encodeURIComponent(principal)}`,
        input,
      ),
      companyId,
      id,
    ),
};
