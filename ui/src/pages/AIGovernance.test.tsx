// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AIGovernance } from "./AIGovernance";
import { i18n } from "@/i18n";
import { aiGovernanceApi } from "@/api/ai-governance";
import { instanceSettingsApi } from "@/api/instanceSettings";
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
    obligations: vi.fn(async () => []),
    create: vi.fn(),
    oversight: vi.fn(),
  },
}));
vi.mock("@/api/issues", () => ({ issuesApi: { list: vi.fn(async () => []) } }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(instanceSettingsApi.getExperimental).mockResolvedValue({
    ai_use_cases_v7: true,
    governance_evidence_v7: false,
  } as Awaited<ReturnType<typeof instanceSettingsApi.getExperimental>>);
  void i18n.changeLanguage("en");
});
it("requires explicit deployment facts and account-scoped reads before registering a draft", async () => {
  await act(async () => i18n.changeLanguage("en"));
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
    expect(container.textContent).toContain("Who defines the intended purpose?");
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

it("shows Danish page controls while preserving the people-domain API value", async () => {
  await act(async () => i18n.changeLanguage("da"));
  vi.mocked(instanceSettingsApi.getExperimental).mockResolvedValue({
    ai_use_cases_v7: true,
    governance_evidence_v7: true,
  } as Awaited<ReturnType<typeof instanceSettingsApi.getExperimental>>);
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
    expect(container.querySelector("h1")?.textContent).toBe("AI-styring");
    expect(container.textContent).toContain("Forudsigelig misbrug (én pr. linje)");
    expect(container.textContent).toContain("Registrér som kladde");
    expect(container.textContent).toContain("Gennemgåede forpligtelser");
    const peopleDomain = [...container.querySelectorAll("select")].find((select) =>
      [...select.options].some((option) => option.textContent === "Ansættelse"),
    );
    expect(peopleDomain).toBeDefined();
    expect(peopleDomain?.querySelector('option[value="employment"]')?.textContent).toBe("Ansættelse");
    await act(async () => {
      peopleDomain!.value = "employment";
      peopleDomain!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(peopleDomain?.value).toBe("employment");
    const framework = [...container.querySelectorAll("select")].find((select) =>
      select.querySelector('option[value="eu_ai_act"]'),
    );
    expect(framework?.querySelector('option[value="eu_ai_act"]')?.textContent).toBe("EU's AI-forordning");
    await act(async () => {
      framework!.value = "company_policy";
      framework!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const addPurpose = [...container.querySelectorAll("button")].find((button) =>
      button.textContent === "Tilføj analytisk formål",
    );
    expect(addPurpose).toBeDefined();
    await act(async () => addPurpose!.click());
    expect(container.textContent).toContain("Tilsigtet analytisk formål");
    const applicability = [...container.querySelectorAll("select")].find((select) =>
      select.querySelector('option[value="applicable"]'),
    );
    expect(applicability?.querySelector('option[value="applicable"]')?.textContent).toBe("Gældende");
    expect(container.textContent).not.toContain("Register draft");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
