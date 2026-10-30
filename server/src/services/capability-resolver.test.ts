import { describe, expect, it } from "vitest";
import type { ExecutionManifestCapability } from "@paperclipai/shared";
import { selectDeclaredToolCapabilities } from "./capability-resolver.js";

const capability = (type: ExecutionManifestCapability["type"], ref: string): ExecutionManifestCapability => ({
  type, ref, title: ref, risk: "C1", access: "allowed", versionHash: null, deterministic: true,
});

describe("Role Pack tool capability selection", () => {
  it("keeps task-relevant tools when the Role Pack declares no tool subset", () => {
    const capabilities = [capability("tool", "tool:a"), capability("tool", "tool:b")];
    expect(selectDeclaredToolCapabilities(capabilities, [])).toEqual(capabilities);
  });

  it("limits connected-tool disclosure to exact declared refs and preserves other capability kinds", () => {
    const capabilities = [capability("tool", "tool:a"), capability("tool", "tool:b"), capability("native_action", "core:task.read")];
    expect(selectDeclaredToolCapabilities(capabilities, ["tool:b"])).toEqual([
      capability("tool", "tool:b"), capability("native_action", "core:task.read"),
    ]);
  });
});
