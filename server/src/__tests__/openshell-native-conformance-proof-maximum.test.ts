import { describe, expect, it } from "vitest";
import { deriveNativeConformanceProofMaximum, type OpenShellPolicyDocument } from "../services/execution-sandbox/openshell-policy.js";

const taskRoot = "/workspace/instance/chat-workspaces/company/agent/task";
const modelBinaries = ["/usr/bin/curl"];
function operatorMaximum(): OpenShellPolicyDocument {
  return {
    version: 1,
    filesystem_policy: { include_workdir: false, read_only: ["/workspace", "/.openshell/runtime", "/usr/bin"], read_write: ["/workspace"] },
    landlock: { compatibility: "hard_requirement" },
    process: { run_as_user: "1000", run_as_group: "1000" },
    network_policies: { broker: { name: "broker", binaries: [{ path: "/usr/bin/curl" }], endpoints: [
      { host: "model.example.test", port: 443, protocol: "rest", enforcement: "enforce", rules: [{ allow: { method: "POST", path: "/messages" } }] },
    ] } },
  };
}
function candidate(): OpenShellPolicyDocument {
  const doc = operatorMaximum();
  doc.filesystem_policy.read_only = [taskRoot, "/.openshell/runtime/openshell-sandbox", ...modelBinaries].sort();
  doc.filesystem_policy.read_write = [taskRoot];
  return doc;
}

describe("Native conformance proof maximum attenuation", () => {
  it("narrows only filesystem roots and preserves every operator non-filesystem dimension", () => {
    const parent = operatorMaximum(), got = deriveNativeConformanceProofMaximum({ operatorMaximum: parent,
      candidate: candidate(), taskRoot, modelBinaries });
    expect(got).not.toBeNull();
    expect(got?.filesystem_policy.read_write).toEqual([taskRoot]);
    expect(got?.filesystem_policy.read_only).toEqual([taskRoot, "/.openshell/runtime/openshell-sandbox", ...modelBinaries].sort());
    expect(got?.landlock).toEqual(parent.landlock);
    expect(got?.process).toEqual(parent.process);
    expect(got?.network_policies).toEqual(parent.network_policies);
    expect(parent.filesystem_policy.read_write).toEqual(["/workspace"]);
  });

  it("refuses parent-boundary expansion, wrong task roots, and incomplete immutable model reads", () => {
    const parent = operatorMaximum();
    expect(deriveNativeConformanceProofMaximum({ operatorMaximum: { ...parent,
      filesystem_policy: { ...parent.filesystem_policy, read_write: ["/var/lib"] } }, candidate: candidate(), taskRoot, modelBinaries })).toBeNull();
    expect(deriveNativeConformanceProofMaximum({ operatorMaximum: parent, candidate: candidate(), taskRoot: "/workspace/../outside", modelBinaries })).toBeNull();
    const missingBinary = candidate();
    missingBinary.filesystem_policy.read_only = [taskRoot, "/.openshell/runtime/openshell-sandbox"];
    expect(deriveNativeConformanceProofMaximum({ operatorMaximum: parent, candidate: missingBinary, taskRoot, modelBinaries })).toBeNull();
  });
});
