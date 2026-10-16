const requiredImplementation = [
  "native_openshell_host_bridge",
  "credential_use_broker_and_revocation",
  "pre_spend_model_reservation",
];
const requiredHosting = [
  ...Array.from({ length: 18 }, (_, i) => `H6-${String(i + 1).padStart(2, "0")}`),
  "H7-01", "H7-02", "H7-03",
];

/** Only checks the retained prerequisite declarations. Passing this check does
 * not authenticate their evidence, promote a release or enable a runtime. */
export function v9ReleasePrerequisiteFailures({ v9, v8, v7 }) {
  const failures = [];
  if (typeof v9?.acceptedBy !== "string" || !v9.acceptedBy.trim())
    failures.push("Release coverage requires a named V9 acceptance owner");
  if (v8?.version !== 1 || v8.sourceComplete !== true)
    failures.push("Release coverage requires complete V8 predecessor source");
  if (v8?.predecessorStatus !== "passed")
    failures.push("Release coverage requires passed inherited H6/H7 hosting gates");
  const hosting = Array.isArray(v8?.predecessorGateIds) ? v8.predecessorGateIds : [];
  for (const id of requiredHosting) {
    if (hosting.filter(value => value === id).length !== 1)
      failures.push(`Missing or duplicate inherited hosting gate: ${id}`);
  }
  if (v7?.version !== 1 || !Array.isArray(v7?.implementationBlockers)) {
    failures.push("Release coverage requires the canonical V7 implementation register");
  }
  const implementation = Array.isArray(v7?.implementationBlockers) ? v7.implementationBlockers : [];
  for (const id of requiredImplementation) {
    const entries = implementation.filter(value => value?.id === id);
    if (entries.length !== 1 || entries[0].status !== "implemented_and_verified")
      failures.push(`Incomplete or missing inherited implementation: ${id}`);
  }
  // Future blockers also remain authoritative; omitting known IDs cannot clear
  // the mandatory three above, and unknown values are never echoed into logs.
  if (implementation.some(value => !value || value.status !== "implemented_and_verified"))
    failures.push("V7 implementation register still contains incomplete work");
  return failures;
}
