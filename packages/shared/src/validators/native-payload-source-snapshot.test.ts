import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nativePayloadSourceSnapshotSchema, type NativePayloadSourceInput } from "./native-payload-source-snapshot.js";

const hash = "a".repeat(64);
function snapshot(inputs: NativePayloadSourceInput[] = []) {
  return { version: 1 as const, owner: { kind: "issue" as const, companyId: randomUUID(), id: randomUUID(), contentHash: hash },
    policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs, digest: hash };
}

describe("Native payload source snapshot structural boundary", () => {
  it("retains distinct body captures and actual opaque runtime identifiers without granting source truth", () => {
    const issueId = randomUUID();
    const value = snapshot([
      { kind: "task", issueId, sourceVersion: "2026-10-23T00:00:00.000Z", contentHash: hash },
      { kind: "project", projectId: randomUUID(), sourceVersion: "2026-10-23T00:00:00.000Z", contentHash: hash },
      { kind: "task", issueId, sourceVersion: "2026-10-23T00:00:01.000Z", contentHash: "b".repeat(64) },
      { kind: "task", issueId, sourceVersion: "2026-10-23T00:00:00.000Z", contentHash: "c".repeat(64) },
      { kind: "skill_version", skillId: randomUUID(), versionId: randomUUID(), skillKey: "native/review", contentHash: hash },
      { kind: "runtime_skill", key: "paperclip", versionId: "catalog-release-2026.10", bundleDigest: hash, manifestDigest: hash },
      { kind: "runtime_skill", key: "builtin", versionId: null, bundleDigest: hash, manifestDigest: hash },
      { kind: "retained_workspace", runId: randomUUID(), executionWorkspaceId: randomUUID(), sessionId: "opaque-provider-session-1", contentHash: hash },
      { kind: "tool_result", runId: randomUUID(), callId: "native-call-1", toolName: "read_task", invocationId: null, contentHash: hash },
    ]);
    // A structurally valid digest is not a verified seal or a completeness bit.
    expect(nativePayloadSourceSnapshotSchema.parse(value)).toEqual(value);
    for (const code of [0, 10, 31, 127]) {
      const control = String.fromCharCode(code);
      expect(nativePayloadSourceSnapshotSchema.safeParse(snapshot([{ kind: "tool_result", runId: randomUUID(),
        callId: `native${control}call`, toolName: "read_task", invocationId: null, contentHash: hash }])).success).toBe(false);
    }
    expect(nativePayloadSourceSnapshotSchema.safeParse({ ...value, inputs: [{ kind: "skill_version", skillId: randomUUID(),
      versionId: "catalog-release-2026.10", skillKey: "native/review", contentHash: hash }] }).success).toBe(false);
  });

  it("does not default missing roots or turn historical NULL into known empty provenance", () => {
    const value = snapshot();
    expect(nativePayloadSourceSnapshotSchema.safeParse(null).success).toBe(false);
    const owner = z.object({ payloadSourceSnapshot: nativePayloadSourceSnapshotSchema.nullable() }).strict();
    expect(owner.parse({ payloadSourceSnapshot: null })).toEqual({ payloadSourceSnapshot: null });
    expect(owner.safeParse({}).success).toBe(false);
    const { memoryIds: _removed, ...incomplete } = value.policy;
    expect(nativePayloadSourceSnapshotSchema.safeParse({ ...value, policy: incomplete }).success).toBe(false);
    const { inputs: _inputs, ...withoutInputs } = value;
    expect(nativePayloadSourceSnapshotSchema.safeParse(withoutInputs).success).toBe(false);
    const { owner: _owner, ...withoutBinding } = value;
    expect(nativePayloadSourceSnapshotSchema.safeParse(withoutBinding).success).toBe(false);
  });

  it("rejects unknown versions, families, nested metadata and authority-shaped additions", () => {
    const value = snapshot();
    for (const invalid of [
      { ...value, version: 2 }, { ...value, qualified: true }, { ...value, owner: { ...value.owner, kind: "run" } },
      { ...value, policy: { ...value.policy, grants: [] } },
      { ...value, inputs: [{ kind: "external_source", sourceRef: "arbitrary://body", contentHash: hash }] },
      { ...value, inputs: [{ kind: "task", issueId: randomUUID(), sourceVersion: "1", contentHash: hash, roots: value.policy }] },
    ]) expect(nativePayloadSourceSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it("bounds the combined source population without dropping inputs and rejects duplicate captures", () => {
    const inputs = Array.from({ length: 255 }, (_, index): NativePayloadSourceInput => ({ kind: "task", issueId: randomUUID(), sourceVersion: String(index), contentHash: hash }));
    const value = { ...snapshot(inputs), policy: { ...snapshot().policy, memoryIds: [randomUUID()] } };
    expect(nativePayloadSourceSnapshotSchema.parse(value).inputs).toHaveLength(255);
    expect(nativePayloadSourceSnapshotSchema.safeParse({ ...value, policy: { ...value.policy, runIds: [randomUUID()] } }).success).toBe(false);
    expect(nativePayloadSourceSnapshotSchema.safeParse({ ...snapshot(), policy: { ...value.policy, memoryIds: [value.policy.memoryIds[0]!, value.policy.memoryIds[0]!] } }).success).toBe(false);
    const capture = { kind: "task" as const, issueId: randomUUID(), sourceVersion: "1", contentHash: hash };
    const reordered = { contentHash: hash, sourceVersion: "1", issueId: capture.issueId, kind: "task" as const };
    expect(nativePayloadSourceSnapshotSchema.safeParse(snapshot([capture, reordered])).success).toBe(false);
  });

  it("distinguishes verified delivered attachments from actual omissions", () => {
    const base = { kind: "attachment" as const, issueId: randomUUID(), attachmentId: randomUUID(), commentId: null };
    expect(nativePayloadSourceSnapshotSchema.safeParse(snapshot([{ ...base, disposition: "delivered", assetId: randomUUID(), sha256: hash, byteSize: 0 }])).success).toBe(true);
    expect(nativePayloadSourceSnapshotSchema.safeParse(snapshot([{ ...base, disposition: "attachment_binding_unavailable", assetId: null, sha256: null, byteSize: null }])).success).toBe(true);
    for (const capture of [
      { ...base, disposition: "delivered" as const, assetId: null, sha256: null, byteSize: null },
      { ...base, disposition: "attachment_binding_unavailable" as const, assetId: randomUUID(), sha256: hash, byteSize: 12 },
      { ...base, disposition: "delivered" as const, assetId: randomUUID(), sha256: hash, byteSize: Number.MAX_SAFE_INTEGER + 1 },
    ]) expect(nativePayloadSourceSnapshotSchema.safeParse(snapshot([capture])).success).toBe(false);
  });
});
