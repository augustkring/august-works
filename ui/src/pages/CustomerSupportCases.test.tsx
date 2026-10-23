// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, type Location } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { CustomerSupportCases } from "./CustomerSupportCases";
import { i18n } from "../i18n";

const state = vi.hoisted(() => ({
  companyId: "00000000-0000-4000-8000-000000000001",
  userId: "support-user",
  sessionId: "00000000-0000-4000-8000-000000000002",
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId, selectedCompany: { issuePrefix: "BLT" } }) }));
let live: ((event: { companyId: string; type: string; payload: Record<string, unknown> }) => void) | undefined;
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (listener: typeof live) => { live = listener; } }));
vi.mock("../hooks/useV9CurrentAccount", () => ({
  useV9CurrentAccount: () => ({ userId: state.userId, localImplicit: false, settled: true, failed: false, sessionId: state.sessionId, authorityEpoch: 0 }),
  hasCurrentV9Session: (_client: unknown, principal: string, sessionId: string | null) => principal === state.userId && sessionId === state.sessionId,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const policy = { available: true, revision: "a".repeat(64), recipientName: "Configured support", privacyNoticeUrl: "https://example.test/privacy", retentionDays: 30, retentionTrigger: "after_last_customer_or_support_message" };
const list = { companyId: state.companyId, entries: [], nextCursor: null };
const waitingCase = {
  id: "00000000-0000-4000-8000-000000000005",
  companyId: state.companyId,
  reference: "BLS-ABCDEF0123456789ABCDEF0123456789",
  openedByUserId: state.userId,
  category: "other",
  subject: "Waiting on you",
  impact: null,
  status: "WAITING_FOR_YOU",
  requestedResponse: "Please confirm whether the connection works now.",
  createdAt: "2026-10-23T10:00:00Z",
  updatedAt: "2026-10-23T10:05:00Z",
  resolvedAt: null,
  closedAt: null,
  delivery: "pending",
};
const waitingDetail = {
  ...waitingCase,
  description: "Private support description",
  safeContext: null,
  followUpOfId: null,
  timeline: [{
    id: "00000000-0000-4000-8000-000000000006", kind: "request", body: "Private support description",
    status: "WAITING_FOR_YOU", author: "customer", safeContext: null, delivery: "pending", createdAt: "2026-10-23T10:00:00Z",
  }],
  nextCursor: null,
};
const receipt = {
  id: "00000000-0000-4000-8000-000000000003",
  companyId: state.companyId,
  reference: "BLS-0123456789ABCDEF0123456789ABCDEF",
  openedByUserId: state.userId,
  category: "other",
  subject: "Help with a task",
  impact: null,
  status: "RECEIVED",
  requestedResponse: null,
  createdAt: "2026-10-23T10:00:00Z",
  updatedAt: "2026-10-23T10:00:00Z",
  resolvedAt: null,
  closedAt: null,
  delivery: "pending",
  description: "Help with a task",
  safeContext: null,
  followUpOfId: null,
  timeline: [{
    id: "00000000-0000-4000-8000-000000000004", kind: "request", body: "Help with a task",
    status: "RECEIVED", author: "customer", safeContext: null, delivery: "pending", createdAt: "2026-10-23T10:00:00Z",
  }],
  nextCursor: null,
};

let lastLocation: Location | null = null;
function ObserveSupportLocation() { lastLocation = useLocation(); return null; }
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
  state.companyId = "00000000-0000-4000-8000-000000000001";
  state.userId = "support-user";
  state.sessionId = "00000000-0000-4000-8000-000000000002";
  await act(async () => { await i18n.changeLanguage("en"); });
});

async function flush() {
  await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount(initialEntry: string | { pathname: string; state?: unknown; search?: string } = "/company/support") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: state.userId }, session: { id: state.sessionId, userId: state.userId } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initialEntry]}><ObserveSupportLocation /><CustomerSupportCases /></MemoryRouter></QueryClientProvider>));
  await flush();
}
async function rerender() {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/company/support"]}><ObserveSupportLocation /><CustomerSupportCases /></MemoryRouter></QueryClientProvider>));
  await flush();
}

