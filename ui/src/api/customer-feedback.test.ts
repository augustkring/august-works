// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type {
  CreateCustomerFeedback,
  CustomerFeedback,
} from "@paperclipai/shared";
import { api } from "./client";
import { customerFeedbackApi } from "./customer-feedback";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data: CustomerFeedback = {
  id: id(2),
  companyId: id(1),
  feedbackId: "AWF-10000000000040008000000000000002",
  category: "BUG",
  body: "PRIVATE-RECEIPT",
  goal: "",
  blocksWork: false,
  omitName: false,
  status: "RECEIVED",
  version: 0,
  createdAt: "2026-10-09T00:00:00.000Z",
  messages: [],
};
const input: CreateCustomerFeedback = {
  idempotencyKey: id(3),
  category: "BUG",
  body: "Report",
  goal: "",
  blocksWork: false,
  omitName: false,
  includeDiagnostics: false,
  context: {
    surfaceKey: "home",
    locale: "en",
    timezone: "UTC",
    viewportClass: "wide",
  },
};
afterEach(() => vi.restoreAllMocks());
it("rejects an invalid deep-link resource before making a private request", async () => {
  const get = vi.spyOn(api, "get");
  await expect(
    customerFeedbackApi.get(id(1), "member", "../../other?PRIVATE=TEXT"),
  ).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
it("rejects an otherwise valid foreign-company history list", async () => {
  vi.spyOn(api, "get").mockResolvedValue([{ ...data, companyId: id(4) }]);
  await expect(customerFeedbackApi.list(id(1), "member")).rejects.toThrow(
    "Feedback context changed",
  );
});
it.each(["company", "resource"])(
  "rejects a detail receipt bound to a different %s",
  async (kind) => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...data,
      ...(kind === "company" ? { companyId: id(4) } : { id: id(5) }),
    });
    await expect(
      customerFeedbackApi.get(id(1), "member", id(2)),
    ).rejects.toThrow("Feedback context changed");
  },
);
it("rejects a foreign creation receipt rather than claiming accepted feedback", async () => {
  vi.spyOn(api, "post").mockResolvedValue({ ...data, companyId: id(4) });
  await expect(
    customerFeedbackApi.create(id(1), "member", input),
  ).rejects.toThrow("Feedback context changed");
});
it("rejects a follow-up receipt for another report", async () => {
  vi.spyOn(api, "post").mockResolvedValue({ ...data, id: id(5) });
  await expect(
    customerFeedbackApi.followUp(id(1), "member", id(2), {
      idempotencyKey: id(3),
      expectedVersion: 0,
      body: "Reply",
    }),
  ).rejects.toThrow("Feedback context changed");
});
