import {
  trustAcceptanceNoticeListSchema,
  trustDocumentAcceptanceReceiptSchema,
  trustDocumentActionReceiptSchema,
  trustDocumentContentSchema,
  type TrustAcceptanceNoticeProjection,
  type TrustDocumentAcceptanceReceipt,
} from "@paperclipai/shared";
import { api } from "./client";
type TrustDocumentContent = ReturnType<typeof trustDocumentContentSchema.parse>;

export const productNoticesApi = {
  async actionRequired(companyId: string, expectedUserId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ expectedUserId });
    const result = await api.get<unknown>(`/companies/${encodeURIComponent(companyId)}/notices/action-required?${query}`, { signal, cache: "no-store" });
    return trustAcceptanceNoticeListSchema.parse(result);
  },
  async content(notice: TrustAcceptanceNoticeProjection, expectedUserId: string, signal?: AbortSignal): Promise<TrustDocumentContent> {
    const query = new URLSearchParams({ expectedUserId });
    const result = await api.get<unknown>(`${notice.contentPath}?${query}`, { signal, cache: "no-store" });
    const parsed = trustDocumentContentSchema.parse(result);
    const expectedMode = notice.completion.owner === "trust_document_notice_read" ? "notice"
      : notice.completion.owner === "trust_document_acceptance" ? "reacceptance" : "customer_admin_acknowledgment";
    if (parsed.document.id !== notice.completion.registryEntryId || parsed.document.version !== notice.completion.version ||
      parsed.document.documentRevisionId !== notice.completion.documentRevisionId || parsed.document.materialChangeAction !== expectedMode) {
      throw new Error("The current trust document version changed. Refresh to review it again.");
    }
    return parsed;
  },
  async complete(notice: TrustAcceptanceNoticeProjection, expectedUserId: string): Promise<TrustDocumentAcceptanceReceipt | ReturnType<typeof trustDocumentActionReceiptSchema.parse>> {
    if (!notice.canComplete) throw new Error("This notice can only be completed by a company owner or admin.");
    const result = await api.post<unknown>(notice.completionPath, {
      expectedUserId,
      requestId: crypto.randomUUID(),
      registryEntryId: notice.completion.registryEntryId,
      version: notice.completion.version,
      surface: "mandatory_product_notice",
    });
    const expected = notice.completion;
    if (notice.completion.owner === "trust_document_acceptance") {
      const receipt = trustDocumentAcceptanceReceiptSchema.parse(result);
      if (receipt.companyId !== notice.affectedCompanyId || receipt.principal !== expectedUserId ||
        receipt.registryEntryId !== expected.registryEntryId || receipt.documentRevisionId !== expected.documentRevisionId ||
        receipt.documentVersion !== expected.version) throw new Error("The trust acceptance receipt does not match this notice.");
      return receipt;
    }
    const receipt = trustDocumentActionReceiptSchema.parse(result);
    const expectedAction = notice.completion.owner === "trust_document_notice_read" ? "notice_read" : "customer_admin_acknowledgment";
    if (receipt.companyId !== notice.affectedCompanyId || receipt.principal !== expectedUserId || receipt.action !== expectedAction ||
      receipt.registryEntryId !== expected.registryEntryId || receipt.documentRevisionId !== expected.documentRevisionId ||
      receipt.documentVersion !== expected.version) throw new Error("The trust action receipt does not match this notice.");
    return receipt;
  },
};
