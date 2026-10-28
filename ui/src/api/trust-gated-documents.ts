import {
  trustDocumentGatedContentSchema,
  trustDocumentGatedGrantReceiptSchema,
  trustDocumentGatedRegistrySchema,
  trustDocumentGatedRevokeReceiptSchema,
} from "@paperclipai/shared";
import { api } from "./client";

export const trustGatedDocumentsApi = {
  async list(companyId: string, expectedUserId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ expectedUserId });
    const result = await api.get<unknown>(`/companies/${encodeURIComponent(companyId)}/trust/gated/documents?${query}`, {
      signal, cache: "no-store",
    });
    return trustDocumentGatedRegistrySchema.parse(result);
  },
  async content(companyId: string, registryEntryId: string, expectedUserId: string,
    grantReceiptId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ expectedUserId, grantReceiptId });
    const result = await api.get<unknown>(`/companies/${encodeURIComponent(companyId)}/trust/gated/documents/${encodeURIComponent(registryEntryId)}/content?${query}`, {
      signal, cache: "no-store",
    });
    const parsed = trustDocumentGatedContentSchema.parse(result);
    if (parsed.document.id !== registryEntryId || parsed.grantReceiptId !== grantReceiptId)
      throw new Error("The current gated evidence grant changed. Refresh before using this document.");
    return parsed;
  },
  async grant(companyId: string, input: {
    expectedUserId: string; requestId: string; registryEntryId: string; version: string;
    granteeUserId: string; expiresAt: string; surface: string;
  }) {
    const result = await api.post<unknown>(`/companies/${encodeURIComponent(companyId)}/trust/gated/grants`, input);
    const receipt = trustDocumentGatedGrantReceiptSchema.parse(result);
    if (receipt.companyId !== companyId || receipt.registryEntryId !== input.registryEntryId ||
      receipt.documentVersion !== input.version || receipt.granteeUserId !== input.granteeUserId ||
      receipt.grantedByUserId !== input.expectedUserId || receipt.requestId !== input.requestId ||
      Date.parse(receipt.expiresAt) !== Date.parse(input.expiresAt))
      throw new Error("The gated access receipt does not match this request.");
    return receipt;
  },
  async revoke(companyId: string, grantReceiptId: string, input: {
    expectedUserId: string; requestId: string; surface: string;
  }) {
    const result = await api.post<unknown>(`/companies/${encodeURIComponent(companyId)}/trust/gated/grants/${encodeURIComponent(grantReceiptId)}/revoke`, input);
    const receipt = trustDocumentGatedRevokeReceiptSchema.parse(result);
    if (receipt.companyId !== companyId || receipt.grantReceiptId !== grantReceiptId ||
      receipt.revokedByUserId !== input.expectedUserId || receipt.requestId !== input.requestId)
      throw new Error("The gated revocation receipt does not match this request.");
    return receipt;
  },
};
