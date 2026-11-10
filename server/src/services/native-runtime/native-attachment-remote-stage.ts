import { createHash } from "node:crypto";
import type { CommandManagedRuntimeRunner } from "@paperclipai/adapter-utils/command-managed-runtime";
import type { RuntimeSandboxExecRelayRequest } from "@paperclipai/shared";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { MAX_ATTACHMENT_BYTES } from "../../attachment-types.js";
import { nativeSha256 } from "./canonical.js";

export const NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE = "native_attachment_stage" as const;
export const NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE = "native_attachment_cleanup" as const;
export const NATIVE_ATTACHMENT_REMOTE_CHUNK_BYTES = 192 * 1024;

export type NativeAttachmentStageCleanupReceipt = {
  attachmentId: string;
  stageNonce: string;
  sha256: string;
  byteSize: number;
};

export type NativeAttachmentStageIntent = {
  schema: "paperclip.native-attachment-stage-intent.v1";
  runId: string;
  companyId: string;
  issueId: string;
  agentId: string;
  leaseId: string;
  attachmentId: string;
  stageNonce: string;
  sha256: string;
  byteSize: number;
  relativePath: string;
  sourceBinding: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
  sourceSnapshotHash: string;
  phase: "staging" | "committed";
  integrityHash: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Read only server-persisted stage receipts whose capture hashes still match.
 * These receipts authorize deletion in the stopped-workload cleanup owner only. */
export function readNativeAttachmentStageCleanupReceipts(profileValue: unknown, runId: string,
  leaseId?: string): NativeAttachmentStageCleanupReceipt[] {
  if (!UUID.test(runId)) throw new Error("native_attachment_cleanup_run_invalid");
  const profile = asRecord(profileValue);
  const captures = profile.nativeAttachmentStageSources;
  const intents = profile.nativeAttachmentStageIntents;
  if (captures === undefined && intents === undefined) return [];
  const execution = asRecord(profile.nativeExecutionInput), binding = asRecord(execution.binding);
  if (binding.runId !== runId || typeof binding.issueId !== "string" || !UUID.test(binding.issueId))
    throw new Error("native_attachment_cleanup_binding_invalid");
  if (captures !== undefined && (!Array.isArray(captures) || captures.length > 64))
    throw new Error("native_attachment_cleanup_receipts_invalid");
  const results: NativeAttachmentStageCleanupReceipt[] = [];
  const nonceSet = new Set<string>();
  for (const value of Array.isArray(captures) ? captures : []) {
    const capture = asRecord(value);
    if (capture.remoteStageReceipts === undefined) continue;
    const receipts = capture.remoteStageReceipts;
    const sourceCaptures = capture.sourceCaptures;
    if (!Array.isArray(receipts) || receipts.length > 20 || !Array.isArray(sourceCaptures))
      throw new Error("native_attachment_cleanup_receipts_invalid");
    const sourceHash = typeof capture.sourceCaptureHash === "string" ? capture.sourceCaptureHash : "";
    const sourceCaptureHash = nativeSha256(sourceCaptures);
    const baseTaskDigest = typeof capture.baseTaskDigest === "string" ? capture.baseTaskDigest : "";
    const finalTaskDigest = typeof capture.finalTaskDigest === "string" ? capture.finalTaskDigest : "";
    const descriptorHash = typeof capture.descriptorHash === "string" ? capture.descriptorHash : "";
    const stageHash = typeof capture.stageHash === "string" ? capture.stageHash : "";
    const eventSeq = capture.eventSeq, attempt = capture.attempt;
    const responsibleUserId = capture.responsibleUserId ?? null;
    const expectedStageHash = nativeSha256({ eventSeq, attempt, responsibleUserId, baseTaskDigest, finalTaskDigest,
      sourceCaptureHash, descriptorHash, remoteStageReceipts: receipts });
    if (!Number.isSafeInteger(eventSeq) || (eventSeq as number) < 1 || !Number.isSafeInteger(attempt) ||
      (attempt as number) < 1 || !/^[a-f0-9]{64}$/.test(baseTaskDigest) || !/^[a-f0-9]{64}$/.test(finalTaskDigest) ||
      !/^[a-f0-9]{64}$/.test(descriptorHash) || sourceHash !== sourceCaptureHash || stageHash !== expectedStageHash)
      throw new Error("native_attachment_cleanup_receipts_invalid");
    for (const rawReceipt of receipts) {
      const receipt = asRecord(rawReceipt);
      const attachmentId = receipt.attachmentId, stageNonce = receipt.stageNonce;
      const sha256 = receipt.sha256, byteSize = receipt.byteSize;
      if (typeof attachmentId !== "string" || !UUID.test(attachmentId) || typeof stageNonce !== "string" ||
        !UUID.test(stageNonce) || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
        !Number.isSafeInteger(byteSize) || (byteSize as number) < 1 || (byteSize as number) > MAX_ATTACHMENT_BYTES ||
        nonceSet.has(stageNonce)) throw new Error("native_attachment_cleanup_receipts_invalid");
      const original = sourceCaptures.map(asRecord).map(item => asRecord(item.input)).find(input =>
        input.kind === "attachment" && input.attachmentId === attachmentId);
      if (!original || original.issueId !== binding.issueId || original.disposition !== "delivered" ||
        original.sha256 !== sha256 || original.byteSize !== byteSize ||
        typeof original.assetId !== "string" || !UUID.test(original.assetId))
        throw new Error("native_attachment_cleanup_receipts_invalid");
      nonceSet.add(stageNonce);
      results.push({ attachmentId, stageNonce, sha256, byteSize: byteSize as number });
    }
  }
  if (intents !== undefined && (!Array.isArray(intents) || intents.length > 1280))
    throw new Error("native_attachment_cleanup_intents_invalid");
  for (const value of Array.isArray(intents) ? intents : []) {
    const intent = asRecord(value);
    const { integrityHash, ...unsigned } = intent;
    const sourceBinding = asRecord(intent.sourceBinding);
    const sourceSnapshot = nativePayloadSourceSnapshotSchema.safeParse(intent.sourceSnapshot);
    const expectedPath = typeof intent.stageNonce === "string"
      ? `.paperclip-inbound/${runId}/${intent.stageNonce}/payload` : "";
    if (intent.schema !== "paperclip.native-attachment-stage-intent.v1" || intent.runId !== runId ||
      (leaseId !== undefined && intent.leaseId !== leaseId) || !UUID.test(String(intent.companyId)) ||
      !UUID.test(String(intent.issueId)) || !UUID.test(String(intent.agentId)) || !UUID.test(String(intent.leaseId)) ||
      intent.companyId !== binding.companyId || intent.issueId !== binding.issueId || intent.agentId !== binding.agentId ||
      !UUID.test(String(intent.attachmentId)) || !UUID.test(String(intent.stageNonce)) ||
      !/^[a-f0-9]{64}$/.test(String(intent.sha256)) || !Number.isSafeInteger(intent.byteSize) ||
      (intent.byteSize as number) < 1 || (intent.byteSize as number) > MAX_ATTACHMENT_BYTES ||
      intent.relativePath !== expectedPath || sourceBinding.kind !== "attachment" ||
      sourceBinding.issueId !== intent.issueId || sourceBinding.attachmentId !== intent.attachmentId ||
      !UUID.test(String(sourceBinding.commentId)) || !UUID.test(String(sourceBinding.assetId)) ||
      sourceBinding.sha256 !== intent.sha256 || sourceBinding.byteSize !== intent.byteSize || !sourceSnapshot.success ||
      sourceSnapshot.data.owner.kind !== "attachment" || sourceSnapshot.data.owner.companyId !== intent.companyId ||
      sourceSnapshot.data.owner.id !== intent.attachmentId || intent.sourceSnapshotHash !== nativeSha256(sourceSnapshot.data) ||
      !["staging", "committed"].includes(String(intent.phase)) ||
      integrityHash !== nativeSha256(unsigned))
      throw new Error("native_attachment_cleanup_intents_invalid");
    const stageNonce = intent.stageNonce as string;
    const existing = results.find(receipt => receipt.stageNonce === stageNonce);
    if (existing) {
      if (existing.attachmentId !== intent.attachmentId || existing.sha256 !== intent.sha256 || existing.byteSize !== intent.byteSize)
        throw new Error("native_attachment_cleanup_receipts_invalid");
      continue;
    }
    if (nonceSet.has(stageNonce)) throw new Error("native_attachment_cleanup_receipts_invalid");
    nonceSet.add(stageNonce);
    results.push({ attachmentId: intent.attachmentId as string, stageNonce,
      sha256: intent.sha256 as string, byteSize: intent.byteSize as number });
  }
  if (results.length > 1280) throw new Error("native_attachment_cleanup_receipt_budget_exceeded");
  return results;
}

// The descriptor walk is rooted at an opened workspace fd. Every child is
// opened with O_NOFOLLOW, so symlink swaps in the provider workspace cannot
// redirect writes outside the opaque run/nonce directory.
const STAGE_SCRIPT = String.raw`
const fs=require('node:fs'),p=require('node:path'),crypto=require('node:crypto'),C=fs.constants;
const fail=()=>{throw new Error('attachment_stage_denied')};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const marker=process.argv[1],rootArg=process.argv[2],run=process.argv[3],nonce=process.argv[4],phase=process.argv[5],attachment=process.argv[6];
if(marker!=='paperclip-native-attachment-stage-v1'||!rootArg?.startsWith('/')||p.posix.normalize(rootArg)!==rootArg||
 !uuid.test(run||'')||!uuid.test(nonce||'')||!uuid.test(attachment||'')||!['init','append','commit','cleanup'].includes(phase))fail();
const rootReal=fs.realpathSync(rootArg);if(rootReal!==rootArg)fail();
const rootFd=fs.openSync(rootReal,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW|C.O_CLOEXEC);
const rootStat=fs.fstatSync(rootFd);if(!rootStat.isDirectory())fail();
const childPath=(fd,name)=>p.join('/proc/self/fd',String(fd),name);
function openDir(parent,name,create=false){
 if(!/^[a-zA-Z0-9._-]+$/.test(name)||name==='.'||name==='..')fail();
 const full=childPath(parent,name);
 if(create){try{fs.mkdirSync(full,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}}
 const fd=fs.openSync(full,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW|C.O_CLOEXEC),st=fs.fstatSync(fd);
 if(!st.isDirectory()||st.dev!==rootStat.dev){fs.closeSync(fd);fail()}
 return fd;
}
function openCleanupDir(parent,name){
 try{return openDir(parent,name)}catch(e){if(e.code==='ENOENT')return undefined;throw e}
}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino}
function unlinkTree(fd,depth=0){
 if(depth>32)fail();
 const dir=fs.opendirSync('/proc/self/fd/'+fd);
 try{for(let ent;(ent=dir.readSync())!==null;){const n=ent.name;if(!n||n==='.'||n==='..'||n.includes('/')||n.includes('\\')||n.includes('\0'))fail();
  const path=childPath(fd,n),before=fs.lstatSync(path);if(before.dev!==rootStat.dev)fail();
  if(before.isSymbolicLink()){const after=fs.lstatSync(path);if(!same(before,after)||!after.isSymbolicLink())fail();fs.unlinkSync(path)}
  else if(before.isDirectory()){const child=openDir(fd,n);try{if(!same(before,fs.fstatSync(child)))fail();fs.chmodSync('/proc/self/fd/'+child,(before.mode&0o777)|0o700);unlinkTree(child,depth+1);const after=fs.lstatSync(path);if(!same(after,fs.fstatSync(child))||!after.isDirectory())fail();fs.rmdirSync(path)}finally{fs.closeSync(child)}}
  else if(before.isFile()&&before.nlink===1){const after=fs.lstatSync(path);if(!same(before,after)||!after.isFile()||after.isSymbolicLink())fail();fs.unlinkSync(path)}else fail();
 }}finally{dir.closeSync()}
}
function readChunk(){const raw=fs.readFileSync(0,'utf8');if(!raw||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))fail();const b=Buffer.from(raw,'base64');if(!b.length||b.toString('base64')!==raw||b.length>196608)fail();return b}
let inbound,runRoot,stage;
try{
 if(phase==='cleanup'){
  inbound=openCleanupDir(rootFd,'.paperclip-inbound');
  if(inbound!==undefined)runRoot=openCleanupDir(inbound,run);
  if(runRoot!==undefined)stage=openCleanupDir(runRoot,nonce);
  if(stage!==undefined){
   const stagePath=childPath(runRoot,nonce);
   const opened=fs.fstatSync(stage);if(!opened.isDirectory())fail();fs.chmodSync('/proc/self/fd/'+stage,(opened.mode&0o777)|0o700);unlinkTree(stage);
   const before=fs.lstatSync(stagePath);if(!same(before,fs.fstatSync(stage))||!before.isDirectory())fail();fs.rmdirSync(stagePath);
   try{fs.lstatSync(stagePath);fail()}catch(e){if(e.code!=='ENOENT')throw e}
  }
 }else{
  inbound=openDir(rootFd,'.paperclip-inbound',phase==='init');runRoot=openDir(inbound,run,phase==='init');stage=openDir(runRoot,nonce,phase==='init');
  const stagePath=childPath(runRoot,nonce);
  if(phase==='init'){
  fs.fchmodSync(stage,0o700);const tmp=childPath(stage,'payload.upload');
  const fd=fs.openSync(tmp,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW|C.O_CLOEXEC,0o600);fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);fs.closeSync(fd);
  }else if(phase==='append'){
  const offset=Number(process.argv[7]),chunkSize=Number(process.argv[8]),total=Number(process.argv[9]);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>196608||!Number.isSafeInteger(total)||total<1||total>${MAX_ATTACHMENT_BYTES})fail();
  const bytes=readChunk();if(bytes.length!==chunkSize||offset+bytes.length>total)fail();
  const file=childPath(stage,'payload.upload'),fd=fs.openSync(file,C.O_WRONLY|C.O_APPEND|C.O_NOFOLLOW|C.O_CLOEXEC|C.O_NONBLOCK),before=fs.fstatSync(fd);
  try{if(!before.isFile()||before.nlink!==1||before.size!==offset)fail();let written=0;while(written<bytes.length)written+=fs.writeSync(fd,bytes,written,bytes.length-written,null);fs.fsyncSync(fd);
   const after=fs.fstatSync(fd),pathAfter=fs.lstatSync(file);if(!same(before,after)||!same(after,pathAfter)||after.size!==offset+bytes.length)fail();}
  finally{fs.closeSync(fd)}
  }else if(phase==='commit'){
  const total=Number(process.argv[7]),expected=process.argv[8];
  if(!Number.isSafeInteger(total)||total<1||total>${MAX_ATTACHMENT_BYTES}||! /^[a-f0-9]{64}$/.test(expected||''))fail();
  const tmp=childPath(stage,'payload.upload'),target=childPath(stage,'payload');
  const src=fs.openSync(tmp,C.O_RDONLY|C.O_NOFOLLOW|C.O_CLOEXEC|C.O_NONBLOCK),srcStat=fs.fstatSync(src);
  try{if(!srcStat.isFile()||srcStat.nlink!==1||srcStat.size!==total)fail();const h=crypto.createHash('sha256');const buf=Buffer.alloc(65536);let pos=0;
   while(pos<total){const n=fs.readSync(src,buf,0,Math.min(buf.length,total-pos),pos);if(!n)fail();h.update(buf.subarray(0,n));pos+=n}if(h.digest('hex')!==expected)fail();
   try{fs.lstatSync(target);fail()}catch(e){if(e.code!=='ENOENT')throw e}
   const dst=fs.openSync(target,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW|C.O_CLOEXEC,0o600);try{fs.fchmodSync(dst,0o600);pos=0;const copiedHash=crypto.createHash('sha256');
    while(pos<total){const n=fs.readSync(src,buf,0,Math.min(buf.length,total-pos),pos);if(!n)fail();copiedHash.update(buf.subarray(0,n));let w=0;while(w<n)w+=fs.writeSync(dst,buf,w,n-w,null);pos+=n}fs.fsyncSync(dst);
    const dstStat=fs.fstatSync(dst),pathAfter=fs.lstatSync(target);if(copiedHash.digest('hex')!==expected||!dstStat.isFile()||dstStat.nlink!==1||dstStat.size!==total||!same(dstStat,pathAfter))fail();
   }finally{fs.closeSync(dst)}
   const tmpAfter=fs.lstatSync(tmp);if(!same(srcStat,tmpAfter)||tmpAfter.isSymbolicLink())fail();fs.unlinkSync(tmp);
  }finally{fs.closeSync(src)}
  }
 }
}finally{for(const fd of [stage,runRoot,inbound,rootFd])if(fd!==undefined)try{fs.closeSync(fd)}catch{}}
`;

type StagePhase = "init" | "append" | "commit" | "cleanup";
export type NativeRemoteAttachmentStageOperation =
  | { phase: "init"; runId: string; stageNonce: string; attachmentId: string }
  | { phase: "append"; runId: string; stageNonce: string; attachmentId: string; offset: number; totalBytes: number; chunkBase64: string }
  | { phase: "commit"; runId: string; stageNonce: string; attachmentId: string; totalBytes: number; sha256: string }
  | { phase: "cleanup"; runId: string; stageNonce: string; attachmentId: string };

export type NativeRemoteAttachmentStageRequest = Parameters<CommandManagedRuntimeRunner["execute"]>[0];
function validUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }

