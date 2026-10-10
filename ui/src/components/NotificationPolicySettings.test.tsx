// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationPolicySettings } from "./NotificationPolicySettings";
import { saasApi } from "../api/saas";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "10000000-0000-4000-8000-000000000001" }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("../hooks/useSaasCapabilities", () => ({ useSaasCapabilities: () => ({ isSuccess: true, isError: false, isFetching: false, data: { notifications: true } }) }));
const sourceKey = ["saas-notification-preferences", "member", 0] as const;

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  client?.clear();
  context.company = "10000000-0000-4000-8000-000000000001";
  vi.restoreAllMocks();
});

async function renderPolicy(saved: () => void) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NotificationPolicySettings
          item={{ category: "work_update", emailEnabled: true }}
          companyId={context.company}
          principal="member"
          onSaved={saved}
          sourceReady
          sourceQueryKey={sourceKey}
        />
      </QueryClientProvider>,
    ),
  );
}
async function mountPolicy(saved: () => void) {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("member"));
  client.setQueryData(["saas-capabilities"], { notifications: true });
  client.setQueryData(queryKeys.instance.experimentalSettings, { notification_policy_v9: true });
  client.setQueryData(sourceKey, [{ category: "work_update", emailEnabled: true }]);
  await renderPolicy(saved);
}

it("explains invalid delivery times, focuses the field, and saves in-app delivery without hidden invalid fields", async () => {
  await i18n.changeLanguage("en");
  const saved = vi.fn();
  const update = vi
    .spyOn(saasApi, "updateNotificationPreference")
    .mockResolvedValue({
      category: "work_update",
      emailEnabled: true,
    });
  await mountPolicy(saved);
  const timezone = host.querySelector<HTMLInputElement>(
    'input[name="timezone"]',
  )!;
  const setValue = (element: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await act(async () => setValue(timezone, "not-a-timezone"));
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(update).not.toHaveBeenCalled();
  expect(timezone.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(timezone);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain(
    "Enter a valid timezone",
  );
  const describedBy = timezone.getAttribute("aria-describedby")!;
  expect(document.getElementById(describedBy)).not.toBeNull();
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "in_app_only";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(update).toHaveBeenCalledWith(
    "10000000-0000-4000-8000-000000000001",
    "member",
    expect.objectContaining({
      policy: expect.objectContaining({
        cadence: "in_app_only",
        quietHours: null,
      }),
    }),
  );
});

const submit = () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
it("does not save retained policy fields after the original session cache changes account", async () => {
  const saved = vi.fn(), update = vi.spyOn(saasApi, "updateNotificationPreference");
  await mountPolicy(saved);
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-account")); submit(); });
  expect(update).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  expect(host.querySelector("form")).toBeNull();
});
it("does not save after a completed rollback in the original settings cache", async () => {
  const saved = vi.fn(), update = vi.spyOn(saasApi, "updateNotificationPreference");
  await mountPolicy(saved);
  await act(async () => { client.setQueryData(queryKeys.instance.experimentalSettings, { notification_policy_v9: false }); submit(); });
  expect(update).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true));
});
it("blocks a save while the original preference read is pending, before React observes it", async () => {
  const saved = vi.fn(), update = vi.spyOn(saasApi, "updateNotificationPreference");
  await mountPolicy(saved);
  let release!: (value: unknown) => void, read!: Promise<unknown>;
  await act(async () => {
    read = client.fetchQuery({ queryKey: sourceKey, queryFn: () => new Promise(resolve => { release = resolve; }) }); submit();
  });
  expect(update).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  await act(async () => { release([{ category: "work_update", emailEnabled: true }]); await read; });
});
it("ignores a late policy acknowledgement after the same account changes its session", async () => {
  const saved = vi.fn(); let release!: (value: { category: "work_update"; emailEnabled: boolean }) => void;
  const update = vi.spyOn(saasApi, "updateNotificationPreference").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await mountPolicy(saved); await act(async () => submit());
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  const session = v9SessionFixture("member");
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, { ...session, session: { ...session.session, id: "new-session-for-member" } });
    release({ category: "work_update", emailEnabled: true });
  });
  expect(saved).not.toHaveBeenCalled(); expect(host.textContent).not.toContain(i18n.t("notifications.saved", { ns: "experience" }));
  expect(update).toHaveBeenCalledOnce();
});
it("does not certify an old company preference acknowledgement after the audit context changes", async () => {
  const saved = vi.fn(); let release!: (value: { category: "work_update"; emailEnabled: boolean }) => void;
  const update = vi.spyOn(saasApi, "updateNotificationPreference").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  await mountPolicy(saved); await act(async () => submit());
  await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
  context.company = "10000000-0000-4000-8000-000000000002"; await renderPolicy(saved);
  await act(async () => release({ category: "work_update", emailEnabled: true }));
  expect(saved).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledOnce();
});
