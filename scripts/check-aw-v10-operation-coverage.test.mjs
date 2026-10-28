import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationCoverage } from "./aw-v10-operation-coverage.mjs";

const entry = (operationId, criticality = "material") => ({ operationId, criticality, canonicalService: "service.run", owner: "server/owner.ts" });
const action = (actionId) => ({ actionId, source: "ui/action.tsx", sourceAnchor: "onClick", owner: "server/owner.ts", reason: "Reviewed UI-only human action with a separate canonical owner and no agent operation." });
const row = (operationId) => ({ operationId, disposition: "excluded", canonicalOwner: "server/owner.ts", uiSource: "ui/action.tsx", sourceAnchor: "onClick", reason: "This Human UI action is governed by a separate operation and must not inherit an Agent execution path." });
const base = {
  version: 1,
  operations: [row("blentera.example.run")],
  uiOnlyActions: [action("example.human.approve")],
};
const sources = new Map([
  ["ui/action.tsx", "<button onClick={run}>"],
  ["server/owner.ts", "export const owner = true;"],
]);
const validate = (manifestEntries, inventory = base) => validateOperationCoverage({
  manifestEntries,
  inventory,
  exists: (path) => sources.has(path),
  readSource: (path) => sources.get(path) ?? "",
});

test("accepts classified material operations and explicit Human-only actions", () => {
  assert.deepEqual(validate([entry("blentera.example.run")]), []);
});

test("fails closed when a new material manifest operation lacks UI classification", () => {
  const failures = validate([entry("blentera.example.run"), entry("blentera.new.material")]);
  assert.ok(failures.includes("Unclassified material Agent-Native operation: blentera.new.material"));
});

test("rejects an unmapped mounted UI operation instead of accepting a wildcard", () => {
  const inventory = structuredClone(base);
  inventory.uiOnlyActions.push({ ...action("new.ui.action"), reason: "" });
  assert.ok(validate([entry("blentera.example.run")], inventory).includes("UI-only action requires a reviewed exclusion reason: new.ui.action"));
});

test("rejects inventory entries that are absent from the canonical manifest", () => {
  const inventory = structuredClone(base);
  inventory.operations.push(row("blentera.unknown.operation"));
  assert.ok(validate([entry("blentera.example.run")], inventory).includes("Inventory operation is absent from the Agent-Native manifest: blentera.unknown.operation"));
});
