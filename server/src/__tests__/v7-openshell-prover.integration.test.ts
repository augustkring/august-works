import { describe, expect, it } from "vitest";
import { projectOpenShellPolicy } from "../services/execution-sandbox/openshell-policy.js";
import { checkOpenShellBoundary } from "../services/execution-sandbox/openshell-prover.js";
import { policyFixture } from "./helpers/sandbox-fixture.js";
const executable = process.env.AW_V7_OPENSHELL_PROVER;
const executableSha256 = "3e80c0d041a7552d57cc338868bc825a6261e21b5f29a7d7527bcc7926d423f1";
const document = () => { const p = policyFixture(); p.filesystem = { readPaths: ["/usr", "/etc"], writePaths: [], deniedPaths: [] }; p.process.allowedBinaries = []; p.process.allowedSyscalls = []; p.network.destinations = []; return projectOpenShellPolicy(p).document; };
(executable ? describe : describe.skip)("actual pinned OpenShell 0.1.2 standalone prover (formal evidence only)", () => {
  const check = (candidate = document(), boundary = document()) => checkOpenShellBoundary({ executable: executable!, executableSha256, candidate, boundary });
  it("checks a complete-root filesystem subset and returns bounded content-free evidence", async () => { const candidate = document(); candidate.filesystem_policy.read_only = ["/usr"]; const result = await check(candidate); expect(result.result).toBe("within_boundary"); expect(result.coveredDomains).toEqual(["filesystem", "landlock", "network_l4", "network_rest", "process"]); expect(JSON.stringify(result)).not.toContain("aw-v7-policy-check"); expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/); });
  it("rejects a new write path with the actual nonzero prover exit", async () => { const candidate = document(); candidate.filesystem_policy.read_write = ["/tmp"]; expect((await check(candidate)).result).toBe("exceeds_boundary"); });
  it("retains unsupported path-resolution semantics instead of approving a lexical prefix", async () => { const candidate = document(); candidate.filesystem_policy.read_only = ["/usr/bin"]; expect(await check(candidate)).toMatchObject({ result: "unsupported", reasonCode: "unresolved_filesystem_path" }); });
  it("rejects a swapped executable before invoking it", async () => { await expect(checkOpenShellBoundary({ executable: executable!, executableSha256: "0".repeat(64), candidate: document(), boundary: document() })).rejects.toThrow("openshell_prover_binary_changed"); });
});
describe("OpenShell authored-policy projection", () => {
  it("does not equate network binary selectors with process or syscall enforcement", () => { const projection = projectOpenShellPolicy(policyFixture()); expect(projection.unsupportedFeatures).toContain("process_binary_allowlist_requires_outer_enforcement"); expect(projection.unsupportedFeatures).toContain("custom_syscall_allowlist_requires_outer_enforcement"); expect(projection.document.landlock.compatibility).toBe("hard_requirement"); expect(projection.document.filesystem_policy.include_workdir).toBe(false); });
  it("does not widen exact path prefixes into sibling prefixes", () => { const rules = projectOpenShellPolicy(policyFixture()).document.network_policies.aw_0!.endpoints[0]!.rules; expect(rules).toEqual([{ allow: { method: "GET", path: "/v1" } }, { allow: { method: "GET", path: "/v1/**" } }]); });
  it("rejects denial holes in Landlock allowlists and leaves broker projection closed", () => { const p = policyFixture(); p.filesystem.readPaths = ["/"]; p.credentials.mode = "brokered"; const result = projectOpenShellPolicy(p); expect(result.unsupportedFeatures).toContain("filesystem_deny_exception_not_representable"); expect(result.unsupportedFeatures).toContain("native_credential_broker_projection_required"); });
});
