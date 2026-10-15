// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  initialActivationState,
  type ActivationView,
} from "@paperclipai/shared";
import { api } from "./client";
import { activationApi } from "./activation";
afterEach(() => vi.restoreAllMocks());
const companyId = "10000000-0000-4000-8000-000000000001";
const { receipts: _, ...state } = initialActivationState();
const view: ActivationView = {
  companyId,
  runId: companyId,
  companyName: "Private company",
  version: 1,
  status: "in_progress",
  state,
  sources: [],
  capabilities: [],
  blockers: [],
};
it("reads only the original account-bound uncached endpoint and preserves cancellation", async () => {
  const signal = new AbortController().signal;
  const get = vi.spyOn(api, "get").mockResolvedValue(view);
  await expect(activationApi.get(companyId, "owner", signal)).resolves.toEqual(
    view,
  );
  expect(get).toHaveBeenCalledExactlyOnceWith(
    `/companies/${companyId}/activation?expectedUserId=owner`,
    { signal, cache: "no-store" },
  );
});
it("refuses a foreign Native read or command acknowledgement without exposing its body", async () => {
  const foreign = {
    ...view,
    companyId: "10000000-0000-4000-8000-000000000002",
  };
  vi.spyOn(api, "get").mockResolvedValue(foreign);
  vi.spyOn(api, "post").mockResolvedValue(foreign);
  await expect(activationApi.get(companyId, "owner")).rejects.toThrow(
    "Activation context changed",
  );
  await expect(
    activationApi.command(companyId, "owner", {
      operation: "complete_activation",
      requestId: companyId,
      expectedVersion: 1,
    }),
  ).rejects.toThrow("Activation context changed");
});
it("withdraws a late private response after its account/company request is cancelled", async () => {
  let resolve!: (value: unknown) => void;
  vi.spyOn(api, "get").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const controller = new AbortController();
  const pending = activationApi.get(companyId, "owner", controller.signal);
  controller.abort();
  resolve(view);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
