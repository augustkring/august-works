// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { SaasBillingPage } from "./SaasBilling";
const fixture = vi.hoisted(() => ({
  billing: vi.fn(),
  checkout: vi.fn(),
  portal: vi.fn(),
}));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({ userId: "owner" }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company" }),
}));
vi.mock("@/hooks/useSaasCapabilities", () => ({
  useSaasCapabilities: () => ({
    data: { billing: true, usage: false, checkout: false },
    isPending: false,
  }),
}));
vi.mock("@/api/saas", () => ({
  saasApi: {
    billing: fixture.billing,
    checkout: fixture.checkout,
    portal: fixture.portal,
  },
}));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it("presents no-card Free access when no paid subscriptions or checkout prices exist", async () => {
  fixture.billing.mockResolvedValue({
    access: "active",
    commercialState: "FREE",
    freeCore: { active: true },
    entitlements: { "execution.concurrent.max": "2" },
    subscriptions: [],
    products: [],
    prices: [],
  });
  const container = document.createElement("div"),
    root = createRoot(container),
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <SaasBillingPage />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(fixture.billing).toHaveBeenCalledWith("company", "owner");
    expect(container.textContent).toContain("without a payment card");
    expect(container.textContent).toContain("Free Core is active");
    expect(container.textContent).toContain("Concurrent runs: 2");
    expect(container.textContent).toContain("bill BYOK/BYO usage separately");
    expect(container.textContent).not.toContain("Contact support");
    expect(container.querySelector('a[href="/company/export"]')).toBeTruthy();
    expect(fixture.checkout).not.toHaveBeenCalled();
    expect(fixture.portal).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
