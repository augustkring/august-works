/** Evidence a managed OpenCode conformance Host records while it serves its
 * exact Run. Each probe Run gets its own per-presence Host, and the serial
 * owner retires (closes) a predecessor Host before admitting the next Run, so
 * the collector reads every Host that was ever created, retired or not. */
export type NativeConformanceRetainedObservations = {
  nativeConformanceStartTupleObservations: Array<{ runId: string; tuple: Record<string, string> }>;
  softwareOnlyPolicyProofObservations: Array<Record<string, unknown>>;
  execFacts: Array<Record<string, unknown>>;
};

export type NativeConformanceObservationOwner = {
  conformanceObservations?: () => NativeConformanceRetainedObservations;
};

/** Concatenates the recorded observations of each distinct owner, in owner
 * order. Rows are copied, never merged or deduplicated, so a duplicate or
 * missing start remains visible to the caller's exact-count checks. */
export function collectRetainedConformanceObservations(
  owners: Iterable<NativeConformanceObservationOwner | null | undefined>,
): NativeConformanceRetainedObservations {
  const collected: NativeConformanceRetainedObservations = {
    nativeConformanceStartTupleObservations: [], softwareOnlyPolicyProofObservations: [], execFacts: [],
  };
  const seen = new Set<NativeConformanceObservationOwner>();
  for (const owner of owners) {
    if (!owner || seen.has(owner)) continue;
    seen.add(owner);
    const observed = owner.conformanceObservations?.();
    if (!observed) continue;
    collected.nativeConformanceStartTupleObservations.push(...structuredClone(observed.nativeConformanceStartTupleObservations));
    collected.softwareOnlyPolicyProofObservations.push(...structuredClone(observed.softwareOnlyPolicyProofObservations));
    collected.execFacts.push(...structuredClone(observed.execFacts));
  }
  return collected;
}