export function nativeAttachmentStageRemotePath(input: { taskRoot: string; runId: string; stageNonce: string }): string {
  if (!input.taskRoot.startsWith("/") || input.taskRoot.includes("\0") || !validUuid(input.runId) || !validUuid(input.stageNonce))
    throw new Error("native_attachment_remote_stage_binding_invalid");
  return `${input.taskRoot.replace(/\/$/, "")}/.paperclip-inbound/${input.runId}/${input.stageNonce}/payload`;
}

export function buildNativeRemoteAttachmentStageCommand(input: {
  taskRoot: string;
  operation: NativeRemoteAttachmentStageOperation;
}): NativeRemoteAttachmentStageRequest {
  const { operation } = input;
  if (!input.taskRoot.startsWith("/") || input.taskRoot.includes("\0") || !validUuid(operation.runId) ||
      !validUuid(operation.stageNonce) || !validUuid(operation.attachmentId))
    throw new Error("native_attachment_remote_stage_binding_invalid");
  const args = ["--input-type=commonjs", "-e", STAGE_SCRIPT, "paperclip-native-attachment-stage-v1", input.taskRoot,
    operation.runId, operation.stageNonce, operation.phase, operation.attachmentId];
  let stdin = "";
  let purpose: typeof NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE | typeof NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE;
  if (operation.phase === "append") {
    if (!Number.isSafeInteger(operation.offset) || operation.offset < 0 || !Number.isSafeInteger(operation.totalBytes) ||
        operation.totalBytes < 1 || operation.totalBytes > MAX_ATTACHMENT_BYTES ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(operation.chunkBase64))
      throw new Error("native_attachment_remote_stage_chunk_invalid");
    const chunk = Buffer.from(operation.chunkBase64, "base64");
    if (!chunk.length || chunk.length > NATIVE_ATTACHMENT_REMOTE_CHUNK_BYTES || chunk.toString("base64") !== operation.chunkBase64 ||
        operation.offset + chunk.length > operation.totalBytes) throw new Error("native_attachment_remote_stage_chunk_invalid");
    args.push(String(operation.offset), String(chunk.length), String(operation.totalBytes));
    stdin = operation.chunkBase64;
    purpose = NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE;
  } else if (operation.phase === "commit") {
    if (!Number.isSafeInteger(operation.totalBytes) || operation.totalBytes < 1 || operation.totalBytes > MAX_ATTACHMENT_BYTES ||
        !/^[a-f0-9]{64}$/.test(operation.sha256)) throw new Error("native_attachment_remote_stage_commit_invalid");
    args.push(String(operation.totalBytes), operation.sha256);
    purpose = NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE;
  } else purpose = operation.phase === "cleanup" ? NATIVE_ATTACHMENT_CLEANUP_PREPARATION_PURPOSE : NATIVE_ATTACHMENT_STAGE_PREPARATION_PURPOSE;
  return { command: "node", args, cwd: input.taskRoot, stdin, bypassSession: true,
    nativePreparationPurpose: purpose };
}

