import {
  activationCommandSchema,
  activationViewSchema,
  type ActivationCommand,
} from "@paperclipai/shared";
import { api } from "./client";
const path = (companyId: string, principal: string) =>
  `/companies/${encodeURIComponent(companyId)}/activation?expectedUserId=${encodeURIComponent(principal)}`;
function currentCompany(raw: unknown, companyId: string) {
  const value = activationViewSchema.parse(raw);
  if (value.companyId !== companyId)
    throw new Error("Activation context changed");
  return value;
}
export const activationApi = {
  get: async (companyId: string, principal: string, signal?: AbortSignal) => {
    const raw = await api.get(path(companyId, principal), {
      signal,
      cache: "no-store",
    });
    signal?.throwIfAborted();
    return currentCompany(raw, companyId);
  },
  command: async (
    companyId: string,
    principal: string,
    input: ActivationCommand,
  ) =>
    currentCompany(
      await api.post(
        path(companyId, principal),
        activationCommandSchema.parse(input),
      ),
      companyId,
    ),
};
