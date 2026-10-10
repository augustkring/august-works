// @vitest-environment jsdom
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { SaasNotifications } from "./SaasNotifications";
import { saasApi } from "../api/saas";
import { queryKeys } from "../lib/queryKeys";
import type { SaasNotification } from "@paperclipai/shared";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context = vi.hoisted(() => ({ identity: { settled: true, failed: false, localImplicit: false, userId: "owner", sessionId: "session-owner", authorityEpoch: 0 }, company: "company-one" }));
vi.mock("@/hooks/useV9CurrentAccount", async (importOriginal) => ({ ...await importOriginal<typeof import("../hooks/useV9CurrentAccount")>(), useV9CurrentAccount: () => context.identity }));
vi.mock("@/hooks/useSaasCapabilities", () => ({ useSaasCapabilities: () => ({ isSuccess: true, isFetching: false, data: { notifications: true } }) }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
const note: SaasNotification = { id: "notice-one", companyId: "company-one", category: "work_update", title: "Private account update", relativePath: "/COMP/issues", createdAt: "2026-10-10T00:00:00Z", readAt: null };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><SaasNotifications /></QueryClientProvider>));
}
async function mount() {
  await i18n.changeLanguage("en");
  context.identity = { settled: true, failed: false, localImplicit: false, userId: "owner", sessionId: "session-owner", authorityEpoch: 0 };
  context.company = "company-one";
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  client.setQueryData(["saas-capabilities"], { notifications: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks();
});

it("blocks a same-turn mark-read during account recheck and waits for a fresh list before redisclosure", async () => {
  const fresh = deferred<{ items: SaasNotification[]; nextCursor: null }>();
  const pages = vi.spyOn(saasApi, "notificationsPage").mockResolvedValueOnce({ items: [note], nextCursor: null }).mockReturnValueOnce(fresh.promise);
  const read = vi.spyOn(saasApi, "readNotification").mockResolvedValue(note);
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain(note.title));
  const account = deferred<unknown>();
  let recheck!: Promise<unknown>;
  await act(async () => {
    recheck = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => account.promise }).catch(() => undefined);
    host.querySelector<HTMLButtonElement>("button")!.click();
  });
  expect(read).not.toHaveBeenCalled();
  context.identity = { ...context.identity, settled: false, authorityEpoch: 1 }; await render();
  expect(host.textContent).not.toContain(note.title);
  await act(async () => { account.resolve(v9SessionFixture("owner")); await recheck; });
  context.identity = { ...context.identity, settled: true, authorityEpoch: 2 }; await render();
  await vi.waitFor(() => expect(pages).toHaveBeenCalledTimes(2));
  expect(host.textContent).not.toContain(note.title);
  await act(async () => fresh.resolve({ items: [note], nextCursor: null }));
  await vi.waitFor(() => expect(host.textContent).toContain(note.title));
  expect(read).not.toHaveBeenCalled();
  expect(pages.mock.calls.every(([, principal, , signal]) => principal === "owner" && signal instanceof AbortSignal)).toBe(true);
});

it("rejects a late old-account list while displaying only the new account's fresh source", async () => {
  const old = deferred<{ items: SaasNotification[]; nextCursor: null }>();
  const pages = vi.spyOn(saasApi, "notificationsPage").mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [{ ...note, id: "new-notice", title: "New account update" }], nextCursor: null });
  const read = vi.spyOn(saasApi, "readNotification");
  await mount();
  await vi.waitFor(() => expect(pages).toHaveBeenCalledTimes(1));
  context.identity = { ...context.identity, userId: "other-owner", sessionId: "session-other-owner" };
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner")); await render();
  await vi.waitFor(() => expect(host.textContent).toContain("New account update"));
  await act(async () => old.resolve({ items: [note], nextCursor: null }));
  expect(host.textContent).not.toContain(note.title);
  expect(pages.mock.calls[1]![1]).toBe("other-owner");
  expect(read).not.toHaveBeenCalled();
});

it("ignores a late mark-read acknowledgement across an account epoch without another mutation or retained refetch", async () => {
  const acknowledgement = deferred<SaasNotification>();
  const pages = vi.spyOn(saasApi, "notificationsPage").mockResolvedValue({ items: [note], nextCursor: null });
  const read = vi.spyOn(saasApi, "readNotification").mockReturnValue(acknowledgement.promise);
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain(note.title));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  context.identity = { ...context.identity, settled: false, authorityEpoch: 1 }; await render();
  await act(async () => acknowledgement.resolve({ ...note, readAt: "2026-10-10T00:01:00Z" }));
  expect(host.textContent).not.toContain(note.title);
  expect(pages).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
  context.identity = { ...context.identity, settled: true, authorityEpoch: 2 }; await render();
  await vi.waitFor(() => expect(pages).toHaveBeenCalledTimes(2));
  expect(read).toHaveBeenCalledTimes(1);
});

it("withdraws cached private updates after session failure and offers an original-session retry", async () => {
  const pages = vi.spyOn(saasApi, "notificationsPage").mockResolvedValue({ items: [note], nextCursor: null });
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain(note.title));
  const retry = vi.fn().mockRejectedValueOnce(new Error("Session read failed")).mockResolvedValue(v9SessionFixture("owner"));
  await act(async () => {
    await client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: retry }).catch(() => undefined);
  });
  retry.mockClear();
  context.identity = { ...context.identity, settled: false, failed: true, authorityEpoch: 1 }; await render();
  expect(host.textContent).not.toContain(note.title);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Updates could not be loaded");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(pages).toHaveBeenCalledTimes(1);
});

it("does not mark a retained notice read after the original session cache already changed account", async () => {
  vi.spyOn(saasApi, "notificationsPage").mockResolvedValue({ items: [note], nextCursor: null });
  const read = vi.spyOn(saasApi, "readNotification").mockResolvedValue(note);
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain(note.title));
  const button = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("different-current-account"));
    button.click();
  });
  expect(read).not.toHaveBeenCalled();
});
