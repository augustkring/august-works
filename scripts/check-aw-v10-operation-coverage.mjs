import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { extractApiClientMethods, extractStaticImports, extractUiClientOperations, validateOperationCoverage } from "./aw-v10-operation-coverage.mjs";

const root = resolve(import.meta.dirname, "..");

export function collectMountedUiSources(rootPath = root) {
  const mountedSources = new Set();
  const pending = ["ui/src/App.tsx", "ui/src/pages/V9RouteEntries.tsx"];
  const visited = new Set();
  while (pending.length) {
    const modulePath = pending.pop();
    if (visited.has(modulePath) || !existsSync(resolve(rootPath, modulePath))) continue;
    visited.add(modulePath);
    if (modulePath.startsWith("ui/src/")) mountedSources.add(modulePath);
    const source = readFileSync(resolve(rootPath, modulePath), "utf8");
    for (const specifier of extractStaticImports(source, modulePath)) {
      const resolvedSpecifier = specifier.startsWith("@/")
        ? resolve(rootPath, "ui/src", specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(rootPath, dirname(modulePath), specifier)
          : null;
      if (!resolvedSpecifier) continue;
      const path = relative(rootPath, resolvedSpecifier).replaceAll("\\", "/");
      if (path.startsWith("../") || isAbsolute(path) || !path.startsWith("ui/src/")) continue;
      const candidate = path.replace(/\.(?:tsx?|jsx?)$/, "");
      let found = false;
      for (const extension of [".tsx", ".ts", ".jsx", ".js"]) {
        if (existsSync(resolve(rootPath, candidate + extension))) {
          pending.push(candidate + extension);
          found = true;
        }
      }
      if (!found) {
        for (const extension of ["/index.tsx", "/index.ts", "/index.jsx", "/index.js"]) {
          if (existsSync(resolve(rootPath, candidate + extension))) pending.push(candidate + extension);
        }
      }
    }
  }
  return mountedSources;
}

export function collectMountedUiOperations(rootPath = root) {
  const mountedSources = collectMountedUiSources(rootPath);
  const apiClientVerbs = new Map();
  for (const source of mountedSources) {
    if (!source.startsWith("ui/src/api/")) continue;
    for (const method of extractApiClientMethods(readFileSync(resolve(rootPath, source), "utf8"), source)) {
      const key = `${method.exportName}.${method.method}`;
      const prior = apiClientVerbs.get(key);
      apiClientVerbs.set(key, prior && JSON.stringify(prior) !== JSON.stringify(method)
        ? { verb: "unknown", routeSignatures: [] }
        : method);
    }
  }
  const mountedUiOperations = new Map();
  for (const source of mountedSources) {
    if (source.startsWith("ui/src/api/")) continue;
    const calls = extractUiClientOperations(readFileSync(resolve(rootPath, source), "utf8"), source, apiClientVerbs);
    if (calls.length) mountedUiOperations.set(source, calls);
  }
  return { mountedSources, mountedUiOperations };
}

export async function checkOperationCoverage(rootPath = root) {
  const inventory = JSON.parse(readFileSync(resolve(rootPath, "doc/operations/agent-native-ui-operation-coverage.json"), "utf8"));
  createRequire(resolve(rootPath, "cli/package.json"))("tsx/esm/api").register();
  const { AGENT_NATIVE_OPERATION_MANIFEST } = await import(pathToFileURL(resolve(rootPath, "server/src/services/agent-native-operation-manifest.ts")).href);
  const { mountedSources, mountedUiOperations } = collectMountedUiOperations(rootPath);
  const failures = validateOperationCoverage({
    manifestEntries: AGENT_NATIVE_OPERATION_MANIFEST,
    inventory,
    exists: (path) => existsSync(resolve(rootPath, path)),
    readSource: (path) => readFileSync(resolve(rootPath, path), "utf8"),
    mountedSources,
    mountedUiOperations,
  });
  const apiOnlyCount = AGENT_NATIVE_OPERATION_MANIFEST.filter((entry) => entry.apiOnly).length;
  return { failures, summary: `V10 mounted UI operation classification verified: ${inventory.operations.length} Agent tool operations, ${apiOnlyCount} unqualified existing API-only contracts, ${inventory.clientOperations?.length ?? 0} exact mounted UI callsites reviewed; API-only contracts expose no tools.` };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { failures, summary } = await checkOperationCoverage();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(summary);
  }
}
