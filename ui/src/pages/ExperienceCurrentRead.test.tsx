// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperienceCard, ExperienceModel } from "@paperclipai/shared";
import { api } from "../api/client";
import { ExperienceHome } from "./ExperienceHome";
import { ExperienceNeedsYou } from "./ExperienceNeedsYou";
import { ExperienceWork } from "./ExperienceWork";
import "../i18n";

const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let company = id(1),
  principal = "member",
  settled = true;
let live: (event: {
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
}) => void;
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: company,
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: principal,
    settled,
    failed: false,
    localImplicit: false,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (listener: typeof live) => {
    live = listener;
  },
}));

function model(
  title = "PRIVATE-CURRENT-TASK",
  companyId = company,
): ExperienceModel {
  const source = {
    companyId,
    domain: "task" as const,
    resourceId: id(3),
    version: "1",
    observedAt: "2026-10-09T00:00:00.000Z",
  };
  const card: ExperienceCard = {
    id: id(3),
    kind: "progress",
    title,
    whyYou: null,
    consequence: null,
    source,
    freshness: "fresh",
    evidence: ["in_progress"],
    actions: [
      {
        id: "open",
        label: "View task",
        operation: "open",
        href: "/issues/AW-1",
        criticality: "C1",
        source,
        requiresCurrentAuthorization: true,
      },
    ],
  };
  return {
    companyId,
    generatedAt: source.observedAt,
    profile: "member",
    dependencies: ["tasks", "attention"].map((domain) => ({
      domain,
      state: "fresh",
      observedAt: source.observedAt,
      reason: null,
    })),
    needsYou: [card],
    inProgress: [card],
    done: [],
    watch: [],
  };
}
let root: Root, container: HTMLDivElement, client: QueryClient;
let Screen: typeof ExperienceHome;
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Screen />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function mount(screen: typeof ExperienceHome) {
  Screen = screen;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
}
async function ready() {
  await vi.waitFor(() =>
    expect(container.textContent).toContain("PRIVATE-CURRENT-TASK"),
  );
  expect(document.activeElement).toBe(container.querySelector("h1"));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  document
    .querySelectorAll("[data-current-read-utility]")
    .forEach((element) => element.remove());
  vi.restoreAllMocks();
  company = id(1);
  principal = "member";
  settled = true;
});
describe.each([
  ["Home", ExperienceHome],
  ["Needs You", ExperienceNeedsYou],
  ["Work", ExperienceWork],
] as const)("%s current private read", (_name, screen) => {
  it("does not steal utility focus when an ordinary background recheck completes", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(model());
    await mount(screen);
    await ready();
    const utility = document.createElement("button");
    utility.dataset.currentReadUtility = "true";
    utility.textContent = "Feedback";
    document.body.append(utility);
    utility.focus();
    let complete!: (value: ExperienceModel) => void;
    get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => {
      void client.invalidateQueries({ queryKey: ["experience", company] });
    });
    await vi.waitFor(() =>
      expect(container.querySelector("article")).toBeNull(),
    );
    await act(async () => complete(model()));
    await vi.waitFor(() =>
      expect(container.querySelector("article")).not.toBeNull(),
    );
    expect(document.activeElement).toBe(utility);
  });
  it("keeps modal focus while a native access-loss recheck fails", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(model());
    await mount(screen);
    await ready();
    const dialog = document.createElement("div"),
      input = document.createElement("input");
    dialog.setAttribute("role", "dialog");
    dialog.dataset.currentReadUtility = "true";
    dialog.append(input);
    document.body.append(dialog);
    input.focus();
    get.mockRejectedValue(new Error("forbidden"));
    await act(async () =>
      live({
        companyId: company,
        type: "analytical.context.access_lost",
        payload: {},
      }),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(document.activeElement).toBe(input);
    expect(container.querySelector("article")).toBeNull();
  });
  it("hides retained titles and controls during a native recheck and focuses a safe failure then recovery", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(model());
    await mount(screen);
    await ready();
    let reject!: (error: Error) => void;
    get.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await act(async () => {
      void client.invalidateQueries({ queryKey: ["experience", company] });
    });
    await vi.waitFor(() =>
      expect(container.querySelector("article")).toBeNull(),
    );
    expect(container.textContent).not.toContain("PRIVATE-CURRENT-TASK");
    await act(async () => reject(new Error("PRIVATE-RAW-ERROR")));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(document.activeElement).toBe(
      container.querySelector('[role="alert"]'),
    );
    expect(container.textContent).not.toContain("PRIVATE-RAW-ERROR");
    get.mockResolvedValue(model());
    await act(async () => container.querySelector("button")!.click());
    await ready();
    expect(get.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
  it.each(["activity.logged", "analytical.context.access_lost"])(
    "rejects late prior-epoch receipts after %s",
    async (type) => {
      const get = vi.spyOn(api, "get").mockResolvedValue(model());
      await mount(screen);
      await ready();
      let resolveOld!: (value: ExperienceModel) => void;
      get.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      );
      await act(async () => {
        void client.invalidateQueries({ queryKey: ["experience", company] });
      });
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      get.mockRejectedValue(new Error("forbidden"));
      await act(async () =>
        live({
          companyId: company,
          type,
          payload: { action: "resource_membership.deleted" },
        }),
      );
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')).not.toBeNull(),
      );
      await act(async () => resolveOld(model("PRIVATE-LATE-OLD-TASK")));
      expect(container.textContent).not.toContain("PRIVATE-LATE-OLD-TASK");
      expect(container.querySelector("article")).toBeNull();
    },
  );
  it.each(["company", "account", "unsettled identity"])(
    "suppresses prior context when %s changes",
    async (kind) => {
      const get = vi.spyOn(api, "get").mockResolvedValue(model());
      await mount(screen);
      await ready();
      get.mockImplementation(() => new Promise(() => {}));
      if (kind === "company") company = id(2);
      if (kind === "account") principal = "new-member";
      if (kind === "unsettled identity") settled = false;
      await render();
      expect(container.textContent).not.toContain("PRIVATE-CURRENT-TASK");
      expect(container.querySelector("article")).toBeNull();
      if (kind === "unsettled identity") expect(get).toHaveBeenCalledTimes(1);
      else
        expect(get.mock.calls.at(-1)![0]).toContain(
          kind === "company" ? company : "expectedUserId=new-member",
        );
    },
  );
  it("rejects a strictly valid receipt bound to a different company", async () => {
    vi.spyOn(api, "get").mockResolvedValue(
      model("PRIVATE-FOREIGN-TASK", id(2)),
    );
    await mount(screen);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(container.textContent).not.toContain("PRIVATE-FOREIGN-TASK");
    expect(document.activeElement).toBe(
      container.querySelector('[role="alert"]'),
    );
  });
});