export function parseNativeRemoteAttachmentStageCommand(request: RuntimeSandboxExecRelayRequest,
  expectedTaskRoot: string): NativeRemoteAttachmentStageOperation | null {
  if (request.cwd !== expectedTaskRoot || request.argv.length < 9 || request.argv[0] !== "node" ||
      request.argv[1] !== "--input-type=commonjs" || request.argv[2] !== "-e" || request.argv[3] !== STAGE_SCRIPT ||
      request.argv[4] !== "paperclip-native-attachment-stage-v1" || request.argv[5] !== expectedTaskRoot ||
      !validUuid(request.argv[6]) || !validUuid(request.argv[7]) || !validUuid(request.argv[9])) return null;
  const runId = request.argv[6]!, stageNonce = request.argv[7]!, phase = request.argv[8] as StagePhase, attachmentId = request.argv[9]!;
  if (phase === "init" && request.argv.length === 10 && request.stdinBase64 === "") return { phase, runId, stageNonce, attachmentId };
  if (phase === "append" && request.argv.length === 13) {
    const offset = Number(request.argv[10]), chunkBytes = Number(request.argv[11]), totalBytes = Number(request.argv[12]);
    const outer = request.stdinBase64;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 ||
      chunkBytes > NATIVE_ATTACHMENT_REMOTE_CHUNK_BYTES || !Number.isSafeInteger(totalBytes) || totalBytes < 1 ||
      totalBytes > MAX_ATTACHMENT_BYTES || !outer || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(outer)) return null;
    const inner = Buffer.from(outer, "base64").toString("utf8");
    if (Buffer.from(outer, "base64").toString("base64") !== outer || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(inner)) return null;
    const chunk = Buffer.from(inner, "base64");
    if (chunk.length !== chunkBytes || chunk.toString("base64") !== inner || offset + chunkBytes > totalBytes) return null;
    return { phase, runId, stageNonce, attachmentId, offset, totalBytes, chunkBase64: inner };
  }
  if (phase === "commit" && request.argv.length === 12 && request.stdinBase64 === "") {
    const totalBytes = Number(request.argv[10]), sha256 = request.argv[11];
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_ATTACHMENT_BYTES || !/^[a-f0-9]{64}$/.test(sha256 ?? "")) return null;
    return { phase, runId, stageNonce, attachmentId, totalBytes, sha256 };
  }
  if (phase === "cleanup" && request.argv.length === 10 && request.stdinBase64 === "") return { phase, runId, stageNonce, attachmentId };
  return null;
}

