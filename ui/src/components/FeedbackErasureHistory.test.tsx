// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackErasureHistory } from "./FeedbackErasureHistory";
import { api } from "../api/client";
import { i18n } from "../i18n";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "10000000-0000-4000-8000-000000000001", feedbackId = "20000000-0000-4000-8000-000000000001";
const item = { receipt: { companyId, feedbackId, id: "30000000-0000-4000-8000-000000000001", target: { kind: "case" },
  status: "pending", requestedAt: "2026-10-11T00:00:00Z", completedAt: null },
  command: { requestKey: "40000000-0000-4000-8000-000000000001", confirmErasure: true,
    expectedReviewHash: "a".repeat(64), target: { kind: "case" } } };
let client: QueryClient, root: Root, container: HTMLDivElement;
const open = vi.fn();
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove();
  vi.restoreAllMocks(); open.mockClear(); await i18n.changeLanguage("en"); });
async function mount() {
  await i18n.changeLanguage("en"); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("operator"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><FeedbackErasureHistory
    companyId={companyId} principal="operator" active onOpen={open} /></QueryClientProvider>));
}
async function expand() { await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Erasure history")!.click()); }
it("reads protected history only on explicit opening and passes the exact original command without posting", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue([item]), post = vi.spyOn(api, "post");
  await mount(); expect(get).not.toHaveBeenCalled(); await expand();
  await vi.waitFor(() => expect(container.textContent).toContain(feedbackId));
  const target = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Awaiting confirmation"))!;
  await act(async () => target.click()); expect(open).toHaveBeenCalledWith(item); expect(post).not.toHaveBeenCalled();
  expect(get.mock.calls[0]![0]).toBe(`/internal/customer-feedback/${companyId}/retention-erasures?expectedUserId=operator`);
});
it("rejects another company before showing or opening its original request", async () => {
  vi.spyOn(api, "get").mockResolvedValue([{ ...item, receipt: { ...item.receipt, companyId: "50000000-0000-4000-8000-000000000001" } }]);
  await mount(); await expand(); await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(container.textContent).not.toContain(feedbackId); expect(open).not.toHaveBeenCalled();
});
it("blocks a same-turn click after native history invalidation and hides it while the original read is pending", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue([item]); await mount(); await expand();
  await vi.waitFor(() => expect(container.textContent).toContain(feedbackId));
  const target = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Awaiting confirmation"))!;
  let finish!: (value: unknown) => void; get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let reading!: Promise<void>;
  await act(async () => { reading = client.invalidateQueries({ queryKey: ["feedback-erasure-history"] }); target.click(); });
  expect(open).not.toHaveBeenCalled(); expect(container.textContent).not.toContain(feedbackId);
  await act(async () => { finish([]); await reading; });
});
