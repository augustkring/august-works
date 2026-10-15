// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { ExperienceToolCard } from "./ExperienceToolCard";
import "../i18n";
const companyId = "10000000-0000-4000-8000-000000000001";
const wire = {
  schemaVersion: 1,
  component: "TaskCard",
  companyId,
  cardId: "card",
  source: { companyId, domain: "task", resourceId: "AW-1", version: "1" },
};
const source = { ...wire.source, observedAt: "2026-10-10T10:00:00.000Z" };
const card = {
  id: "card",
  kind: "progress",
  title: "PRIVATE <script>quoted</script>",
  whyYou: null,
  consequence: null,
  source,
  freshness: "fresh",
  evidence: [],
  actions: [
    {
      id: "open",
      label: "View task",
      operation: "open",
      href: "/issues/AW-1",
      source,
      criticality: "C1",
      requiresCurrentAuthorization: true,
    },
  ],
};
const model = {
  companyId,
  profile: "member",
  generatedAt: source.observedAt,
  dependencies: [],
  needsYou: [],
  inProgress: [card],
  done: [],
  watch: [],
};
let enabled = true;
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: companyId }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: "member",
    localImplicit: false,
    settled: true,
    failed: false,
  }),
}));
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: () => {},
}));
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({
    enabled,
    query: {
      isSuccess: true,
      isPending: false,
      isFetching: false,
      isError: false,
    },
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  enabled = true;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
});
async function render(
  value: unknown = wire,
  state: "loading" | "ready" | "error" = "ready",
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExperienceToolCard wire={value} state={state} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("reads the current private Native view and renders escaped text and navigation only", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(model),
    post = vi.spyOn(api, "post");
  await render();
  await vi.waitFor(() =>
    expect(container.querySelector("article")?.textContent).toContain(
      card.title,
    ),
  );
  expect(get).toHaveBeenCalledWith(
    expect.stringContaining("expectedUserId=member"),
    expect.objectContaining({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }),
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "/issues/AW-1",
  );
  expect(container.querySelector("button")).toBeNull();
  expect(post).not.toHaveBeenCalled();
});
it("hides the old private card while authentication is pending and waits for a new current Native read", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(model);
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE"));
  let releaseSession!: (value: null) => void;
  await act(async () => {
    void client.fetchQuery({
      queryKey: queryKeys.auth.session,
      queryFn: () =>
        new Promise<null>((resolve) => {
          releaseSession = resolve;
        }),
    });
  });
  await vi.waitFor(() => expect(container.querySelector("article")).toBeNull());
  expect(container.textContent).not.toContain("PRIVATE");
  let releaseRead!: (value: unknown) => void;
  get.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  await act(async () => releaseSession(null));
  await vi.waitFor(() => expect(releaseRead).toBeTypeOf("function"));
  expect(container.querySelector("article")).toBeNull();
  await act(async () => releaseRead(model));
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE"));
});
it("hides a changed current version and refuses injected/foreign arguments or a disabled flag without a read", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(model);
  await render({ ...wire, title: "INVENTED" });
  expect(get).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("INVENTED");
  await render({ ...wire, companyId: "10000000-0000-4000-8000-000000000099" });
  expect(get).not.toHaveBeenCalled();
  enabled = false;
  await render();
  expect(get).not.toHaveBeenCalled();
  enabled = true;
  await render({ ...wire, source: { ...wire.source, version: "stale" } });
  await vi.waitFor(() => expect(get).toHaveBeenCalled());
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).toBeTruthy(),
  );
  expect(container.querySelector("article")).toBeNull();
});
it("keeps input/loading/error tool states free of model-provided private output", async () => {
  const get = vi.spyOn(api, "get");
  await render({ ...wire, output: "PRIVATE FAKE" }, "loading");
  expect(container.querySelector('[role="status"]')).toBeTruthy();
  await render({ ...wire, output: "PRIVATE FAKE" }, "error");
  expect(container.querySelector('[role="alert"]')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("PRIVATE FAKE");
});
