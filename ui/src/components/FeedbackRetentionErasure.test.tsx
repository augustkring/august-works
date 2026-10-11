// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackRetentionErasure } from "./FeedbackRetentionErasure";
import { api, ApiError } from "../api/client";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import type { FeedbackRetentionErasureReview, FeedbackRetentionErasureReceipt } from "@paperclipai/shared";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "10000000-0000-4000-8000-000000000001", feedbackId = "20000000-0000-4000-8000-000000000001";
const review: FeedbackRetentionErasureReview = { companyId, feedbackId, reviewHash: "a".repeat(64), caseVersion: 4, retentionVersion: 2,
  configuration: { closedFeedbackDays: 90, imageDays: 30, openFeedbackMonths: 12 }, held: false,
  caseDueAt: "2026-10-01T00:00:00Z", caseEligible: true, caseCanErase: true, images: [] };
const pending: FeedbackRetentionErasureReceipt = { companyId, feedbackId, id: "30000000-0000-4000-8000-000000000001",
  target: { kind: "case" }, status: "pending", requestedAt: "2026-10-11T00:00:00Z", completedAt: null };
let client: QueryClient, root: Root, container: HTMLDivElement;
const requested = vi.fn();
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove(); vi.restoreAllMocks();
  requested.mockClear(); await i18n.changeLanguage("en"); });
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!; }
async function click(text: string) { const target = button(text); expect(target).toBeDefined(); await act(async () => target.click()); }
async function mount() {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("operator"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><FeedbackRetentionErasure
    companyId={companyId} feedbackId={feedbackId} principal="operator" onCaseRequested={requested} /></QueryClientProvider>));
  await vi.waitFor(() => expect(button("Erase expired case")).toBeDefined());
}
function reads(value = review, receipt = pending) {
  return vi.spyOn(api, "get").mockImplementation(async path => String(path).includes("/requests/") ? receipt : value);
}
it("shows actual configured expiry without erasing, and disables ineligible content", async () => {
  reads({ ...review, configuration: { closedFeedbackDays: 120, imageDays: 45, openFeedbackMonths: 18 }, caseCanErase: false });
  const post = vi.spyOn(api, "post"); await mount();
  expect(container.textContent).toContain("120"); expect(container.textContent).toContain("45"); expect(container.textContent).toContain("18");
  expect(button("Erase expired case").disabled).toBe(true); expect(post).not.toHaveBeenCalled();
});
it("requires separate C3 confirmation and submits one immutable request under a double click", async () => {
  reads(); let finish!: (value: FeedbackRetentionErasureReceipt) => void;
  const post = vi.spyOn(api, "post").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await click("Erase expired case"); expect(post).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("text and replies");
  expect(document.querySelector('[data-slot="alert-dialog-cancel"]')?.textContent).toBe("Cancel");
  expect(document.activeElement).toBe(document.querySelector('[data-slot="alert-dialog-cancel"]'));
  const confirm = button("Confirm erasure"); await act(async () => { confirm.click(); confirm.click(); });
  expect(post).toHaveBeenCalledTimes(1); const input = post.mock.calls[0]![1];
  expect(requested).toHaveBeenCalled(); // Hide case text before the acknowledgement.
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(input).toMatchObject({ confirmErasure: true, expectedReviewHash: review.reviewHash, target: { kind: "case" } });
  expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen((input as { target: object }).target)).toBe(true);
  await act(async () => finish(pending));
  expect(requested).toHaveBeenCalled();
});
it("uses read-only status after an unknown acknowledgement and only resumes the same key after C3 confirmation", async () => {
  const get = reads(); const post = vi.spyOn(api, "post").mockRejectedValueOnce(Error("PRIVATE-ERASURE-ERROR")).mockResolvedValue(pending);
  await mount(); await click("Erase expired case"); await click("Confirm erasure");
  await vi.waitFor(() => expect(button("Review the same erasure again")?.disabled).toBe(false));
  expect(post).toHaveBeenCalledTimes(1); const original = post.mock.calls[0]![1] as { requestKey: string };
  expect(get.mock.calls.some(([path]) => String(path).includes(`/requests/${original.requestKey}?expectedUserId=operator`))).toBe(true);
  expect(container.textContent).not.toContain("PRIVATE-ERASURE-ERROR");
  await click("Check erasure status"); expect(post).toHaveBeenCalledTimes(1);
  await click("Review the same erasure again"); expect(post).toHaveBeenCalledTimes(1);
  await click("Confirm erasure"); await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1]![1]).toBe(original);
});
it("closes a stale review immediately when the native source hash changes", async () => {
  reads(); const post = vi.spyOn(api, "post"); await mount(); await click("Erase expired case");
  const confirm = button("Confirm erasure"), key = client.getQueryCache().findAll({ queryKey: ["feedback-erasure-review"] })[0]!.queryKey;
  await act(async () => { client.setQueryData(key, { ...review, reviewHash: "b".repeat(64), held: true, caseCanErase: false }); confirm.click(); });
  expect(post).not.toHaveBeenCalled(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it("fences same-turn confirmation during actual session recheck and requires a new review afterward", async () => {
  reads(); const post = vi.spyOn(api, "post"); await mount(); await click("Erase expired case");
  let finish!: (value: ReturnType<typeof v9SessionFixture>) => void;
  vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let checking!: Promise<unknown>; const confirm = button("Confirm erasure");
  await act(async () => { checking = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 }); confirm.click(); });
  expect(post).not.toHaveBeenCalled(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(container.textContent).not.toContain(review.caseDueAt);
  expect(container.querySelector('[aria-label="Erase expired feedback"]')).not.toBeNull();
  expect(container.textContent).toContain("Checking current retention controls");
  const next = v9SessionFixture("operator"); next.session.id = "new-original-session";
  await act(async () => { finish(next); await checking; });
  await vi.waitFor(() => expect(button("Erase expired case")).toBeDefined());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it("hides a cached completed receipt during recheck and does not expose it after original operator read refusal", async () => {
  const done = { ...pending, status: "completed" as const, completedAt: "2026-10-11T00:01:00Z" };
  const get = reads(review, done); const post = vi.spyOn(api, "post").mockResolvedValue(done);
  await mount(); await click("Erase expired case"); await click("Confirm erasure");
  await vi.waitFor(() => expect(container.textContent).toContain("Erasure confirmed"));
  let finish!: (value: ReturnType<typeof v9SessionFixture>) => void;
  vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let checking!: Promise<unknown>;
  await act(async () => { checking = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 }); });
  expect(container.textContent).not.toContain("Erasure confirmed"); get.mockRejectedValue(new ApiError("Forbidden", 403, { error: "Forbidden" }));
  expect(container.querySelector('[aria-label="Erase expired feedback"]')).not.toBeNull();
  await act(async () => { finish(v9SessionFixture("operator")); await checking; });
  await vi.waitFor(() => expect(button("Check erasure status")).toBeDefined());
  expect(container.textContent).not.toContain("Erasure confirmed"); expect(post).toHaveBeenCalledTimes(1);
});
