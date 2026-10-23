import { z } from "zod";

export const NATIVE_PAYLOAD_SOURCE_REFERENCE_LIMIT = 256;

// Canonical UUID spelling avoids duplicate identities with different casing.
// This validates shape, not source existence, tenant binding or permission.
const id = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(512).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value));
const byteSize = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ids = z.array(id).max(NATIVE_PAYLOAD_SOURCE_REFERENCE_LIMIT);

export const nativePayloadSourceOwnerSchema = z.object({
  kind: z.enum(["issue", "project", "memory_record", "comment", "document_revision", "attachment"]),
  companyId: id,
  id,
  contentHash: sha256,
}).strict();

export const nativePayloadSourcePolicySchema = z.object({
  issueIds: ids,
  projectIds: ids,
  runIds: ids,
  memoryIds: ids,
  foundationRevisionIds: ids,
}).strict();

/** Actual captured inputs, never prose, filesystem paths or arbitrary metadata.
 * Native DB versions are UUIDs; runtime/catalog Skill versions and native tool
 * call/session identifiers are opaque strings in their original contracts. */
export const nativePayloadSourceInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), issueId: id, sourceVersion: text, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("project"), projectId: id, sourceVersion: text, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("memory"), memoryId: id, sourceVersion: text, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("foundation_revision"), foundationDocumentId: id, documentId: id, revisionId: id, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("comment"), issueId: id, commentId: id, sourceVersion: text, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("interaction"), issueId: id, interactionId: id, sourceVersion: text, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("document_revision"), documentId: id, revisionId: id, issueId: id.nullable(), contentHash: sha256 }).strict(),
  z.object({
    kind: z.literal("attachment"), issueId: id, attachmentId: id, commentId: id.nullable(),
    assetId: id.nullable(), sha256: sha256.nullable(), byteSize: byteSize.nullable(),
    disposition: z.enum(["delivered", "remote_workspace_staging_unsupported", "attachment_binding_unavailable", "attachment_staging_failed"]),
  }).strict().superRefine((input, ctx) => {
    if (input.disposition === "delivered" && (input.assetId === null || input.sha256 === null || input.byteSize === null)) {
      ctx.addIssue({ code: "custom", message: "Delivered attachment requires its verified asset, hash and size." });
    }
    if (input.disposition === "attachment_binding_unavailable" && (input.assetId !== null || input.sha256 !== null || input.byteSize !== null)) {
      ctx.addIssue({ code: "custom", message: "Unavailable attachment binding cannot assert an asset tuple." });
    }
  }),
  z.object({ kind: z.literal("context"), manifestId: id, queryHash: sha256, policySnapshotHash: sha256, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("skill_version"), skillId: id, versionId: id, skillKey: text, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("runtime_skill"), key: text, versionId: text.nullable(), bundleDigest: sha256, manifestDigest: sha256 }).strict(),
  z.object({ kind: z.literal("playbook_revision"), playbookId: id, revisionId: id, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("role_pack_version"), rolePackId: id, versionId: id, contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("authored_definition"), agentId: id, revisionId: id, definitionHash: sha256, procedureSnapshotHash: sha256.nullable() }).strict(),
  z.object({ kind: z.literal("runtime_instructions"), agentId: id, bundleDigest: sha256, manifestDigest: sha256 }).strict(),
  z.object({ kind: z.literal("retained_run"), runId: id, inputDigest: sha256, dispatchDigest: sha256 }).strict(),
  z.object({ kind: z.literal("retained_workspace"), runId: id, executionWorkspaceId: id, sessionId: text.nullable(), contentHash: sha256 }).strict(),
  z.object({ kind: z.literal("tool_result"), runId: id, callId: text, toolName: text, invocationId: id.nullable(), contentHash: sha256 }).strict(),
]);

/** Structural contract only. It neither computes/verifies the digest nor proves
 * producer truth, completeness or access. NULL belongs to the containing owner
 * and means unknown; this parser never turns it into an empty snapshot. */
export const nativePayloadSourceSnapshotSchema = z.object({
  version: z.literal(1),
  owner: nativePayloadSourceOwnerSchema,
  policy: nativePayloadSourcePolicySchema,
  inputs: z.array(nativePayloadSourceInputSchema).max(NATIVE_PAYLOAD_SOURCE_REFERENCE_LIMIT),
  digest: sha256,
}).strict().superRefine((snapshot, ctx) => {
  let references = snapshot.inputs.length;
  for (const key of ["issueIds", "projectIds", "runIds", "memoryIds", "foundationRevisionIds"] as const) {
    const values = snapshot.policy[key];
    references += values.length;
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: "custom", path: ["policy", key], message: "Duplicate policy source identity." });
    }
  }
  if (references > NATIVE_PAYLOAD_SOURCE_REFERENCE_LIMIT) {
    ctx.addIssue({ code: "custom", message: "Native payload sources exceed their combined reference bound." });
  }
  // Strict parsed objects have schema-defined key order, so input object key
  // ordering cannot disguise an identical capture. Different versions/content
  // hashes for the same native source remain distinct captured inputs.
  const captures = snapshot.inputs.map(input => JSON.stringify(input));
  if (new Set(captures).size !== captures.length) {
    ctx.addIssue({ code: "custom", path: ["inputs"], message: "Duplicate captured input." });
  }
});

export type NativePayloadSourceOwner = z.infer<typeof nativePayloadSourceOwnerSchema>;
export type NativePayloadSourcePolicy = z.infer<typeof nativePayloadSourcePolicySchema>;
export type NativePayloadSourceInput = z.infer<typeof nativePayloadSourceInputSchema>;
export type NativePayloadSourceSnapshot = z.infer<typeof nativePayloadSourceSnapshotSchema>;
