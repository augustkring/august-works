// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { SaasResetPasswordPage } from "./SaasPasswordReset";
import { i18n } from "../i18n";
const action = vi.hoisted(() => vi.fn());
vi.mock("../api/saas", () => ({ saasAuthAction: action }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null, selectedCompanyId: null }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient, navigate: ReturnType<typeof useNavigate>;
function Page() { navigate = useNavigate(); return <SaasResetPasswordPage />; }
async function mount(path = "/saas/reset-password", language = "en") {
  await i18n.changeLanguage(language); action.mockResolvedValue({});
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Page /></MemoryRouter></QueryClientProvider>));
}
async function enter(value: string) {
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
afterEach(async () => {
  if (root) await act(async () => root.unmount()); host?.remove(); client?.clear();
  action.mockReset(); await i18n.changeLanguage("en");
});
it.each(["en", "da"])("localizes the public reset request and keeps its receipt non-enumerating in %s", async language => {
  await mount(undefined, language);
  expect(document.activeElement).toBe(host.querySelector("h1"));
  expect(host.textContent).toContain(language === "en" ? "Reset password" : "Nulstil adgangskode");
  expect(host.querySelector("input")!.autocomplete).toBe("email");
  await enter("person@example.test"); await submit();
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeTruthy());
  expect(action).toHaveBeenCalledExactlyOnceWith("request-password-reset", { email: "person@example.test", redirectTo: window.location.origin + "/saas/reset-password" });
  expect(host.textContent).toContain(language === "en" ? "If this email has an account" : "Hvis der findes en konto");
  expect(document.activeElement).toBe(host.querySelector('[role="status"]'));
});
it("keeps a failed password change unconfirmed without exposing the native error or clearing entered input", async () => {
  await mount("/saas/reset-password?token=original");
  action.mockRejectedValue(new Error("PRIVATE-AUTH-TRANSPORT-CANARY"));
  await enter("Private-valid-password"); await submit();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeTruthy());
  expect(host.textContent).toContain("could not be confirmed"); expect(host.textContent).not.toContain("PRIVATE-AUTH-TRANSPORT-CANARY");
  expect(host.querySelector("input")!.value).toBe("Private-valid-password");
  expect(document.activeElement).toBe(host.querySelector('[role="alert"]')); expect(action).toHaveBeenCalledOnce();
});
it.each(["en", "da"])("shows safe common-password advice and keeps the entered value in %s", async language => {
  await mount("/saas/reset-password?token=original", language);
  action.mockRejectedValue(Object.assign(new Error("PRIVATE-COMMON-PASSWORD-DETAIL"), { code: "PASSWORD_TOO_COMMON" }));
  await enter("Private-valid-password"); await submit();
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeTruthy());
  expect(host.textContent).toContain(language === "en" ? "Choose a different password" : "Vælg en anden adgangskode");
  expect(host.textContent).not.toContain("PRIVATE-COMMON-PASSWORD-DETAIL");
  expect(host.querySelector("input")!.value).toBe("Private-valid-password");
});
it("a new recovery token clears the previous password and cannot inherit its late success", async () => {
  await mount("/saas/reset-password?token=first");
  let finish!: (value: object) => void; action.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await enter("First-private-password"); await submit();
  expect(action).toHaveBeenCalledExactlyOnceWith("reset-password", { token: "first", newPassword: "First-private-password" });
  await act(async () => navigate("/saas/reset-password?token=second"));
  expect(host.querySelector("input")!.value).toBe(""); expect(host.querySelector("input")!.disabled).toBe(false);
  await act(async () => finish({}));
  expect(host.querySelector('[role="status"]')).toBeNull(); expect(host.textContent).not.toContain("has been changed");
});
it("does not send an empty request or an undersized password from a dispatched form submission", async () => {
  await mount(); await submit(); expect(action).not.toHaveBeenCalled();
  await act(async () => navigate("/saas/reset-password?token=request"));
  await enter("short"); await submit(); expect(action).not.toHaveBeenCalled();
  expect(host.querySelector("input")!.autocomplete).toBe("new-password");
});

it("admits only one current reset action when two submit gestures arrive before React updates", async () => {
  await mount("/saas/reset-password?token=original");
  let finish!: (value: object) => void; action.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await enter("Private-valid-password");
  await act(async () => {
    const form = host.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  await act(async () => finish({}));
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeTruthy());
  expect(host.querySelector("input")).toBeNull();
});
