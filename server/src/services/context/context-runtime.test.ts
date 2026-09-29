import type { Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import {
  assembleFreshNativeGovernedContext,
  type ContextAssemble,
} from "./context-runtime.js";

const baseInput = {
  enabled: true,
  foundationEnabled: true,
  companyId: "22222222-2222-4222-8222-222222222222",
  agentId: "11111111-1111-4111-8111-111111111111",
  responsibleUserId: "user-1",
  runId: "33333333-3333-4333-8333-333333333333",
  issueId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  issueTitle: "Prepare launch recommendation",
  issueDescription: "Use the approved positioning and current task constraints.",
  immediateRequest: "Focus on enterprise customers.",
};

function result(markdown: string) {
  return {
    markdown,
    packet: {
      governance: {
        sensitivityCeiling: "internal" as const,
        asOf: "2026-09-28T10:00:00.000Z",
      },
      foundation: [],
      connectedEvidence: [],
      sharedMemory: [],
      privateMemory: [],
      taskContext: [],
      artifacts: [],
      warnings: [],
      citations: [],
      manifest: null,
      selectedEstimatedTokens: 0,
    },
    decisions: [],
  };
}

describe("fresh native governed context", () => {
  it("does nothing when Context Engine V1 is disabled", async () => {
    const assemble = vi.fn<ContextAssemble>();
    await expect(
      assembleFreshNativeGovernedContext(
        {} as Db,
        { ...baseInput, enabled: false },
        { assemble },
      ),
    ).resolves.toBeNull();
    expect(assemble).not.toHaveBeenCalled();
  });

  it("assembles a bounded internal context request for a fresh native run", async () => {
    const assemble = vi.fn<ContextAssemble>().mockResolvedValue(
      result("## August Works governed context\nApproved truth"),
    );

    const markdown = await assembleFreshNativeGovernedContext(
      {} as Db,
      baseInput,
      { assemble },
    );

    expect(markdown).toContain("Approved truth");
    expect(assemble).toHaveBeenCalledWith(expect.objectContaining({
      companyId: baseInput.companyId,
      agentId: baseInput.agentId,
      responsibleUserId: "user-1",
      runId: baseInput.runId,
      issueId: baseInput.issueId,
      projectId: baseInput.projectId,
      includeFoundation: true,
      sensitivityCeiling: "internal",
      intent: "native_task_execution",
      query: expect.stringContaining("Focus on enterprise customers."),
    }));
  });

  it("keeps Context Engine active but excludes Foundation when its flag is off", async () => {
    const assemble = vi.fn<ContextAssemble>().mockResolvedValue(result("context"));
    await assembleFreshNativeGovernedContext(
      {} as Db,
      { ...baseInput, foundationEnabled: false },
      { assemble },
    );
    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({ includeFoundation: false }),
    );
  });

  it("caps retrieval query material before provider search", async () => {
    const assemble = vi.fn<ContextAssemble>().mockResolvedValue(result("context"));
    await assembleFreshNativeGovernedContext(
      {} as Db,
      {
        ...baseInput,
        immediateRequest: "x".repeat(1_000),
        issueTitle: "title-after-limit",
      },
      { assemble },
    );
    const call = assemble.mock.calls[0]![0];
    expect(call.query).toHaveLength(500);
    expect(call.query).not.toContain("title-after-limit");
  });
});
