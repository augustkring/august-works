// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AIGovernance } from "./AIGovernance";
import { aiGovernanceApi } from "@/api/ai-governance";
const fixture = vi.hoisted(() => ({
  company: "11111111-1111-4111-8111-111111111111",
  user: "account-one",
  breadcrumbs: vi.fn(),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: fixture.company }),
}));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: fixture.user,
    settled: true,
    failed: false,
  }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }),
}));
vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: {
    getExperimental: vi.fn(async () => ({
      ai_use_cases_v7: true,
      governance_evidence_v7: false,
    })),
  },
}));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/api/ai-governance", () => ({
  aiGovernanceApi: {
    list: vi.fn(async () => []),
    profiles: vi.fn(async () => []),
    targets: vi.fn(async () => []),
    create: vi.fn(),
    oversight: vi.fn(),
  },
}));
vi.mock("@/api/issues", () => ({ issuesApi: { list: vi.fn(async () => []) } }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());
it("requires explicit deployment facts and account-scoped reads before registering a draft", async () => {
  const container = document.createElement("div"),
    root = createRoot(container),
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AIGovernance />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const primary = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Register draft",
    );
    expect(primary?.disabled).toBe(true);
    expect(container.textContent).toContain("Who defines intended purpose?");
    expect(container.textContent).toContain(
      "deployment still needs current permissions",
    );
    expect(aiGovernanceApi.list).toHaveBeenCalledWith(
      fixture.company,
      fixture.user,
    );
    expect(aiGovernanceApi.create).not.toHaveBeenCalled();
    expect(aiGovernanceApi.oversight).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Export current evidence pack");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
