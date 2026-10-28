// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { SaasAccountPage } from "./SaasAccount";
import { saasApi } from "../api/saas";
import { authApi } from "../api/auth";
import { instanceSettingsApi } from "../api/instanceSettings";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";
import type { SaasCapabilities, SaasNotificationPreference } from "@paperclipai/shared";
import { PENDING_ACCOUNT_DELETION_KEY, readPendingAccountDeletion } from "../lib/pending-account-deletion";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const context = vi.hoisted(() => ({ company: "company-one" }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: context.company }) }));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a>,
  useSearchParams: () => [new URLSearchParams()],
}));
const preference: SaasNotificationPreference = { category: "work_update", emailEnabled: true,
  policy: { version: 1, cadence: "immediate", timezone: "Europe/Copenhagen", quietHours: null, digestMinute: 540 } };
const capabilities: SaasCapabilities = { profile: "saas", signup: false, emailVerification: false, onboarding: false,
  billing: false, checkout: false, runtime: false, usage: false, support: false, notifications: true, deletion: true };
const session = { id: "private-session-for-owner", createdAt: "2026-10-10T00:00:00Z", expiresAt: "2027-10-10T00:00:00Z" };
const receipt = { id: "private-deletion-receipt", companyId: "PRIVATE-DELETION-COMPANY", status: "processing", stage: "retention", createdAt: "2026-10-10T00:00:00Z", completedAt: null };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let root: Root, host: HTMLDivElement, client: QueryClient;
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><SaasAccountPage /></QueryClientProvider>)); }
async function mount(options: { coldSessionFailure?: boolean; passwordless?: boolean; readyChallenge?: string } = {}) {
  await i18n.changeLanguage("en"); context.company = "company-one";
  if (options.readyChallenge) window.history.replaceState({}, "", `/company/settings/security?accountDeletionReauth=${options.readyChallenge}`);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  if (!options.coldSessionFailure) client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  client.setQueryData(["saas-capabilities"], capabilities);
  vi.spyOn(saasApi, "capabilities").mockResolvedValue(capabilities);
  const account = vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("owner"));
  vi.spyOn(authApi, "securityStatus").mockResolvedValue({ userId: "owner", hasPassword: !options.passwordless,
    twoFactorEnabled: false, phishingResistantRequired: false, passkeysAvailable: false });
  vi.spyOn(authApi, "accountDeletionSsoStatus").mockResolvedValue({ userId: "owner", providerId: options.passwordless ? "qualified-oidc" : null,
    available: !!options.passwordless, ready: !!options.readyChallenge, challengeId: options.readyChallenge ?? null });
  if (options.coldSessionFailure) account.mockRejectedValueOnce(new Error("PRIVATE-COLD-BOOT-ERROR"));
  vi.spyOn(instanceSettingsApi, "getExperimental").mockResolvedValue({ notification_policy_v9: true } as never);
  vi.spyOn(saasApi, "sessions").mockResolvedValue([session]);
  vi.spyOn(saasApi, "notificationPreferences").mockResolvedValue([preference]);
  vi.spyOn(saasApi, "deletionReceipts").mockResolvedValue([receipt]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
  if (!options.coldSessionFailure) {
    await vi.waitFor(() => expect(host.querySelector('input[name="timezone"]')).toBeTruthy());
    await vi.waitFor(() => expect(host.textContent).toContain(receipt.companyId));
  }
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  localStorage.clear(); sessionStorage.clear(); await i18n.changeLanguage("en");
});
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const deletionSection = () => host.querySelector<HTMLElement>('section[aria-label="Delete your account"]')!;
async function confirmDeletion(password = "PRIVATE-CURRENT-PASSWORD") {
  await act(async () => {
    setInput(deletionSection().querySelector<HTMLInputElement>('input[autocomplete="off"]')!, "DELETE MY ACCOUNT");
    setInput(deletionSection().querySelector<HTMLInputElement>('input[type="password"]')!, password);
    deletionSection().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
}
const submitDeletion = () => deletionSection().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

it("withdraws private account data and preserves a same-person deletion draft through an original-session recheck", async () => {
  await mount(); await confirmDeletion();
  const current = deferred<ReturnType<typeof v9SessionFixture>>(); let recheck!: Promise<unknown>;
  await act(async () => { recheck = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => current.promise }); });
  await vi.waitFor(() => expect(host.querySelector('input[type="password"]')).toBeNull());
  expect(host.textContent).not.toContain(receipt.companyId); expect(host.textContent).not.toContain("Signed in");
  expect(host.querySelector('input[name="timezone"]')).toBeNull();
  await act(async () => { current.resolve(v9SessionFixture("owner")); await recheck; });
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("PRIVATE-CURRENT-PASSWORD"));
  await vi.waitFor(() => expect(host.textContent).toContain(receipt.companyId));
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  expect(document.activeElement).toBe(host.querySelector("h1"));
  expect(saasApi.sessions).toHaveBeenCalledTimes(2); expect(saasApi.notificationPreferences).toHaveBeenCalledTimes(2); expect(saasApi.deletionReceipts).toHaveBeenCalledTimes(2);
});
it("requires a fresh preference read before restoring a same-person unsaved policy editor", async () => {
  await mount();
  await act(async () => setInput(host.querySelector<HTMLInputElement>('input[name="timezone"]')!, "Europe/Paris"));
  const fresh = deferred<SaasNotificationPreference[]>(); vi.mocked(saasApi.notificationPreferences).mockReturnValueOnce(fresh.promise);
  const current = deferred<ReturnType<typeof v9SessionFixture>>(); let recheck!: Promise<unknown>;
  await act(async () => { recheck = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => current.promise }); });
  await vi.waitFor(() => expect(host.querySelector('input[name="timezone"]')).toBeNull());
  await act(async () => { current.resolve(v9SessionFixture("owner")); await recheck; });
  await vi.waitFor(() => expect(saasApi.notificationPreferences).toHaveBeenCalledTimes(2));
  expect(host.querySelector('input[name="timezone"]')).toBeNull();
  await act(async () => fresh.resolve([preference]));
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[name="timezone"]')?.value).toBe("Europe/Paris"));
});
it("purges the previous person's password and unsaved policy when the actual session changes account", async () => {
  await mount(); await confirmDeletion();
  await act(async () => setInput(host.querySelector<HTMLInputElement>('input[name="timezone"]')!, "Europe/Paris"));
  await act(async () => client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner")));
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(""));
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('input[name="timezone"]')?.value).toBe("Europe/Copenhagen"));
  expect(deletionSection().querySelector<HTMLInputElement>('input[autocomplete="off"]')?.value).toBe("");
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  expect(saasApi.sessions).toHaveBeenLastCalledWith("other-owner", expect.any(AbortSignal));
  expect(saasApi.notificationPreferences).toHaveBeenLastCalledWith("other-owner", expect.any(AbortSignal));
});
it("blocks a same-turn old-account session revocation after the original cache already changed", async () => {
  await mount(); const revoke = vi.spyOn(saasApi, "revokeSession");
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === "Revoke session")!;
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner")); button.click(); });
  expect(revoke).not.toHaveBeenCalled();
});
it("blocks deletion after the original session cache changes account, before React renders it", async () => {
  await mount(); await confirmDeletion(); const remove = vi.spyOn(saasApi, "deleteAccount");
  const form = deletionSection().querySelector("form")!;
  await act(async () => { client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner")); form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(remove).not.toHaveBeenCalled();
});
it("blocks deletion after a completed capability withdrawal without relying on the old displayed button", async () => {
  await mount(); await confirmDeletion(); const remove = vi.spyOn(saasApi, "deleteAccount");
  await act(async () => { client.setQueryData(["saas-capabilities"], { notifications: true, deletion: false }); submitDeletion(); });
  expect(remove).not.toHaveBeenCalled();
});
it("retains the exact unknown deletion request across a company change and persists only its bounded recovery locator", async () => {
  await mount(); await confirmDeletion();
  const remove = vi.spyOn(saasApi, "deleteAccount").mockRejectedValue(new Error("Lost acknowledgement"));
  await act(async () => submitDeletion());
  await vi.waitFor(() => expect(host.textContent).toContain("Your deletion request is not confirmed"));
  const original = structuredClone(remove.mock.calls[0]![1]);
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="password"]')?.disabled).toBe(true);
  context.company = "company-two"; await render();
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe(original.password);
  await act(async () => submitDeletion());
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  expect(remove.mock.calls[1]).toEqual(["owner", original]);
  expect(localStorage.length).toBe(0);
  expect(JSON.parse(sessionStorage.getItem(PENDING_ACCOUNT_DELETION_KEY)!)).toEqual([{ schemaVersion: 1, principal: "owner", idempotencyKey: original.idempotencyKey }]);
  expect(sessionStorage.getItem(PENDING_ACCOUNT_DELETION_KEY)).not.toContain(original.password);
});
it("permits password correction after a definite Native refusal while retaining the original account key", async () => {
  await mount(); await confirmDeletion();
  const remove = vi.spyOn(saasApi, "deleteAccount").mockRejectedValueOnce(new ApiError("Current password confirmation required", 403, null)).mockRejectedValueOnce(new Error("Lost acknowledgement"));
  await act(async () => submitDeletion());
  await vi.waitFor(() => expect(host.textContent).toContain("Account deletion was refused"));
  const key = remove.mock.calls[0]![1].idempotencyKey;
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="password"]')?.disabled).toBe(false);
  await act(async () => setInput(deletionSection().querySelector<HTMLInputElement>('input[type="password"]')!, "CORRECTED-PRIVATE-PASSWORD"));
  await act(async () => submitDeletion());
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  expect(remove.mock.calls[1]![1]).toMatchObject({ password: "CORRECTED-PRIVATE-PASSWORD", idempotencyKey: key });
});
it("keeps a late deletion acknowledgement unconfirmed across the same account's recheck", async () => {
  await mount(); await confirmDeletion();
  const accepted = deferred<Awaited<ReturnType<typeof saasApi.deleteAccount>>>();
  const remove = vi.spyOn(saasApi, "deleteAccount").mockReturnValue(accepted.promise);
  await act(async () => submitDeletion()); await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  const current = deferred<ReturnType<typeof v9SessionFixture>>(); let recheck!: Promise<unknown>;
  await act(async () => { recheck = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => current.promise }); });
  await vi.waitFor(() => expect(host.querySelector('input[type="password"]')).toBeNull());
  await act(async () => accepted.resolve({ id: "native-deletion", status: "requested", createdAt: "2026-10-10T00:00:00Z", completedAt: null }));
  await act(async () => { current.resolve(v9SessionFixture("owner")); await recheck; });
  await vi.waitFor(() => expect(host.textContent).toContain("Your deletion request is not confirmed"));
  expect(remove).toHaveBeenCalledOnce();
});
it("requires all explicit deletion confirmations even when a form submit is dispatched directly", async () => {
  await mount(); const remove = vi.spyOn(saasApi, "deleteAccount");
  await act(async () => submitDeletion()); expect(remove).not.toHaveBeenCalled();
});
it("requires a fresh company sign-in and keeps deletion behind the explicit confirmation form", async () => {
  await mount({ passwordless: true });
  const start = vi.spyOn(authApi, "startAccountDeletionSso").mockResolvedValue({
    challengeId: "11111111-1111-4111-8111-111111111111", providerId: "qualified-oidc",
    callbackURL: "https://example.test/company/settings/security?accountDeletionReauth=11111111-1111-4111-8111-111111111111",
  });
  const signIn = vi.spyOn(authApi, "signInAccountDeletionSso").mockReturnValue(new Promise(() => {}));
  const remove = vi.spyOn(saasApi, "deleteAccount");
  const submit = deletionSection().querySelector("form")!;
  await act(async () => submit.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(remove).not.toHaveBeenCalled();
  const companySignIn = [...deletionSection().querySelectorAll("button")].find(button => button.textContent === "Continue with company sign-in")!;
  await act(async () => companySignIn.click());
  await vi.waitFor(() => expect(signIn).toHaveBeenCalledWith("qualified-oidc",
    "https://example.test/company/settings/security?accountDeletionReauth=11111111-1111-4111-8111-111111111111", "owner", "session-owner"));
  expect(start).toHaveBeenCalledWith("owner", "session-owner");
  expect(remove).not.toHaveBeenCalled();
});

it("submits a session-bound company sign-in proof only after explicit delete and export confirmation", async () => {
  const proofId = "22222222-2222-4222-8222-222222222222";
  await mount({ passwordless: true, readyChallenge: proofId });
  const remove = vi.spyOn(saasApi, "deleteAccount").mockReturnValue(new Promise(() => {}));
  await act(async () => {
    setInput(deletionSection().querySelector<HTMLInputElement>('input[autocomplete="off"]')!, "DELETE MY ACCOUNT");
    deletionSection().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  await act(async () => submitDeletion());
  await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  expect(remove.mock.calls[0]![1]).toMatchObject({ confirmation: "DELETE MY ACCOUNT", reauthenticationProofId: proofId, acknowledgeExport: true });
  expect(remove.mock.calls[0]![1]).not.toHaveProperty("password");
});
it("hides private cached data after an actual session failure and exposes an original-session retry", async () => {
  await mount();
  const read = vi.mocked(authApi.getSession).mockRejectedValueOnce(new Error("PRIVATE-SESSION-FAILURE")).mockResolvedValueOnce(v9SessionFixture("owner"));
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.auth.session, exact: true }); });
  await vi.waitFor(() => expect(host.textContent).toContain("Account access could not be checked"));
  expect(host.textContent).not.toContain(receipt.companyId); expect(host.textContent).not.toContain("PRIVATE-SESSION-FAILURE");
  expect(host.querySelector('input[type="password"]')).toBeNull();
  const retry = [...host.querySelectorAll("button")].find(item => item.textContent === "Try again")!;
  await act(async () => retry.click());
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(host.textContent).toContain(receipt.companyId));
});
it("uses Danish account labels without changing the Native API subject", async () => {
  await mount(); await act(async () => { await i18n.changeLanguage("da"); });
  expect(host.querySelector("h1")?.textContent).toBe("Kontosikkerhed");
  expect(host.textContent).toContain("Tilbagekald session"); expect(host.textContent).toContain("Notifikationsindstillinger");
  expect(saasApi.sessions).toHaveBeenCalledWith("owner", expect.any(AbortSignal));
});

