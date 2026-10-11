// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackImages } from "./FeedbackImages";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { api, ApiError } from "../api/client";
import { authApi } from "../api/auth";
import { feedbackImagesApi } from "../api/feedback-images";
import { i18n } from "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const company = "10000000-0000-4000-8000-000000000001", feedback = "20000000-0000-4000-8000-000000000001";
const image = { id: "30000000-0000-4000-8000-000000000001", companyId: company, feedbackId: feedback,
  status: "ready" as const, mediaType: "image/png" as const, byteSize: 3, createdAt: "2026-10-11T00:00:00Z", deletedAt: null };
let client: QueryClient, root: Root, container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); client?.clear(); container?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });
function Harness() { const authority = useV9PrivateReadAuthority("member");
  return <FeedbackImages companyId={company} feedbackId={feedback} principal="member" authority={authority} active />;
}
function view() { return [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "View image")!; }
async function mount() {
  await i18n.changeLanguage("en");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "session"], v9SessionFixture("member"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await vi.waitFor(() => expect(view()).toBeDefined());
}
function urls() { const create = vi.fn(() => "blob:owned-private-image"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; }); return { create, revoke };
}
it("reads bytes only on explicit view and releases the component-owned preview on unmount", async () => {
  vi.spyOn(api, "get").mockResolvedValue([image]);
  const read = vi.spyOn(feedbackImagesApi, "read").mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  const { create, revoke } = urls(); await mount(); expect(read).not.toHaveBeenCalled();
  await act(async () => view().click());
  await vi.waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:owned-private-image"));
  expect(create).toHaveBeenCalledOnce();
  await act(async () => root.unmount()); root = undefined as unknown as Root;
  expect(revoke).toHaveBeenCalledWith("blob:owned-private-image");
});
it("blocks same-turn image reads during original account recheck and never auto-reads after recovery", async () => {
  vi.spyOn(api, "get").mockResolvedValue([image]); const read = vi.spyOn(feedbackImagesApi, "read"); urls(); await mount();
  let finish!: (value: ReturnType<typeof v9SessionFixture>) => void;
  vi.spyOn(authApi, "getSession").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let checking!: Promise<unknown>; const old = view();
  await act(async () => { checking = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: authApi.getSession, staleTime: 0 }); old.click(); });
  expect(read).not.toHaveBeenCalled(); expect(container.querySelector("img")).toBeNull();
  const next = v9SessionFixture("member"); next.session.id = "new-original-member-session";
  await act(async () => { finish(next); await checking; });
  await vi.waitFor(() => expect(view()).toBeDefined()); expect(read).not.toHaveBeenCalled();
});
it("does not create or display a late binary preview after the original account changes", async () => {
  vi.spyOn(api, "get").mockResolvedValue([image]); let finish!: (blob: Blob) => void;
  vi.spyOn(feedbackImagesApi, "read").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { create } = urls(); await mount(); await act(async () => view().click());
  await act(async () => client.setQueryData(["auth", "session"], v9SessionFixture("another-member")));
  await act(async () => finish(new Blob(["private-image"])));
  expect(create).not.toHaveBeenCalled(); expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).not.toContain("Attached image");
});
it("hides and revokes a shown image immediately during original metadata recheck, including a failed cached read", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue([image]);
  const read = vi.spyOn(feedbackImagesApi, "read").mockResolvedValue(new Blob(["png"]));
  const { revoke } = urls(); await mount(); await act(async () => view().click());
  await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  let fail!: (error: Error) => void; get.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  let checking!: Promise<void>;
  await act(async () => { checking = client.invalidateQueries({ queryKey: ["feedback-images"] }); });
  expect(container.querySelector("img")).toBeNull(); expect(revoke).toHaveBeenCalledOnce();
  await act(async () => { fail(new ApiError("private-native-error", 403, null)); await checking; });
  expect(container.textContent).not.toContain("private-native-error"); expect(read).toHaveBeenCalledOnce();
});
it("uses the current native list immediately when a shown image enters deletion", async () => {
  vi.spyOn(api, "get").mockResolvedValue([image]); vi.spyOn(feedbackImagesApi, "read").mockResolvedValue(new Blob(["png"]));
  const { revoke } = urls(); await mount(); await act(async () => view().click());
  await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  const key = client.getQueryCache().findAll({ queryKey: ["feedback-images"] })[0]!.queryKey;
  await act(async () => client.setQueryData(key, [{ ...image, status: "deleting" }]));
  expect(container.querySelector("img")).toBeNull(); expect(revoke).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("not yet confirmed");
});
