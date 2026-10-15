// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { NotificationChannelPreferenceView, NotificationChannelPreferenceReceipt, NotificationChannelUpdate } from "@paperclipai/shared";
import { NotificationChannelSettings } from "./NotificationChannelSettings";
import { saasApi } from "../api/saas";
import { authApi } from "../api/auth";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "10000000-0000-4000-8000-000000000001";
const target = { identityLinkId: "10000000-0000-4000-8000-000000000002", conversationId: "10000000-0000-4000-8000-000000000003",
  provider: "slack" as const, label: "Slack · PRIVATE own workspace · Your account", targetHash: "b".repeat(64) };
const initial: NotificationChannelPreferenceView = { companyId, userId: "owner", category: "work_update", version: 0,
  channel: "default", deliveryLocale: "en", availability: "default", target: null, baselineHash: "a".repeat(64), targets: [target], targetsLimited: false };
const flags = { saas_deployment_profile_v6: true, notification_policy_v9: true, transactional_email_v6: true, notification_channels_v9: true };
const parentKey = ["notification-parent", "owner", 0] as const;
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: companyId }) }));
vi.mock("../context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: () => {} }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
async function render(principal = "owner") {
  await act(async () => root.render(<QueryClientProvider client={client}><NotificationChannelSettings companyId={companyId}
    principal={principal} category="work_update" sourceReady sourceQueryKey={parentKey} /></QueryClientProvider>));
}
async function mount(options: { enabled?: boolean; view?: NotificationChannelPreferenceView } = {}) {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  client.setQueryData(["saas-capabilities"], { notifications: true }); client.setQueryData(parentKey, []);
  client.setQueryData(queryKeys.instance.experimentalSettings, { ...flags, notification_channels_v9: options.enabled !== false });
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("owner"));
  vi.spyOn(saasApi, "capabilities").mockResolvedValue({ notifications: true } as never);
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ ...flags, notification_channels_v9: options.enabled !== false } as never);
  vi.spyOn(saasApi, "notificationChannelPreference").mockResolvedValue(options.view ?? initial);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await render();
  if (options.enabled !== false) await vi.waitFor(() => expect(host.textContent).toContain("Where future updates arrive"), { timeout: 3000 });
}
afterEach(async () => { if (root) await act(async () => root.unmount()); await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
const button = (name: string) => [...host.querySelectorAll("button")].find(node => node.textContent === name)!;
async function select(value: string, index = 0) { await act(async () => { const node = host.querySelectorAll("select")[index]!; node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); }); }
const ownTarget = () => select(`${target.identityLinkId}:${target.conversationId}`);
const receipt = (command: NotificationChannelUpdate): NotificationChannelPreferenceReceipt => ({ companyId, userId: "owner", category: "work_update",
  requestId: command.requestId, version: 1, channel: "slack", preferenceApplied: true, authorityGranted: false, messageSent: false, executionStarted: false });
it("keeps new destination controls hidden when rollback finds only the current default preference", async () => {
  await mount({ enabled: false, view: { ...initial, targets: [] } });
  await vi.waitFor(() => expect(saasApi.notificationChannelPreference).toHaveBeenCalledWith(companyId, "owner", "work_update", expect.any(AbortSignal)));
  await vi.waitFor(() => expect(host.textContent).toBe("")); expect(host.querySelector("select")).toBeNull();
});
it("allows an existing bound choice to be explicitly reset after rollout is disabled and the page reloads", async () => {
  await mount({ enabled: false, view: { ...initial, version: 3, channel: "slack", availability: "unavailable", targets: [] } });
  await vi.waitFor(() => expect(host.querySelector("select")?.value).toBe("unavailable"));
  expect(host.textContent).toContain("not redirected to email");
  expect(host.textContent).not.toContain("Your preference or destination changed");
  const update = vi.spyOn(saasApi, "updateNotificationChannel").mockImplementation(async (_company, _user, _category, command) => ({
    ...receipt(command), channel: "default", version: 4,
  }));
  vi.mocked(saasApi.notificationChannelPreference).mockResolvedValue({ ...initial, version: 4, targets: [], baselineHash: "c".repeat(64) });
  await select("default"); await act(async () => button("Save delivery preference").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Preference version 4 was saved"));
  expect(update.mock.calls[0]![3]).toMatchObject({ expectedVersion: 3, choice: { channel: "default" } });
});
it("retries the exact save after a lost acknowledgement and reports preference rather than delivery", async () => {
  await mount(); await ownTarget(); await select("da", 1);
  const update = vi.spyOn(saasApi, "updateNotificationChannel").mockRejectedValueOnce(new Error("PRIVATE transport failure"))
    .mockImplementationOnce(async (_company, _user, _category, command) => receipt(command));
  vi.spyOn(saasApi, "notificationChannelReceipt").mockResolvedValue(null);
  await act(async () => button("Save delivery preference").click());
  await vi.waitFor(() => expect(host.textContent).toContain("This save is unconfirmed"));
  const original = update.mock.calls[0]![3]; expect(original.deliveryLocale).toBe("da");
  expect(host.querySelector("select")!.disabled).toBe(true); expect(host.textContent).not.toContain("PRIVATE transport failure");
  await act(async () => button("Check saved preference").click());
  await vi.waitFor(() => expect(saasApi.notificationChannelReceipt).toHaveBeenCalledWith(companyId, "owner", "work_update", original.requestId));
  vi.mocked(saasApi.notificationChannelPreference).mockResolvedValue({ ...initial, version: 1, channel: "slack", availability: "available", target, baselineHash: "c".repeat(64), deliveryLocale: "da" });
  await act(async () => button("Retry the same save").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Preference version 1 was saved"));
  expect(update.mock.calls[1]![3]).toEqual(original); expect(host.textContent).toContain("does not confirm message delivery");
});
it("recovers an Original receipt without posting another preference command", async () => {
  await mount(); await ownTarget();
  const update = vi.spyOn(saasApi, "updateNotificationChannel").mockRejectedValue(new Error("lost acknowledgement"));
  const recovery = vi.spyOn(saasApi, "notificationChannelReceipt").mockImplementation(async () => receipt(update.mock.calls[0]![3]));
  await act(async () => button("Save delivery preference").click()); await vi.waitFor(() => expect(button("Check saved preference")).toBeTruthy());
  vi.mocked(saasApi.notificationChannelPreference).mockResolvedValue({ ...initial, version: 1, channel: "slack", availability: "available", target, baselineHash: "c".repeat(64) });
  await act(async () => button("Check saved preference").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Preference version 1 was saved"));
  expect(update).toHaveBeenCalledTimes(1); expect(recovery).toHaveBeenCalledTimes(1);
});
it("retains the exact uncertain reset through a rollback-settings recheck", async () => {
  await mount({ enabled: false, view: { ...initial, version: 3, channel: "slack", availability: "unavailable", targets: [] } });
  await vi.waitFor(() => expect(host.querySelector("select")?.value).toBe("unavailable"));
  const update = vi.spyOn(saasApi, "updateNotificationChannel").mockRejectedValue(new Error("lost reset acknowledgement"));
  await select("default"); await act(async () => button("Save delivery preference").click());
  await vi.waitFor(() => expect(button("Retry the same save")).toBeTruthy());
  const original = update.mock.calls[0]![3], fresh = deferred<typeof flags>(); let recheck!: Promise<unknown>;
  await act(async () => { recheck = client.fetchQuery({ queryKey: queryKeys.instance.experimentalSettings, queryFn: () => fresh.promise }); });
  await vi.waitFor(() => expect(host.querySelector("select")).toBeNull());
  await act(async () => { fresh.resolve({ ...flags, notification_channels_v9: false }); await recheck; });
  await vi.waitFor(() => expect(button("Retry the same save")).toBeTruthy());
  await act(async () => button("Retry the same save").click());
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2)); expect(update.mock.calls[1]![3]).toEqual(original);
});
it("retains an unavailable saved destination without selecting email or allowing an implicit reset", async () => {
  await mount({ view: { ...initial, version: 3, channel: "slack", availability: "unavailable", targets: [] } });
  expect(host.querySelector("select")!.value).toBe("unavailable"); expect(button("Save delivery preference").disabled).toBe(true);
  expect(host.textContent).toContain("not redirected to email");
  await select("default"); expect(button("Save delivery preference").disabled).toBe(false);
});
it("blocks a stale-account same-turn click and discards the previous person's unsent destination", async () => {
  await mount(); await ownTarget(); const update = vi.spyOn(saasApi, "updateNotificationChannel"); const stale = button("Save delivery preference");
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner")); stale.click(); });
  expect(update).not.toHaveBeenCalled(); expect(host.textContent).not.toContain(target.label);
  vi.mocked(saasApi.notificationChannelPreference).mockResolvedValue({ ...initial, userId: "other-owner" });
  await render("other-owner"); await vi.waitFor(() => expect(host.querySelector("select")?.value).toBe("default"));
});
it("hides private destinations while the Original account is rechecked and requires a fresh destination source", async () => {
  await mount(); await ownTarget();
  const fresh = deferred<NotificationChannelPreferenceView>(); vi.mocked(saasApi.notificationChannelPreference).mockReturnValueOnce(fresh.promise);
  const session = deferred<ReturnType<typeof v9SessionFixture>>(); let request!: Promise<unknown>;
  await act(async () => { request = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => session.promise }); });
  await vi.waitFor(() => expect(host.querySelector("select")).toBeNull()); expect(host.textContent).not.toContain(target.label);
  await act(async () => { session.resolve(v9SessionFixture("owner")); await request; });
  await vi.waitFor(() => expect(saasApi.notificationChannelPreference).toHaveBeenCalledTimes(2)); expect(host.querySelector("select")).toBeNull();
  await act(async () => fresh.resolve({ ...initial, targets: [{ ...target, targetHash: "d".repeat(64) }], baselineHash: "e".repeat(64) }));
  await vi.waitFor(() => expect(host.querySelector("select")).toBeTruthy()); expect(button("Save delivery preference").disabled).toBe(true);
  expect(host.textContent).toContain("Review the current setting");
});
