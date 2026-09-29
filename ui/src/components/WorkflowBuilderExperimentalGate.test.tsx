// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowBuilderExperimentalGate } from "./WorkflowBuilderExperimentalGate";

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

describe("WorkflowBuilderExperimentalGate", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  async function renderGate() {
    root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowBuilderExperimentalGate>
            <div data-testid="workflow-content">Workflow content</div>
          </WorkflowBuilderExperimentalGate>
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

  it("fails closed unless both Workflow flags are enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableWorkflowsV1: true,
      enableWorkflowBuilderV1: false,
    });
    await renderGate();
    expect(container.querySelector('[data-testid="navigate"]')?.getAttribute("data-to"))
      .toBe("/dashboard");
  });

  it("renders when Workflow persistence and builder are enabled", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({
      enableWorkflowsV1: true,
      enableWorkflowBuilderV1: true,
    });
    await renderGate();
    expect(container.querySelector('[data-testid="workflow-content"]')).not.toBeNull();
  });
});
