import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { workflowsApi } from "./workflows";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data = {
  companyId: id(1),
  workflowId: id(2),
  id: id(3),
  revisionId: id(4),
  revisionNumber: 2,
  revisionState: "superseded",
  status: "succeeded",
  updatedAt: "2026-10-09T00:00:00.000Z",
  canRequestStop: false,
  stopReceipt: null,
  trace: { state: "available", attempts: [] },
};
afterEach(() => vi.restoreAllMocks());
it("binds the private no-store request to company, principal, workflow and run", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(data);
  const controller = new AbortController();
  expect(
    await workflowsApi.runExperience(
      id(1),
      "private user",
      id(2),
      id(3),
      controller.signal,
    ),
  ).toEqual(data);
  expect(get).toHaveBeenCalledWith(
    `/companies/${id(1)}/workflow-runs/${id(3)}/experience?expectedUserId=private%20user`,
    { signal: controller.signal, cache: "no-store" },
  );
});
it.each(["companyId", "workflowId", "id"])(
  "rejects a receipt bound to a different %s",
  async (field) => {
    vi.spyOn(api, "get").mockResolvedValue({ ...data, [field]: id(99) });
    await expect(
      workflowsApi.runExperience(id(1), "member", id(2), id(3)),
    ).rejects.toThrow("context changed");
  },
);
it("rejects unexpected private configuration in a purported metadata response", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    ...data,
    config: { secret: "PRIVATE" },
  });
  await expect(
    workflowsApi.runExperience(id(1), "member", id(2), id(3)),
  ).rejects.toThrow();
});
const stopCommand = {
  requestId: id(5),
  expectedWorkflowId: id(2),
  expectedRevisionId: id(4),
  expectedUpdatedAt: data.updatedAt,
  acknowledgeCompletedEffectsRemain: true as const,
};
const stopReceipt = {
  companyId: id(1),
  workflowId: id(2),
  runId: id(3),
  revisionId: id(4),
  requestId: id(5),
  disposition: "cancellation_requested",
};
it("binds a stop request to the original reviewed run and account", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue(stopReceipt);
  expect(
    await workflowsApi.stop(id(1), "private user", id(2), id(3), stopCommand),
  ).toEqual(stopReceipt);
  expect(post).toHaveBeenCalledWith(
    `/companies/${id(1)}/workflow-runs/${id(3)}/experience/stop?expectedUserId=private%20user`,
    stopCommand,
  );
});
it.each(["companyId", "workflowId", "runId", "revisionId", "requestId"])(
  "rejects an original stop receipt with a foreign %s",
  async (field) => {
    vi.spyOn(api, "post").mockResolvedValue({
      ...stopReceipt,
      [field]: id(99),
    });
    await expect(
      workflowsApi.stop(id(1), "member", id(2), id(3), stopCommand),
    ).rejects.toThrow("context changed");
  },
);
it("refuses a workflow mismatch before sending any stop command", async () => {
  const post = vi.spyOn(api, "post");
  await expect(
    workflowsApi.stop(id(1), "member", id(2), id(3), {
      ...stopCommand,
      expectedWorkflowId: id(99),
    }),
  ).rejects.toThrow("context changed");
  expect(post).not.toHaveBeenCalled();
});
it.each(["companyId", "workflowId", "runId", "revisionId"])(
  "rejects a recovered native admission bound to a different %s",
  async (field) => {
    vi.spyOn(api, "get").mockResolvedValue({
      ...data,
      canRequestStop: true,
      stopReceipt: { ...stopReceipt, [field]: id(99) },
    });
    await expect(
      workflowsApi.runExperience(id(1), "member", id(2), id(3)),
    ).rejects.toThrow("context changed");
  },
);
it("does not accept a recovered stop admission after stop authority is lost", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ ...data, stopReceipt });
  await expect(
    workflowsApi.runExperience(id(1), "member", id(2), id(3)),
  ).rejects.toThrow("context changed");
});
