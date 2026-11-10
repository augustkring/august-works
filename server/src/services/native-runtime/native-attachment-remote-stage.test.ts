import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { nativeSha256 } from "./canonical.js";
import {
  buildNativeRemoteAttachmentStageCommand,
  parseNativeRemoteAttachmentStageCommand,
  readNativeAttachmentStageCleanupReceipts,
} from "./native-attachment-remote-stage.js";

const runId = "12345678-1234-4234-9234-123456789abc";
const stageNonce = "22345678-1234-4234-9234-123456789abc";
const attachmentId = "32345678-1234-4234-9234-123456789abc";
const issueId = "42345678-1234-4234-9234-123456789abc";
const companyId = "92345678-1234-4234-9234-123456789abc";
const agentId = "82345678-1234-4234-9234-123456789abc";
const leaseId = "72345678-1234-4234-9234-123456789abc";

function capturedProfile() {
  const sourceSnapshot = { version: 1 as const,
    owner: { kind: "attachment" as const, companyId, id: attachmentId, contentHash: "a".repeat(64) },
    policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [], digest: "b".repeat(64) };
  const sourceCaptures = [{ input: { kind: "attachment", issueId: "42345678-1234-4234-9234-123456789abc",
    attachmentId, commentId: "52345678-1234-4234-9234-123456789abc", assetId: "62345678-1234-4234-9234-123456789abc",
    sha256: "a".repeat(64), byteSize: 19, disposition: "delivered" }, payloadSourceSnapshot: sourceSnapshot }];
  const remoteStageReceipts = [{ attachmentId, stageNonce, sha256: "a".repeat(64), byteSize: 19 }];
  const sourceCaptureHash = nativeSha256(sourceCaptures);
  const metadata = { eventSeq: 12, attempt: 1, responsibleUserId: "72345678-1234-4234-9234-123456789abc",
    baseTaskDigest: "b".repeat(64), finalTaskDigest: "c".repeat(64), sourceCaptureHash,
    descriptorHash: "d".repeat(64), remoteStageReceipts };
  return { nativeExecutionInput: { binding: { companyId, runId, issueId, agentId } },
    nativeAttachmentStageSources: [{ ...metadata, stageHash: nativeSha256(metadata), sourceCaptures }] };
}

