import {
  customerFeedbackSchema,
  customerFeedbackListSchema,
  type CreateCustomerFeedback,
} from "@paperclipai/shared";
import { api } from "./client";
const scope = (companyId: string, principal: string) =>
  `/companies/${companyId}/customer-feedback?expectedUserId=${encodeURIComponent(principal)}`;
export const customerFeedbackApi = {
  create: async (
    companyId: string,
    principal: string,
    input: CreateCustomerFeedback,
  ) =>
    customerFeedbackSchema.parse(
      await api.post(scope(companyId, principal), input),
    ),
  list: async (
    companyId: string,
    principal: string,
    signal?: AbortSignal,
    before?: string,
  ) =>
    customerFeedbackListSchema.parse(
      await api.get(
        scope(companyId, principal) +
          (before ? `&before=${encodeURIComponent(before)}` : ""),
        { signal, cache: "no-store" },
      ),
    ),
  get: async (
    companyId: string,
    principal: string,
    id: string,
    signal?: AbortSignal,
  ) =>
    customerFeedbackSchema.parse(
      await api.get(
        `/companies/${companyId}/customer-feedback/${id}?expectedUserId=${encodeURIComponent(principal)}`,
        { signal, cache: "no-store" },
      ),
    ),
  followUp: async (
    companyId: string,
    principal: string,
    id: string,
    input: { body: string; expectedVersion: number; idempotencyKey: string },
  ) =>
    customerFeedbackSchema.parse(
      await api.post(
        `/companies/${companyId}/customer-feedback/${id}/follow-up?expectedUserId=${encodeURIComponent(principal)}`,
        input,
      ),
    ),
};
