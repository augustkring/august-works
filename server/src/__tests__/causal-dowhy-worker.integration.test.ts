import fs from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoWhyWorker, type DoWhyWorkerRequest } from "../services/causal-claims/dowhy-worker.js";

const request = (units = 8, control = 2, treatment = 6): DoWhyWorkerRequest => ({ operation: "registered_binary_itt", control: { units, successes: control }, treatment: { units, successes: treatment } });
const workspaces = async () => (await fs.readdir(os.tmpdir())).filter(name => name.startsWith("aw-causal-worker-")).sort();
async function numeric(input: DoWhyWorkerRequest) { const result = await runDoWhyWorker(input); if (!("effect" in result)) throw new Error("Expected causal diagnostics"); return result; }
afterEach(() => vi.unstubAllEnvs());
describe("Optional causal worker admission", () => {
  it("requires an explicitly configured interpreter", async () => {
    vi.stubEnv("PAPERCLIP_DOWHY_PYTHON", "");
    await expect(runDoWhyWorker({ operation: "health" })).rejects.toMatchObject({ code: "unavailable" });
  });
  it("rejects arbitrary graph/code/identities/endpoints and unqualified numeric envelopes before spawning", async () => {
    for (const input of [{ ...request(), graph: "arbitrary DAG" }, { ...request(), code: "arbitrary Python" }, { ...request(), companyId: "private" }, { ...request(), endpoint: "https://example.com" }, { ...request(), control: { units: 8, successes: 9 } }, { ...request(), treatment: { units: 7, successes: 2 } }, request(2001, 500, 1000), { ...request(), control: { units: 8, successes: Number.NaN } }, { operation: "observational" }]) await expect(runDoWhyWorker(input as DoWhyWorkerRequest)).rejects.toThrow();
  });
});
// An absent optional interpreter is not provider qualification. Opt into these
// actual library/sandbox checks using the separately hash-locked installation.
describe.runIf(!!process.env.PAPERCLIP_DOWHY_PYTHON)("Actual pinned DoWhy in original denied-network sandbox", () => {
  it("attests all 48 versions, cleared credentials and private workspace cleanup", async () => {
    vi.stubEnv("DATABASE_URL", "fixture_secret_must_not_cross_boundary");
    vi.stubEnv("PAPERCLIP_SIGNING_SECRET", "fixture_signing_material_must_not_cross_boundary");
    const before = await workspaces(), health = await runDoWhyWorker({ operation: "health" });
    expect(health).toMatchObject({ provider: "dowhy", version: "0.14", python: "3.12.14", networkProxyDisabled: true, dependencies: { scipy: "1.15.3", numpy: "2.4.6" } });
    if (!("dependencies" in health)) throw new Error("Expected runtime attestation");
    expect(Object.keys(health.dependencies)).toHaveLength(48); expect(health.environmentNames).not.toContain("DATABASE_URL"); expect(health.environmentNames).not.toContain("PAPERCLIP_SIGNING_SECRET");
    expect(health.bundleHash).toMatch(/^[a-f0-9]{64}$/); expect(await workspaces()).toEqual(before);
  });
  it.each([[2, 6, 0.5], [6, 2, -0.5], [4, 4, 0]])("matches known registered count effect %s/%s with explicit identification and diagnostics", async (control, treatment, effect) => {
    const result = await numeric(request(8, control, treatment));
    expect(result.effect).toBeCloseTo(effect, 12); expect(result.identification).toBe("identified_under_registered_randomization"); expect(result.adjustmentSet).toEqual([]);
    expect(result.refutations.map(item => item.method)).toEqual(["random_common_cause", "placebo_treatment_refuter", "data_subset_refuter"]);
    expect(result).toMatchObject({ representation: "anonymous_binary_sufficient_counts", seed: 1729, simulations: 16, sensitivity: "unknown", uncertainty: "native_registered_interval_required" });
  });
  it("reproduces complete refutations across separate processes with advancing subset randomness", async () => {
    const first = await numeric(request()), second = await numeric(request());
    expect(second).toEqual(first);
    // Public numeric regression: a repeated integer seed incorrectly yields
    // 0.38095 and p=0; the advancing seeded generator yields varied subsets.
    expect(first.refutations[2].effect).toBeCloseTo(0.5474702380952382, 12); expect(first.refutations[2].pValue).toBeCloseTo(0.3506687178631871, 12);
  });
  it("preserves constant-data undefined p-values as unknown instead of passing refutation", async () => {
    const result = await numeric(request(8, 0, 0));
    expect(result.effect).toBe(0); expect(result.refutations.every(item => item.pValue === null && item.status === "unknown")).toBe(true);
  });
  it("executes the maximum 4000-unit anonymous count envelope under the production deadline", async () => {
    const started = performance.now(), result = await numeric(request(2000, 700, 1100));
    expect(result.effect).toBeCloseTo(0.2, 12); expect(result.refutations.every(item => item.status === "passed")).toBe(true); expect(performance.now() - started).toBeLessThan(15000);
  });
  it("closes process groups and removes workspaces on cancellation and deadline", async () => {
    const before = await workspaces(), controller = new AbortController();
    const pending = runDoWhyWorker(request(), { signal: controller.signal }); setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" }); expect(await workspaces()).toEqual(before);
    await expect(runDoWhyWorker(request(), { timeoutMs: 100 })).rejects.toMatchObject({ code: "timeout" }); expect(await workspaces()).toEqual(before);
  });
});
