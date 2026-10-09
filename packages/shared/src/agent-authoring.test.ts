import { describe, expect, it } from "vitest";
import {
  agentAuthoringContentSchema,
  agentDraftCreateSchema,
  agentDraftSaveSchema,
} from "./agent-authoring.js";

describe("unpublished agent authoring contracts", () => {
  it("preserves entered text while defaulting to no memory, delegation or capabilities", () => {
    const draft = agentAuthoringContentSchema.parse({
      instructions: { purpose: "  A bounded outcome  " },
    });
    expect(draft.instructions.purpose).toBe("  A bounded outcome  ");
    expect(draft.memory).toBe("none");
    expect(draft.collaboration).toBe("none");
    expect(draft.capabilities).toEqual([]);
  });
  it("does not allow client fields to supply runtime authority, evidence or broad delegation", () => {
    for (const field of [
      "permissions",
      "approved",
      "testPassed",
      "effectiveInstructions",
      "providerToken",
      "publishAllowed",
    ])
      expect(
        agentAuthoringContentSchema.safeParse({ [field]: true }).success,
      ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({ collaboration: "autonomous" })
        .success,
    ).toBe(false);
  });
  it("rejects consequential automatic actions and self-granted permission changes", () => {
    for (const operation of ["external_send", "spend", "change_permissions"])
      expect(
        agentAuthoringContentSchema.safeParse({
          capabilities: [{ operation, autonomy: "automatic" }],
        }).success,
      ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({
        capabilities: [{ operation: "external_send", autonomy: "ask_first" }],
      }).success,
    ).toBe(true);
  });
  it("bounds scenario content and rejects duplicated or untyped source and capability references", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(
      agentAuthoringContentSchema.safeParse({ knowledgeDocumentIds: [id, id] })
        .success,
    ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({
        knowledgeDocumentIds: ["https://untrusted.invalid"],
      }).success,
    ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({ scenarios: ["x".repeat(2001)] })
        .success,
    ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({
        capabilities: [
          { operation: "read_approved_knowledge", autonomy: "automatic" },
          { operation: "read_approved_knowledge", autonomy: "ask_first" },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires independent request and version fences and does not admit publication as a save step effect", () => {
    expect(
      agentDraftCreateSchema.safeParse({ requestId: "unsafe" }).success,
    ).toBe(false);
    expect(
      agentDraftSaveSchema.safeParse({
        requestId: "10000000-0000-4000-8000-000000000001",
        expectedVersion: 0,
        step: "publish",
        content: {},
      }).success,
    ).toBe(false);
    expect(
      agentDraftSaveSchema.safeParse({
        requestId: "10000000-0000-4000-8000-000000000001",
        expectedVersion: 1,
        step: "publish",
        publish: true,
        content: {},
      }).success,
    ).toBe(false);
  });
});
