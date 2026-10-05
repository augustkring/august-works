/** Shared with the standalone Node 24 host agent; this module has no application dependencies. */
export function runtimeRequestSigningInput(
  method: string,
  path: string,
  bodyHash: string,
  proof: { hostId: string; epoch: number; timestamp: string; nonce: string },
): string {
  return [
    "aw-runtime-host-v6",
    proof.hostId,
    String(proof.epoch),
    method.toUpperCase(),
    path,
    proof.timestamp,
    proof.nonce,
    bodyHash,
  ].join("\n");
}
