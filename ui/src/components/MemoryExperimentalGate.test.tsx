// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryExperimentalGate } from "./MemoryExperimentalGate";

const mockApi = vi.hoisted(() => ({ getExperimental: vi.fn() }));
vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockApi,
}));
vi.mock("@/lib/router", () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

async function flushReact() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("MemoryExperimentalGate", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  async function renderGate() {
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <MemoryExperimentalGate>
            <div data-testid="memory-content">Memory</div>
          </MemoryExperimentalGate>
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  it("shows a legible error instead of redirecting when settings cannot be loaded", async () => {
    mockApi.getExperimental.mockRejectedValue(new Error("settings unavailable"));
    await renderGate();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Memory availability could not be checked",
    );
    expect(container.querySelector('[data-testid="navigate"]')).toBeNull();
  });

  it("redirects while Memory is disabled", async () => {
    mockApi.getExperimental.mockResolvedValue({ enableCollectiveMemoryV1: false });
    await renderGate();
    expect(container.querySelector('[data-testid="navigate"]')?.getAttribute("data-to")).toBe("/dashboard");
  });

  it("renders when Memory is enabled", async () => {
    mockApi.getExperimental.mockResolvedValue({ enableCollectiveMemoryV1: true });
    await renderGate();
    expect(container.querySelector('[data-testid="memory-content"]')).not.toBeNull();
  });
});
