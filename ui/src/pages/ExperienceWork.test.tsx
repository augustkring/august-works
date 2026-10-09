// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ExperienceModel } from "@paperclipai/shared";
import { experienceApi } from "../api/experience";
import { ExperienceWork } from "./ExperienceWork";
import "../i18n";
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: "member",
    localImplicit: false,
    settled: true,
    failed: false,
  }),
}));
const model: ExperienceModel = {
  companyId: "10000000-0000-4000-8000-000000000001",
  profile: "member",
  generatedAt: "2026-10-09T00:00:00.000Z",
  dependencies: [
    {
      domain: "tasks",
      state: "fresh",
      observedAt: "2026-10-09T00:00:00.000Z",
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
  vi.restoreAllMocks();
});
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
        <MemoryRouter>
          <ExperienceWork />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("uses native company-prefixed work owners and scopes the empty state to this bounded view", async () => {
  vi.spyOn(experienceApi, "home").mockResolvedValue(model);
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "No current tasks appear in this view",
    ),
  );
  expect(
    [...container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    ),
  ).toEqual(["/AW/projects", "/AW/issues", "/AW/routines"]);
  expect(container.textContent).toContain("This view shows");
  expect(container.querySelector("h2")).toBeNull();
});
it("keeps dependency failure separate from an empty company and offers a native recheck", async () => {
  const get = vi.spyOn(experienceApi, "home").mockResolvedValue({
    ...model,
    dependencies: [
      {
        domain: "tasks",
        state: "unavailable",
        reason: "timeout",
        observedAt: null,
      },
    ],
  });
  await mount();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "does not mean that the company has no work",
    ),
  );
  expect(container.textContent).not.toContain("No current tasks appear");
  get.mockResolvedValue(model);
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Try again")!
      .click(),
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "No current tasks appear in this view",
    ),
  );
});
