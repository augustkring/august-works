import { activationConnectionConsentWithdrawalCommandSchema, activationConnectionConsentCommandSchema, activationConnectionConsentReceiptSchema, activationConnectionReviewSchema,
  type ActivationConnectionConsentCommand, type ConnectToolAppResult } from "@paperclipai/shared";
import { api } from "./client";
const root = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/activation`;
const account = (principal: string) => `?expectedUserId=${encodeURIComponent(principal)}`;
const checkedReceipt = (raw: unknown, companyId: string, requestKey: string) => {
  const value = activationConnectionConsentReceiptSchema.parse(raw);
  if (value.companyId !== companyId || value.requestKey !== requestKey) throw new Error("Connection consent context changed");
  return value;
};
export const activationConnectionApi = {
  async currentReceipt(companyId: string, principal: string, applicationKey: string, signal?: AbortSignal) {
    const raw = await api.get(`${root(companyId)}/connections/${encodeURIComponent(applicationKey)}/consent${account(principal)}`, { signal, cache: "no-store" });
    signal?.throwIfAborted();
    const value = activationConnectionConsentReceiptSchema.nullable().parse(raw);
    if (value && value.companyId !== companyId) throw new Error("Original connection consent context changed");
    return value;
  },
  async withdraw(companyId: string, principal: string, requestKey: string, expectedReviewHash: string) {
    return checkedReceipt(await api.post(`${root(companyId)}/connection-consents/${encodeURIComponent(requestKey)}/withdraw${account(principal)}`,
      activationConnectionConsentWithdrawalCommandSchema.parse({ confirmWithdrawal: true, expectedReviewHash })), companyId, requestKey);
  },
  async review(companyId: string, principal: string, applicationKey: string, signal?: AbortSignal) {
    const raw = await api.get(`${root(companyId)}/connections/${encodeURIComponent(applicationKey)}/review${account(principal)}`, { signal, cache: "no-store" });
    signal?.throwIfAborted();
    const value = activationConnectionReviewSchema.parse(raw);
    if (value.companyId !== companyId || value.applicationKey !== applicationKey) throw new Error("Connection permission review context changed");
    return value;
  },
  async approve(companyId: string, principal: string, applicationKey: string, command: ActivationConnectionConsentCommand) {
    return checkedReceipt(await api.post(`${root(companyId)}/connections/${encodeURIComponent(applicationKey)}/consent${account(principal)}`,
      activationConnectionConsentCommandSchema.parse(command)), companyId, command.requestKey);
  },
  async receipt(companyId: string, principal: string, requestKey: string, signal?: AbortSignal) {
    const raw = await api.get(`${root(companyId)}/connection-consents/${encodeURIComponent(requestKey)}${account(principal)}`, { signal, cache: "no-store" });
    signal?.throwIfAborted(); return checkedReceipt(raw, companyId, requestKey);
  },
  async connect(companyId: string, principal: string, requestKey: string) {
    const result = await api.post<ConnectToolAppResult>(`${root(companyId)}/connection-consents/${encodeURIComponent(requestKey)}/connect${account(principal)}`, { confirmProviderSetup: true });
    if (result.connection.companyId !== companyId || result.application.companyId !== companyId ||
      result.connection.id !== result.connectionId || result.connection.applicationId !== result.application.id ||
      result.connection.credentialPolicy !== "per_user") throw new Error("Original connection allocation context changed");
    return result;
  },
};
