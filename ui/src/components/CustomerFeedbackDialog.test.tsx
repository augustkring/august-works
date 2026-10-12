// @vitest-environment jsdom
import { v9SessionFixture } from "../hooks/v9-session.test-support";
import { queryKeys } from "../lib/queryKeys";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { customerFeedbackApi } from "../api/customer-feedback";
import { api, ApiError } from "../api/client";
import { FEEDBACK_CONTACTS } from "@paperclipai/shared";
import { feedbackImagesApi } from "../api/feedback-images";
import { CustomerFeedbackDialog } from "./CustomerFeedbackDialog";
const identityState = vi.hoisted(() => ({ principal: "feedback-member" }));
vi.mock("../hooks/useV9FeatureEnabled", () => ({
  useV9FeatureEnabled: () => ({ enabled: true, query: { isSuccess: true, isFetching: false, isError: false } }),
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "10000000-0000-4000-8000-000000000001",
    selectedCompany: { issuePrefix: "AW" },
  }),
}));
vi.mock("../api/companies-query", () => ({
  useAccountIdentity: () => ({
    userId: identityState.principal,
    localImplicit: false,
    settled: true,
    failed: false,
  }),
}));
let root: Root, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  identityState.principal = "feedback-member";
  await i18n.changeLanguage("en");
});
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function enter(body: string) {
  const element = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(element, body);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, v9SessionFixture(identityState.principal));
  client.setQueryDefaults(queryKeys.instance.experimentalSettings, { gcTime: Infinity });
  client.setQueryData(queryKeys.instance.experimentalSettings, { customer_feedback_v9: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            "/AW/needs-you?secret=private-query#private-fragment",
          ]}
        >
          <CustomerFeedbackDialog />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await click("Feedback");
}
const accepted = {
  id: "10000000-0000-4000-8000-000000000002",
  feedbackId: "AWF-10000000000040008000000000000002",
  companyId: "10000000-0000-4000-8000-000000000001",
  category: "BUG" as const,
  body: "My approval is missing",
  goal: "",
  blocksWork: false,
  omitName: false,
  status: "RECEIVED" as const,
  version: 0,
  createdAt: "2026-10-09T00:00:00.000Z",
  messages: [],
};
describe("feedback consent and canonical receipt", () => {
  it("opens by Enter without carrying its default action to the category select", async () => {
    await mount();
    await click("Cancel");
    const trigger = [...document.querySelectorAll("button")].find(button => button.textContent === "Feedback")!;
    trigger.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => trigger.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(document.querySelector("select"));
  });
  it("starts diagnostics/name exclusion off and links to the user-confirmed distinct contact purposes", async () => {
    await mount();
    expect(document.activeElement?.tagName).toBe("SELECT");
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ),
      ].every((input) => !input.checked),
    ).toBe(true);
    expect(
      document.querySelector('a[href="mailto:security@blentera.com"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('a[href="mailto:privacy@blentera.com"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('a[href="mailto:support@blentera.com"]'),
    ).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
  it("preserves draft on close/failure, retries the same payload and omits raw page context", async () => {
    const reported = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue(
        "private-ua-canary Mozilla/5.0 (Windows NT 10.0) Chrome/143.0 Safari/537.36",
      );
    const save = vi
      .spyOn(customerFeedbackApi, "create")
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce(accepted);
    await mount();
    await enter(accepted.body);
    await click("Send feedback");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "could not be confirmed",
      ),
    );
    expect(document.body.textContent).not.toContain(
      "Thanks — feedback received",
    );
    const first = save.mock.calls[0]![2];
    expect(
      [
        ...document.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >("input, textarea, select"),
      ].every((input) => input.disabled),
    ).toBe(true);
    await enter("An edit must not replace the unacknowledged request");
    expect(document.querySelector("textarea")!.value).toBe(accepted.body);
    expect(first.context.surfaceKey).toBe("needs_you");
    expect(first.context.screenContractId).toBe("NEEDS-YOU");
    expect(first.context.clientEnvironment?.browser).toEqual({
      family: "chrome",
      majorVersion: 143,
    });
    expect(JSON.stringify(first)).not.toContain("private-ua-canary");
    expect(first.includeDiagnostics).toBe(false);
    expect(first).not.toHaveProperty("diagnostics");
    expect(JSON.stringify(first)).not.toContain("private-query");
    expect(JSON.stringify(first)).not.toContain("private-fragment");
    await click("Cancel");
    reported.mockReturnValue("Firefox/144.0 private-new-ua");
    expect(document.activeElement?.textContent).toBe("Feedback");
    await click("Feedback");
    expect(document.querySelector("textarea")!.value).toBe(accepted.body);
    await click("Send feedback");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(accepted.feedbackId),
    );
    expect(save.mock.calls[1]![2]).toEqual(first);
    expect(document.body.textContent).toContain("Thanks — feedback received");
    await click("Close");
    await click("Feedback");
    expect(document.querySelector("textarea")!.value).toBe("");
    expect(document.querySelector("textarea")!.disabled).toBe(false);
  });
  it("allows correcting a canonically rejected validation request without discarding its text", async () => {
    const save = vi
      .spyOn(customerFeedbackApi, "create")
      .mockRejectedValueOnce(
        new ApiError("Invalid request", 400, { error: "Invalid request" }),
      )
      .mockResolvedValueOnce(accepted);
    await mount();
    await enter(accepted.body);
    await click("Send feedback");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(document.querySelector("textarea")!.disabled).toBe(false);
    expect(document.querySelector("textarea")!.value).toBe(accepted.body);
    const first = save.mock.calls[0]![2];
    await enter("Corrected report");
    await click("Send feedback");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![2].idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    expect(save.mock.calls[1]![2].body).toBe("Corrected report");
  });
  it("discloses the exact empty diagnostic bundle before opt-in and freezes it for an unknown retry", async () => {
    const save = vi
      .spyOn(customerFeedbackApi, "create")
      .mockRejectedValueOnce(new Error("Lost acknowledgement"))
      .mockResolvedValueOnce(accepted);
    await mount();
    const toggle = [
      ...document.querySelectorAll<HTMLInputElement>("input"),
    ].find(
      (input) =>
        input.getAttribute("aria-describedby") ===
        "feedback-diagnostics-disclosure",
    )!;
    expect(toggle.checked).toBe(false);
    expect(
      document.getElementById("feedback-diagnostics-disclosure")?.textContent,
    ).toContain("Selecting this option sends an empty diagnostic bundle");
    await act(async () => toggle.click());
    await enter(accepted.body);
    await click("Send feedback");
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')).not.toBeNull(),
    );
    const first = save.mock.calls[0]![2];
    expect(first.includeDiagnostics).toBe(true);
    expect(first.diagnostics).toEqual({
      safeErrorCodes: [],
      correlationIds: [],
    });
    expect(toggle.disabled).toBe(true);
    await act(async () => toggle.click());
    await click("Send feedback");
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![2]).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("private-query");
    expect(JSON.stringify(first)).not.toContain("Lost acknowledgement");
  });
});

