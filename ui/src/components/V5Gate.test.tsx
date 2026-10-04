// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { v5FeatureFlagsSchema } from "@paperclipai/shared";
import { V5Gate } from "./V5Gate";
import { queryKeys } from "@/lib/queryKeys";

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-one" }) }));
vi.mock("@/lib/router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: vi.fn() } }));
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); });
describe("V5 route gates", () => {
  async function render(flags: Record<string, boolean>) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.instance.experimentalSettings, { ...v5FeatureFlagsSchema.parse({}), ...flags });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => { root!.render(<QueryClientProvider client={client}><V5Gate feature="agent_runtime_fabric_v5"><div data-testid="execution-control">Execution control</div></V5Gate></QueryClientProvider>); });
    return container;
  }
  it("does not mount execution controls under the safe-off defaults", async () => { const view = await render({}); expect(view.querySelector('[data-testid="execution-control"]')).toBeNull(); expect(view.textContent).toContain("disabled"); });
  it("does not mount controls when the flag is on but a prerequisite is off", async () => { const view = await render({ agent_runtime_fabric_v5: true }); expect(view.querySelector('[data-testid="execution-control"]')).toBeNull(); });
  it("mounts controls only when all execution prerequisites are enabled", async () => { const flags = Object.fromEntries(Object.keys(v5FeatureFlagsSchema.parse({})).map((key) => [key, true])); const view = await render({ ...flags, enableFoundationV1: true, enableContextEngineV1: true }); expect(view.querySelector('[data-testid="execution-control"]')).not.toBeNull(); });
});
