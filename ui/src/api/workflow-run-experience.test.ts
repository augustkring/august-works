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
