// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerSupportAssistant } from "./CustomerSupportAssistant";
import type { V9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { i18n } from "../i18n";

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../api/client", () => ({ api: transport }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const companyId = "00000000-0000-4000-8000-000000000001";
const policyRevision = "a".repeat(64);
const available = { available: true, included: true, policyRevision, providerName: "Anthropic",
  processingNotice: "Your question and selected Help articles are sent to Anthropic for included assistance.",
  privacyNoticeUrl: "https://blentera.com/privacy" };
const citation = { id: "recovering-work:0", articleId: "recovering-work", locale: "en", title: "Recover interrupted work",
  href: "https://docs.blentera.com/help/recovering-work", sourceHash: "b".repeat(64), text: "Check the original task before retrying.",
  maturity: "preview", lastVerifiedAt: "2026-10-25" };
const acknowledgements = new WeakSet<object>();
const authority: V9PrivateReadAuthority = {
  readReady: true, epoch: 0, failed: false, rechecking: false, canRead: () => true,
  read: async operation => operation(), recheck: async () => {},
  write: async operation => { const value = await operation(); acknowledgements.add(value); return value; },
  confirmed: value => acknowledgements.has(value),
};
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => {
  transport.get.mockReset(); transport.post.mockReset();
  transport.get.mockResolvedValue(available);
  await i18n.changeLanguage("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
async function render(principal = "human-a") {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <CustomerSupportAssistant key={principal} companyId={companyId} principal={principal} locale="en" ready authority={authority} />
  </QueryClientProvider>));
  await vi.waitFor(() => expect(transport.get).toHaveBeenCalled());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
async function compose() {
  await vi.waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
  await act(async () => {
    const textarea = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "How can I recover my task?");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("keeps human support available without configured AI or a customer key", async () => {
  transport.get.mockResolvedValue({ available: false });
  await render();
  expect(container.textContent).toContain("AI assistance is unavailable");
  expect(container.querySelector('a[href="mailto:support@blentera.com"]')).not.toBeNull();
  expect(container.querySelector("textarea")).toBeNull();
  expect(transport.post).not.toHaveBeenCalled();
});

it("requires consent and sends the exact displayed policy revision before showing cited guidance", async () => {
  transport.post.mockImplementation(async (_path, body) => ({ requestId: body.requestId, kind: "guidance", citations: [citation] }));
  await render();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await compose(); await submit();
  await vi.waitFor(() => expect(container.querySelector("blockquote")?.textContent).toBe(citation.text));
  expect(transport.post.mock.calls[0]![1]).toMatchObject({ expectedUserId: "human-a", consent: true, consentPolicyRevision: policyRevision });
  expect(transport.post).toHaveBeenCalledTimes(1);
});

it("does not automatically resend an unknown model request", async () => {
  transport.post.mockImplementation(async (_path, body) => ({ requestId: body.requestId, kind: "unknown", citations: [] }));
  await render(); await compose(); await submit();
  await vi.waitFor(() => expect(container.textContent).toContain("I can’t verify"));
  await submit();
  expect(transport.post).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

it("aborts and discards an old account response when the Help scope changes", async () => {
  let complete!: (value: unknown) => void;
  transport.post.mockImplementation((_path, _body, _options) => new Promise(resolve => { complete = resolve; }));
  await render(); await compose(); await submit();
  await vi.waitFor(() => expect(transport.post).toHaveBeenCalledTimes(1));
  const [, body, options] = transport.post.mock.calls[0]!;
  await render("human-b");
  expect(options.signal.aborted).toBe(true);
  await act(async () => complete({ requestId: body.requestId, kind: "guidance", citations: [citation] }));
  expect(container.querySelector("blockquote")).toBeNull();
  expect(container.querySelector("textarea")?.value).toBe("");
});
