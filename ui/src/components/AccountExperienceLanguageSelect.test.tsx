// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { i18n } from "../i18n";
import { EXPERIENCE_LOCALE_KEY } from "../i18n/experience-locale-preference";
import { queryKeys } from "../lib/queryKeys";
import { AccountExperienceLanguageSelect } from "./AccountExperienceLanguageSelect";

const { getSession, getPreferences, updatePreferences } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock("../api/auth", () => ({ authApi: { getSession, getPreferences, updatePreferences } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;
const session = (id: string) => ({ user: { id, email: `${id}@example.test` }, session: { id: `session-${id}`, userId: id } });
beforeEach(() => vi.resetAllMocks());
async function mount(userId = "user-1", companyLocale?: "en" | "da") {
  getSession.mockResolvedValue(session(userId));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><AccountExperienceLanguageSelect companyLocale={companyLocale} companyId={companyLocale ? "company-1" : undefined} /></QueryClientProvider>));
  await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledWith(userId));
}
async function choose(locale: string) {
  const select = host.querySelector("select")!;
  await act(async () => { select.value = locale; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); client?.clear();
  vi.restoreAllMocks();
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
});

it("initializes from the current account preference when there is no browser choice", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
  getPreferences.mockResolvedValue({ keyboardShortcuts: false, locale: "da" });
  await mount("user-1", "en");
  await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe("da"));
  expect(host.textContent).toContain("Sprog");
  expect(getPreferences).toHaveBeenCalledWith("user-1");
});

it("uses the selected company language only when the person has no saved preference", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
  getPreferences.mockResolvedValue({ keyboardShortcuts: false, locale: null });
  await mount("user-1", "da");
  await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe("da"));
  expect(host.textContent).toContain("Sprog");
});

it("saves the browser selection to the account that owns the selector", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
  getPreferences.mockResolvedValue({ keyboardShortcuts: false, locale: null });
  updatePreferences.mockResolvedValue({ keyboardShortcuts: false, locale: "da" });
  await mount("user-owner");
  await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledWith("user-owner"));
  await choose("da");
  await vi.waitFor(() => expect(updatePreferences).toHaveBeenCalledWith({ locale: "da", expectedUserId: "user-owner" }));
  expect(i18n.resolvedLanguage).toBe("da");
  expect(client.getQueryData(queryKeys.auth.preferences("user-owner"))).toEqual({ keyboardShortcuts: false, locale: "da" });
});

it("ignores a late old-account save after the new account changes language", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
  getPreferences.mockImplementation(async (id: string) => ({ keyboardShortcuts: false, locale: id === "user-2" ? "en" : null }));
  let finishOld!: (value: { keyboardShortcuts: boolean; locale: string }) => void;
  updatePreferences.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce({ keyboardShortcuts: false, locale: "en" });
  await mount("user-1");
  await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledWith("user-1"));
  await choose("da");
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, session("user-2"));
  });
  await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledWith("user-2"));
  await choose("en");
  await vi.waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
  await act(async () => finishOld({ keyboardShortcuts: false, locale: "da" }));
  expect(i18n.resolvedLanguage).toBe("en");
  expect(client.getQueryData(queryKeys.auth.preferences("user-2"))).toEqual({ keyboardShortcuts: false, locale: "en" });
});

it("does not apply a stale account read after the person changes language", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
  let finishRead!: (value: { keyboardShortcuts: boolean; locale: string }) => void;
  getPreferences.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
  updatePreferences.mockResolvedValue({ keyboardShortcuts: false, locale: "da" });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("PRIVATE-STORAGE-FAILURE"); });
  await mount();
  await choose("da");
  expect(i18n.resolvedLanguage).toBe("da");
  await act(async () => finishRead({ keyboardShortcuts: false, locale: "en" }));
  await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledWith("user-1"));
  expect(i18n.resolvedLanguage).toBe("da");
  expect(host.textContent).not.toContain("PRIVATE-STORAGE-FAILURE");
});

it("keeps the chosen browser language and shows safe feedback when account saving fails", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
  getPreferences.mockResolvedValue({ keyboardShortcuts: false, locale: null });
  updatePreferences.mockRejectedValue(new Error("PRIVATE-PREFERENCES-CANARY"));
  await mount("user-1");
  await vi.waitFor(() => expect(getPreferences).toHaveBeenCalledWith("user-1"));
  await choose("da");
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain("kontoens sprogvalg kunne ikke gemmes"));
  expect(i18n.resolvedLanguage).toBe("da");
  expect(host.textContent).not.toContain("PRIVATE-PREFERENCES-CANARY");
  expect(localStorage.getItem(EXPERIENCE_LOCALE_KEY)).toBe("da");
});
