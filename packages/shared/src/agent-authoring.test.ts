import { describe, expect, it } from "vitest";
import {
  agentAuthoringContentSchema,
  agentDraftCreateSchema,
  agentDraftSaveSchema,
  agentAuthoringDraftPageSchema,
  agentAuthoringDraftViewSchema,
} from "./agent-authoring.js";

describe("unpublished agent authoring contracts", () => {
  it("accepts explicit Hire version references and bounded setup steps without client-supplied pins or authority", () => {
    const requestId = "10000000-0000-4000-8000-000000000001";
    expect(agentDraftCreateSchema.parse({ requestId })).toEqual({
      requestId,
      agentId: null,
      packageVersionId: null,
    });
    expect(
      agentDraftCreateSchema.safeParse({
        requestId,
        packageVersionId: requestId,
      }).success,
    ).toBe(true);
    expect(
      agentDraftCreateSchema.safeParse({
        requestId,
        packageVersionId: requestId,
        packageContentHash: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      agentDraftSaveSchema.safeParse({
        requestId,
        expectedVersion: 1,
        step: "hire_authority",
        content: {},
      }).success,
    ).toBe(true);
    expect(
      agentDraftSaveSchema.safeParse({
        requestId,
        expectedVersion: 1,
        step: "hire_activated",
        content: {},
      }).success,
    ).toBe(false);
  });
  it("keeps earlier accepted drafts readable above the new write budget", () => {
    const content = agentAuthoringContentSchema.parse({
      scenarios: Array.from({ length: 10 }, () => "界".repeat(1800)),
    });
    content.instructions.responsibilities = "界".repeat(3200);
    const bytes = new TextEncoder().encode(JSON.stringify(content)).length;
    expect(bytes).toBeGreaterThan(62 * 1024);
    expect(bytes).toBeLessThan(64 * 1024);
    expect(agentAuthoringContentSchema.safeParse(content).success).toBe(false);
    expect(
      agentAuthoringDraftViewSchema.safeParse({
        id: "10000000-0000-4000-8000-000000000001",
        companyId: "10000000-0000-4000-8000-000000000002",
        agentId: null,
        createdByUserId: "author",
        version: 1,
        status: "draft",
        step: "instructions",
        content,
        baselineHash: null,
        createdAt: "2026-10-09T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  it("rejects complete Unicode payloads above the storage budget and null characters before a database write", () => {
    expect(
      agentAuthoringContentSchema.safeParse({
        instructions: {
          responsibilities: "界".repeat(6000),
          prohibited: "界".repeat(3000),
        },
        scenarios: Array.from({ length: 10 }, () => "界".repeat(2000)),
      }).success,
    ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({ name: "Name\u0000invalid" })
        .success,
    ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({ name: "Name\ud800invalid" })
        .success,
    ).toBe(false);
    expect(
      agentAuthoringContentSchema.safeParse({ name: "Valid \ud83d\ude00" })
        .success,
    ).toBe(true);
    expect(
      agentAuthoringContentSchema.safeParse({
        scenarios: Array.from({ length: 10 }, () => "界".repeat(1500)),
      }).success,
    ).toBe(true);
  });
  it("keeps instructions, owner identity and request receipts out of draft history", () => {
    const summary = {
      id: "10000000-0000-4000-8000-000000000001",
      companyId: "10000000-0000-4000-8000-000000000002",
      agentId: null,
      version: 1,
      name: "Private draft",
      step: "identity",
      updatedAt: "2026-10-09T00:00:00.000Z",
    };
    expect(
      agentAuthoringDraftPageSchema.safeParse({
        items: [summary],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      agentAuthoringDraftPageSchema.safeParse({
        items: [{ ...summary, content: {} }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
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
