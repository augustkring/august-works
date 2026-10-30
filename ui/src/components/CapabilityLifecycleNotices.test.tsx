// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityLifecycleNotices } from "./CapabilityLifecycleNotices";

const api = vi.hoisted(() => ({ capabilityLifecycle: vi.fn() }));
vi.mock("@/api/product-notices", () => ({ productNoticesApi: api }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, string>) => `${key} ${Object.values(values ?? {}).join(" ")}`.trim(),
  i18n: { language: "en", resolvedLanguage: "en" },
}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "00000000-0000-4000-8000-000000000001";
const qualifiedNotice = {
  capabilityKey: "enableApps", customerName: "Apps", owner: "Apps team",
  deprecationAt: "2026-11-01T00:00:00.000Z", sunsetAt: "2027-02-01T00:00:00.000Z",
  replacementCapability: "apps.connections", migrationGuideSlug: "apps-and-connections",
};

describe("informational capability lifecycle notices", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const render = async () => act(async () => root.render(<QueryClientProvider client={client}>
    <CapabilityLifecycleNotices companyId={companyId} enabled />
  </QueryClientProvider>));
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.capabilityLifecycle.mockReset().mockResolvedValue({ coverage: "unknown", deprecatedCapabilityCount: 2, notices: [] });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });

  it("keeps unknown coverage quiet and renders only a qualified notice with a safe Help link and localized dates", async () => {
    await render();
    await act(async () => { await vi.waitFor(() => expect(api.capabilityLifecycle).toHaveBeenCalledOnce()); });
    expect(container.textContent).toBe("");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { await vi.waitFor(() => expect(client.getQueryData(["capability-lifecycle-notices", companyId])).toBeDefined()); });

    await act(async () => client.setQueryData(["capability-lifecycle-notices", companyId], {
      coverage: "incomplete", deprecatedCapabilityCount: 2, notices: [qualifiedNotice],
    }));
    await act(async () => { await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull()); });
    const link = container.querySelector("a")!;
    expect(container.textContent).toContain("1 Nov 2026");
    expect(link.textContent).toContain("announcement.lifecycle.migrationGuide");
    expect(link.href).toBe("https://docs.blentera.com/help/apps-and-connections");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noreferrer");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