it("retains a rejected draft and waits for the new disclosure and an explicit send", async () => {
  let policyReads = 0, releasePolicy!: (value: unknown) => void;
  const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return ++policyReads === 1 ? policy as never
      : new Promise(resolve => { releasePolicy = resolve; });
    if (path.includes("/cases?")) return list as never;
    throw new Error("A rejected policy command has no uncertain receipt to recover");
  });
  const post = vi.spyOn(api, "post").mockRejectedValueOnce(new ApiError("Policy changed", 409, { details: { code: "SUPPORT_POLICY_CHANGED" } }))
    .mockResolvedValueOnce(receipt as never);
  await mount({ pathname: "/company/support", state: {
    companyId: state.companyId, expectedUserId: state.userId, backgroundKey: "actual-work-route",
  } });
  await vi.waitFor(() => expect(container.querySelector("form")).not.toBeNull());
  await act(async () => setField("form textarea", "Keep this support draft"));
  await clickSubmit();
  await vi.waitFor(() => expect(policyReads).toBe(2));
  expect(container.textContent).toContain("Your message was not sent.");
  expect(container.querySelector<HTMLTextAreaElement>("form textarea")?.value).toBe("Keep this support draft");
  expect(container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(true);
  expect(lastLocation!.state).toMatchObject({ backgroundKey: "actual-work-route" });
  expect(lastLocation!.state).not.toHaveProperty("supportRequest");
  const changedPolicy = { ...policy, revision: "b".repeat(64), recipientName: "New disclosed support" };
  await act(async () => releasePolicy(changedPolicy));
  await vi.waitFor(() => expect(container.textContent).toContain("New disclosed support"));
  expect(post).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.some(([path]) => path.includes("/cases/requests/"))).toBe(false);
  await clickSubmit();
  expect(post.mock.calls[0]![1]).toMatchObject({ expectedPolicyRevision: policy.revision });
  expect(post.mock.calls[1]![1]).toMatchObject({ expectedPolicyRevision: changedPolicy.revision, description: "Keep this support draft" });
  expect((post.mock.calls[1]![1] as { idempotencyKey: string }).idempotencyKey)
    .not.toBe((post.mock.calls[0]![1] as { idempotencyKey: string }).idempotencyKey);
});

it("keeps an unsent reply when the existing case policy can no longer accept it", async () => {
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes(`/cases/${waitingCase.id}?`)) return waitingDetail as never;
    if (path.includes("/cases?")) return list as never;
    throw new Error("A rejected policy command has no uncertain receipt to recover");
  });
  const post = vi.spyOn(api, "post").mockRejectedValue(new ApiError("Case policy changed", 409, { details: { code: "SUPPORT_CASE_POLICY_CHANGED" } }));
  await mount(`/company/support?case=${waitingCase.id}`);
  await vi.waitFor(() => expect(container.querySelector("article")).not.toBeNull());
  await act(async () => setField('textarea[aria-label="Add a reply"]', "Unsent case reply"));
  const send = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Send reply")!;
  await vi.waitFor(() => expect(send.disabled).toBe(false));
  await act(async () => send.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Contact support directly before adding information."));
  expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Add a reply"]')?.value).toBe("Unsent case reply");
  expect(post).toHaveBeenCalledTimes(1);
  expect(lastLocation!.state).not.toHaveProperty("supportRequest");
});
async function clickSubmit() {
  const button = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
  expect(button).not.toBeNull();
  expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
  await flush();
}
function setField(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

it("keeps the draft through a language change and retries an uncertain submission with the same key and unanswered impact", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases/requests/")) throw new ApiError("not found", 404, null);
    if (path.includes("/cases?")) return list as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockRejectedValueOnce(new Error("transport unavailable"))
    .mockResolvedValueOnce(receipt as never);
  await mount();
  await vi.waitFor(() => expect(container.querySelector("form")).not.toBeNull());

  const description = container.querySelector<HTMLTextAreaElement>("form textarea")!;
  expect(description.required).toBe(true);
  expect(container.querySelectorAll("form [required]")).toHaveLength(1);
  expect(container.querySelector<HTMLSelectElement>("[aria-label='How has this affected you? (optional)']")?.value).toBe("");

  await act(async () => setField("form textarea", "Help with a task"));
  await act(async () => { await i18n.changeLanguage("da"); });
  await flush();
  expect(container.querySelector<HTMLTextAreaElement>("form textarea")?.value).toBe("Help with a task");

  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]?.[1]).toMatchObject({ description: "Help with a task", category: "other", impact: null });
  await vi.waitFor(() => expect(container.textContent).toContain("Resultatet er ikke bekræftet"));

  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
  await vi.waitFor(() => expect(container.textContent).toContain("BLS-0123456789ABCDEF0123456789ABCDEF"));
  expect(container.textContent).toContain("Modtaget; afventer levering");
  expect(get).toHaveBeenCalledWith(expect.stringContaining("/cases/requests/"), { cache: "no-store" });
});

