// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NativeAuthenticationSettings } from "./NativeAuthenticationSettings";
import { authApi, AuthApiError } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { i18n } from "../i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function SessionObserver() {
  useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, staleTime: 0, retry: false });
  return null;
}
let root: Root, host: HTMLDivElement, client: QueryClient;
async function render(principal = "owner") {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <SessionObserver /><NativeAuthenticationSettings principal={principal} />
  </QueryClientProvider>));
}
async function mount() {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture("owner"));
  vi.spyOn(authApi, "getSession").mockResolvedValue(v9SessionFixture("owner"));
  vi.spyOn(authApi, "securityStatus").mockResolvedValue({ userId: "owner", hasPassword: true,
    twoFactorEnabled: false, phishingResistantRequired: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
  await vi.waitFor(() => expect(host.textContent).toContain("Set up an authenticator"));
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === label)!;
}

it("reveals the setup key and one-time recovery codes only after current-account confirmation", async () => {
  let status = { userId: "owner", hasPassword: true, twoFactorEnabled: false, phishingResistantRequired: false };
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "enableTwoFactor").mockResolvedValue({
    sessionId: "session-owner", totpURI: "otpauth://totp/Blentera%3Aowner?secret=JBSWY3DPEHPK3PXP&issuer=Blentera",
    backupCodes: ["RECOVERY-ONE-TIME-01", "RECOVERY-ONE-TIME-02"],
  });
  vi.spyOn(authApi, "verifyTotp").mockImplementation(async () => { status = { ...status, twoFactorEnabled: true }; return { sessionId: "session-owner" }; });

  await mount();
  vi.mocked(authApi.securityStatus).mockImplementation(async () => status);
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    button("Set up an authenticator").click();
  });
  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>("#native-authenticator-setup-key")?.value).toBe("JBSWY3DPEHPK3PXP"));
  expect(host.textContent).not.toContain("RECOVERY-ONE-TIME-01");
  expect(authApi.reauthenticatePassword).toHaveBeenCalledWith("CURRENT-PRIVATE-PASSWORD", "owner", "session-owner");
  expect(authApi.enableTwoFactor).toHaveBeenCalledWith("CURRENT-PRIVATE-PASSWORD", "owner", "session-owner");

  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-enrollment-code")!, "123456");
    button("Verify and finish setup").click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("RECOVERY-ONE-TIME-01"));
  expect(authApi.verifyTotp).toHaveBeenCalledWith("123456", "owner", "session-owner");
  await act(async () => button("I saved these codes").click());
  expect(host.textContent).not.toContain("RECOVERY-ONE-TIME-01");
  await vi.waitFor(() => expect(host.querySelector("#native-authenticator-current-totp")).not.toBeNull());
  vi.mocked(authApi.verifyTotp).mockRejectedValueOnce(new AuthApiError("used", 401, null, "OTP_ALREADY_USED"));
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-current-totp")!, "123456");
    button("Confirm my identity").click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("That code has already been used"));
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-current-totp")!, "234567");
    button("Confirm my identity").click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Your identity was confirmed"));
});

it("discards a late enrollment response after the authenticated account changes", async () => {
  await mount();
  const pending = deferred<{ sessionId: string; totpURI: string; backupCodes: string[] }>();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "enableTwoFactor").mockReturnValue(pending.promise);
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    button("Set up an authenticator").click();
  });
  await vi.waitFor(() => expect(authApi.enableTwoFactor).toHaveBeenCalledOnce());

  await act(async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(v9SessionFixture("other-owner"));
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("other-owner"));
    await render();
  });
  await act(async () => pending.resolve({
    sessionId: "session-owner", totpURI: "otpauth://totp/Blentera%3Aowner?secret=KRSXG5DSNFXGOIDBNZSA&issuer=Blentera",
    backupCodes: ["PRIVATE-LATE-RECOVERY-CODE"],
  }));
  expect(host.textContent).not.toContain("KRSXG5DSNFXGOIDBNZSA");
  expect(host.textContent).not.toContain("PRIVATE-LATE-RECOVERY-CODE");
  expect(host.querySelector("#native-authenticator-setup-key")).toBeNull();
});


it("removes pending setup through the native cancellation owner and clears its visible key", async () => {
  await mount();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "enableTwoFactor").mockResolvedValue({
    sessionId: "session-owner", totpURI: "otpauth://totp/Blentera?secret=JBSWY3DPEHPK3PXP&issuer=Blentera", backupCodes: ["CANCELLED-RECOVERY-CANARY"],
  });
  vi.spyOn(authApi, "cancelTwoFactorEnrollment").mockResolvedValue(undefined);
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    button("Set up an authenticator").click();
  });
  await vi.waitFor(() => expect(host.querySelector("#native-authenticator-setup-key")).not.toBeNull());
  await act(async () => button("Cancel setup").click());
  expect(authApi.cancelTwoFactorEnrollment).toHaveBeenCalledWith("owner", "session-owner");
  await vi.waitFor(() => expect(host.querySelector("#native-authenticator-setup-key")).toBeNull());
  expect(host.textContent).not.toContain("CANCELLED-RECOVERY-CANARY");
});

it("withholds an enrollment response whose issued session is not the current session", async () => {
  await mount();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "enableTwoFactor").mockResolvedValue({ sessionId: "different-session",
    totpURI: "otpauth://totp/Blentera?secret=JBSWY3DPEHPK3PXP&issuer=Blentera", backupCodes: ["WRONG-SESSION-RECOVERY-CANARY"] });
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    button("Set up an authenticator").click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("The security change could not be confirmed"));
  expect(host.querySelector("#native-authenticator-setup-key")).toBeNull();
  expect(host.textContent).not.toContain("WRONG-SESSION-RECOVERY-CANARY");
});

