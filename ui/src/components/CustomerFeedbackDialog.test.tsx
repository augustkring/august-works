// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { customerFeedbackApi } from "../api/customer-feedback";
import { CustomerFeedbackDialog } from "./CustomerFeedbackDialog";
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({ enabled: true }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: "feedback-member",
    localImplicit: false,
    settled: true,
    failed: false,
  }),
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function enter(body: string) {
  const element = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(element, body);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            "/AW/needs-you?secret=private-query#private-fragment",
          ]}
        >
          <CustomerFeedbackDialog />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await click("Feedback");
}
const accepted = {
  id: "10000000-0000-4000-8000-000000000002",
  feedbackId: "AWF-10000000000040008000000000000002",
  companyId: "10000000-0000-4000-8000-000000000001",
  category: "BUG" as const,
  body: "My approval is missing",
  goal: "",
  blocksWork: false,
  omitName: false,
  status: "RECEIVED" as const,
  version: 0,
  createdAt: "2026-10-09T00:00:00.000Z",
  messages: [],
};
describe("feedback consent and canonical receipt", () => {
  it("starts diagnostics/name exclusion off and links to the user-confirmed distinct contact purposes", async () => {
    await mount();
    expect(document.activeElement?.tagName).toBe("SELECT");
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ),
      ].every((input) => !input.checked),
    ).toBe(true);
    expect(
      document.querySelector('a[href="mailto:security@blentera.com"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('a[href="mailto:privacy@blentera.com"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('a[href="mailto:support@blentera.com"]'),
    ).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it("preserves draft on close/failure, retries the same payload and omits raw page context", async () => {
    const save = vi
      .spyOn(customerFeedbackApi, "create")
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce(accepted);
    await mount();
    await enter(accepted.body);
    await click("Send feedback");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "could not be confirmed",
      ),
    );
    expect(document.body.textContent).not.toContain(
      "Thanks — feedback received",
    );
    const first = save.mock.calls[0]![2];
    expect(first.context.surfaceKey).toBe("needs_you");
    expect(first.includeDiagnostics).toBe(false);
    expect(first).not.toHaveProperty("diagnostics");
    expect(JSON.stringify(first)).not.toContain("private-query");
    expect(JSON.stringify(first)).not.toContain("private-fragment");
    await click("Cancel");
    expect(document.activeElement?.textContent).toBe("Feedback");
    await click("Feedback");
    expect(document.querySelector("textarea")!.value).toBe(accepted.body);
    await click("Send feedback");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(accepted.feedbackId),
    );
    expect(save.mock.calls[1]![2]).toEqual(first);
    expect(document.body.textContent).toContain("Thanks — feedback received");
  });
});
