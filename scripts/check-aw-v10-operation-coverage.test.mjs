import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { extractApiClientMethods, extractUiClientOperations, validateOperationCoverage } from "./aw-v10-operation-coverage.mjs";
import { collectMountedUiSources } from "./check-aw-v10-operation-coverage.mjs";

const entry = (operationId, criticality = "material") => ({ operationId, criticality, canonicalService: "service.run", owner: "server/owner.ts" });
const action = (actionId) => ({ actionId, source: "ui/action.tsx", sourceAnchor: "onClick", owner: "server/owner.ts", reason: "Reviewed UI-only human action with a separate canonical owner and no agent operation." });
const row = (operationId) => ({ operationId, disposition: "excluded", canonicalOwner: "server/owner.ts", uiSource: "ui/action.tsx", sourceAnchor: "onClick", reason: "This Human UI action is governed by a separate operation and must not inherit an Agent execution path." });
const base = {
  version: 1,
  operations: [row("blentera.example.run")],
  uiOnlyActions: [action("example.human.approve")],
  clientOperations: [],
  nonMaterialUiSources: [],
};
const sources = new Map([
  ["ui/action.tsx", "<button onClick={run}>"],
  ["server/owner.ts", "export const owner = true;"],
]);
const validate = (manifestEntries, inventory = base, mountedUiOperations) => validateOperationCoverage({
  manifestEntries,
  inventory,
  exists: (path) => sources.has(path),
  readSource: (path) => sources.get(path) ?? "",
  mountedUiOperations,
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

test("fails when a new UI client mutation appears while the inventory stays unchanged", () => {
  sources.set("ui/action.tsx", "export const save = () => accessApi.securitySuspendMember();");
  const failures = validate([entry("blentera.example.run")]);
  assert.ok(failures.some((failure) => failure.startsWith("Unclassified mounted UI client operation: ui/action.tsx#accessApi.securitySuspendMember:unknown@")));
  sources.set("ui/action.tsx", "<button onClick={run}>");
});

test("classifies client reads from HTTP definitions and catches custom-named writes", () => {
  const definitions = extractApiClientMethods([
    'import { api as defaultApi } from "./client";',
    "export const accessApi = {",
    "read: (id: string) => defaultApi.get(`/companies/${id}/security`),",
    "securitySuspendMember: (id: string) => defaultApi.patch(`/companies/${id}/security/suspend`),",
    "};",
  ].join("\n"), "ui/src/api/access.ts");
  const registry = new Map(definitions.map((method) => [`${method.exportName}.${method.method}`, method]));
  const calls = extractUiClientOperations(`
    import { accessApi } from "@/api/access";
    accessApi.read("user");
    accessApi.securitySuspendMember("user");
  `, "ui/src/pages/Security.tsx", registry);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiVerb, "write");
  assert.deepEqual(calls[0].routeSignatures, ["patch:`/companies/${id}/security/suspend`"]);
});

test("keeps opaque fetch init objects unknown instead of assuming GET", () => {
  const [method] = extractApiClientMethods(
    'export const customApi = { run: (url: string, init: RequestInit) => fetch(url, init) };',
    "ui/src/api/custom.ts",
  );
  assert.equal(method.verb, "unknown");
  const [call] = extractUiClientOperations('fetch("/api/action", requestOptions);', "ui/src/pages/Action.tsx");
  assert.equal(call.apiVerb, "unknown");
});

test("treats a second direct POST endpoint in one source as a distinct operation", () => {
  const source = 'api.post("/api/known", { ok: true });\napi.post("/api/security/suspend", { userId });';
  sources.set("ui/action.tsx", source);
  const [known] = extractUiClientOperations(source, "ui/action.tsx");
  const inventory = structuredClone(base);
  inventory.clientOperations = [{
    source: "ui/action.tsx",
    ...known,
    owner: "server/owner.ts",
    reason: "This direct UI request is reviewed as a separate action under the current server-owned Human authorization contract.",
  }];
  const failures = validate([entry("blentera.example.run")], inventory);
  assert.ok(failures.some((failure) => failure.includes("Unclassified mounted UI client operation: ui/action.tsx#api.post:post")));
  sources.set("ui/action.tsx", "<button onClick={run}>");
});

test("fails for an API action in a newly mounted source outside the existing inventory", () => {
  const root = mkdtempSync(resolve(tmpdir(), "aw-v10-operation-route-"));
  const write = (path, source) => {
    const fullPath = resolve(root, path);
    mkdirSync(resolve(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, source);
  };
  try {
    write("ui/src/App.tsx", 'import { NewSecurityRoute } from "@/routes"; void NewSecurityRoute;');
    write("ui/src/routes/index.ts", 'export { NewSecurityRoute } from "../pages/NewSecurityRoute";');
    write("ui/src/pages/NewSecurityRoute.tsx", 'import { accessApi } from "@/api/access"; export const NewSecurityRoute = () => { accessApi.performCriticalAction(); accessApi.setSomething(); };');
    write("ui/src/api/access.ts", "export const accessApi = {}; ");
    write("ui/src/pages/V9RouteEntries.tsx", "export {};");
    const mountedSources = collectMountedUiSources(root);
    const operations = new Map([...mountedSources]
      .filter((source) => source.startsWith("ui/src/") && !source.startsWith("ui/src/api/"))
      .map((source) => [source, extractUiClientOperations(readFileSync(resolve(root, source), "utf8"), source)])
      .filter(([, calls]) => calls.length));
    assert.ok(mountedSources.has("ui/src/pages/NewSecurityRoute.tsx"));
    const failures = validate([entry("blentera.example.run")], base, operations);
  assert.ok(failures.includes("Unclassified mounted UI source with client operations: ui/src/pages/NewSecurityRoute.tsx"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects inventory entries that are absent from the canonical manifest", () => {
  const inventory = structuredClone(base);
  inventory.operations.push(row("blentera.unknown.operation"));
  assert.ok(validate([entry("blentera.example.run")], inventory).includes("Inventory operation is absent from the Agent-Native manifest: blentera.unknown.operation"));
});
