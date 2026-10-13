import { afterEach, expect, it, vi } from "vitest";
import { agentAuthoringApi } from "./agent-authoring";
import { api } from "./client";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const candidate = { id: id(3), companyId: id(1), draftId: id(2), agentId: id(4), modelProfileId: id(5),
  configurationHash: "a".repeat(64), recordedStatus: "draft", qualificationRequestId: null,
  qualificationCurrent: false, createdAt: "2026-10-13T00:00:00Z", changesLive: false };
const receipt = { companyId: id(1), draftId: id(2), candidateId: id(3), requestId: id(6), status: "unknown",
  createdAt: "2026-10-13T00:00:00Z", finishedAt: null, runIds: [], reservationIds: [], reservedMinor: 12,
  unknownCharges: 1, changesLiveConfiguration: false, providerComputeStopConfirmed: false };
afterEach(() => vi.restoreAllMocks());

it("keeps Original receipt lookup scoped to the current principal and bypasses caching", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(receipt), post = vi.spyOn(api, "post");
  const abort = new AbortController();
  expect(await agentAuthoringApi.runtimeCandidateConformanceReceipt(id(1), "person@example.test", id(2), id(3), id(6), abort.signal)).toEqual(receipt);
  expect(get).toHaveBeenCalledWith(`/companies/${id(1)}/agent-configuration-drafts/${id(2)}/runtime-candidates/${id(3)}/conformance/requests/${id(6)}?expectedUserId=person%40example.test`,
    { signal: abort.signal, cache: "no-store" });
  expect(post).not.toHaveBeenCalled();
});
it.each(["companyId", "draftId", "candidateId", "requestId"] as const)("rejects an Original receipt with a mismatched %s", async field => {
  vi.spyOn(api, "get").mockResolvedValue({ ...receipt, [field]: id(9) });
  await expect(agentAuthoringApi.runtimeCandidateConformanceReceipt(id(1), "author", id(2), id(3), id(6))).rejects.toThrow();
});
it("treats an absent Original slot as absence without issuing a replacement command", async () => {
  vi.spyOn(api, "get").mockResolvedValue(null); const post = vi.spyOn(api, "post");
  expect(await agentAuthoringApi.runtimeCandidateCreationReceipt(id(1), "author", id(2), id(6))).toBeNull();
  expect(await agentAuthoringApi.runtimeCandidateConformanceReceipt(id(1), "author", id(2), id(3), id(6))).toBeNull();
  expect(post).not.toHaveBeenCalled();
});
it("refuses a foreign candidate and a response containing private extra fields", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ ...candidate, draftId: id(9) });
  await expect(agentAuthoringApi.runtimeCandidate(id(1), "author", id(2), id(3))).rejects.toThrow();
  get.mockResolvedValue({ ...candidate, adapterConfig: { credential: "PRIVATE" } });
  await expect(agentAuthoringApi.runtimeCandidate(id(1), "author", id(2), id(3))).rejects.toThrow();
});
it("refuses malformed identifiers before transport", async () => {
  const get = vi.spyOn(api, "get");
  await expect(agentAuthoringApi.runtimeCandidateConformanceReceipt(id(1), "author", id(2), id(3), "../other")).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
it("recovers managed provisioning through a scoped Original read without a replacement effect", async () => {
  const managed = { companyId: id(1), draftId: id(2), agentId: id(3), requestId: id(6), cellId: id(7), operationId: id(8),
    recordedAt: "2026-10-13T00:00:00Z", operationStatus: "REQUESTED", runtimeStatus: "REQUESTED", modelConfigured: false,
    activatesAgent: false, grantsAuthority: false, runtimeQualified: false };
  const get = vi.spyOn(api, "get").mockResolvedValue(managed), post = vi.spyOn(api, "post");
  expect(await agentAuthoringApi.managedRuntimeReceipt(id(1), "author", id(2), id(6))).toEqual(managed);
  expect(get).toHaveBeenCalledWith(`/companies/${id(1)}/agent-configuration-drafts/${id(2)}/managed-runtime/requests/${id(6)}?expectedUserId=author`,
    { signal: undefined, cache: "no-store" });
  for (const field of ["companyId", "draftId", "requestId"]) {
    get.mockResolvedValue({ ...managed, [field]: id(9) });
    await expect(agentAuthoringApi.managedRuntimeReceipt(id(1), "author", id(2), id(6))).rejects.toThrow();
  }
  get.mockResolvedValue({ ...managed, gatewaySecretRef: "PRIVATE" });
  await expect(agentAuthoringApi.latestManagedRuntimeReceipt(id(1), "author", id(2))).rejects.toThrow();
  get.mockResolvedValue(null);
  expect(await agentAuthoringApi.managedRuntimeReceipt(id(1), "author", id(2), id(6))).toBeNull();
  expect(post).not.toHaveBeenCalled();
});
