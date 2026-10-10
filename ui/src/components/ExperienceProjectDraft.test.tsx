// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import ExperienceProjectDraft from "./ExperienceProjectDraft";
import "../i18n";
const state = vi.hoisted(() => ({
  company: "10000000-0000-4000-8000-000000000001",
  principal: "draft-owner",
  enabled: true,
  featureFetching: false,
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: state.principal,
    settled: true,
    failed: false,
    localImplicit: false,
  }),
}));
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({
    enabled: state.enabled,
    query: {
      isSuccess: true,
      isFetching: state.featureFetching,
      isPending: false,
      isError: false,
    },
  }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: state.company,
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const project = {
  id: "10000000-0000-4000-8000-000000000002",
  companyId: state.company,
  name: "<img src=x onerror=alert(1)> PRIVATE-PROJECT",
};
let root: Root, container: HTMLDivElement, client: QueryClient;
const close = vi.fn();
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  close.mockClear();
  state.principal = "draft-owner";
  state.enabled = true;
  state.featureFetching = false;
});
async function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await renderDraft();
}
async function renderDraft() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExperienceProjectDraft
            companyId={state.company}
            principal="draft-owner"
            initialName={project.name}
            onClose={close}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function recheck() {
  let resolve!: (value: object) => void, pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({
      queryKey: ["auth", "session"],
      queryFn: () =>
        new Promise<object>((done) => {
          resolve = done;
        }),
    });
  });
  return async () => {
    await act(async () => {
      resolve({});
      await pending;
    });
  };
}
it("edits an explicit project draft without effects, freezes the original unknown request and requires a current Native receipt before claiming success", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockRejectedValueOnce(new Error("PRIVATE-RAW-ERROR"))
    .mockResolvedValueOnce(project);
  let resolve!: (value: unknown) => void;
  const get = vi.spyOn(api, "get").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await mount();
  expect(post).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
    project.name,
  );
  expect(document.querySelector("img")).toBeNull();
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).toBeTruthy(),
  );
  expect(document.body.textContent).not.toContain("PRIVATE-RAW-ERROR");
  const first = post.mock.calls[0]!;
  expect(
    new URL(first[0], "https://fixture.invalid").searchParams.get(
      "expectedActorId",
    ),
  ).toBe("user:draft-owner");
  expect(first[1]).toEqual({
    name: project.name,
    description: "",
    status: "planned",
    idempotencyKey: expect.any(String),
  });
  expect(document.querySelector<HTMLInputElement>("input")!.disabled).toBe(
    true,
  );
  await click("Try again");
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[1]).toEqual(first);
  expect(document.body.textContent).not.toContain("Project saved");
  await act(async () => resolve(project));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Project saved"),
  );
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("a")!.getAttribute("href")).toContain(
    `/projects/${project.id}`,
  );
  expect(get.mock.calls[0]![1]).toEqual({
    signal: expect.any(AbortSignal),
    cache: "no-store",
  });
});
it("fences a late acknowledgement across current-account revalidation and reconciles only the original Native request", async () => {
  let resolve!: (value: unknown) => void;
  const post = vi
    .spyOn(api, "post")
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(project);
  vi.spyOn(api, "get").mockResolvedValue(project);
  await mount();
  await click("Create project");
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const finish = await recheck();
  await vi.waitFor(() =>
    expect(document.querySelector("input,textarea")).toBeNull(),
  );
  await act(async () => resolve(project));
  expect(document.body.textContent).not.toContain(project.name);
  await finish();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).toBeTruthy(),
  );
  expect(document.body.textContent).not.toContain("Project saved");
  await click("Try again");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Project saved"),
  );
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
});
it("withdraws a saved project's name and link when a fresh current-owner read is denied without repeating creation", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue(project);
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValueOnce(project)
    .mockRejectedValue(new Error("PRIVATE-DENIAL"));
  await mount();
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Project saved"),
  );
  const finish = await recheck();
  await vi.waitFor(() => expect(document.querySelector("a")).toBeNull());
  expect(document.body.textContent).not.toContain(project.name);
  await finish();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')).toBeTruthy(),
  );
  expect(get).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toMatch(/PRIVATE-|Project saved/);
  expect(document.querySelector("a,input,textarea")).toBeNull();
});

it("withdraws an entered draft during feature revalidation and rollback, then retains it only in the same scoped dialog", async () => {
  const post = vi.spyOn(api, "post");
  await mount();
  expect(document.querySelector("input")?.value).toBe(project.name);
  state.featureFetching = true;
  await renderDraft();
  expect(document.querySelector("input")).toBeNull();
  expect(document.body.textContent).not.toContain("PRIVATE-PROJECT");
  expect(post).not.toHaveBeenCalled();
  state.featureFetching = false;
  state.enabled = false;
  await renderDraft();
  expect(document.querySelector("input")).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
  state.enabled = true;
  await renderDraft();
  expect(document.querySelector("input")?.value).toBe(project.name);
});

it("refuses a write when the original session query starts before React can commit the pending state", async () => {
  const post = vi.spyOn(api, "post");
  await mount();
  let release!: (value: null) => void;
  let pending!: Promise<null>;
  const form = document.querySelector("form")!;
  await act(async () => {
    pending = client.fetchQuery({
      queryKey: ["auth", "session"],
      queryFn: () =>
        new Promise<null>((resolve) => {
          release = resolve;
        }),
    });
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(post).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.querySelector("input")).toBeNull());
  await act(async () => {
    release(null);
    await pending;
  });
  expect(post).not.toHaveBeenCalled();
});
