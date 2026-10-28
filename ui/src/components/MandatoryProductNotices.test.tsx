// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrustAcceptanceNoticeProjection } from "@paperclipai/shared";
import { MandatoryProductNotices } from "./MandatoryProductNotices";

const api = vi.hoisted(() => ({ actionRequired: vi.fn(), content: vi.fn(), complete: vi.fn() }));
vi.mock("@/api/product-notices", () => ({ productNoticesApi: api }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div data-testid="document-body">{children}</div> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, value?: { version?: string }) => value?.version ? `${key} ${value.version}` : key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "00000000-0000-4000-8000-000000000001";
const notice: TrustAcceptanceNoticeProjection = {
  id: "00000000-0000-4000-8000-000000000002", category: "policy_legal", title: "Current policy",
  summary: "Review and accept the current version (4).", affectedCompanyId: companyId,
  effectiveAt: "2026-10-28T00:00:00Z", customerImpact: "Your company requires acceptance of Current policy.",
  actionRequired: true, actionDeadline: null, mandatoryVisibility: true,
  completion: { owner: "trust_document_acceptance", registryEntryId: "00000000-0000-4000-8000-000000000002",
    documentRevisionId: "00000000-0000-4000-8000-000000000004", version: "4" },
  contentPath: `/companies/${companyId}/trust/documents/00000000-0000-4000-8000-000000000002/content`,
  canComplete: true,
  completionPath: `/companies/${companyId}/trust/acceptances`,
};
const body = { document: { id: notice.id, documentId: "00000000-0000-4000-8000-000000000003",
  documentRevisionId: "00000000-0000-4000-8000-000000000004", title: notice.title, version: "4", owner: "owner",
  effectiveAt: notice.effectiveAt, evidenceRefs: [], customerVisibility: "public" as const, ndaRequired: false,
  lastReviewedAt: notice.effectiveAt, nextReviewOrTrigger: null, expiresAt: null, supersededBy: null,
  materialChangeAction: "reacceptance", acceptanceRequired: true },
  format: "markdown", body: "Exact current policy text." };

describe("mandatory product notices", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const render = async () => act(async () => root.render(<QueryClientProvider client={client}><MandatoryProductNotices companyId={companyId} userId="alice" /></QueryClientProvider>));
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.actionRequired.mockReset().mockResolvedValueOnce({ configured: true, notices: [notice] }).mockResolvedValue({ configured: true, notices: [] });
    api.content.mockReset().mockResolvedValue(body);
    api.complete.mockReset().mockResolvedValue({ requestId: crypto.randomUUID(), companyId, principal: "alice",
      registryEntryId: notice.id, documentRevisionId: body.document.documentRevisionId, documentVersion: "4",
      acceptedAt: "2026-10-28T00:00:00Z", surface: "mandatory_product_notice" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });

  it("shows the exact canonical text, requires an explicit accept action, then re-reads owner state", async () => {
    await render();
    await act(async () => { await vi.waitFor(() => expect(api.content).toHaveBeenCalledOnce()); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(notice.title);
    expect(container.querySelector('[data-testid="document-body"]')?.textContent).toBe(body.body);
    const button = container.querySelector("button")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(api.complete).toHaveBeenCalledWith(notice, "alice");
    await act(async () => { await vi.waitFor(() => expect(container.querySelector('[data-testid="document-body"]')).toBeNull()); });
    expect(api.actionRequired.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps acceptance disabled when the reviewed content is not the exact current owner version", async () => {
    api.content.mockResolvedValue({ ...body, document: { ...body.document, version: "3" } });
    await render();
    await act(async () => { await vi.waitFor(() => expect(api.content).toHaveBeenCalledOnce()); });
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(api.complete).not.toHaveBeenCalled();
  });

  it("requires an explicit action for a notice-mode receipt and does not complete an admin-only action for a member", async () => {
    const readNotice: TrustAcceptanceNoticeProjection = { ...notice,
      summary: "Review the current version (4) and mark the notice as read.",
      completion: { ...notice.completion, owner: "trust_document_notice_read" },
      completionPath: `/companies/${companyId}/trust/notices/read` };
    api.actionRequired.mockReset().mockResolvedValue({ configured: true, notices: [readNotice] });
    api.content.mockReset().mockResolvedValue({ ...body, document: { ...body.document, materialChangeAction: "notice", acceptanceRequired: false } });
    await render();
    await act(async () => { await vi.waitFor(() => expect(api.content).toHaveBeenCalledOnce()); });
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("announcement.mandatory.markRead");
    expect(api.complete).not.toHaveBeenCalled();
    await act(async () => button.click());
    expect(api.complete).toHaveBeenCalledWith(readNotice, "alice");

    const adminNotice: TrustAcceptanceNoticeProjection = { ...notice, canComplete: false,
      completion: { ...notice.completion, owner: "trust_document_admin_acknowledgment" },
      completionPath: `/companies/${companyId}/trust/admin-acknowledgments` };
    api.actionRequired.mockReset().mockResolvedValue({ configured: true, notices: [adminNotice] });
    api.complete.mockClear();
    await act(async () => client.clear());
    await render();
    await act(async () => { await vi.waitFor(() => expect(api.content).toHaveBeenCalledTimes(2)); });
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(api.complete).not.toHaveBeenCalled();
  });
});
