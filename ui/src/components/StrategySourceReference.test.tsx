// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { StrategySourceReference } from "./StrategySourceReference";
const companyId = "00000000-0000-4000-8000-000000000001", decisionId = "00000000-0000-4000-8000-000000000002";
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "AW" } }) }));
vi.mock("@/api/decisions", () => ({ decisionsApi: { get: vi.fn(async () => ({ companyId: "00000000-0000-4000-8000-000000000001", title: "Actual native decision Source" })) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function NativeDecisionRoute() { const [params] = useSearchParams(); return <p>Native decision {params.get("decisionId")}</p>; }
it("opens a retained decision citation through the existing company-prefixed native decision deep link", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/AW/strategy-execution"]}><Routes><Route path="/AW/strategy-execution" element={<StrategySourceReference companyId={companyId} userId="current-human" reference={{ type: "decision", id: decisionId }} />} /><Route path="/AW/decisions" element={<NativeDecisionRoute />} /><Route path="*" element={<p>Unregistered route</p>} /></Routes></MemoryRouter></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const link = container.querySelector("a")!;
    expect(link.textContent).toBe("Actual native decision Source");
    await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    expect(container.textContent).toBe(`Native decision ${decisionId}`);
    expect(container.textContent).not.toContain("Unregistered route");
  } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
});
