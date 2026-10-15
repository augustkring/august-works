import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { agentAuthoringContentSchema, authoredAgentMappingBlockers } from "@paperclipai/shared";
import { agentPublicationPackageProvenanceSchema } from "../../../packages/shared/src/agent-authoring-publication.js";
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
  it("preserves exact package provenance without exempting JWT-shaped strings from redaction", () => {
    const definition = compileAuthoredAgentDefinition(candidate(), randomUUID(), "a".repeat(64), "b".repeat(64), {
      version: 1, provenance: { draftId: randomUUID(), draftVersion: 2, candidateRevision: 1, requestedByUserId: "owner",
        reviewHash: "c".repeat(64), requestHash: "d".repeat(64), verifiedTestIds: [randomUUID()], priorRevisionId: null,
        activatedAtPublication: true, packageInstallation: { installationId: randomUUID(), versionId: randomUUID(), key: "welcome",
          releaseVersion: ["1", "0", "0"], contentHash: "e".repeat(64) } } });
    expect(definition.publication!.packageInstallation!.releaseVersion.join(".")).toBe("1.0.0");
    expect(() => compileAuthoredAgentDefinition({ ...candidate(), internalDescription: "eyJhbGciOiJIUzI1NiJ9.payload.signature" }, randomUUID(), "a".repeat(64)))
      .toThrow("Remove credential-shaped values");
  });
  it.each(["blentera.welcome.v1", "welcome..draft."])("preserves the valid dotted package key %s without a redaction exception", key => {
    const packageInstallation = { installationId: randomUUID(), versionId: randomUUID(), keyParts: key.split("."),
      releaseVersion: ["1", "0", "0"] as [string, string, string], contentHash: "e".repeat(64) };
    const definition = compileAuthoredAgentDefinition(candidate(), randomUUID(), "a".repeat(64), "b".repeat(64), {
      version: 1, provenance: { draftId: randomUUID(), draftVersion: 2, candidateRevision: 1, requestedByUserId: "owner",
        reviewHash: "c".repeat(64), requestHash: "d".repeat(64), verifiedTestIds: [randomUUID()], priorRevisionId: null,
        activatedAtPublication: true, packageInstallation } });
    expect(definition.publication!.packageInstallation).toEqual(packageInstallation);
    expect(agentPublicationPackageProvenanceSchema.safeParse({ ...packageInstallation, keyParts: [key] }).success).toBe(false);
    expect(agentPublicationPackageProvenanceSchema.safeParse({ ...packageInstallation, key: "ambiguous" }).success).toBe(false);
  });
  it.each(["none", "not_allowed", "ask_first"])("does not invent automatic internal-draft authority from %s", autonomy => {
    const content = candidate(); content.capabilities = autonomy === "none" ? [] : [{ operation: "create_internal_draft", autonomy: autonomy as "not_allowed" | "ask_first" }];
    expect(authoredAgentMappingBlockers(content)).toContain("internal_draft_authority_required");
    expect(() => compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64))).toThrow();
  });
  it.each(["read_approved_knowledge", "external_send", "spend"] as const)("does not turn %s into an instruction-only grant", operation => {
    const content = candidate(); content.capabilities.push({ operation, autonomy: "ask_first" });
    expect(authoredAgentMappingBlockers(content)).toContain("capability_mapping_required");
  });
  it("maps only Human-reviewed task data and keeps automatic task effects blocked", () => {
    const content = candidate(); content.capabilities.push({ operation: "create_task", autonomy: "ask_first" });
    expect(authoredAgentMappingBlockers(content)).toEqual([]);
    expect(compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64)).content.capabilities).toEqual(content.capabilities);
    content.capabilities[1]!.autonomy = "automatic";
    expect(authoredAgentMappingBlockers(content)).toContain("capability_mapping_required");
  });
  it("rejects credentials instead of publishing silently redacted instructions", () => {
    const content = candidate(); content.instructions.purpose = "token=private-secret-value";
    expect(() => compileAuthoredAgentDefinition(content, randomUUID(), "a".repeat(64)))
      .toThrow("Remove credential-shaped values");
  });
  it("requires current knowledge read authority and explicitly selected memory sources", () => {
    const content = candidate(); content.knowledgeDocumentIds = [randomUUID()]; content.memory = "approved_work_preferences";
    expect(authoredAgentMappingBlockers(content)).toEqual(["knowledge_read_authority_required", "memory_source_selection_required"]);
  });
});