it("does not read private accounts when the original SaaS capability owner reports unavailable", async () => {
  await mount();
  await act(async () => client.setQueryData(["saas-capabilities"], null));
  await vi.waitFor(() => expect(host.textContent).toContain("Personal account features are currently unavailable"));
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(host.textContent).not.toContain(receipt.companyId);
  expect(saasApi.sessions).toHaveBeenCalledOnce(); expect(saasApi.notificationPreferences).toHaveBeenCalledOnce();
});
it("offers an original-session retry after a cold-boot failure without any private read before recovery", async () => {
  await mount({ coldSessionFailure: true });
  await vi.waitFor(() => expect(host.textContent).toContain("Account access could not be checked"));
  expect(host.textContent).not.toContain("PRIVATE-COLD-BOOT-ERROR");
  expect(saasApi.sessions).not.toHaveBeenCalled(); expect(saasApi.notificationPreferences).not.toHaveBeenCalled(); expect(saasApi.deletionReceipts).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await vi.waitFor(() => expect(host.querySelector('input[name="timezone"]')).toBeTruthy());
  expect(authApi.getSession).toHaveBeenCalledTimes(2);
});

async function reopenAccount() {
  await act(async () => root.unmount()); root = createRoot(host);
  await render(); await vi.waitFor(() => expect(host.querySelector('input[type="password"]')).toBeTruthy());
}
it("reopens only the original deletion key after route unmount and requires new explicit consent without persisting a password", async () => {
  await mount(); await confirmDeletion();
  const remove = vi.spyOn(saasApi, "deleteAccount").mockRejectedValue(new Error("Lost acknowledgement"));
  await act(async () => submitDeletion()); await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  const original = structuredClone(remove.mock.calls[0]![1]); await reopenAccount();
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
  expect(deletionSection().querySelector<HTMLInputElement>('input[autocomplete="off"]')?.value).toBe("");
  expect(deletionSection().querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  expect(host.textContent).toContain("An earlier deletion request is unresolved");
  expect(remove).toHaveBeenCalledOnce();
  await confirmDeletion(original.password); await act(async () => submitDeletion());
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2)); expect(remove.mock.calls[1]).toEqual(["owner", original]);
});
it("does not discard an earlier unknown deletion key when a subsequent retry is refused", async () => {
  await mount(); await confirmDeletion();
  const remove = vi.spyOn(saasApi, "deleteAccount").mockRejectedValueOnce(new Error("Lost acknowledgement"))
    .mockRejectedValueOnce(new ApiError("Current password confirmation required", 403, null)).mockRejectedValueOnce(new Error("Lost final acknowledgement"));
  await act(async () => submitDeletion()); await vi.waitFor(() => expect(host.textContent).toContain("Your deletion request is not confirmed"));
  const original = structuredClone(remove.mock.calls[0]![1]);
  await act(async () => submitDeletion()); await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  expect(readPendingAccountDeletion("owner")).toBe(original.idempotencyKey);
  await reopenAccount(); await confirmDeletion(original.password); await act(async () => submitDeletion());
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(3)); expect(remove.mock.calls[2]).toEqual(["owner", original]);
});
it("starts no irreversible transport when recovery storage is unavailable", async () => {
  await mount(); await confirmDeletion(); const remove = vi.spyOn(saasApi, "deleteAccount");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage refused"); });
  await act(async () => submitDeletion()); await vi.waitFor(() => expect(host.textContent).toContain("No new request will be sent"));
  expect(remove).not.toHaveBeenCalled();
});
it("coalesces two same-turn deletion submissions into one original Native request", async () => {
  await mount(); await confirmDeletion();
  const response = deferred<Awaited<ReturnType<typeof saasApi.deleteAccount>>>();
  const remove = vi.spyOn(saasApi, "deleteAccount").mockReturnValue(response.promise);
  await act(async () => { submitDeletion(); submitDeletion(); });
  await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner"));
    response.resolve({ id: "native-original-operation", status: "requested", createdAt: "2026-10-10T00:00:00Z", completedAt: null });
  });
  expect(remove).toHaveBeenCalledOnce();
});

it("does not steal focus from current-account input when a same-person source acknowledgement updates the epoch", async () => {
  const remove = vi.spyOn(saasApi, "deleteAccount");
  await mount();
  const input = deletionSection().querySelector<HTMLInputElement>('input[autocomplete="off"]')!;
  await act(async () => { input.focus(); setInput(input, "DELETE MY ACCOUNT"); });
  const reconfirmed = v9SessionFixture("owner"); reconfirmed.session.id = "reconfirmed-same-owner-session";
  await act(async () => { client.setQueryData(queryKeys.auth.session, reconfirmed); });
  await vi.waitFor(() => expect(saasApi.sessions).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(host.textContent).toContain(receipt.companyId));
  expect(document.activeElement).toBe(input); expect(input.value).toBe("DELETE MY ACCOUNT");
  expect(remove).not.toHaveBeenCalled();
});