it("shows the customer action on a waiting case, keeps its last confirmed detail on refresh failure, and clears it after access denial", async () => {
  const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return { companyId: state.companyId, entries: [waitingCase], nextCursor: null } as never;
    if (path.includes(`/cases/${waitingCase.id}?`)) return waitingDetail as never;
    throw new Error("Unexpected support request");
  });
  await mount();
  await vi.waitFor(() => expect(container.textContent).toContain("Waiting on you"));
  const viewButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "View case");
  expect(viewButton).toBeTruthy();
  await act(async () => viewButton!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Private support description"));
  expect(container.textContent).toContain("Please confirm whether the connection works now.");

  get.mockImplementation(async (path) => {
    if (path.includes(`/cases/${waitingCase.id}?`)) throw new ApiError("internal detail error", 503, null);
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return { companyId: state.companyId, entries: [waitingCase], nextCursor: null } as never;
    throw new Error("Unexpected support request");
  });
  await act(async () => client.invalidateQueries({ predicate: (query) => query.queryKey.includes(waitingCase.id) }));
  await vi.waitFor(() => expect(container.textContent).toContain("The latest case updates could not be loaded"));
  expect(container.textContent).toContain("Private support description");

  get.mockImplementation(async (path) => {
    if (path.includes(`/cases/${waitingCase.id}?`)) throw new ApiError("access denied", 403, null);
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return { companyId: state.companyId, entries: [waitingCase], nextCursor: null } as never;
    throw new Error("Unexpected support request");
  });
  await act(async () => client.invalidateQueries({ predicate: (query) => query.queryKey.includes(waitingCase.id) }));
  await vi.waitFor(() => expect(container.textContent).not.toContain("Private support description"));
  expect(container.textContent).toContain("Your account or access changed");
});

it.each(["account", "session"])("ignores a late create acknowledgement after the %s changes", async change => {
  let resolveCreate!: (value: unknown) => void;
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return list as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
  await mount();
  await vi.waitFor(() => expect(container.querySelector("form")).not.toBeNull());
  await act(async () => setField("form textarea", "Old account draft"));
  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

  if (change === "account") state.userId = "new-support-user";
  state.sessionId = "00000000-0000-4000-8000-000000000007";
  client.setQueryData(queryKeys.auth.session, { user: { id: state.userId }, session: { id: state.sessionId, userId: state.userId } });
  await rerender();
  await vi.waitFor(() => expect(container.querySelector("form")).not.toBeNull());
  await act(async () => resolveCreate({ ...receipt, openedByUserId: "support-user" }));
  await flush();

  expect(container.textContent).not.toContain(receipt.reference);
  expect(container.querySelector<HTMLTextAreaElement>("form textarea")?.value).toBe("");
  expect(client.getQueryCache().findAll({ predicate: (query) => query.queryKey.includes(receipt.id) })).toHaveLength(0);
});


