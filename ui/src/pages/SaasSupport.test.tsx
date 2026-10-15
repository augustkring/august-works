// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeSupportControls } from "./SaasSupport";
import { saasApi } from "../api/saas";
import "../i18n";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let live: (event: {
  companyId: string;
  type: string;
  payload: Record<string, unknown>;
}) => void;
vi.mock("../context/LiveUpdatesProvider", () => ({
  useCompanyLiveEvent: (listener: typeof live) => {
    live = listener;
  },
}));
const receipt = {
  id: "native-session",
  companyId: "company",
  operatorUserId: "private-operator",
  approvedByUserId: "owner",
  reason: "Private review purpose",
  scopes: ["status:read"],
  createdAt: "2026-10-10T06:00:00Z",
  expiresAt: "2099-10-10T06:30:00Z",
  revokedAt: null,
};
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.spyOn(saasApi, "pendingSupportApproval").mockResolvedValue(null);
  vi.spyOn(saasApi, "prepareSupportApproval").mockImplementation(
    async (companyId, _principal, input) => ({
      companyId,
      approvalId: input.approvalId!,
      reviewedAt: "2026-10-10T07:00:00.000Z",
      state: "pending",
    }),
  );
  vi.spyOn(saasApi, "cancelSupportApproval").mockImplementation(
    async (companyId, _principal, approvalId) => ({
      companyId,
      approvalId,
      reviewedAt: "2026-10-10T07:00:00.000Z",
      state: "cancelled",
    }),
  );
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  client?.clear();
  container?.remove();
  vi.restoreAllMocks();
});
async function render(principal = "owner") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <main>
          <NativeSupportControls
            key={principal}
            companyId="company"
            principal={principal}
          />
        </main>
      </QueryClientProvider>,
    ),
  );
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  await vi.waitFor(() =>
    expect(container.querySelector("form")).not.toBeNull(),
  );
}
function button(text: string) {
  const result = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  if (!result) throw new Error("Missing button: " + text);
  return result;
}
async function prepare() {
  const input = container.querySelector<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    )!,
    reason = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "private-operator");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(reason, "Private review purpose");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() =>
    expect(
      container.querySelector<HTMLInputElement>(
        'section[aria-label="Review temporary access"] input[type="checkbox"]',
      )?.disabled,
    ).toBe(false),
  );
}
it("requires the inspected review and an unchecked acknowledgement before any Native approval", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi
    .spyOn(saasApi, "approveSupport")
    .mockResolvedValue(receipt);
  await mount();
  await prepare();
  expect(approve).not.toHaveBeenCalled();
  expect(
    container.querySelector('section[aria-label="Review temporary access"] h2'),
  ).toBe(document.activeElement);
  expect(container.querySelectorAll("main")).toHaveLength(1);
  expect(container.textContent).toContain("private-operator");
  expect(container.textContent).toContain("Private review purpose");
  const acknowledgement = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  expect(acknowledgement.checked).toBe(false);
  expect(button("Approve temporary access").disabled).toBe(true);
  await act(async () => acknowledgement.click());
  await act(async () => button("Approve temporary access").click());
  await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
  expect(approve).toHaveBeenCalledWith("company", "owner", {
    approvalId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    operatorUserId: "private-operator",
    reason: "Private review purpose",
    scopes: ["status:read"],
    expiresInMinutes: 30,
  });
});
it("sends the frozen review once even if confirmation is clicked twice before a render", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi
    .spyOn(saasApi, "approveSupport")
    .mockImplementation(() => new Promise(() => {}));
  await mount();
  await prepare();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  const confirm = button("Approve temporary access");
  await act(async () => {
    confirm.click();
    confirm.click();
    button("Cancel").click();
  });
  expect(approve).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(button("Cancel").disabled).toBe(true));
  expect(container.textContent).toContain("Private review purpose");
});
it("retains an unconfirmed approval without a retry, changed review or raw error disclosure", async () => {
  const get = vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi
    .spyOn(saasApi, "approveSupport")
    .mockRejectedValue(new Error("PRIVATE-NATIVE-FAILURE"));
  await mount();
  await prepare();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  await act(async () => button("Approve temporary access").click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Approval outcome is unconfirmed"),
  );
  expect(container.textContent).not.toContain("PRIVATE-NATIVE-FAILURE");
  expect(button("Cancel").disabled).toBe(true);
  expect(button("Approve temporary access").disabled).toBe(true);
  await act(async () => button("Check access history").click());
  await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  expect(approve).toHaveBeenCalledTimes(1);
});
it("hides every private field during current source checking and a rejected read", async () => {
  const get = vi.spyOn(saasApi, "supportSessions").mockResolvedValue([receipt]);
  await mount();
  await prepare();
  let reject!: (error: Error) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  await vi.waitFor(() =>
    expect(container.querySelector('[role="status"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("private-operator");
  expect(container.textContent).not.toContain("Private review purpose");
  await act(async () => reject(new Error("PRIVATE-ACCESS-REFUSAL")));
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  expect(container.textContent).not.toContain("PRIVATE-ACCESS-REFUSAL");
  expect(container.querySelector("form")).toBeNull();
});
it("discards the previous account's review and private history on a keyed account change", async () => {
  const get = vi.spyOn(saasApi, "supportSessions").mockResolvedValue([receipt]);
  await mount();
  await prepare();
  get.mockImplementation(() => new Promise(() => {}));
  await render("changed-account");
  expect(container.textContent).not.toContain("private-operator");
  expect(container.textContent).not.toContain("Private review purpose");
  expect(container.querySelector('[role="status"]')).not.toBeNull();
});

it("checks the exact original unconfirmed approval by a read and never posts another grant", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi
    .spyOn(saasApi, "approveSupport")
    .mockRejectedValue(new Error("Lost acknowledgement"));
  const original = vi
    .spyOn(saasApi, "supportApproval")
    .mockImplementation(async (_company, _principal, input) => ({
      ...receipt,
      id: input.approvalId!,
    }));
  await mount();
  await prepare();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  await act(async () => button("Approve temporary access").click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Approval outcome is unconfirmed"),
  );
  const input = approve.mock.calls[0]![2];
  await act(async () => button("Check original approval").click());
  await vi.waitFor(() =>
    expect(container.querySelector("form")).not.toBeNull(),
  );
  expect(original).toHaveBeenCalledWith("company", "owner", input);
  expect(approve).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Private review purpose");
  expect(container.textContent).not.toContain(
    "Approval outcome is unconfirmed",
  );
});
it("keeps a missing original receipt unconfirmed and does not permit a new approval", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi
    .spyOn(saasApi, "approveSupport")
    .mockRejectedValue(new Error("Lost acknowledgement"));
  vi.spyOn(saasApi, "supportApproval").mockRejectedValue(
    new Error("PRIVATE-ORIGINAL-MISSING"),
  );
  await mount();
  await prepare();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  await act(async () => button("Approve temporary access").click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain("Approval outcome is unconfirmed"),
  );
  await act(async () => button("Check original approval").click());
  expect(container.textContent).not.toContain("PRIVATE-ORIGINAL-MISSING");
  expect(button("Cancel").disabled).toBe(true);
  expect(button("Approve temporary access").disabled).toBe(true);
  expect(approve).toHaveBeenCalledTimes(1);
});

it("recovers a Native pending reference on a new mount and blocks a fresh approval until original cancellation", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const pending = vi.mocked(saasApi.pendingSupportApproval);
  pending.mockResolvedValue({
    companyId: "company",
    approvalId: "original-reference",
    reviewedAt: "2026-10-10T07:00:00Z",
    state: "pending",
  });
  const approve = vi.spyOn(saasApi, "approveSupport");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "An earlier approval needs resolution",
    ),
  );
  expect(container.querySelector("form")).toBeNull();
  const cancel = vi
    .mocked(saasApi.cancelSupportApproval)
    .mockImplementationOnce(async () => {
      pending.mockResolvedValue(null);
      return {
        companyId: "company",
        approvalId: "original-reference",
        reviewedAt: "2026-10-10T07:00:00Z",
        state: "cancelled",
      };
    });
  await act(async () => button("Cancel original request").click());
  await vi.waitFor(() =>
    expect(container.querySelector("form")).not.toBeNull(),
  );
  expect(cancel).toHaveBeenCalledWith("company", "owner", "original-reference");
  expect(approve).not.toHaveBeenCalled();
});
it("retries only the same content-free review reservation after its lost acknowledgement", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const prepare = vi
    .mocked(saasApi.prepareSupportApproval)
    .mockRejectedValueOnce(new Error("PRIVATE-REVIEW-ACK"));
  const approve = vi.spyOn(saasApi, "approveSupport");
  await mount();
  // First reservation failure must retain the review rather than waiting for confirm enablement.
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The original review could not be confirmed",
    ),
  );
  expect(container.textContent).not.toContain("PRIVATE-REVIEW-ACK");
  expect(button("Approve temporary access").disabled).toBe(true);
  const original = prepare.mock.calls[0]![2];
  await act(async () => button("Check original review").click());
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  expect(prepare.mock.calls[1]![2]).toEqual(original);
  expect(approve).not.toHaveBeenCalled();
});
it("closes same-tick duplicate review submission and Cancel-versus-confirm races in the click handlers", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi.spyOn(saasApi, "approveSupport");
  const prepared = vi.mocked(saasApi.prepareSupportApproval);
  await mount();
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await vi.waitFor(() =>
    expect(
      container.querySelector<HTMLInputElement>(
        'section[aria-label="Review temporary access"] input[type="checkbox"]',
      )?.disabled,
    ).toBe(false),
  );
  expect(prepared).toHaveBeenCalledTimes(1);
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(
        'section[aria-label="Review temporary access"] input[type="checkbox"]',
      )!
      .click(),
  );
  const confirm = button("Approve temporary access"),
    cancel = button("Cancel");
  await act(async () => {
    cancel.click();
    confirm.click();
  });
  expect(approve).not.toHaveBeenCalled();
  expect(saasApi.cancelSupportApproval).toHaveBeenCalledTimes(1);
});

