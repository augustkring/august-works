// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { V7_FEATURE_KEYS, V8_FEATURE_KEYS } from "@paperclipai/shared";
import { ExperienceInsights } from "./ExperienceInsights";
import { queryKeys } from "../lib/queryKeys";
import { i18n } from "../i18n";

const f = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001", user: "manager-a",
  settled: true, loading: false, failed: false, profile: "manager", flags: vi.fn(), retry: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: f.company }) }));
vi.mock("../hooks/useExperience", () => ({ useExperience: () => ({
  query: { isError: false, isPending: false, isFetching: f.loading, data: { profile: f.profile } },
  identity: { userId: f.user, settled: f.settled, failed: f.failed, localImplicit: false, authorityEpoch: 0 },
  loading: f.loading || !f.settled, scope: `${f.company}:${f.user}`, retry: f.retry,
}) }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: f.flags, getCurrentExperimental: f.flags } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root, client: QueryClient;
const enabled = () => Object.fromEntries([...V7_FEATURE_KEYS, ...V8_FEATURE_KEYS].map(key => [key, true]));
const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><ExperienceInsights /></QueryClientProvider>));
  await flush();
}
beforeEach(() => {
  vi.clearAllMocks(); f.company = "10000000-0000-4000-8000-000000000001"; f.user = "manager-a";
  f.settled = true; f.loading = false; f.failed = false; f.profile = "manager"; f.flags.mockResolvedValue(enabled());
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); await act(async () => i18n.changeLanguage("en")); });

it("includes the existing enabled experiment owner alongside the other analytical families", async () => {
  await render(); expect(container.querySelector('a[href="/business-experiments"]')).not.toBeNull();
});
it("withdraws cached destinations while the current account or experience authority is unresolved", async () => {
  await render(); expect(container.querySelectorAll("a").length).toBeGreaterThan(0);
  f.settled = false; await render(); expect(container.querySelectorAll("a")).toHaveLength(0);
  f.settled = true; f.loading = true; await render(); expect(container.querySelectorAll("a")).toHaveLength(0);
});
it("withdraws retained destinations during an actual flags refresh and respects a closed family", async () => {
  await render(); let release!: (value: Record<string, boolean>) => void;
  f.flags.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = client.refetchQueries({ queryKey: queryKeys.instance.experimentalSettings }); });
  await flush(); expect(container.querySelectorAll("a")).toHaveLength(0);
  await act(async () => { release({ ...enabled(), scenario_planning_v8: false }); await pending; }); await flush();
  expect(container.querySelector('a[href="/business-scenarios"]')).toBeNull();
  expect(container.querySelector('a[href="/business-metrics"]')).not.toBeNull();
});
it("does not let an earlier actor's late flag response restore destinations", async () => {
  let old!: (value: Record<string, boolean>) => void;
  f.flags.mockImplementationOnce(() => new Promise(resolve => { old = resolve; }));
  await render(); f.user = "manager-b"; f.flags.mockResolvedValueOnce({}); await render();
  expect(container.querySelectorAll("a")).toHaveLength(0);
  await act(async () => old(enabled())); await flush();
  expect(container.querySelectorAll("a")).toHaveLength(0);
});
it("shows fixed read recovery without raw error text and refreshes only reads", async () => {
  f.flags.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_ERROR")); await render();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("PRIVATE_PROVIDER_ERROR");
  f.flags.mockResolvedValue(enabled());
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click()); await flush();
  expect(f.retry).toHaveBeenCalledTimes(1);
  expect(container.querySelector('a[href="/business-experiments"]')).not.toBeNull();
});
it("localizes the directory and distinguishes disabled views from missing business evidence", async () => {
  await act(async () => i18n.changeLanguage("da")); await render();
  expect(container.querySelector("h1")?.textContent).toBe("Indsigter");
  expect(container.textContent).toContain("betingede beregninger");
  expect(container.textContent).toContain("Virksomhedseksperimenter");
  f.profile = "member"; await render(); expect(container.querySelectorAll("a")).toHaveLength(0);
});
