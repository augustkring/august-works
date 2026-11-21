import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { contextManifests, type Db, type heartbeatRuns } from "@paperclipai/db";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * APR-E2E-16. On a Native Run's first frame no input receipt is sealed yet;
 * the bootstrap closure the server prepared at launch is persisted on the Run
 * (`nativePreparedBootstrapSourceClosure`). Return the candidate inputs as
 * that Run's bootstrap inputs only when all of these hold, otherwise null:
 * - the Run is the running Native Run of this Task and Agent, on source
 *   protocol version 0, with no sealed receipt and no prior Native effects
 *   (no dispatch intent, tool-call association or tool-result capture);
 * - its prepared closure is bound to this company, Run, Agent and Task and to
 *   the persisted execution input;
 * - the candidate inputs are that prepared closure's inputs exactly, in
 *   order, plus at most one extra input: the turn's Context input (kind
 *   `context`) that the server attaches to the first frame after launch.
 * It returns the prepared inputs and those Context inputs separately; the
 * caller must prove each Context input is a manifest of this same Run (see
 * nativeHistoricalPendingContextForParentInner). The caller passes a Run row
 * it re-read in its own source-read transaction. A Run with a sealed receipt
 * keeps using its receipt.
 */
export function nativeFirstConstructorBootstrapInputs(
  run: Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "status" | "runtimeMode" |
    "nativeIssueId" | "nativeInputSourceProtocolVersion" | "runnerProfileJson"> | null | undefined,
  input: { companyId: string; issueId: string; agentId: string; candidate: readonly NativePayloadSourceInput[] | undefined },
): { inputs: NativePayloadSourceInput[];
  turnContextInputs: Extract<NativePayloadSourceInput, { kind: "context" }>[] } | null {
  if (!run || !input.candidate || run.companyId !== input.companyId || run.agentId !== input.agentId ||
    run.nativeIssueId !== input.issueId || run.status !== "running" || run.runtimeMode !== "native" ||
    run.nativeInputSourceProtocolVersion !== 0) return null;
  const profile = record(run.runnerProfileJson);
  if (profile.nativeInputSourceReceipt !== undefined || profile.nativeExecutionInput === undefined ||
    ![profile.nativeModelInputDispatchIntents, profile.nativeToolCallDispatchAssociations,
      profile.nativeToolResultSourceCaptures].every(value => value === undefined || Array.isArray(value) && value.length === 0))
    return null;
  const closure = record(profile.nativePreparedBootstrapSourceClosure);
  const binding = record(closure.binding);
  const sourceSet = record(record(closure.closure).sourceSet);
  if (closure.version !== 1 || binding.companyId !== run.companyId || binding.runId !== run.id ||
    binding.agentId !== run.agentId || binding.issueId !== input.issueId ||
    closure.executionInputHash !== nativeSha256(profile.nativeExecutionInput) ||
    !Array.isArray(sourceSet.inputs)) return null;
  const prepared = sourceSet.inputs as NativePayloadSourceInput[];
  const extras = input.candidate.filter(candidate => !prepared.some(value => isDeepStrictEqual(value, candidate)));
  const turnContextInputs = extras.filter((value): value is Extract<NativePayloadSourceInput, { kind: "context" }> =>
    value.kind === "context");
  if (turnContextInputs.length !== extras.length || turnContextInputs.length > 1 ||
    !isDeepStrictEqual(input.candidate.filter(candidate => !extras.includes(candidate)), prepared)) return null;
  return { inputs: [...prepared], turnContextInputs };
}

/**
 * APR-E2E-16. nativeFirstConstructorBootstrapInputs plus the proof that each
 * of the turn's Context inputs is a manifest of this same Run, Agent and Task
 * with the same query and policy hashes, read in the caller's transaction.
 * Returns the prepared bootstrap inputs, or null.
 */
export async function nativeFirstConstructorBootstrapInputsCurrent(
  db: Pick<Db, "select">,
  run: Parameters<typeof nativeFirstConstructorBootstrapInputs>[0],
  input: Parameters<typeof nativeFirstConstructorBootstrapInputs>[1],
): Promise<NativePayloadSourceInput[] | null> {
  const selected = nativeFirstConstructorBootstrapInputs(run, input);
  if (!selected || !run) return null;
  for (const source of selected.turnContextInputs) {
    const [manifest] = await db.select().from(contextManifests).where(and(eq(contextManifests.companyId, input.companyId),
      eq(contextManifests.id, source.manifestId))).for("share");
    if (!manifest || manifest.runId !== run.id || manifest.agentId !== run.agentId || manifest.issueId !== input.issueId ||
      manifest.queryHash !== source.queryHash || manifest.policySnapshotHash !== source.policySnapshotHash) return null;
  }
  return selected.inputs;
}
