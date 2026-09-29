// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoundationExperimentalGate } from "./FoundationExperimentalGate";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("@/lib/router", () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(replace ?? false)} />
  ),
}));

async function flushReact() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  flushSync(() => {});
}

describe("FoundationExperimentalGate", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  async function renderGate() {
    root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <FoundationExperimentalGate>
            <div data-testid="foundation-content">Foundation content</div>
          </FoundationExperimentalGate>
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

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

  it("redirects when Foundation is disabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableFoundationV1: false });
    await renderGate();
    expect(container.querySelector('[data-testid="navigate"]')?.getAttribute("data-to")).toBe("/dashboard");
    expect(container.querySelector('[data-testid="foundation-content"]')).toBeNull();
  });

  it("renders Foundation when enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableFoundationV1: true });
    await renderGate();
    expect(container.querySelector('[data-testid="foundation-content"]')).not.toBeNull();
  });

  it("renders nothing while the flag is unresolved", async () => {
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    await renderGate();
    expect(container.querySelector('[data-testid="navigate"]')).toBeNull();
    expect(container.querySelector('[data-testid="foundation-content"]')).toBeNull();
  });
});