async function sessionRecheck() {
  let resolve!: (value: object) => void, pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: () => new Promise<object>(done => { resolve = done; }) });
  });
  // Query notifications are batched outside React's act. Wait for the real
  // pending-state render before resolving the fixture or changing its account.
  await vi.waitFor(() => expect([...document.querySelectorAll("button")].find(button => button.textContent === "Feedback")?.disabled).toBe(true));
  return async () => { await act(async () => { resolve(v9SessionFixture(identityState.principal)); await pending; }); };
}
it("blocks feedback before transport when the completed session cache already changed account", async () => {
  const post = vi.spyOn(customerFeedbackApi, "create");
  await mount(); await enter("Private submitted feedback");
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, v9SessionFixture("different-current-account"));
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(post).not.toHaveBeenCalled();
});
it("hides a same-account draft during a real session recheck and preserves it only for that account", async () => {
  const post = vi.spyOn(customerFeedbackApi, "create");
  await mount();await enter("PRIVATE-UNSENT-FEEDBACK");
  const settle = await sessionRecheck();
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.body.textContent).not.toContain("PRIVATE-UNSENT-FEEDBACK");
  expect(post).not.toHaveBeenCalled();
  await settle();
  await vi.waitFor(() => expect(document.querySelector("textarea")?.value).toBe("PRIVATE-UNSENT-FEEDBACK"));
  const changed = await sessionRecheck();identityState.principal = "other-member";await changed();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await click("Feedback");
  expect(document.querySelector("textarea")!.value).toBe("");
  expect(post).not.toHaveBeenCalled();
});
it("withholds a late acknowledgement through an account epoch and reconciles its original receipt with current GET only", async () => {
  let acknowledge!: (value: typeof accepted) => void;
  const post = vi.spyOn(customerFeedbackApi, "create").mockImplementation(() => new Promise(done => { acknowledge = done; }));
  const read = vi.spyOn(customerFeedbackApi, "get").mockRejectedValueOnce(new Error("PRIVATE-READ-CANARY")).mockResolvedValueOnce(accepted);
  await mount();await enter(accepted.body);await click("Send feedback");
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const settle = await sessionRecheck();
  await act(async () => acknowledge(accepted));
  expect(document.body.textContent).not.toContain(accepted.feedbackId);
  expect(read).not.toHaveBeenCalled();
  await settle();
  await vi.waitFor(() => expect(document.body.textContent).toContain("could not be confirmed with your current access"));
  expect(document.body.textContent).not.toContain(accepted.feedbackId);
  expect(document.body.textContent).not.toContain("PRIVATE-READ-CANARY");
  expect(document.querySelector("textarea")).toBeNull();
  await click("Check feedback receipt");
  await vi.waitFor(() => expect(document.body.textContent).toContain(accepted.feedbackId));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read.mock.calls.every(call => call[0] === accepted.companyId && call[1] === "feedback-member" && call[2] === accepted.id)).toBe(true);
  expect(post).toHaveBeenCalledTimes(1);
});
it("withdraws an acknowledged receipt until a fresh original-owner read after session revalidation", async () => {
  const post = vi.spyOn(customerFeedbackApi, "create").mockResolvedValue(accepted);
  const read = vi.spyOn(customerFeedbackApi, "get").mockRejectedValue(new Error("PRIVATE-WITHDRAWN-CANARY"));
  await mount();await enter(accepted.body);await click("Send feedback");
  await vi.waitFor(() => expect(document.body.textContent).toContain(accepted.feedbackId));
  const settle = await sessionRecheck();
  expect(document.body.textContent).not.toContain(accepted.feedbackId);
  await settle();
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(document.body.textContent).not.toContain(accepted.feedbackId);
  expect(document.body.textContent).not.toContain("PRIVATE-WITHDRAWN-CANARY");
  expect(post).toHaveBeenCalledTimes(1);
});
it("blocks a same-turn submit before React observes the session fetch", async () => {
  const post = vi.spyOn(customerFeedbackApi, "create");
  await mount();await enter(accepted.body);
  let resolve!: (value: object) => void, pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: ["auth", "session"], queryFn: () => new Promise<object>(done => { resolve = done; }) });
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(post).not.toHaveBeenCalled();
  await act(async () => { resolve(v9SessionFixture(identityState.principal));await pending; });
  await vi.waitFor(() => expect(document.querySelector("textarea")?.value).toBe(accepted.body));
});

