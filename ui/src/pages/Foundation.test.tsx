// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationDocument } from "@paperclipai/shared";
import { Foundation } from "./Foundation";

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  search: vi.fn(),
  revisions: vi.fn(),
  listProposals: vi.fn(),
}));
const breadcrumbMock = vi.hoisted(() => ({ setBreadcrumbs: vi.fn() }));
const toastMock = vi.hoisted(() => ({ pushToast: vi.fn() }));

vi.mock("@/api/foundation", () => ({
  foundationApi: {
    ...apiMock,
    create: vi.fn(),
    updateDraft: vi.fn(),
    submitForReview: vi.fn(),
    approve: vi.fn(),
    rejectReview: vi.fn(),
    archive: vi.fn(),
    createProposal: vi.fn(),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
  },
}));

vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/api/access", () => ({
  accessApi: { listUserDirectory: vi.fn().mockResolvedValue({ users: [] }) },
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => breadcrumbMock,
}));
vi.mock("@/context/ToastContext", () => ({
  useToastActions: () => toastMock,
}));
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));
vi.mock("@/components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div data-testid="markdown-body">{children}</div>,
}));

const document: FoundationDocument = {
  id: "foundation-1",
  companyId: "company-1",
  documentId: "document-1",
  approvedRevisionId: "revision-1",
  foundationKey: "company-profile",
  category: "company",
  documentType: "company_profile",
  authorityLevel: "canonical",
  status: "draft",
  sensitivity: "internal",
  ownerUserId: null,
  ownerAgentId: null,
  reviewFrequencyDays: 30,
  lastReviewedAt: null,
  nextReviewAt: null,
  validFrom: null,
  validUntil: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-28T00:00:00Z"),
  title: "Company profile",
  body: "Working truth",
  latestRevisionId: "revision-2",
  latestRevisionNumber: 2,
  canonicalRevision: {
    id: "revision-1",
    revisionNumber: 1,
    title: "Company profile",
    body: "Approved truth",
    changeSummary: "Approved",
    createdAt: new Date("2026-09-10T00:00:00Z"),
  },
  canonicalGovernance: {
    category: "company",
    documentType: "company_profile",
    authorityLevel: "canonical",
    sensitivity: "internal",
    ownerUserId: null,
    ownerAgentId: null,
    reviewFrequencyDays: 30,
    validFrom: null,
    validUntil: null,
  },
};

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("Foundation page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    apiMock.list.mockResolvedValue([document]);
    apiMock.get.mockResolvedValue(document);
    apiMock.search.mockResolvedValue([]);
    apiMock.revisions.mockResolvedValue([]);
    apiMock.listProposals.mockResolvedValue([]);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("makes working and approved truth visibly distinct", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/foundation/foundation-1"]}>
            <Routes>
              <Route path="/foundation/:foundationDocumentId" element={<Foundation />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain("Foundation");
    expect(container.textContent).toContain("Company profile");
    expect(container.textContent).toContain("Approved truth");
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("Draft");
    expect(container.querySelector('nav[aria-label="Foundation categories"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="foundation-document-workspace"]')).not.toBeNull();

    flushSync(() => root.unmount());
  });
});
