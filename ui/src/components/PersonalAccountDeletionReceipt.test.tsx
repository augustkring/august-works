// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalAccountDeletionReceipt } from "./PersonalAccountDeletionReceipt";
import { api, ApiError } from "../api/client";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const receipt = { scope: "personal_account", id: "01000000-0000-4000-8000-000000000001", status: "processing",
  createdAt: "2026-11-11T12:00:00.000Z", completedAt: null };
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
async function mount(requested = true) {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<QueryClientProvider client={client}><PersonalAccountDeletionReceipt requested={requested} /></QueryClientProvider>));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  await client?.cancelQueries(); client?.clear(); host?.remove(); vi.restoreAllMocks();
});
it("reads only the private cookie receipt and presents its personal scope without restoring a session", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue(receipt);
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Deletion is in progress"));
  expect(host.textContent).toContain("personal account deletion request");
  expect(post).toHaveBeenCalledWith("/saas/account/deletion/receipt", {}, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(host.textContent).not.toContain("Company deletion completed");
});
it("does not infer an accepted request from the requested URL when no private receipt exists", async () => {
  vi.spyOn(api, "post").mockRejectedValue(new ApiError("Not available", 404, null));
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("does not establish whether"));
  expect(host.textContent).not.toContain("Access has been revoked");
  expect(host.textContent).not.toContain("deletion completed");
});
it("keeps the ordinary sign-in screen unchanged when no private receipt is present", async () => {
  vi.spyOn(api, "post").mockRejectedValue(new ApiError("Not available", 404, null));
  await mount(false);
  await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
  expect(host.textContent).toBe("");
});
it("rejects a company receipt instead of presenting it as personal account erasure", async () => {
  vi.spyOn(api, "post").mockResolvedValue({ ...receipt, scope: "company", companyId: "PRIVATE-COMPANY" });
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("current status could not be checked"));
  expect(host.textContent).not.toContain("PRIVATE-COMPANY");
  expect(host.textContent).not.toContain("Deletion is in progress");
});
it("withdraws the last status when a subsequent private receipt check fails", async () => {
  vi.spyOn(api, "post").mockResolvedValueOnce(receipt).mockRejectedValueOnce(new ApiError("PRIVATE-DETAIL", 404, null));
  await mount(); await vi.waitFor(() => expect(host.textContent).toContain("Deletion is in progress"));
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Try again" || button.textContent === "Retry");
  expect(retry).toBeTruthy(); await act(async () => retry!.click());
  await vi.waitFor(() => expect(host.textContent).toContain("does not establish whether"));
  expect(host.textContent).not.toContain("Deletion is in progress");
  expect(host.textContent).not.toContain("PRIVATE-DETAIL");
});
