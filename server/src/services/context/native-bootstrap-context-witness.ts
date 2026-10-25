import { createHash } from "node:crypto";
import { nativePayloadSourceSnapshotSchema, type NativePayloadSourceInput, type NativePayloadSourcePolicy } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";

type Manifest = { id: string; companyId: string; runId: string | null; agentId: string; issueId: string | null;
  projectId: string | null; queryHash: string; policySnapshotHash: string; createdAt: Date };
type Item = { id: string; manifestId: string; companyId: string; rank: number; sourceProvider: string; sourceRef: string;
  sourceVersion: string | null; contentHash: string; payloadSourceSnapshot: unknown };
type Root = { companyId: string; manifestId: string; memoryRecordId: string; sourceVersion: string; payloadSourceSnapshot: unknown };

export type NativeBootstrapContextWitness = object;
type WitnessData = { companyId: string; runId: string; agentId: string; issueId: string; renderedMarkdownDigest: string;
  manifestId: string; queryHash: string; policySnapshotHash: string; contentHash: string;
  actor: AuthorizationActor; policy: NativePayloadSourcePolicy; inputs: NativePayloadSourceInput[] };
const witnesses = new WeakMap<object, WitnessData>();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const emptyPolicy = (): NativePayloadSourcePolicy => ({ issueIds: [], projectIds: [], runIds: [], memoryIds: [], foundationRevisionIds: [] });
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Called only by the Context manifest owner while its source-verification transaction is active. */
export function captureNativeBootstrapContextWitness(input: { companyId: string; runId: string; agentId: string; issueId: string;
  actor: AuthorizationActor; renderedMarkdown: string; manifest: Manifest; items: Item[]; roots: Root[] }): NativeBootstrapContextWitness | null {
  try {
  const { manifest } = input;
  if (!uuid.test(input.companyId) || !uuid.test(input.runId) || !uuid.test(input.agentId) || !uuid.test(input.issueId) ||
    manifest.companyId !== input.companyId || manifest.runId !== input.runId || manifest.agentId !== input.agentId ||
    manifest.issueId !== input.issueId || input.actor.type !== "agent" ||
    (input.actor.source !== "agent_jwt" && input.actor.source !== "none") ||
    input.actor.companyId !== input.companyId || input.actor.agentId !== input.agentId || input.actor.runId !== input.runId ||
    !input.actor.onBehalfOfUserId || input.items.length === 0 || input.items.length > 256 || input.roots.length > 256 ||
    input.items.some(item => item.companyId !== input.companyId || item.manifestId !== manifest.id) ||
    input.roots.some(root => root.companyId !== input.companyId || root.manifestId !== manifest.id))
    return null;

  const policy = emptyPolicy();
  if (manifest.projectId) policy.projectIds.push(manifest.projectId);
  const inputs: NativePayloadSourceInput[] = [];
  const appendSnapshot = (raw: unknown, ownerKind: "issue" | "memory_record", ownerId: string) => {
    const parsed = nativePayloadSourceSnapshotSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Native bootstrap Context payload snapshot is unavailable");
      if (parsed.data.owner.kind !== ownerKind || parsed.data.owner.companyId !== input.companyId || parsed.data.owner.id !== ownerId) {
        throw new Error("Native bootstrap Context payload snapshot is unavailable");
      }
    for (const key of Object.keys(policy) as Array<keyof NativePayloadSourcePolicy>)
      policy[key] = [...new Set([...policy[key], ...parsed.data.policy[key]])].sort();
    for (const source of parsed.data.inputs) {
      if (source.kind === "context") throw new Error("Nested Context source closure is unavailable");
      if (!inputs.some(existing => JSON.stringify(existing) === JSON.stringify(source))) inputs.push(source);
    }
  };
  for (const item of [...input.items].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))) {
    if (!item.sourceVersion || !/^[0-9a-f]{64}$/i.test(item.contentHash)) {
      throw new Error("Native bootstrap Context item is incomplete");
    }
    if (item.sourceProvider === "august_works_tasks") {
      const match = /^issue:\/\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(item.sourceRef);
      if (!match) throw new Error("Native bootstrap Task Context reference is invalid");
      policy.issueIds = [...new Set([...policy.issueIds, match[1]!])].sort();
      appendSnapshot(item.payloadSourceSnapshot, "issue", match[1]!);
    } else if (item.sourceProvider === "august_works_foundation") {
      const match = /^foundation:\/\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/(?:whole|\d+))?$/i.exec(item.sourceRef);
      if (!match || item.sourceVersion !== match[2]) throw new Error("Native bootstrap Foundation Context reference is invalid");
      policy.foundationRevisionIds = [...new Set([...policy.foundationRevisionIds, match[2]!])].sort();
    } else if (item.sourceProvider === "august_works_memory") {
      const match = /^memory:\/\/record\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(item.sourceRef);
      if (!match || !input.roots.some(root => root.memoryRecordId === match[1] && root.sourceVersion === item.sourceVersion))
        throw new Error("Native bootstrap Memory Context root is unavailable");
      policy.memoryIds = [...new Set([...policy.memoryIds, match[1]!])].sort();
    } else if (item.sourceProvider !== "august_works_derived_memory") {
      throw new Error("Native bootstrap Context provider is unsupported");
    }
  }
  for (const root of input.roots) {
    if (!uuid.test(root.memoryRecordId) || !root.sourceVersion) throw new Error("Native bootstrap Memory root is incomplete");
    policy.memoryIds = [...new Set([...policy.memoryIds, root.memoryRecordId])].sort();
    appendSnapshot(root.payloadSourceSnapshot, "memory_record", root.memoryRecordId);
  }
  if (inputs.length + Object.values(policy).reduce((sum, values) => sum + values.length, 0) > 256)
    throw new Error("Native bootstrap Context source set exceeds its bound");

  const renderedMarkdownDigest = sha256(input.renderedMarkdown);
  const contentHash = sha256(JSON.stringify({
    manifest: { id: manifest.id, companyId: manifest.companyId, runId: manifest.runId, agentId: manifest.agentId,
      issueId: manifest.issueId, projectId: manifest.projectId, queryHash: manifest.queryHash,
      policySnapshotHash: manifest.policySnapshotHash, createdAt: manifest.createdAt.toISOString() },
    items: [...input.items].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map(item => ({ id: item.id,
      rank: item.rank, provider: item.sourceProvider, ref: item.sourceRef, version: item.sourceVersion,
      contentHash: item.contentHash, payloadSourceSnapshot: item.payloadSourceSnapshot })),
    roots: [...input.roots].sort((a, b) => a.memoryRecordId.localeCompare(b.memoryRecordId)).map(root => ({
      memoryRecordId: root.memoryRecordId, sourceVersion: root.sourceVersion, payloadSourceSnapshot: root.payloadSourceSnapshot })),
    renderedMarkdownDigest, policy, inputs,
  }));
  const witness = Object.freeze({});
  witnesses.set(witness, { companyId: input.companyId, runId: input.runId, agentId: input.agentId, issueId: input.issueId,
    renderedMarkdownDigest, manifestId: manifest.id, queryHash: manifest.queryHash,
    policySnapshotHash: manifest.policySnapshotHash, contentHash, actor: structuredClone(input.actor), policy, inputs });
  return witness;
  } catch {
    return null;
  }
}

