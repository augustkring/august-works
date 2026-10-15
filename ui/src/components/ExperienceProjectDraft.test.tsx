import {
  PENDING_PROJECT_RECEIPTS_KEY,
  retainPendingProjectReceipt,
} from "../lib/pending-project-receipts";
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
  window.sessionStorage.removeItem(PENDING_PROJECT_RECEIPTS_KEY);
  vi.restoreAllMocks();
  close.mockClear();
  state.enabled = true;
});
async function render() {
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
    .mockResolvedValue(project);
  await mount();
  expect(post).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
    project.name,
  );
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this project",
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
    name: project.name,
    description: "",
    status: "planned",
  });
  expect(document.querySelector("input")).toBeNull();
  await click("Check project receipt");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Project saved"),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1]![0]).toContain(
    `/create-receipts/${(body as { idempotencyKey: string }).idempotencyKey}?`,
  );
  expect(get.mock.calls[1]![1]).toMatchObject({ cache: "no-store" });
  expect(document.querySelector("img")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Project saved");
  expect(
    document.querySelector<HTMLAnchorElement>(
      'a[href$="/projects/' + project.id + '"]',
    ),
  ).toBeTruthy();
});
it("keeps a missing or erased receipt unconfirmed and never repeats its POST", async () => {
  const post = vi.spyOn(api, "post").mockRejectedValue(new Error("lost"));
  const get = vi
    .spyOn(api, "get")
    .mockRejectedValue(new Error("receipt not found"));
  await mount();
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this project",
    ),
  );
  await click("Check project receipt");
  await click("Check project receipt");
  expect(post).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(document.body.textContent).not.toContain("Project saved");
  expect(
    document.querySelector<HTMLAnchorElement>('a[href$="/projects"]'),
  ).toBeTruthy();
});
it("hides a confirmed project during auth recheck and requires a new Native read", async () => {
  vi.spyOn(api, "post").mockResolvedValue(project);
  const get = vi.spyOn(api, "get").mockResolvedValue(project);
  await mount();
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Project saved"),
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
  await vi.waitFor(() =>
    expect(document.body.textContent).not.toContain(project.name),
  );
  expect(
    document.querySelector('a[href$="/projects/' + project.id + '"]'),
  ).toBeNull();
  get.mockRejectedValue(new Error("access revoked"));
  await act(async () => {
    finish({});
    await pending;
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this project",
    ),
  );
  expect(document.body.textContent).not.toContain(project.name);
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
    project.name,
  );
});

it("restores only a per-tab Native receipt locator after remount and performs no second create", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockRejectedValue(new Error("lost acknowledgement"));
  const get = vi
    .spyOn(api, "get")
    .mockRejectedValue(new Error("temporarily unavailable"));
  await mount();
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "We have not confirmed this project",
    ),
  );
  const stored = window.sessionStorage.getItem(PENDING_PROJECT_RECEIPTS_KEY)!;
  expect(stored).not.toContain(project.name);
  expect(stored).not.toContain("description");
  const nonce = (post.mock.calls[0]![1] as { idempotencyKey: string })
    .idempotencyKey;
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  get.mockResolvedValue(project);
  await mount();
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Project saved"),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.at(-1)![0]).toContain(`/create-receipts/${nonce}?`);
  expect(window.sessionStorage.getItem(PENDING_PROJECT_RECEIPTS_KEY)).toBeNull();
});
it("refuses creation when recovery data is corrupt or storage cannot retain the nonce", async () => {
  const post = vi.spyOn(api, "post");
  window.sessionStorage.setItem(
    PENDING_PROJECT_RECEIPTS_KEY,
    "corrupt-private-state",
  );
  await mount();
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(
      "could not restore project recovery information",
    ),
  );
  expect(document.querySelector("form")).toBeNull();
  expect(post).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  window.sessionStorage.removeItem(PENDING_PROJECT_RECEIPTS_KEY);
  await mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("PRIVATE-STORAGE-CANARY");
  });
  await click("Create project");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Your project has not been sent"),
  );
  expect(post).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("PRIVATE-STORAGE-CANARY");
});
it("keeps another account's pending locator out of the draft", async () => {
  retainPendingProjectReceipt(
    state.company,
    "another-owner",
    "10000000-0000-4000-8000-000000000099",
  );
  const get = vi.spyOn(api, "get"),
    post = vi.spyOn(api, "post");
  await mount();
  expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(
    project.name,
  );
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
