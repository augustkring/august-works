// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V7FeatureGate } from "./V7FeatureGate";

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

describe("V7FeatureGate", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  async function renderGate() {
    root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <V7FeatureGate feature="readiness_engine_v7">
            <div data-testid="readiness-content">Readiness content</div>
          </V7FeatureGate>
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

  it("redirects when Readiness is disabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ readiness_engine_v7: false });
    await renderGate();
    expect(container.querySelector('[data-testid="navigate"]')?.getAttribute("data-to")).toBe("/dashboard");
    expect(container.querySelector('[data-testid="readiness-content"]')).toBeNull();
  });

  it("renders Readiness when enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ readiness_engine_v7: true, enableFoundationV1: true, enableContextEngineV1: true });
    await renderGate();
    expect(container.querySelector('[data-testid="readiness-content"]')).not.toBeNull();
  });

  it("does not expose content while the gate is unresolved", async () => {
    mockInstanceSettingsApi.getExperimental.mockImplementation(() => new Promise(() => {}));
    await renderGate();
    expect(container.querySelector('[data-testid="navigate"]')).toBeNull();
    expect(container.querySelector('[data-testid="readiness-content"]')).toBeNull();
  });
});
