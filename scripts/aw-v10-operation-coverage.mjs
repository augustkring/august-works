export function validateOperationCoverage({ manifestEntries, inventory, readSource, exists }) {
  const failures = [];
  if (inventory?.version !== 1 || !Array.isArray(inventory.operations) || !Array.isArray(inventory.uiOnlyActions)) {
    return ["Invalid V10 operation coverage inventory shape"];
  }

  const manifestById = new Map();
  for (const entry of manifestEntries) {
    if (!entry.operationId || manifestById.has(entry.operationId)) {
      failures.push(`Missing or duplicate manifest operation: ${entry.operationId ?? "<unknown>"}`);
      continue;
    }
    manifestById.set(entry.operationId, entry);
  }

  const inventoryIds = new Set();
  for (const row of inventory.operations) {
    if (!row.operationId || inventoryIds.has(row.operationId)) {
      failures.push(`Missing or duplicate inventory operation: ${row.operationId ?? "<unknown>"}`);
      continue;
    }
    inventoryIds.add(row.operationId);
    const entry = manifestById.get(row.operationId);
    if (!entry) {
      failures.push(`Inventory operation is absent from the Agent-Native manifest: ${row.operationId}`);
      continue;
    }
    if (entry.criticality !== "material") failures.push(`Inventory row is not material in the manifest: ${row.operationId}`);
    if (!row.uiSource || !exists(row.uiSource)) failures.push(`Missing mounted UI source: ${row.operationId}`);
    else if (!row.sourceAnchor || !readSource(row.uiSource).includes(row.sourceAnchor)) {
      failures.push(`UI source anchor is missing: ${row.operationId}`);
    }
    if (!entry.owner || !exists(entry.owner)) failures.push(`Missing canonical owner source: ${row.operationId}`);
    if (row.canonicalOwner !== entry.owner) failures.push(`Inventory canonical owner does not match the manifest: ${row.operationId}`);
    if (!entry.canonicalService || typeof entry.canonicalService !== "string") failures.push(`Missing canonical service: ${row.operationId}`);
    if (row.disposition === "mapped") {
      if (typeof row.reason !== "string" || row.reason.trim().length < 32) failures.push(`Mapped operation needs a reviewed mapping rationale: ${row.operationId}`);
    } else if (row.disposition === "excluded") {
      if (typeof row.reason !== "string" || row.reason.trim().length < 48) failures.push(`Excluded operation needs an explicit reason: ${row.operationId}`);
    } else {
      failures.push(`Unknown operation disposition: ${row.operationId}`);
    }
  }

  const materialIds = new Set(manifestEntries.filter((entry) => entry.criticality === "material").map((entry) => entry.operationId));
  for (const operationId of materialIds) {
    if (!inventoryIds.has(operationId)) failures.push(`Unclassified material Agent-Native operation: ${operationId}`);
  }
  for (const operationId of inventoryIds) {
    if (!materialIds.has(operationId)) failures.push(`Inventory operation is not a current material operation: ${operationId}`);
  }

  const uiOnlyIds = new Set();
  for (const action of inventory.uiOnlyActions) {
    if (!action.actionId || uiOnlyIds.has(action.actionId)) {
      failures.push(`Missing or duplicate UI-only action: ${action.actionId ?? "<unknown>"}`);
      continue;
    }
    uiOnlyIds.add(action.actionId);
    if (!action.source || !exists(action.source)) failures.push(`Missing UI-only action source: ${action.actionId}`);
    else if (!action.sourceAnchor || !readSource(action.source).includes(action.sourceAnchor)) failures.push(`UI-only source anchor is missing: ${action.actionId}`);
    if (!action.owner || !exists(action.owner)) failures.push(`Missing UI-only canonical owner: ${action.actionId}`);
    if (typeof action.reason !== "string" || action.reason.trim().length < 48) {
      failures.push(`UI-only action requires a reviewed exclusion reason: ${action.actionId}`);
    }
    if (manifestById.has(action.actionId)) failures.push(`UI-only action must not reuse a manifest operation ID: ${action.actionId}`);
  }
  return failures;
}
