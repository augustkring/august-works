import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { agentPackagesApi } from "./agent-packages";
afterEach(() => vi.restoreAllMocks());
const company = "10000000-0000-4000-8000-000000000001", request = "20000000-0000-4000-8000-000000000001";
const receipt = { companyId: company, requestId: request, installationId: "30000000-0000-4000-8000-000000000001",
  installationVersion: 1, installationStatus: "configuring", observedAt: "2026-10-14T14:00:00Z" };
it("reads an exact private Original installation request without a write", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(receipt), post = vi.spyOn(api, "post"), signal = new AbortController().signal;
  expect(await agentPackagesApi.installationRequest(company, "owner", request, signal)).toEqual(receipt);
  expect(get).toHaveBeenCalledWith(`/companies/${company}/agent-package-installations/requests/${request}?expectedUserId=owner`, { signal, cache: "no-store" });
  expect(post).not.toHaveBeenCalled();
});
it.each([{ companyId: "10000000-0000-4000-8000-000000000002" },
  { requestId: "20000000-0000-4000-8000-000000000002" }, { privateBody: "PRIVATE" }, { installationStatus: "unknown-success" }])(
  "refuses a foreign or expanded installation receipt %j", async change => {
    vi.spyOn(api, "get").mockResolvedValue({ ...receipt, ...change });
    await expect(agentPackagesApi.installationRequest(company, "owner", request)).rejects.toThrow();
  });
it("does not join a private request started before a later reader's session check", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise(done => { finish = done; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, installationVersion: 2 }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const earlier = agentPackagesApi.installationRequest(company, "owner", request);
  const current = await agentPackagesApi.installationRequest(company, "owner", request);
  expect(fetch).toHaveBeenCalledTimes(2); expect(current.installationVersion).toBe(2);
  finish(new Response(JSON.stringify(receipt), { status: 200, headers: { "Content-Type": "application/json" } }));
  expect((await earlier).installationVersion).toBe(1);
});
