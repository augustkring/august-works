// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { i18n } from "../i18n";
import { experienceApi } from "../api/experience";
import { ExperienceHome } from "./ExperienceHome";
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
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExperienceHome />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
const model = {
  companyId: "10000000-0000-4000-8000-000000000001",
  profile: "member" as const,
  generatedAt: "2026-10-09T00:00:00.000Z",
  dependencies: [],
  needsYou: [],
  inProgress: [],
  done: [],
  watch: [],
};
describe("Home state truth", () => {
  it("does not describe an observed native page boundary as an outage or a complete empty queue", async () => {
    vi.spyOn(experienceApi, "home").mockResolvedValue({
      ...model,
      dependencies: [
        {
          domain: "attention",
          state: "partial",
          observedAt: model.generatedAt,
          reason: "more_items_available",
        },
      ],
    });
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Open the full queue"),
    );
    expect(container.textContent).not.toContain("temporarily unavailable");
    expect(container.textContent).not.toContain("Nothing needs your attention");
  });
  it("shows the meaningful empty state without empty dashboard sections", async () => {
    vi.spyOn(experienceApi, "home").mockResolvedValue(model);
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Nothing needs your attention right now.",
      ),
    );
    expect(container.querySelector("h2")).toBeNull();
  });
  it("never calls unavailable attention healthy or caught up", async () => {
    vi.spyOn(experienceApi, "home").mockResolvedValue({
      ...model,
      dependencies: [
        {
          domain: "attention",
          state: "unavailable",
          observedAt: null,
          reason: "timeout",
        },
      ],
    });
    await mount();
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Some information is temporarily unavailable. Available work is shown below.",
      ),
    );
    expect(container.textContent).not.toContain(
      "Nothing needs your attention right now.",
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "Try again",
      ),
    ).toBe(true);
  });
  it("preserves a distinct system failure and supports Danish in the existing i18next stack", async () => {
    await i18n.changeLanguage("da");
    vi.spyOn(experienceApi, "home").mockRejectedValue(new Error("offline"));
    await mount();
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Hjem kunne ikke indlæses",
      ),
    );
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.textContent === "Prøv igen",
      ),
    ).toBe(true);
  });
});
