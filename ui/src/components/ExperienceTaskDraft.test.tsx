// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import ExperienceTaskDraft from "./ExperienceTaskDraft";
import "../i18n";
const state = vi.hoisted(() => ({
  company: "10000000-0000-4000-8000-000000000001",
  principal: "draft-owner",
  enabled: true,
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
    query: { isSuccess: true, isFetching: false },
  }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: state.company,
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const task = {
  id: "10000000-0000-4000-8000-000000000002",
  companyId: state.company,
  title: "<img src=x onerror=alert(1)> PRIVATE-TASK",
};
let root: Root, container: HTMLDivElement, client: QueryClient;
const close = vi.fn();
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  close.mockClear();
  state.enabled = true;
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ExperienceTaskDraft
            companyId={state.company}
            principal="draft-owner"
            initialTitle={task.title}
            onClose={close}
          />
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
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
it("sends one explicit Native create and reconciles a lost acknowledgement with GET only", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockRejectedValue(new Error("PRIVATE-RAW-ERROR"));
  const get = vi
    .spyOn(api, "get")
    .mockRejectedValueOnce(new Error("PRIVATE-RAW-ERROR"))
    .mockResolvedValue(task);
  await mount();
  expect(post).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
    task.title,
  );
  await click("Create task");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this task",
    ),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain("PRIVATE-RAW-ERROR");
  const [path, body] = post.mock.calls[0]!;
  expect(
    new URL(path, "https://fixture.invalid").searchParams.get(
      "expectedActorId",
    ),
  ).toBe("user:draft-owner");
  expect(body).toEqual({
    idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
    title: task.title,
    description: "",
    status: "backlog",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    allowDuplicate: true,
  });
  expect(document.querySelector("input")).toBeNull();
  await click("Check task receipt");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Task confirmed"),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1]![0]).toContain(
    `/create-receipts/${(body as { idempotencyKey: string }).idempotencyKey}?`,
  );
  expect(get.mock.calls[1]![1]).toMatchObject({ cache: "no-store" });
  expect(document.querySelector("img")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Task confirmed");
  expect(
    document.querySelector<HTMLAnchorElement>(
      'a[href$="/issues/' + task.id + '"]',
    ),
  ).toBeTruthy();
});
it("keeps a missing or erased receipt unconfirmed and never repeats its POST", async () => {
  const post = vi.spyOn(api, "post").mockRejectedValue(new Error("lost"));
  const get = vi
    .spyOn(api, "get")
    .mockRejectedValue(new Error("receipt not found"));
  await mount();
  await click("Create task");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this task",
    ),
  );
  await click("Check task receipt");
  await click("Check task receipt");
  expect(post).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(document.body.textContent).not.toContain("Task confirmed");
  expect(
    document.querySelector<HTMLAnchorElement>('a[href$="/work"]'),
  ).toBeTruthy();
});
it("hides a confirmed task during auth recheck and requires a new Native read", async () => {
  vi.spyOn(api, "post").mockResolvedValue(task);
  const get = vi.spyOn(api, "get").mockResolvedValue(task);
  await mount();
  await click("Create task");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Task confirmed"),
  );
  let finish!: (value: object) => void, pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({
      queryKey: ["auth", "session"],
      queryFn: () =>
        new Promise<object>((done) => {
          finish = done;
        }),
    });
  });
  await vi.waitFor(() => expect(document.body.textContent).not.toContain(task.title));
  expect(
    document.querySelector('a[href$="/issues/' + task.id + '"]'),
  ).toBeNull();
  get.mockRejectedValue(new Error("access revoked"));
  await act(async () => {
    finish({});
    await pending;
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this task",
    ),
  );
  expect(document.body.textContent).not.toContain(task.title);
});
it("blocks a stale same-turn write and preserves the draft across a flag rollback", async () => {
  const post = vi.spyOn(api, "post");
  await mount();
  client.setQueryDefaults(["auth", "session"], {
    queryFn: () => new Promise(() => {}),
  });
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: ["auth", "session"] });
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(post).not.toHaveBeenCalled();
  await act(async () => {
    await client.cancelQueries({ queryKey: ["auth", "session"] });
    await pending.catch(() => {});
  });
  state.enabled = false;
  await render();
  expect(document.querySelector("input")).toBeNull();
  state.enabled = true;
  await render();
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
    task.title,
  );
});