it("opens an authorized case link and hides its private content before access revalidation completes", async () => {
  let hold = false, finish!: (value: unknown) => void;
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return list as never;
    if (path.includes(`/cases/${waitingCase.id}?`)) return hold ? new Promise(resolve => { finish = resolve; }) : waitingDetail as never;
    throw new Error("Unexpected support request");
  });
  await mount(`/company/support?case=${waitingCase.id}`);
  await vi.waitFor(() => expect(container.textContent).toContain("Private support description"));
  hold = true;
  await act(async () => live?.({ companyId: state.companyId, type: "activity.logged", payload: { action: "membership.updated" } }));
  expect(container.textContent).not.toContain("Private support description");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => finish(waitingDetail));
  await vi.waitFor(() => expect(container.textContent).toContain("Private support description"));
});

it("previews only bound safe context and removes it before sending", async () => {
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return list as never;
    if (path.includes(`/cases/${receipt.id}?`)) return receipt as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockResolvedValue(receipt as never);
  const operationId = "00000000-0000-4000-8000-000000000008";
  await mount({ pathname: "/company/support", state: { companyId: state.companyId, expectedUserId: state.userId,
    safeContext: { surface: "work", operationId, errorCode: "REQUEST_TIMEOUT" } } });
  await vi.waitFor(() => expect(container.textContent).toContain(operationId));
  const remove = [...container.querySelectorAll("button")].find(button => button.textContent === "Remove context");
  expect(remove).toBeTruthy();
  await act(async () => remove!.click());
  expect(container.textContent).not.toContain(operationId);
  await act(async () => setField("form textarea", "Help with a task"));
  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]![1]).not.toHaveProperty("safeContext");
});


it("preserves a cancelled draft and its company-bound return route without sending the route", async () => {
  vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases?")) return list as never;
    if (path.includes(`/cases/${receipt.id}?`)) return receipt as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockResolvedValue(receipt as never);
  await mount({ pathname: "/BLT/company/support", state: { companyId: state.companyId, expectedUserId: state.userId, returnPathname: "/BLT/issues/BLT-42" } });
  await vi.waitFor(() => expect(container.querySelector("form")).toBeTruthy());
  const back = () => [...container.querySelectorAll("a")].find(link => link.textContent === "Back to work");
  expect(back()?.getAttribute("href")).toBe("/BLT/issues/BLT-42");
  await act(async () => setField("form textarea", "Keep this support draft"));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Cancel")!.click());
  expect(container.querySelector("form")).toBeNull();
  expect(document.activeElement?.textContent).toBe("Resume support draft");
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Resume support draft")!.click());
  expect(document.activeElement).toBe(container.querySelector("form textarea"));
  expect(container.querySelector<HTMLTextAreaElement>("form textarea")?.value).toBe("Keep this support draft");
  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]![1]).not.toHaveProperty("returnPathname");
  await vi.waitFor(() => expect(container.textContent).toContain(receipt.reference));
  expect(back()?.getAttribute("href")).toBe("/BLT/issues/BLT-42");
});

it.each(["/OTHER/issues/OTHER-1", "//example.test/BLT/work", "//[", "/BLT/../OTHER/work"])("rejects an unsafe or foreign return route: %s", async returnPathname => {
  vi.spyOn(api, "get").mockImplementation(async path => path.includes("/policy?") ? policy as never : list as never);
  await mount({ pathname: "/BLT/company/support", state: { companyId: state.companyId, expectedUserId: state.userId, returnPathname } });
  await vi.waitFor(() => expect(container.querySelector("form")).toBeTruthy());
  expect([...container.querySelectorAll("a")].find(link => link.textContent === "Back to work")?.getAttribute("href")).toBe("/BLT/work");
});