export function readNativeBootstrapContextWitness(value: unknown, expected: {
  companyId: string; runId: string; agentId: string; issueId: string; renderedMarkdown: string;
  manifestIds: readonly { companyId: string; contextManifestId: string }[];
}): { actor: AuthorizationActor; contextInput: Extract<NativePayloadSourceInput, { kind: "context" }>; policy: NativePayloadSourcePolicy;
  inputs: NativePayloadSourceInput[] } | null {
  if (!value || typeof value !== "object") return null;
  const data = witnesses.get(value as object);
  if (!data) return null;
  const failures = [data.companyId !== expected.companyId, data.runId !== expected.runId, data.agentId !== expected.agentId,
    data.issueId !== expected.issueId || sha256(expected.renderedMarkdown) !== data.renderedMarkdownDigest ||
    expected.manifestIds.length !== 1, expected.manifestIds[0]?.companyId !== data.companyId,
    expected.manifestIds[0]?.contextManifestId !== data.manifestId];
  if (failures.some(Boolean)) return null;
  return { actor: structuredClone(data.actor), contextInput: { kind: "context", manifestId: data.manifestId, queryHash: data.queryHash,
    policySnapshotHash: data.policySnapshotHash, contentHash: data.contentHash }, policy: structuredClone(data.policy), inputs: structuredClone(data.inputs) };
}
