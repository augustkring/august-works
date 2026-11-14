import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
