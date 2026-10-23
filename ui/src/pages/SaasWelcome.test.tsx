// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { authApi } from "../api/auth";
import { saasApi } from "../api/saas";
import { i18n } from "../i18n";
import { EXPERIENCE_LOCALE_KEY } from "../i18n/experience-locale-preference";
import { SaasWelcomePage } from "./SaasWelcome";

const { reloadCompanies, setSelectedCompanyId } = vi.hoisted(() => ({
  reloadCompanies: vi.fn(async () => {}),
  setSelectedCompanyId: vi.fn(),
}));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: null,
    companies: [],
    reloadCompanies,
    setSelectedCompanyId,
  }),
}));
vi.mock("@/hooks/useSaasCapabilities", () => ({
  useSaasCapabilities: () => ({
    data: { onboarding: true, runtime: false },
    isPending: false,
    isError: false,
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement, client: QueryClient;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); client?.clear();
  vi.restoreAllMocks();
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("en");
});

it("keeps the organization draft through locale change and shows safe create failure", async () => {
  localStorage.removeItem(EXPERIENCE_LOCALE_KEY);
  await i18n.changeLanguage("da");
  vi.spyOn(authApi, "getSession").mockResolvedValue({
    user: { id: "welcome-owner", email: "owner@example.test", name: "Owner", image: null },
    session: { id: "welcome-session", userId: "welcome-owner" },
    sentryDsn: null,
  });
  vi.spyOn(saasApi, "createCompany").mockRejectedValue(new Error("PRIVATE-SERVER-DETAIL"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(
    <QueryClientProvider client={client}><MemoryRouter><SaasWelcomePage /></MemoryRouter></QueryClientProvider>,
  ));
  await vi.waitFor(() => expect(host.textContent).toContain("Opsæt din virksomhed"));
  const name = host.querySelector('input[maxlength="120"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Nordlys");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const language = host.querySelector("select") as HTMLSelectElement;
  await act(async () => {
    language.value = "en";
    language.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Set up your organization"));
  expect(name.value).toBe("Nordlys");
  expect(saasApi.createCompany).not.toHaveBeenCalled();
  expect(reloadCompanies).not.toHaveBeenCalled();

  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeTruthy());
  expect(host.textContent).toContain("This request could not be confirmed");
  expect(host.textContent).not.toContain("PRIVATE-SERVER-DETAIL");
  expect((host.querySelector('input[maxlength="120"]') as HTMLInputElement).value).toBe("Nordlys");
  expect(saasApi.createCompany).toHaveBeenCalledExactlyOnceWith("welcome-owner", {
    name: "Nordlys",
    idempotencyKey: expect.any(String),
  });
});