describe("Native remote attachment staging owners", () => {
  it("admits only the exact fixed upload command shape and nested base64 chunk", () => {
    const chunkBase64 = Buffer.from("small attachment bytes").toString("base64");
    const command = buildNativeRemoteAttachmentStageCommand({ taskRoot: "/workspace/task", operation: {
      phase: "append", runId, stageNonce, attachmentId, offset: 0, totalBytes: 23, chunkBase64,
    } });
    const request = { cwd: "/workspace/task", argv: [command.command, ...(command.args ?? [])],
      stdinBase64: Buffer.from(command.stdin ?? "").toString("base64") } as any;
    expect(parseNativeRemoteAttachmentStageCommand(request, "/workspace/task")).toMatchObject({
      phase: "append", runId, stageNonce, attachmentId, offset: 0, totalBytes: 23, chunkBase64,
    });
    expect(parseNativeRemoteAttachmentStageCommand({ ...request, argv: [...request.argv.slice(0, 3), "arbitrary shell", ...request.argv.slice(4)] },
      "/workspace/task")).toBeNull();
    expect(parseNativeRemoteAttachmentStageCommand({ ...request, stdinBase64: Buffer.from("other bytes").toString("base64") },
      "/workspace/task")).toBeNull();
  });

  it("executes fixed-fd init, append, commit, repeat cleanup, and denies a symlink ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "paperclip-attachment-stage-"));
    const outside = mkdtempSync(join(tmpdir(), "paperclip-attachment-outside-"));
    writeFileSync(join(outside, "neighbor"), "preserve");
    const invoke = (taskRoot: string, operation: Parameters<typeof buildNativeRemoteAttachmentStageCommand>[0]["operation"]) => {
      const command = buildNativeRemoteAttachmentStageCommand({ taskRoot, operation });
      return spawnSync(process.execPath, command.args, { cwd: taskRoot, input: command.stdin, encoding: "utf8" });
    };
    try {
      const bytes = Buffer.from("verified remote attachment bytes");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      expect(invoke(root, { phase: "init", runId, stageNonce, attachmentId }).status).toBe(0);
      expect(invoke(root, { phase: "append", runId, stageNonce, attachmentId, offset: 0, totalBytes: bytes.length,
        chunkBase64: bytes.toString("base64") }).status).toBe(0);
      expect(invoke(root, { phase: "commit", runId, stageNonce, attachmentId, totalBytes: bytes.length, sha256 }).status).toBe(0);
      expect(readFileSync(join(root, ".paperclip-inbound", runId, stageNonce, "payload"))).toEqual(bytes);
      expect(invoke(root, { phase: "cleanup", runId, stageNonce, attachmentId }).status).toBe(0);
      expect(invoke(root, { phase: "cleanup", runId, stageNonce, attachmentId }).status).toBe(0);

      const absentRun = "62345678-1234-4234-9234-123456789abc";
      const absentNonce = "72345678-1234-4234-9234-123456789abc";
      expect(invoke(root, { phase: "cleanup", runId: absentRun, stageNonce: absentNonce, attachmentId }).status).toBe(0);

      const symlinkRun = "52345678-1234-4234-9234-123456789abc";
      const symlinkRoot = mkdtempSync(join(tmpdir(), "paperclip-attachment-symlink-"));
      symlinkSync(outside, join(symlinkRoot, ".paperclip-inbound"));
      expect(invoke(symlinkRoot, { phase: "init", runId: symlinkRun,
        stageNonce: "42345678-1234-4234-9234-123456789abc", attachmentId }).status)
        .not.toBe(0);
      expect(readdirSync(outside)).toEqual(["neighbor"]);
      expect(readFileSync(join(outside, "neighbor"), "utf8")).toBe("preserve");
      rmSync(symlinkRoot, { recursive: true, force: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps legacy runs without attachment staging metadata cleanup-compatible", () => {
    expect(readNativeAttachmentStageCleanupReceipts({}, runId)).toEqual([]);
    expect(() => readNativeAttachmentStageCleanupReceipts({ nativeAttachmentStageSources: [] }, runId))
      .toThrow("native_attachment_cleanup_binding_invalid");
    expect(() => readNativeAttachmentStageCleanupReceipts({ nativeAttachmentStageIntents: [] }, runId))
      .toThrow("native_attachment_cleanup_binding_invalid");
    const bound = { nativeExecutionInput: { binding: { runId, issueId } } };
    expect(() => readNativeAttachmentStageCleanupReceipts({ ...bound, nativeAttachmentStageSources: {} }, runId))
      .toThrow("native_attachment_cleanup_receipts_invalid");
    expect(() => readNativeAttachmentStageCleanupReceipts({ ...bound, nativeAttachmentStageIntents: {} }, runId))
      .toThrow("native_attachment_cleanup_intents_invalid");
  });

  it("retains only stage nonces whose source and capture hashes still agree", () => {
    const profile = capturedProfile();
    expect(readNativeAttachmentStageCleanupReceipts(profile, runId)).toEqual([{
      attachmentId, stageNonce, sha256: "a".repeat(64), byteSize: 19,
    }]);
    const tampered = structuredClone(profile);
    (tampered.nativeAttachmentStageSources[0]!.remoteStageReceipts[0] as any).attachmentId = "82345678-1234-4234-9234-123456789abc";
    expect(() => readNativeAttachmentStageCleanupReceipts(tampered, runId)).toThrow("native_attachment_cleanup_receipts_invalid");
    expect(() => readNativeAttachmentStageCleanupReceipts(profile, "------------------------------------")).toThrow();
  });

  it("retains a pre-write intent for deletion without requiring a committed source capture", () => {
    const sourceBinding = { kind: "attachment" as const, issueId, attachmentId,
      commentId: "52345678-1234-4234-9234-123456789abc",
      assetId: "62345678-1234-4234-9234-123456789abc", sha256: "a".repeat(64), byteSize: 19,
    };
    const sourceSnapshot = { version: 1 as const,
      owner: { kind: "attachment" as const, companyId, id: attachmentId, contentHash: "a".repeat(64) },
      policy: { issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] }, inputs: [], digest: "b".repeat(64) };
    const unsigned = { schema: "paperclip.native-attachment-stage-intent.v1" as const,
      runId, companyId, issueId, agentId, leaseId, attachmentId, stageNonce,
      sha256: "a".repeat(64), byteSize: 19, executionInputHash: "e".repeat(64),
      relativePath: `.paperclip-inbound/${runId}/${stageNonce}/payload`,
      sourceBinding, sourceSnapshot, sourceSnapshotHash: nativeSha256(sourceSnapshot), phase: "staging" as const };
    const profile = { nativeExecutionInput: { binding: { companyId, runId, issueId, agentId } }, nativeAttachmentStageIntents: [
      { ...unsigned, integrityHash: nativeSha256(unsigned) },
    ] };
    expect(readNativeAttachmentStageCleanupReceipts(profile, runId, leaseId)).toEqual([
      { attachmentId, stageNonce, sha256: "a".repeat(64), byteSize: 19 },
    ]);
    const wrongInputHash = structuredClone(profile);
    wrongInputHash.nativeAttachmentStageIntents[0]!.executionInputHash = "f".repeat(64);
    expect(() => readNativeAttachmentStageCleanupReceipts(wrongInputHash, runId, leaseId))
      .toThrow("native_attachment_cleanup_intents_invalid");
    const wrongLease = structuredClone(profile);
    wrongLease.nativeAttachmentStageIntents[0]!.leaseId = "a2345678-1234-4234-9234-123456789abc";
    expect(() => readNativeAttachmentStageCleanupReceipts(wrongLease, runId, leaseId)).toThrow("native_attachment_cleanup_intents_invalid");
  });
});
