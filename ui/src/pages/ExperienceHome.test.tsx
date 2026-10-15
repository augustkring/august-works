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
  return client;
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
  it("preserves a keyboard gesture on a global utility when the first projection finishes", async () => {
    let resolve!: (value: typeof model) => void;
    vi.spyOn(experienceApi, "home").mockImplementation(() => new Promise(done => { resolve = done; }));
    await mount();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const utilities = document.createElement("div"), feedback = document.createElement("button");
    feedback.textContent = "Feedback"; utilities.append(feedback); document.body.append(utilities);
    const opening = vi.fn(); feedback.addEventListener("keydown", opening);
    try {
      feedback.focus(); expect(document.activeElement).toBe(feedback);
      await act(async () => resolve(model));
      await vi.waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
      expect(document.activeElement).toBe(feedback);
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(opening).toHaveBeenCalledOnce();
    } finally { utilities.remove(); }
  });
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

it.each([false, true])("orients a remounted current heading after a private recheck without interrupting utilities (utility=%s)", async utility => {
  let finish!: (value: typeof model) => void;
  vi.spyOn(experienceApi, "home").mockResolvedValueOnce(model)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const client = await mount();
  await vi.waitFor(() => expect(document.activeElement).toBe(container.querySelector("h1")));
  const original = container.querySelector("h1");
  await act(async () => { void client.refetchQueries({ type: "active" }); });
  await vi.waitFor(() => expect(container.querySelector("h1")).toBeNull());
  const feedback = document.createElement("button"); feedback.textContent = "Feedback"; document.body.append(feedback);
  try {
    if (utility) feedback.focus();
    await act(async () => finish(model));
    await vi.waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
    expect(container.querySelector("h1")).not.toBe(original);
    expect(document.activeElement).toBe(utility ? feedback : container.querySelector("h1"));
  } finally { feedback.remove(); }
});