export async function executeNativeRemoteAttachmentStage(input: {
  runner: Pick<CommandManagedRuntimeRunner, "execute">;
  taskRoot: string;
  runId: string;
  attachmentId: string;
  bytes: Buffer;
  sha256: string;
  stageNonce: string;
}): Promise<{ relativePath: string; cleanup(): Promise<void> }> {
  if (!validUuid(input.runId) || !validUuid(input.attachmentId) || !validUuid(input.stageNonce) ||
      !Number.isSafeInteger(input.bytes.length) || input.bytes.length < 1 || input.bytes.length > MAX_ATTACHMENT_BYTES ||
      createHash("sha256").update(input.bytes).digest("hex") !== input.sha256)
    throw new Error("native_attachment_remote_stage_binding_invalid");
  const relativePath = `.paperclip-inbound/${input.runId}/${input.stageNonce}/payload`;
  const run = async (operation: NativeRemoteAttachmentStageOperation) => {
    const command = buildNativeRemoteAttachmentStageCommand({ taskRoot: input.taskRoot, operation });
    const result = await input.runner.execute(command);
    if (result.exitCode !== 0 || result.timedOut) throw new Error("native_attachment_remote_stage_failed");
  };
  try {
    await run({ phase: "init", runId: input.runId, stageNonce: input.stageNonce, attachmentId: input.attachmentId });
    for (let offset = 0; offset < input.bytes.length; offset += NATIVE_ATTACHMENT_REMOTE_CHUNK_BYTES) {
      const chunk = input.bytes.subarray(offset, Math.min(input.bytes.length, offset + NATIVE_ATTACHMENT_REMOTE_CHUNK_BYTES));
      await run({ phase: "append", runId: input.runId, stageNonce: input.stageNonce, attachmentId: input.attachmentId,
        offset, totalBytes: input.bytes.length, chunkBase64: chunk.toString("base64") });
    }
    await run({ phase: "commit", runId: input.runId, stageNonce: input.stageNonce, attachmentId: input.attachmentId,
      totalBytes: input.bytes.length, sha256: input.sha256 });
    return { relativePath, cleanup: async () => {
      await run({ phase: "cleanup", runId: input.runId, stageNonce: input.stageNonce, attachmentId: input.attachmentId });
    } };
  } catch (error) {
    await run({ phase: "cleanup", runId: input.runId, stageNonce: input.stageNonce, attachmentId: input.attachmentId }).catch(() => undefined);
    throw error;
  }
}
