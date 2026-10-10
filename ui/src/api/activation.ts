import {
  activationCommandSchema,
  activationViewSchema,
  type ActivationCommand,
} from "@paperclipai/shared";
import { api } from "./client";
const path = (companyId: string, principal: string) =>
  `/companies/${encodeURIComponent(companyId)}/activation?expectedUserId=${encodeURIComponent(principal)}`;
export const activationApi = {
  get: async (companyId: string, principal: string, signal?: AbortSignal) =>
    activationViewSchema.parse(
      await api.get(path(companyId, principal), { signal, cache: "no-store" }),
    ),
  command: async (
    companyId: string,
    principal: string,
    input: ActivationCommand,
  ) =>
    activationViewSchema.parse(
      await api.post(
        path(companyId, principal),
        activationCommandSchema.parse(input),
      ),
    ),
};
