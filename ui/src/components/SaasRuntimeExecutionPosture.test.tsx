// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { SaasRuntimeExecutionPosture } from "./SaasRuntimeExecutionPosture";
import { api } from "@/api/client";
vi.mock("@/api/client", () => ({ api: { get: vi.fn() } }));
describe("customer execution posture", () => {
  it.each([ ["backend_qualified", "Awaiting execution boundary verification"], ["quarantined", "Execution boundary requires attention"], ["legacy_boundary", "Existing runtime boundary"] ])("does not confuse %s with applied execution enforcement", async (state, label) => {
    vi.mocked(api.get).mockResolvedValue({ state, executionEnforced: false });
    const container = document.createElement("div"), root = createRoot(container), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    try { await act(async () => { root.render(<QueryClientProvider client={client}><SaasRuntimeExecutionPosture companyId="company" cellId="cell" userId="user" /></QueryClientProvider>); }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); expect(container.textContent).toBe(label); expect(api.get).toHaveBeenLastCalledWith("/companies/company/runtime-cells/cell/execution-posture?expectedUserId=user"); expect(container.querySelector("button")).toBeNull(); } finally { await act(async () => root.unmount()); client.clear(); }
  });
});