it("retries a closure with the same command key and preserves an unsent reply", async () => {
  let closed = false;
  const closedDetail = { ...waitingDetail, status: "CLOSED", requestedResponse: null, closedAt: "2026-10-23T11:00:00Z" };
  vi.spyOn(api, "get").mockImplementation(async path => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases/requests/")) throw new ApiError("Not found", 404, null);
    if (path.includes(`/cases/${waitingCase.id}?`)) return (closed ? closedDetail : waitingDetail) as never;
    if (path.includes("/cases?")) return { ...list, entries: [closed ? closedDetail : waitingCase] } as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockImplementationOnce(async () => { closed = true; return closedDetail as never; });
  await mount({ pathname: "/company/support", search: `?case=${waitingCase.id}` });
  await vi.waitFor(() => expect(container.querySelector("article textarea")).toBeTruthy());
  await act(async () => setField("article textarea", "Keep my unsent reply"));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Close case")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Retry closing case"));
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Retry closing case")!.click());
  await vi.waitFor(() => expect(container.textContent).toContain("Case closed. Your history remains available."));
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
  expect(post.mock.calls[0]![0]).toContain(`/cases/${waitingCase.id}/close`);
  expect(Object.keys(post.mock.calls[0]![1] as object).sort()).toEqual(["expectedUserId", "idempotencyKey"]);
  expect(container.querySelector<HTMLTextAreaElement>("article textarea")?.value).toBe("Keep my unsent reply");
});


it("recovers a receipt after remount without saving text in history or resending", async () => {
  const privateText = "A private description that must stay out of browser history state.";
  const saved = { ...receipt, subject: privateText, description: privateText,
    timeline: [{ ...receipt.timeline[0], body: privateText }] };
  let committed = false, finish: ((value: unknown) => void) | undefined;
  vi.spyOn(api, "get").mockImplementation(async path => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases/requests/")) {
      if (committed) return saved as never;
      throw new ApiError("Not found", 404, null);
    }
    if (path.includes(`/cases/${saved.id}?`)) return saved as never;
    if (path.includes("/cases?")) return list as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount({ pathname: "/company/support", state: { companyId: state.companyId, expectedUserId: state.userId,
    returnPathname: "/BLT/work", unrelatedDraft: "Unrelated secret text" } });
  await vi.waitFor(() => expect(container.querySelector("form")).toBeTruthy());
  await act(async () => setField("form textarea", privateText));
  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const restoredState = JSON.parse(JSON.stringify(lastLocation!.state));
  expect(restoredState.supportRequest).toEqual({ kind: "create", key: (post.mock.calls[0]![1] as { idempotencyKey: string }).idempotencyKey });
  expect(JSON.stringify(restoredState)).not.toContain(privateText);
  expect(JSON.stringify(restoredState)).not.toContain("Unrelated secret text");
  expect(restoredState.supportRequest).not.toHaveProperty("payload");
  await act(async () => root.unmount());
  client.clear(); container.remove();
  committed = true;
  await mount({ pathname: "/company/support", state: restoredState });
  await vi.waitFor(() => expect(container.textContent).toContain("Your previous submission has a saved receipt."));
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => finish?.(saved));
  expect(post).toHaveBeenCalledTimes(1);
  const view = [...container.querySelectorAll("button")].find(button => button.textContent?.includes(saved.reference));
  expect(view).toBeTruthy();
  await act(async () => view!.click());
  await vi.waitFor(() => expect(container.querySelector("article")?.textContent).toContain(privateText));
  expect(lastLocation!.state).not.toHaveProperty("supportRequest");
});

it("reuses the recovered key when an unconfirmed create must be entered again", async () => {
  const key = "00000000-0000-4000-8000-000000000009";
  vi.spyOn(api, "get").mockImplementation(async path => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases/requests/")) throw new ApiError("Not found", 404, null);
    if (path.includes(`/cases/${receipt.id}?`)) return receipt as never;
    if (path.includes("/cases?")) return list as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockResolvedValue(receipt as never);
  await mount({ pathname: "/company/support", state: { companyId: state.companyId, expectedUserId: state.userId,
    supportRequest: { key, kind: "create" } } });
  await vi.waitFor(() => expect(container.textContent).toContain("The previous result is not confirmed."));
  expect(post).not.toHaveBeenCalled();
  await act(async () => setField("form textarea", "Help with a task"));
  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]![1]).toMatchObject({ idempotencyKey: key, expectedUserId: state.userId });
  await vi.waitFor(() => expect(lastLocation!.state).not.toHaveProperty("supportRequest"));
});

