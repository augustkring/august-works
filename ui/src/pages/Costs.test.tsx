// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Costs } from "./Costs";
import { useCostFormatting } from "../hooks/useCostFormatting";
import { i18n } from "../i18n";

const budgetOverviewMock = vi.hoisted(() => vi.fn());
const setBreadcrumbsMock = vi.hoisted(() => vi.fn());
const costsApiMocks = vi.hoisted(() => ({
  summary: vi.fn(),
  byAgent: vi.fn(),
  byProject: vi.fn(),
  byAgentModel: vi.fn(),
  financeSummary: vi.fn(),
  financeByBiller: vi.fn(),
  financeByKind: vi.fn(),
  financeEvents: vi.fn(),
  byProvider: vi.fn(),
  byBiller: vi.fn(),
  windowSpend: vi.fn(),
  quotaWindows: vi.fn(),
}));

function CostFormattingProbe() {
  const formatCost = useCostFormatting();
  return <div>
    <span data-testid="reported-zero">{formatCost(0, 0)}</span>
    <span data-testid="unpriced-zero">{formatCost(0, 1)}</span>
    <span data-testid="mixed">{formatCost(125, 2)}</span>
  </div>;
}

vi.mock("../api/budgets", () => ({
  budgetsApi: {
    overview: (...args: unknown[]) => budgetOverviewMock(...args),
    upsertPolicy: vi.fn(),
    resolveIncident: vi.fn(),
  },
}));

vi.mock("../api/costs", () => ({ costsApi: costsApiMocks }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: setBreadcrumbsMock }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Costs embedded Audit surfaces", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    budgetOverviewMock.mockResolvedValue({
      policies: [],
      activeIncidents: [],
      pendingApprovalCount: 0,
      pausedAgentCount: 0,
      pausedProjectCount: 0,
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("renders a focused Budgets section without duplicate Costs chrome or spend queries", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Costs embedded initialTab="budgets" lockTab />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(budgetOverviewMock).toHaveBeenCalledWith("company-1");
        expect(container.textContent).toContain("Budget control plane");
      });
    });
    expect(container.textContent).not.toContain("Inference spend");
    expect(container.querySelector('[role="tab"]')).toBeFalsy();
    expect(setBreadcrumbsMock).not.toHaveBeenCalled();
    for (const mock of Object.values(costsApiMocks)) expect(mock).not.toHaveBeenCalled();
  });

  it("localizes the difference between recorded zero, unknown price, and partial recorded spend", async () => {
    root = createRoot(container);
    await act(async () => {
      await i18n.changeLanguage("en");
      root.render(<CostFormattingProbe />);
    });
    expect(container.querySelector('[data-testid="reported-zero"]')?.textContent).toBe("$0.00");
    expect(container.querySelector('[data-testid="unpriced-zero"]')?.textContent).toBe("Price unknown for 1 usage event");
    expect(container.querySelector('[data-testid="mixed"]')?.textContent).toBe("$1.25 + 2 unpriced usage events");

    await act(async () => {
      await i18n.changeLanguage("da");
    });
    expect(container.querySelector('[data-testid="reported-zero"]')?.textContent).toBe("$0.00");
    expect(container.querySelector('[data-testid="unpriced-zero"]')?.textContent).toBe("Pris ukendt for 1 forbrugshændelse");
    expect(container.querySelector('[data-testid="mixed"]')?.textContent).toBe("$1.25 + 2 forbrugshændelser uden pris");
    await act(async () => { await i18n.changeLanguage("en"); });
  });
});