it("reconciles a lost cancellation acknowledgement by the same original reference without any grant", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const approve = vi.spyOn(saasApi, "approveSupport");
  const cancel = vi
    .mocked(saasApi.cancelSupportApproval)
    .mockRejectedValueOnce(new Error("PRIVATE-CANCEL-ACK"));
  await mount();
  await prepare();
  await act(async () => button("Cancel").click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "The original review could not be confirmed",
    ),
  );
  expect(container.textContent).not.toContain("PRIVATE-CANCEL-ACK");
  expect(button("Approve temporary access").disabled).toBe(true);
  const original = cancel.mock.calls[0]![2];
  await act(async () => button("Check original cancellation").click());
  await vi.waitFor(() =>
    expect(container.querySelector("form")).not.toBeNull(),
  );
  expect(cancel.mock.calls[1]![2]).toBe(original);
  expect(approve).not.toHaveBeenCalled();
});

it("retires an earlier in-flight private response when Native admission changes", async () => {
  let resolve!: (value: (typeof receipt)[]) => void;
  const get = vi
    .spyOn(saasApi, "supportSessions")
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValueOnce(new Error("CURRENT-OWNER-REFUSED"));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull(),
  );
  await act(async () => resolve([receipt]));
  expect(container.textContent).not.toContain("private-operator");
  expect(container.textContent).not.toContain("Private review purpose");
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBe(
    document.activeElement,
  );
});
it("restores the same private form control after a current Native refresh", async () => {
  const get = vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  await mount();
  const operator = container.querySelector<HTMLInputElement>(
    '[data-native-support-focus="operator"]',
  )!;
  await act(async () => operator.focus());
  let resolve!: (value: (typeof receipt)[]) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  await vi.waitFor(() => expect(container.querySelector("form")).toBeNull());
  await act(async () => resolve([]));
  await vi.waitFor(() =>
    expect(
      container.querySelector('[data-native-support-focus="operator"]'),
    ).toBe(document.activeElement),
  );
});
it("preserves an open Native dialog while the private support read refreshes", async () => {
  const get = vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  await mount();
  const operator = container.querySelector<HTMLInputElement>(
    '[data-native-support-focus="operator"]',
  )!;
  await act(async () => operator.focus());
  let resolve!: (value: (typeof receipt)[]) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () =>
    live({ companyId: "company", type: "activity.logged", payload: {} }),
  );
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const control = document.createElement("button");
  dialog.append(control);
  document.body.append(dialog);
  control.focus();
  try {
    await act(async () => resolve([]));
    await vi.waitFor(() =>
      expect(container.querySelector("form")).not.toBeNull(),
    );
    expect(document.activeElement).toBe(control);
  } finally {
    dialog.remove();
  }
});

it("explains an already-recorded grant separately from cancellation without silently revoking access", async () => {
  vi.spyOn(saasApi, "supportSessions").mockResolvedValue([]);
  const revoke = vi.spyOn(saasApi, "revokeSupport");
  vi.mocked(saasApi.cancelSupportApproval).mockImplementationOnce(
    async (companyId, _principal, approvalId) => ({
      companyId,
      approvalId,
      reviewedAt: "2026-10-10T07:00:00Z",
      state: "recorded",
    }),
  );
  await mount();
  await prepare();
  await act(async () => button("Cancel").click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain(
      "Cancellation did not revoke its access",
    ),
  );
  expect(container.textContent).not.toContain("Original request cancelled");
  expect(revoke).not.toHaveBeenCalled();
});