function selectedImagePolicy() {
  const image = { id: "30000000-0000-4000-8000-000000000001", companyId: accepted.companyId, feedbackId: accepted.id,
    status: "storing", mediaType: "image/png", byteSize: 3, createdAt: accepted.createdAt, deletedAt: null };
  vi.spyOn(api, "get").mockImplementation(async path => path === "/customer-feedback/policy" ? {
    contacts: FEEDBACK_CONTACTS, attachments: { enabled: true, reason: "validation_required", types: ["image/png", "image/jpeg", "image/webp"], maxFiles: 3, maxBytes: 10485760 },
    retention: { status: "owner_decision_required" }, ga: { allowed: false, reason: "data_processing_qualification_required" },
  } : [image]);
  const create = vi.fn(() => "blob:owned-selected-input"), revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  return { image, create, revoke };
}
async function selectImage() {
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["png"], "private-local-image-name.png", { type: "image/png" })], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
it("sends explicitly selected images only after the canonical feedback receipt and preserves the original send on a double click", async () => {
  const { image } = selectedImagePolicy(); let finish!: (value: typeof accepted) => void;
  const post = vi.spyOn(customerFeedbackApi, "create").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const upload = vi.spyOn(feedbackImagesApi, "upload").mockResolvedValue({ ...image, status: "ready", mediaType: "image/png" });
  await mount(); await enter(accepted.body); await selectImage();
  expect(document.body.textContent).toContain("private-local-image-name.png"); expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:owned-selected-input");
  expect(upload).not.toHaveBeenCalled();
  await act(async () => {
    const send = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Send feedback")!;
    send.click(); send.click();
  });
  expect(post).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled();
  expect(JSON.stringify(post.mock.calls[0]![2])).not.toContain("private-local-image-name");
  await act(async () => finish(accepted));
  await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
  expect(upload.mock.calls[0]!.slice(0, 3)).toEqual([accepted.companyId, identityState.principal, accepted.id]);
  expect(upload.mock.calls[0]![4]).toBeInstanceOf(File);
  await vi.waitFor(() => expect(document.body.textContent).toContain(accepted.feedbackId));
});
it("keeps a received case after an unknown image reply and checks its status without repeating the upload", async () => {
  selectedImagePolicy(); const post = vi.spyOn(customerFeedbackApi, "create").mockResolvedValue(accepted);
  const upload = vi.spyOn(feedbackImagesApi, "upload").mockRejectedValue(Error("PRIVATE-PROVIDER-CANARY"));
  await mount(); await enter(accepted.body); await selectImage(); await click("Send feedback");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Some selected images could not be confirmed"));
  expect(document.body.textContent).toContain(accepted.feedbackId); expect(document.body.textContent).not.toContain("PRIVATE-PROVIDER-CANARY");
  await vi.waitFor(() => expect([...document.querySelectorAll("button")].some(button => button.textContent === "Check image status")).toBe(true));
  await click("Check image status");
  await vi.waitFor(() => expect(document.body.textContent).toContain("not yet confirmed"));
  expect(post).toHaveBeenCalledOnce(); expect(upload).toHaveBeenCalledOnce();
});
it("keeps one focused canonical receipt status while protected image metadata is still loading", async () => {
  selectedImagePolicy(); const get = vi.mocked(api.get); let finish!: (value: unknown[]) => void;
  const policy = await get("/customer-feedback/policy");
  get.mockImplementation(path => path === "/customer-feedback/policy" ? Promise.resolve(policy) : new Promise(resolve => { finish = resolve; }));
  vi.spyOn(customerFeedbackApi, "create").mockResolvedValue(accepted);
  await mount(); await enter(accepted.body); await click("Send feedback");
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(document.querySelectorAll('[role="dialog"] [role="status"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain(accepted.feedbackId);
  expect(document.activeElement).toBe(document.querySelector('[role="dialog"] [role="status"]'));
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => finish([]));
});

it("opens a public feedback frame during an immediate session recheck and restores the same account draft only after confirmation", async () => {
  const post = vi.spyOn(customerFeedbackApi, "create");
  await mount(); await enter("PRIVATE-UNSENT-OPEN-FEEDBACK"); await click("Cancel");
  let resolve!: (value: object) => void, pending!: Promise<unknown>;
  await act(async () => {
    pending = client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: () => new Promise<object>(done => { resolve = done; }) });
    document.dispatchEvent(new Event("paperclip:open-feedback"));
  });
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.body.textContent).not.toContain("PRIVATE-UNSENT-OPEN-FEEDBACK");
  expect(document.querySelector('a[href="mailto:security@blentera.com"]')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
  await act(async () => { resolve(v9SessionFixture(identityState.principal)); await pending; });
  await vi.waitFor(() => expect(document.querySelector("textarea")?.value).toBe("PRIVATE-UNSENT-OPEN-FEEDBACK"));
  expect(document.activeElement).toBe(document.querySelector("select"));
  expect(post).not.toHaveBeenCalled();
});
