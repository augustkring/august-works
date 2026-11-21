// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { JevDecisionSettings, JevDecisionSettingsUpdate } from "@paperclipai/shared";
import { i18n } from "../i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { JevSkillSuggestionSettings } from "./JevSkillSuggestionSettings";

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), setupTest: vi.fn(), history: vi.fn() }));
vi.mock("../api/jev-decisions", () => ({ jevDecisionApi: apiMocks }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const connection1 = "10000000-0000-4000-8000-000000000001", grant1 = "10000000-0000-4000-8000-000000000011";
const connection2 = "20000000-0000-4000-8000-000000000002", grant2 = "20000000-0000-4000-8000-000000000022";
const settings = (companyId: string, connectionId: string, grantId: string): JevDecisionSettings => ({
  companyId, mode: "off", allowBackground: false, connectionId, grantId, updatedAt: new Date().toISOString(),
});
const payload = (companyId: string, connectionId = connection1, grantId = grant1) => ({
  settings: settings(companyId, connectionId, grantId),
  choices: [
    { id: connection1, grantId: grant1, name: "Shared OpenRouter A", status: "active", model: "typesafe/jev-1.13" },
    { id: connection2, grantId: grant2, name: "Shared OpenRouter B", status: "active", model: "typesafe/jev-1.13" },
  ], suggestionsQualified: false,
  testProfile: { profileHash: companyId === "company-2" ? "b".repeat(64) : "a".repeat(64), costCapMinor: 5, currency: "USD" },
});
let root: Root, host: HTMLDivElement, client: QueryClient, saved: Record<string, JevDecisionSettings>;
async function render(companyId = "company-1") {
  await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><JevSkillSuggestionSettings companyId={companyId} /></TooltipProvider></QueryClientProvider>));
  await vi.waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith(companyId));
  await vi.waitFor(() => expect(host.querySelector("input[type=checkbox]")).not.toBeNull());
}
const accountSelect = () => host.querySelectorAll("select")[1] as HTMLSelectElement;
const consentInput = () => host.querySelector('input[type="checkbox"]') as HTMLInputElement;
const testButton = () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Run disclosed setup test")) as HTMLButtonElement;
async function click(element: HTMLElement) { await act(async () => element.click()); }

beforeEach(async () => {
  vi.resetAllMocks();
  saved = { "company-1": settings("company-1", connection1, grant1), "company-2": settings("company-2", connection1, grant1) };
  apiMocks.get.mockImplementation(async (companyId: string) => payload(companyId, saved[companyId]!.connectionId!, saved[companyId]!.grantId!));
  apiMocks.update.mockImplementation(async (companyId: string, input: JevDecisionSettingsUpdate) => {
    saved[companyId] = settings(companyId, input.connectionId!, input.grantId!);
    return { settings: saved[companyId], suggestionsQualified: false };
  });
  apiMocks.setupTest.mockResolvedValue({ status: "completed", model: "typesafe/jev-1.13", inputTokens: 10, outputTokens: 2, costAmount: "0.001", costStatus: "reported", errorCode: null });
  apiMocks.history.mockResolvedValue([]);
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); client?.clear(); vi.restoreAllMocks();
});

it("binds consent to company/account/profile and asks again after each completed paid test", async () => {
  await render();
  expect(testButton().disabled).toBe(true);
  await click(consentInput());
  expect(testButton().disabled).toBe(false);

  await act(async () => {
    accountSelect().value = connection2;
    accountSelect().dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(consentInput().checked).toBe(false));
  expect(testButton().disabled).toBe(true); // The alternate account is not the saved company account.
  expect(apiMocks.setupTest).not.toHaveBeenCalled();

  const saveButton = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Save")) as HTMLButtonElement;
  await click(saveButton);
  await vi.waitFor(() => expect(saved["company-1"]!.connectionId).toBe(connection2));
  await vi.waitFor(() => expect(accountSelect().value).toBe(connection2));
  expect(consentInput().checked).toBe(false);
  await click(consentInput());
  await click(testButton());
  await vi.waitFor(() => expect(apiMocks.setupTest).toHaveBeenCalledTimes(1));
  expect(apiMocks.setupTest).toHaveBeenCalledWith("company-1", expect.objectContaining({ connectionId: connection2, grantId: grant2, profileHash: "a".repeat(64) }));
  await vi.waitFor(() => expect(consentInput().checked).toBe(false));
  expect(testButton().disabled).toBe(true);

  await click(consentInput());
  await act(async () => root.render(<QueryClientProvider client={client}><TooltipProvider><JevSkillSuggestionSettings companyId="company-2" /></TooltipProvider></QueryClientProvider>));
  await vi.waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith("company-2"));
  await vi.waitFor(() => expect(consentInput().checked).toBe(false));
  expect(testButton().disabled).toBe(true); // Company switch and profile hash both fence the old consent.
  expect(apiMocks.setupTest).toHaveBeenCalledTimes(1);
});