it.each(["principal", "company"])("ignores a recovered command for another %s", async scope => {
  const key = "00000000-0000-4000-8000-000000000009";
  const get = vi.spyOn(api, "get").mockImplementation(async path => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes(`/cases/${receipt.id}?`)) return receipt as never;
    if (path.includes("/cases?")) return list as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockResolvedValue(receipt as never);
  await mount({ pathname: "/company/support", state: {
    companyId: scope === "company" ? "00000000-0000-4000-8000-000000000099" : state.companyId,
    expectedUserId: scope === "principal" ? "another-support-user" : state.userId, supportRequest: { key, kind: "create" },
  } });
  await vi.waitFor(() => expect(container.querySelector("form")).toBeTruthy());
  expect(get.mock.calls.some(([path]) => path.includes("/cases/requests/"))).toBe(false);
  expect(post).not.toHaveBeenCalled();
  await act(async () => setField("form textarea", "Help with a task"));
  await clickSubmit();
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect((post.mock.calls[0]![1] as { idempotencyKey: string }).idempotencyKey).not.toBe(key);
});

it.each(["reply", "close"] as const)("recovers a %s only against its original case, including an already closed case", async kind => {
  const key = "00000000-0000-4000-8000-000000000009";
  const original = kind === "close" ? { ...waitingDetail, status: "CLOSED", requestedResponse: null, closedAt: "2026-10-23T11:00:00Z" } : waitingDetail;
  const get = vi.spyOn(api, "get").mockImplementation(async path => {
    if (path.includes("/policy?")) return policy as never;
    if (path.includes("/cases/requests/")) throw new ApiError("Not found", 404, null);
    if (path.includes(`/cases/${receipt.id}?`)) return receipt as never;
    if (path.includes(`/cases/${original.id}?`)) return original as never;
    if (path.includes("/cases?")) return { ...list, entries: [receipt, original] } as never;
    throw new Error("Unexpected support request");
  });
  const post = vi.spyOn(api, "post").mockResolvedValue(original as never);
  await mount({ pathname: "/company/support", search: `?case=${receipt.id}`, state: {
    companyId: state.companyId, expectedUserId: state.userId, supportRequest: { key, kind, caseId: original.id },
  } });
  await vi.waitFor(() => expect(container.querySelector("article")?.textContent).toContain(receipt.description));
  await vi.waitFor(() => expect(container.textContent).toContain("The previous result is not confirmed."));
  await act(async () => setField('textarea[aria-label="Add a reply"]', "Other case reply must not be sent"));
  const button = (text: string) => [...container.querySelectorAll("button")].find(entry => entry.textContent?.trim() === text);
  expect(button("Send reply")?.disabled).toBe(true);
  expect(button("Close case")?.disabled).toBe(true);
  expect(post).not.toHaveBeenCalled();
  await act(async () => button("Return to the previous request")!.click());
  await vi.waitFor(() => expect(container.querySelector("article")?.textContent).toContain(original.description));
  if (kind === "reply") await act(async () => setField('textarea[aria-label="Add a reply"]', "Recovered original reply"));
  const label = kind === "close" ? "Retry closing case" : "Retry the same reply";
  await vi.waitFor(() => expect(button(label)?.disabled).toBe(false));
  await act(async () => button(label)!.click());
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]![0]).toContain(`/cases/${original.id}/${kind === "close" ? "close" : "replies"}`);
  expect(post.mock.calls[0]![1]).toEqual({ expectedUserId: state.userId, idempotencyKey: key,
    ...(kind === "reply" ? { body: "Recovered original reply", expectedPolicyRevision: policy.revision } : {}) });
  await vi.waitFor(() => expect(lastLocation!.state).not.toHaveProperty("supportRequest"));
  expect(get.mock.calls.some(([path]) => path.includes(`/cases/requests/${key}`))).toBe(true);
});
