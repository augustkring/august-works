import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetLocator,
  isRemoteRuntimeAssetRemovalReceipt,
  remoteRuntimeAssetLocatorDigest,
  remoteRuntimeAssetPathDigest,
} from "./runtime-asset-retention.js";

describe("remote Native runtime asset erasure binding", () => {
  function fixture() {
    const locator = createRemoteRuntimeAssetLocator({
      companyId: randomUUID(),
      runId: randomUUID(),
      environmentId: randomUUID(),
      environmentLeaseId: randomUUID(),
      provider: "sandbox-fixture",
      providerLeaseId: "lease-fixture-1",
      runnerInstanceId: randomUUID(),
      normalizedSessionId: randomUUID(),
      remoteCwd: "/workspace/safe-fixture",
    });
    const receipt = {
      schema: "paperclip.remote-runtime-asset-removal.v1" as const,
      locatorDigest: remoteRuntimeAssetLocatorDigest(locator),
      commandRequestId: randomUUID(),
      purpose: "native_provider_data_erasure" as const,
      target: { hostId: randomUUID(), cellId: randomUUID(), cellGeneration: "7", bindingId: randomUUID() },
      relativePath: locator.relativePath,
      pathDigest: locator.pathDigest,
      stopProof: {
        schema: "paperclip.native-remote-process-stop.v1" as const,
        runId: locator.runId,
        normalizedSessionIdDigest: locator.normalizedSessionIdDigest,
        runnerInstanceId: locator.runnerInstanceId,
        environmentLeaseId: locator.environmentLeaseId,
        providerLeaseId: locator.providerLeaseId,
        pid: 12345,
        startedAt: "2026-10-28T12:00:00.000Z",
        processIdentityDigest: "a".repeat(64),
        processStartFingerprintDigest: "b".repeat(64),
        stoppedAt: "2026-10-28T12:01:00.000Z",
      },
      stopProofBeforeDelete: true as const,
      exitCode: 0 as const,
      timedOut: false as const,
      postDeleteAbsent: true as const,
    };
    return { locator, receipt };
  }

  it("pins the exact canonical shared-session path and detects lease mutation", () => {
    const { locator } = fixture();
    expect(locator.relativePath).toBe(`sessions/${locator.normalizedSessionIdDigest}`);
    expect(locator.pathDigest).toBe(remoteRuntimeAssetPathDigest(locator.relativePath));
    expect(isRemoteRuntimeAssetLocator(locator, locator)).toBe(true);
    expect(isRemoteRuntimeAssetLocator({ ...locator, relativePath: "sessions/../other" }, locator)).toBe(false);
    const replacement = { ...locator, providerLeaseId: "replacement-lease" };
    expect(isRemoteRuntimeAssetLocator(replacement, locator)).toBe(true);
    expect(remoteRuntimeAssetLocatorDigest(replacement)).not.toBe(remoteRuntimeAssetLocatorDigest(locator));
    expect(isRemoteRuntimeAssetLocator({ ...locator, arbitraryPath: "/tmp/other" }, locator)).toBe(false);
  });

  it("accepts only a locator-bound process-stop, exact-target, post-delete receipt", () => {
    const { locator, receipt } = fixture();
    expect(isRemoteRuntimeAssetRemovalReceipt(receipt, locator)).toBe(true);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt, relativePath: "sessions/neighbor" }, locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt, stopProofBeforeDelete: false }, locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt,
      stopProof: { ...receipt.stopProof, providerLeaseId: "replacement-lease" } }, locator)).toBe(false);
    expect(isRemoteRuntimeAssetRemovalReceipt({ ...receipt,
      target: { ...receipt.target, cellGeneration: "0" } }, locator)).toBe(false);
  });
});
