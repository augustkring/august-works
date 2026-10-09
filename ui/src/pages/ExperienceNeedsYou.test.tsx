// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ExperienceCard, ExperienceModel } from "@paperclipai/shared";
import { i18n } from "../i18n";
import { experienceApi } from "../api/experience";
import { ExperienceNeedsYou } from "./ExperienceNeedsYou";
const context = vi.hoisted(() => ({ principal: "member" }));
const companyId = "10000000-0000-4000-8000-000000000001";
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: context.principal,
    localImplicit: false,
    settled: true,
    failed: false,
  }),
}));
const source = {
  domain: "attention" as const,
  companyId,
  resourceId: "native-attention",
  version: "1",
  observedAt: "2026-10-09T00:00:00.000Z",
};
const card: ExperienceCard = {
  id: "native-attention",
  kind: "approval",
  title: "Approve the bounded plan",
  whyYou: "A human review is required",
  consequence: "This approval remains pending.",
  source,
  freshness: "fresh",
  evidence: ["Current pending approval"],
  actions: [
    {
      id: "open",
      label: "Review",
      labelKey: "review",
      operation: "open",
      href: "/needs-you?attentionId=native-attention",
      criticality: "C3",
      source,
      requiresCurrentAuthorization: true,
    },
  ],
};
const model: ExperienceModel = {
  companyId,
  profile: "member",
  generatedAt: source.observedAt,
  dependencies: [
    {
      domain: "attention",
      state: "fresh",
      observedAt: source.observedAt,
      reason: null,
    },
  ],
  needsYou: [],
  inProgress: [],
  done: [],
  watch: [],
};
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  context.principal = "member";
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExperienceNeedsYou />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
}
it("renders the prescribed card order and links to the exact native resolver with a complete queue escape", async () => {
  vi.spyOn(experienceApi, "home").mockResolvedValue({
    ...model,
    needsYou: [card],
  });
  await mount();
  await vi.waitFor(() =>
    expect(container.querySelector("article")).toBeTruthy(),
  );
  const article = container.querySelector("article")!;
  expect(
    [...article.children].map((child) => child.textContent).slice(0, 5),
  ).toEqual([
    card.title,
    card.whyYou,
    card.consequence,
    "Current pending approval",
    "Review",
  ]);
  expect(article.querySelector("h2")).toBeTruthy();
  expect(article.querySelector("a")!.href).toContain(
    "/AW/needs-you?attentionId=native-attention",
  );
  expect(container.textContent).toContain("This view shows");
  expect(container.querySelector('a[href="/AW/decisions"]')).toBeTruthy();
  expect(document.activeElement).toBe(container.querySelector("h1"));
});
it.each(["unavailable", "partial"] as const)(
  "does not call %s attention an empty queue",
  async (state) => {
    vi.spyOn(experienceApi, "home").mockResolvedValue({
      ...model,
      dependencies: [
        {
          domain: "attention",
          state,
          observedAt: null,
          reason: state === "partial" ? "more_items_available" : "timeout",
        },
      ],
    });
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        state === "partial" ? "This view shows" : "does not mean",
      ),
    );
    expect(container.textContent).not.toContain("Nothing needs your action");
  },
);
it("keeps the new account from seeing cached prior-account cards", async () => {
  const get = vi
    .spyOn(experienceApi, "home")
    .mockResolvedValue({ ...model, needsYou: [card] });
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain(card.title));
  context.principal = "other-member";
  get.mockImplementation(() => new Promise(() => {}));
  await render();
  expect(container.textContent).not.toContain(card.title);
  expect(get.mock.calls.at(-1)![1]).toBe("other-member");
});
it("uses the Danish empty-state contract", async () => {
  await i18n.changeLanguage("da");
  vi.spyOn(experienceApi, "home").mockResolvedValue(model);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain("ingen handlinger til dig"),
  );
});
