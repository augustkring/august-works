import { expect, it, vi } from "vitest";
import { api } from "./client";
import { createWorkflowsApi } from "./workflows";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const response = { kind: "test", receipt: { companyId: id(1), workflowId: id(2), requestId: id(3), runId: id(4), revisionId: id(5), purpose: "test", disposition: "admitted" } };
it("uses one scoped no-store GET and never a publication/test/run/status POST for recovery", async () => {
  const get = vi.fn().mockResolvedValue(response), post = vi.fn();
  const client = createWorkflowsApi({ ...api, get, post }); const controller = new AbortController();
  expect(await client.requestReceipt(id(1), "reader", id(2), "test", id(3), controller.signal)).toEqual(response);
  expect(get).toHaveBeenCalledExactlyOnceWith(`/companies/${id(1)}/workflows/${id(2)}/experience/requests/test/${id(3)}?expectedUserId=reader`, { signal: controller.signal, cache: "no-store" });
  expect(post).not.toHaveBeenCalled();
});
it.each(["companyId", "workflowId", "requestId"] as const)("refuses a foreign %s receipt", async field => {
  const client = createWorkflowsApi({ ...api, get: vi.fn().mockResolvedValue({ ...response, receipt: { ...response.receipt, [field]: id(9) } }) });
  await expect(client.requestReceipt(id(1), "reader", id(2), "test", id(3))).rejects.toThrow("scope changed");
});
it("refuses a foreign operation and a response completed after abortion", async () => {
  const controller = new AbortController();
  const client = createWorkflowsApi({ ...api, get: vi.fn().mockImplementation(async () => { controller.abort(); return response; }) });
  await expect(client.requestReceipt(id(1), "reader", id(2), "test", id(3), controller.signal)).rejects.toThrow();
  const wrong = createWorkflowsApi({ ...api, get: vi.fn().mockResolvedValue({ kind: "launch", receipt: { ...response.receipt, purpose: undefined } }) });
  await expect(wrong.requestReceipt(id(1), "reader", id(2), "test", id(3))).rejects.toThrow();
});