it("retries an uncertain cancellation with its original session reference", async () => {
  await mount();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "enableTwoFactor").mockResolvedValue({ sessionId: "session-owner",
    totpURI: "otpauth://totp/Blentera?secret=JBSWY3DPEHPK3PXP&issuer=Blentera", backupCodes: ["UNCERTAIN-CANCELLATION-CANARY"] });
  const cancel = vi.spyOn(authApi, "cancelTwoFactorEnrollment").mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValue(undefined);
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    button("Set up an authenticator").click();
  });
  await vi.waitFor(() => expect(host.querySelector("#native-authenticator-setup-key")).not.toBeNull());
  await act(async () => button("Cancel setup").click());
  await vi.waitFor(() => expect(host.textContent).toContain("Setup cancellation has not been confirmed"));
  expect(host.querySelector("#native-authenticator-setup-key")).toBeNull();
  const refreshed = v9SessionFixture("owner"); refreshed.session.id = "new-source-owner";
  vi.mocked(authApi.getSession).mockResolvedValue(refreshed);
  await act(async () => { client.setQueryData(queryKeys.auth.session, refreshed); });
  await vi.waitFor(() => expect(button("Retry cancellation")?.disabled).toBe(false));
  await act(async () => button("Retry cancellation").click());
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(2));
  expect(cancel.mock.calls).toEqual([["owner", "session-owner"], ["owner", "session-owner"]]);
  await vi.waitFor(() => expect(host.textContent).not.toContain("Setup cancellation has not been confirmed"));
});

async function showPasskeySettings() {
  vi.mocked(authApi.securityStatus).mockResolvedValue({ userId: "owner", hasPassword: true,
    twoFactorEnabled: false, phishingResistantRequired: false, passkeysAvailable: true });
  vi.spyOn(authApi, "listPasskeys").mockResolvedValue([]);
  await act(async () => { await client.invalidateQueries({ queryKey: ["native-authenticator-status", "owner"] }); });
  await vi.waitFor(() => expect(button("Add a passkey")).toBeTruthy());
}

it("registers a passkey for the current principal and session, then reads that session's list", async () => {
  await mount();
  await showPasskeySettings();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  let added = false;
  vi.mocked(authApi.listPasskeys).mockImplementation(async () => added ? [
    { id: "native-key-1", name: "Work laptop", createdAt: "2026-10-24T12:00:00.000Z" },
  ] : []);
  vi.spyOn(authApi, "addPasskey").mockImplementation(async () => {
    added = true;
    return { id: "native-key-1", name: "Work laptop", createdAt: "2026-10-24T12:00:00.000Z", sessionId: "session-owner" };
  });

  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    setInput(host.querySelector<HTMLInputElement>("#native-passkey-name")!, "Work laptop");
    button("Add a passkey").click();
  });

  await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>("#native-passkey-native-key-1")?.value).toBe("Work laptop"));
  expect(authApi.reauthenticatePassword).toHaveBeenCalledWith("CURRENT-PRIVATE-PASSWORD", "owner", "session-owner");
  expect(authApi.addPasskey).toHaveBeenCalledWith("Work laptop", "owner", "session-owner");
  expect(authApi.listPasskeys).toHaveBeenLastCalledWith("owner", "session-owner", expect.anything());
});

it("withholds a passkey registration acknowledgement from a different native session", async () => {
  await mount();
  await showPasskeySettings();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "addPasskey").mockResolvedValue({
    id: "wrong-session-key", name: "Wrong session key", createdAt: "2026-10-24T12:00:00.000Z", sessionId: "session-other",
  });

  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    setInput(host.querySelector<HTMLInputElement>("#native-passkey-name")!, "Wrong session key");
    button("Add a passkey").click();
  });

  await vi.waitFor(() => expect(host.textContent).toContain("The security change could not be confirmed"));
  expect(authApi.addPasskey).toHaveBeenCalledWith("Wrong session key", "owner", "session-owner");
  expect(host.textContent).not.toContain("Wrong session key");
  expect(host.querySelector("#native-passkey-wrong-session-key")).toBeNull();
});

it("holds background native status reads while the current session is being rotated", async () => {
  const enrollment = deferred<Awaited<ReturnType<typeof authApi.enableTwoFactor>>>();
  vi.spyOn(authApi, "reauthenticatePassword").mockResolvedValue(undefined);
  vi.spyOn(authApi, "enableTwoFactor").mockReturnValue(enrollment.promise);
  await mount();
  const readsBefore = vi.mocked(authApi.securityStatus).mock.calls.length;
  await act(async () => {
    setInput(host.querySelector<HTMLInputElement>("#native-authenticator-password")!, "CURRENT-PRIVATE-PASSWORD");
    button("Set up an authenticator").click();
  });
  await vi.waitFor(() => expect(authApi.enableTwoFactor).toHaveBeenCalled());
  await act(async () => { await client.invalidateQueries({ queryKey: ["native-authenticator-status", "owner"] }); });
  expect(authApi.securityStatus).toHaveBeenCalledTimes(readsBefore);
  await act(async () => enrollment.resolve({ sessionId: "session-owner",
    totpURI: "otpauth://totp/Blentera%3Aowner?secret=JBSWY3DPEHPK3PXP&issuer=Blentera", backupCodes: ["RECOVERY-FENCED"] }));
  await vi.waitFor(() => expect(host.querySelector("#native-authenticator-setup-key")).not.toBeNull());
  expect(authApi.securityStatus).toHaveBeenCalledWith("owner", undefined, "session-owner");
});
