import { isDeepStrictEqual } from "node:util";
import { nativePayloadSourceInputSchema, type NativeRunInputSourceReceipt } from "@paperclipai/shared";

export type NativeOutputInvocation = {
  id: string; companyId: string; runId: string | null; agentId: string | null;
  idempotencyKey: string | null; toolName: string; status: string;
  resultHash: string | null; argumentsHash: string | null;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Test result collection from original producer refs. The caller verifies the
 * persisted PostgreSQL receipt seal and reads the selected real owner rows. */
export function collectNativeManagedOutputReferences(input: {
  binding: Pick<NativeRunInputSourceReceipt["binding"], "companyId" | "runId" | "agentId">;
  additionalInputs: NativeRunInputSourceReceipt["additionalInputs"];
  captures: unknown[];
  invocations: NativeOutputInvocation[];
}) {
  const results: Array<{ invocationId: string; callId: string; toolName: string; taskId: string | null; memoryId: string | null }> = [];
  for (const raw of input.captures) {
    const capture = object(raw);
    if (capture.managedOpenCode !== true || !["create_task", "self_remember"].includes(String(capture.tool))) continue;
    const parsed = nativePayloadSourceInputSchema.safeParse(capture.source);
    if (!parsed.success || parsed.data.kind !== "tool_result") throw new Error("native_fixture_output_source_invalid");
    const source = parsed.data;
    const toolName = capture.tool === "self_remember" ? "paperclip-self:remember" : "create_task";
    const matches = input.invocations.filter(row => row.id === source.invocationId);
    const invocation = matches[0];
    if (matches.length !== 1 || !invocation || invocation.companyId !== input.binding.companyId ||
      invocation.runId !== input.binding.runId || invocation.agentId !== input.binding.agentId ||
      invocation.status !== "succeeded" || invocation.toolName !== toolName ||
      source.runId !== input.binding.runId || source.toolName !== toolName || source.callId !== capture.callId ||
      invocation.idempotencyKey !== `aw-native-tool:${input.binding.runId}:${source.callId}` ||
      typeof capture.argumentsHash !== "string" || !/^[a-f0-9]{64}$/.test(capture.argumentsHash) ||
      invocation.argumentsHash !== capture.argumentsHash || invocation.resultHash !== capture.resultDigest ||
      source.contentHash !== capture.resultDigest || results.some(row => row.invocationId === invocation.id))
      throw new Error("native_fixture_output_invocation_mismatch");
    const entries = input.additionalInputs.filter(entry => entry.inputs.some(atom => isDeepStrictEqual(atom, source)));
    if (entries.length !== 1) throw new Error("native_fixture_output_receipt_mismatch");
    const entry = entries[0]!;
    const outputs = entry.inputs.filter(atom => atom.kind === (capture.tool === "create_task" ? "task" : "memory"));
    if (outputs.length !== 1) throw new Error("native_fixture_output_owner_ambiguous");
    const output = outputs[0]!;
    const taskId = output.kind === "task" ? output.issueId : null;
    const memoryId = output.kind === "memory" ? output.memoryId : null;
    if (taskId ? object(capture.taskRef).issueId !== taskId || !entry.policy.issueIds.includes(taskId)
      : !memoryId || !entry.policy.memoryIds.includes(memoryId))
      throw new Error("native_fixture_output_owner_mismatch");
    results.push({ invocationId: invocation.id, callId: source.callId, toolName, taskId, memoryId });
  }
  return results;
}
