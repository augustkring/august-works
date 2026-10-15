// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { hasCurrentV9Session, useV9CurrentAccount } from "./useV9CurrentAccount";
import { v9SessionFixture } from "./v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear(); container?.remove(); focusManager.setFocused(undefined); vi.restoreAllMocks();
});

it("requires the exact successful non-invalidated original session at a call boundary", async () => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  expect(hasCurrentV9Session(client, "owner", "session-owner")).toBe(false);
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  expect(hasCurrentV9Session(client, "owner", "session-owner")).toBe(true);
  expect(hasCurrentV9Session(client, "other-owner", "session-owner")).toBe(false);
  expect(hasCurrentV9Session(client, "owner", "different-session")).toBe(false);
  await client.invalidateQueries({ queryKey: queryKeys.auth.session, refetchType: "none" });
  expect(hasCurrentV9Session(client, "owner", "session-owner")).toBe(false);
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  const session = v9SessionFixture("owner");
  client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, userId: "different-owner" } });
  expect(hasCurrentV9Session(client, "owner", "session-owner")).toBe(false);
  client.setQueryData(queryKeys.auth.session, { user: { id: "owner" }, session: { id: "session-owner", userId: "owner" } });
  expect(hasCurrentV9Session(client, "owner", "session-owner")).toBe(false);
  client.setQueryData(queryKeys.auth.session, null);
  expect(hasCurrentV9Session(client, "owner", "session-owner")).toBe(false);
});

it("preserves explicit local-board compatibility only for a valid original local session", () => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("local-native-user", true));
  expect(hasCurrentV9Session(client, "local-board", "session-local-native-user")).toBe(false);
  expect(hasCurrentV9Session(client, "local-board", "session-local-native-user", true)).toBe(true);
  expect(hasCurrentV9Session(client, "local-native-user", "session-local-native-user", true)).toBe(false);
});

it("starts a new source epoch when the same account receives a different completed session", async () => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const session = v9SessionFixture("owner");
  client.setQueryData(queryKeys.auth.session, session);
  const get = vi.spyOn(authApi, "getSession").mockResolvedValue(session);
  function EpochProbe() {
    const account = useV9CurrentAccount();
    return <p data-epoch={account.authorityEpoch}>{account.userId}</p>;
  }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><EpochProbe /></QueryClientProvider>));
  const prior = Number(container.querySelector("p")!.dataset.epoch);
  await act(async () => client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "new-session-for-owner" } }));
  await vi.waitFor(() => expect(Number(container.querySelector("p")!.dataset.epoch)).toBeGreaterThan(prior));
  expect(container.textContent).toBe("owner");
  expect(get).not.toHaveBeenCalled();
});
function PrivateProbe() {
  const account = useV9CurrentAccount();
  return account.settled ? <p>PRIVATE owner {account.userId}</p> : <p role="status">Checking current account</p>;
}
function Host() {
  const [nested, setNested] = useState(false);
  return <><PrivateProbe /><button onClick={() => setNested(true)}>Mount another observer</button>{nested && <PrivateProbe />}</>;
}
it("rechecks on return within the ordinary freshness window without starting reads for nested observers", async () => {
  type Session = NonNullable<Awaited<ReturnType<typeof authApi.getSession>>>;
  const session: Session = { user: { id: "owner", email: "owner@example.test", name: "Owner", image: null },
    session: { id: "session-owner", userId: "owner", localImplicit: false }, sentryDsn: null };
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  client.setQueryData(queryKeys.auth.session, session);
  let release!: (value: typeof session) => void;
  const get = vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise<Session>((resolve) => { release = resolve; }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>));
  expect(container.textContent).toContain("PRIVATE owner owner"); expect(get).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelectorAll("p")).toHaveLength(2); expect(get).not.toHaveBeenCalled();
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
  await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(container.textContent).not.toContain("PRIVATE"));
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
  await act(async () => release(session));
  await vi.waitFor(() => expect(container.textContent).toContain("PRIVATE owner owner"));
  expect(get).toHaveBeenCalledOnce();
});
