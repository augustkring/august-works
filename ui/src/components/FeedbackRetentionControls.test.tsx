// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackRetentionControls } from "./FeedbackRetentionControls";
import { api, ApiError } from "../api/client";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import type { FeedbackRetentionView } from "@paperclipai/shared";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "10000000-0000-4000-8000-000000000001", feedbackId = "20000000-0000-4000-8000-000000000001";
const ready: FeedbackRetentionView = { companyId, feedbackId, version: 1, legalHold: { active: true, releaseAt: null,
  reason: "Private original hold reason" }, extensionUntil: null, extensionReason: "", updatedAt: "2026-10-11T00:00:00Z" };
let client: QueryClient, root: Root, container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
async function mount() {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("operator"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}>
    <FeedbackRetentionControls companyId={companyId} feedbackId={feedbackId} principal="operator" />
  </QueryClientProvider>));
  await vi.waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
}
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!; }
async function review() { await act(async () => button("Review retention change").click()); }
it("requires an explicit C3 review and sends one immutable command even on a double click", async () => {
  vi.spyOn(api, "get").mockResolvedValue(ready); let finish!: (value: FeedbackRetentionView) => void;
  const post = vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await review(); expect(post).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Private original hold reason");
  await act(async () => { button("Confirm retention change").click(); button("Confirm retention change").click(); });
  expect(post).toHaveBeenCalledTimes(1); const command = post.mock.calls[0]![1] as { expectedVersion: number; confirmRetentionChange: boolean; legalHold: object };
  expect(command).toMatchObject({ expectedVersion: 1, confirmRetentionChange: true });
  expect(Object.isFrozen(command)).toBe(true); expect(Object.isFrozen(command.legalHold)).toBe(true);
  await act(async () => finish({ ...ready, version: 2 }));
});
it("retains the exact unknown command for explicit retry, without exposing raw errors", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(ready);
  const post = vi.spyOn(api, "post").mockRejectedValueOnce(Error("PRIVATE raw error")).mockResolvedValue({ ...ready, version: 2 });
  await mount(); await review(); await act(async () => button("Confirm retention change").click());
  await vi.waitFor(() => expect(button("Review the same request again")).toBeDefined());
  expect(container.textContent).not.toContain("PRIVATE raw error"); expect(container.querySelector("fieldset")?.disabled).toBe(true);
  const original = post.mock.calls[0]![1]; get.mockResolvedValue({ ...ready, version: 2 });
  await act(async () => button("Review the same request again").click());
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => button("Confirm retention change").click());
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2)); expect(post.mock.calls[1]![1]).toBe(original);
});
it("hides private controls and closes review during an original owner read, retaining no failed cached reason", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(ready); const post = vi.spyOn(api, "post");
  await mount(); await review(); let fail!: (error: Error) => void;
  get.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  let refetch!: Promise<void>;
  await act(async () => { refetch = client.invalidateQueries({ queryKey: ["feedback-retention"] }); });
  expect(container.querySelector("textarea")).toBeNull(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await act(async () => { fail(new ApiError("Forbidden", 403, { error: "Forbidden" })); await refetch; });
  expect(container.textContent).not.toContain(ready.legalHold.reason); expect(post).not.toHaveBeenCalled();
});
it("blocks same-turn writes during account recheck and requires new review after the session changes", async () => {
  vi.spyOn(api, "get").mockResolvedValue(ready); const post = vi.spyOn(api, "post");
  await mount(); await review(); let finish!: (value: ReturnType<typeof v9SessionFixture>) => void;
  vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let checking!: Promise<unknown>; const oldConfirm = button("Confirm retention change");
  await act(async () => { checking = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 }); oldConfirm.click(); });
  expect(post).not.toHaveBeenCalled(); expect(container.querySelector("textarea")).toBeNull();
  const next = v9SessionFixture("operator"); next.session.id = "new-session-original-operator";
  await act(async () => { finish(next); await checking; });
  await vi.waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(post).not.toHaveBeenCalled();
});

it("requires fresh C3 review after the original native controls version changes", async () => {
  vi.spyOn(api, "get").mockResolvedValue(ready); const post = vi.spyOn(api, "post");
  await mount(); await review();
  const key = client.getQueryCache().findAll({ queryKey: ["feedback-retention"] })[0]!.queryKey;
  await act(async () => client.setQueryData(key, { ...ready, version: 2, legalHold: { ...ready.legalHold, reason: "Current changed native reason" } }));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(post).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Current changed native reason");
  await review(); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Current changed native reason");
  expect(post).not.toHaveBeenCalled();
});
