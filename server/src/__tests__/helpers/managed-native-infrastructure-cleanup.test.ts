import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { managedSerialSchedulerFixtureControls } from "./managed-native-conversation-sandbox-host.js";

it("restores the owned environment while retaining image evidence on failed or unproven Host closure", async () => {
  const root = mkdtempSync(join(tmpdir(), "managed-image-cleanup-control-"));
  const evidence = join(root, "synthetic-provider-evidence.sqlite"); writeFileSync(evidence, "retained unit evidence");
  const key = "PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT", previous = process.env[key];
  let dataRetirements = 0, proofCalls = 0;
  const retained: string[] = [];
  const infrastructure = {
    restoreEnvironment: () => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; },
    retireData: () => { dataRetirements++; rmSync(root, { recursive: true, force: true }); },
    retainData: (reason: string) => { retained.push(reason); },
  };
  try {
    process.env[key] = root;
    await expect(managedSerialSchedulerFixtureControls.finishManagedFixtureInfrastructure(infrastructure,
      async () => { throw new Error("synthetic_services_close_failed"); }, async () => { proofCalls++; }))
      .rejects.toThrow("synthetic_services_close_failed");
    expect(process.env[key]).toBe(previous);
    expect(proofCalls).toBe(0); expect(dataRetirements).toBe(0);
    expect(readFileSync(evidence, "utf8")).toBe("retained unit evidence");
    process.env[key] = root;
    await managedSerialSchedulerFixtureControls.finishManagedFixtureInfrastructure(infrastructure,
      async () => {}, async () => { proofCalls++; throw new Error("native_stop_not_proven"); });
    expect(process.env[key]).toBe(previous);
    expect(dataRetirements).toBe(0); expect(proofCalls).toBe(1);
    expect(retained).toEqual(["host_services_close_failed", "native_closure_not_proven"]);
    expect(readFileSync(evidence, "utf8")).toBe("retained unit evidence");
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

// CONF3d. Each per-presence Host made its own provider image and overwrote the
// server's single install-root setting, so the first Host's launch pin check
// refused the artifact authority built from the second Host's image.
it("shares one provider image and install root across Hosts that are live together", () => {
  const key = "PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT", previous = process.env[key];
  const packRoot = mkdtempSync(join(tmpdir(), "managed-shared-image-pack-"));
  const { acquireSharedManagedProviderImage: acquire } = managedSerialSchedulerFixtureControls;
  try {
    process.env[key] = "/operator/provider-pack";
    const primary = acquire(packRoot), peer = acquire(packRoot);
    expect(peer.home).toBe(primary.home);
    expect(process.env[key]).toBe(primary.pack);
    expect(realpathSync(primary.pack)).toBe(realpathSync(packRoot));
    // The first Host to close leaves the setting and the image to the live peer.
    primary.restoreEnvironment(); primary.retireData();
    expect(process.env[key]).toBe(primary.pack);
    expect(existsSync(primary.home)).toBe(true);
    // A repeated release does not release the peer's share.
    primary.restoreEnvironment();
    expect(process.env[key]).toBe(primary.pack);
    // The last Host restores the operator setting and retires the image.
    peer.restoreEnvironment(); peer.retireData();
    expect(process.env[key]).toBe("/operator/provider-pack");
    expect(existsSync(primary.home)).toBe(false);
    // A later Host gets a new image; retained evidence is never removed.
    const later = acquire(packRoot), laterPeer = acquire(packRoot);
    expect(later.home).not.toBe(primary.home);
    later.retainData("native_closure_not_proven");
    later.restoreEnvironment(); later.retireData();
    laterPeer.restoreEnvironment(); laterPeer.retireData();
    expect(existsSync(later.home)).toBe(true);
    expect(process.env[key]).toBe("/operator/provider-pack");
    rmSync(later.home, { recursive: true, force: true });
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    rmSync(packRoot, { recursive: true, force: true });
  }
});
