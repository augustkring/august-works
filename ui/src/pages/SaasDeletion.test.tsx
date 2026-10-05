// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaasDeletionPage } from "./SaasDeletion";

const fixture = vi.hoisted(() => ({
  userId: "owner-a",
  companyId: "company-a",
  deletion: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/api/companies-query", () => ({
  useAccountIdentity: () => ({ userId: fixture.userId }),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: fixture.companyId,
    selectedCompany: { name: "Same name" },
  }),
}));
vi.mock("@/hooks/useSaasCapabilities", () => ({
  useSaasCapabilities: () => ({ data: { deletion: true } }),
}));
vi.mock("@/api/saas", () => ({
  saasApi: { deletion: fixture.deletion, deleteCompany: fixture.request },
}));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("Organization deletion consent scope", () => {
  let container: HTMLDivElement, root: Root, client: QueryClient;
  beforeEach(() => {
    fixture.userId = "owner-a";
    fixture.companyId = "company-a";
    vi.clearAllMocks();
    fixture.deletion.mockResolvedValue(null);
    fixture.request.mockRejectedValue(Error("Lost deletion acknowledgement"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  async function render() {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <SaasDeletionPage />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  async function confirm() {
    const input = container.querySelector<HTMLInputElement>(
      'input[autocomplete="off"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Same name");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click();
    });
  }
  async function submit() {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  it.each(["company", "user"])(
    "requires fresh consent after switching %s and preserves retries within a scope",
    async (change) => {
      await render();
      await confirm();
      await submit();
      await submit();
      expect(fixture.request).toHaveBeenCalledTimes(2);
      const original = fixture.request.mock.calls[0]!;
      expect(fixture.request.mock.calls[1]![2].idempotencyKey).toBe(
        original[2].idempotencyKey,
      );
      if (change === "company") fixture.companyId = "company-b";
      else fixture.userId = "owner-b";
      await render();
      expect(
        container.querySelector<HTMLInputElement>('input[autocomplete="off"]')!
          .value,
      ).toBe("");
      expect(
        container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
          .checked,
      ).toBe(false);
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')!
          .disabled,
      ).toBe(true);
      expect(container.textContent).not.toContain(
        "Lost deletion acknowledgement",
      );
      expect(fixture.request).toHaveBeenCalledTimes(2);
      await confirm();
      await submit();
      const current = fixture.request.mock.calls[2]!;
      expect(current.slice(0, 2)).toEqual([fixture.companyId, fixture.userId]);
      expect(current[2].idempotencyKey).not.toBe(original[2].idempotencyKey);
    },
  );
});
