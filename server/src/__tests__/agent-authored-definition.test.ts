import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { agentAuthoringContentSchema, authoredAgentMappingBlockers } from "@paperclipai/shared";
import { compileAuthoredAgentDefinition, authoredAgentInstructionText } from "../services/agents/authored-definition.js";
import { nativeSha256 } from "../services/native-runtime/canonical.js";

const candidate = () => agentAuthoringContentSchema.parse({ name: "Welcome specialist", outcome: "Create internal welcome drafts",
  ownerUserId: "owner", description: "Drafts a welcome message", capabilities: [{ operation: "create_internal_draft", autonomy: "automatic" }],
  instructions: { purpose: "Welcome teammates", responsibilities: "Draft one welcome message", prohibited: "Do not contact anyone",
    missingInformation: "Ask the owner", escalation: "Ask the owner when uncertain", communication: "Use plain language" } });
describe("Canonical authored Agent definition", () => {
  it("keeps the exact saved instructions and a stable content digest", () => {
    const content = candidate(), revisionId = randomUUID(), candidateHash = "a".repeat(64);
    const definition = compileAuthoredAgentDefinition(content, revisionId, candidateHash);
    expect(definition).toMatchObject({ revisionId, candidateHash, definitionHash: nativeSha256(content), content });
    const text = authoredAgentInstructionText(content);
    for (const value of [content.name, content.outcome, ...Object.values(content.instructions)]) expect(text).toContain(value);
    expect(compileAuthoredAgentDefinition({ ...content, instructions: { ...content.instructions, prohibited: "Different limits" } }, revisionId, candidateHash).definitionHash)
      .not.toBe(definition.definitionHash);
  });
  it.each(["none", "not_allowed", "ask_first"])("does not invent automatic internal-draft authority from %s", autonomy => {
    const content = candidate(); content.capabilities = autonomy === "none" ? [] : [{ operation: "create_internal_draft", autonomy: autonomy as "not_allowed" | "ask_first" }];
    expect(authoredAgentMappingBlockers(content)).toContain("internal_draft_authority_required");
    expect(() => compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64))).toThrow();
  });
  it.each(["read_approved_knowledge", "create_task", "external_send", "spend"] as const)("does not turn %s into an instruction-only grant", operation => {
    const content = candidate(); content.capabilities.push({ operation, autonomy: "ask_first" });
    expect(authoredAgentMappingBlockers(content)).toContain("capability_mapping_required");
  });
  it("rejects credentials instead of publishing silently redacted instructions", () => {
    const content = candidate(); content.instructions.purpose = "token=private-secret-value";
    expect(() => compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64)))
      .toThrow("Remove credential-shaped values");
  });
  it("requires actual knowledge and memory mappings", () => {
    const content = candidate(); content.knowledgeDocumentIds = [randomUUID()]; content.memory = "approved_work_preferences";
    expect(authoredAgentMappingBlockers(content)).toEqual(["knowledge_mapping_required", "memory_mapping_required"]);
  });
});
