// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaasDeletionPage } from "./SaasDeletion";
import { i18n } from "@/i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fixture = vi.hoisted(() => ({
  userId: "owner-a",
  companyId: "company-a",
  deletion: vi.fn(),
  request: vi.fn(),
  deletionEnabled: true,
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
  useSaasCapabilities: () => ({ data: { profile: "saas", deletion: fixture.deletionEnabled } }),
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
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    fixture.deletionEnabled = true;
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

  it("shows a customer-facing label while the deletion worker stops active runs", async () => {
    fixture.deletion.mockResolvedValue({
      id: "deletion-operation",
      companyId: fixture.companyId,
      status: "processing",
      stage: "revoke_finalizing",
    });
    await render();
    expect(container.textContent).toContain("Current step: Stopping active work");
    expect(container.textContent).not.toContain("revoke_finalizing");
  });

  it.each(["en", "da"])("keeps a failed request visible after rollout withdrawal in %s", async (language) => {
    await i18n.changeLanguage(language);
    fixture.deletionEnabled = false;
    fixture.deletion.mockResolvedValue({
      id: "original-deletion-request", companyId: fixture.companyId,
      status: "failed", stage: "runtimes", errorCode: "offboarding_provider_access_denied",
      notBefore: "2026-11-11T12:00:00.000Z",
    });
    await render();
    expect(fixture.deletion).toHaveBeenCalledWith(fixture.companyId, fixture.userId, expect.any(AbortSignal));
    expect(container.textContent).toContain("original-deletion-request");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      language === "da" ? "Sletningen er ikke gennemført" : "Erasure is incomplete",
    );
    expect(container.querySelector('a[href="mailto:privacy@blentera.com"]')).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("offboarding_provider_access_denied");
    expect(container.textContent).toContain(language === "da" ? "Adgangen til den oprindelige sletteudbyder" : "Access to the original erasure provider");
    expect(container.textContent).not.toContain(language === "da" ? "Næste automatiske kontrol" : "Next automatic check");
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("does not offer a new request while status is unknown or unavailable", async () => {
    let reject!: (error: Error) => void;
    fixture.deletion.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Checking the deletion request");
    await act(async () => reject(new Error("Status temporarily unavailable")));
    await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Status temporarily unavailable");
    fixture.deletion.mockResolvedValue(null);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await render();
    expect(container.querySelector("form")).not.toBeNull();
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("blocks new requests when deletion admission is disabled", async () => {
    fixture.deletionEnabled = false;
    await render();
    expect(fixture.deletion).toHaveBeenCalledTimes(1);
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("New organization deletion requests are not available");
  });

  it("explains that the original export storage requires repair before erasure can continue", async () => {
    fixture.deletion.mockResolvedValue({ id: "original-deletion-request", status: "failed", stage: "purge",
      errorCode: "company_export_storage_scope_changed" });
    await render();
    expect(container.textContent).toContain("The original export storage needs operator reconciliation.");
    expect(container.textContent).toContain("Erasure is incomplete");
    expect(container.querySelector("form")).toBeNull();
  });

  it("shows pending erasure and its earliest reconciliation time without claiming completion", async () => {
    fixture.deletion.mockResolvedValue({
      id: "pending-original-request", companyId: fixture.companyId, status: "processing",
      stage: "purge", errorCode: "secret_provider_erasure_pending", notBefore: "2026-11-11T12:00:00.000Z",
    });
    await render();
    expect(container.textContent).toContain("The original provider has not yet confirmed erasure.");
    expect(container.textContent).toContain("Next automatic check, no earlier than:");
    expect(container.textContent).toContain(new Date("2026-11-11T12:00:00.000Z").toLocaleString("en"));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Deletion: completed");
  });
});
