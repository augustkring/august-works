import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const ts = createRequire(import.meta.url)("typescript-compiler-api");
const httpMethods = new Set(["get", "post", "put", "patch", "delete", "deleteWithBody", "postForm", "putRaw"]);

export function extractApiClientMethods(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const methods = new Map();
  const helpers = new Map();
  const exports = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) helpers.set(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) helpers.set(declaration.name.text, declaration.initializer);
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
          /Api$/.test(declaration.name.text) && !/^create[A-Z]/.test(declaration.name.text)) exports.push(declaration.name.text);
    }
  }
  function analyze(node) {
    const verbs = new Set(), routes = new Set(), dependencies = new Set(), helperCalls = new Set();
    function visit(child) {
      if (ts.isCallExpression(child)) {
        if (ts.isPropertyAccessExpression(child.expression) && ts.isIdentifier(child.expression.expression)) {
          const receiver = child.expression.expression.text, method = child.expression.name.text;
          if (httpMethods.has(method) && (!/Api$/.test(receiver) || receiver === "defaultApi")) {
            verbs.add(method);
            routes.add(`${method}:${child.arguments[0]?.getText(sourceFile) ?? ""}`);
          } else if (/Api$/.test(receiver)) {
            dependencies.add(`${receiver}.${method}`);
          }
        } else if (ts.isIdentifier(child.expression)) {
          const helper = helpers.get(child.expression.text);
          if (helper) helperCalls.add(child.expression.text);
        }
        if (ts.isIdentifier(child.expression) && child.expression.text === "fetch") {
          const verb = fetchMethod(child, sourceFile);
          verbs.add(verb);
          routes.add(`${verb}:${child.arguments[0]?.getText(sourceFile) ?? ""}`);
        }
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    return { verbs, routes, dependencies, helperCalls };
  }
  function visit(node) {
    if (ts.isPropertyAssignment(node) && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const name = node.name.getText(sourceFile).replace(/^['"]|['"]$/g, "");
      methods.set(name, analyze(node.initializer));
    } else if (ts.isMethodDeclaration(node) && node.name) {
      methods.set(node.name.getText(sourceFile), analyze(node));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const resolveMethod = (owner, method, seen = new Set()) => {
    const key = `${owner}.${method}`;
    if (seen.has(key)) return { verbs: new Set(), routes: new Set() };
    seen.add(key);
    const analysis = owner === "@helper" ? analyze(helpers.get(method)) : methods.get(method);
    if (!analysis) return { verbs: new Set(), routes: new Set() };
    const verbs = new Set(analysis.verbs), routes = new Set(analysis.routes);
    for (const helper of analysis.helperCalls) {
      const value = resolveMethod("@helper", helper, new Set(seen));
      for (const verb of value.verbs) verbs.add(verb);
      for (const route of value.routes) routes.add(route);
    }
    for (const dependency of analysis.dependencies) {
      const value = resolveMethod(owner, dependency.split(".").at(-1), new Set(seen));
      for (const verb of value.verbs) verbs.add(verb);
      for (const route of value.routes) routes.add(route);
    }
    return { verbs, routes };
  };
  return exports.flatMap((exportName) => [...methods.keys()].map((method) => {
    const value = resolveMethod(exportName, method);
    const verb = value.verbs.has("unknown") ? "unknown"
      : [...value.verbs].some((item) => item !== "get") ? "write"
      : value.verbs.has("get") ? "get"
        : method === "downloadUrl" ? "local" : "unknown";
    return { exportName, method, verb, routeSignatures: [...value.routes].sort() };
  }));
}

function importedApiNames(sourceFile) {
  const names = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        if (/Api$/.test(importedName) || importedName === "api") names.set(element.name.text, importedName);
      }
    } else if (bindings && ts.isNamespaceImport(bindings) && /Api$/.test(bindings.name.text)) {
      names.set(bindings.name.text, bindings.name.text);
    }
  }
  return names;
}

export function extractUiClientOperations(source, fileName, apiClientVerbs = new Map()) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = importedApiNames(sourceFile);
  const found = [];
  const occurrences = new Map();
  function visit(node) {
    if (ts.isCallExpression(node) &&
        (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression) ||
          (ts.isIdentifier(node.expression) && node.expression.text === "fetch"))) {
      const expression = node.expression;
      const receiverNode = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
        ? expression.expression : null;
      const receiver = receiverNode?.getText(sourceFile) ?? "fetch";
      const method = ts.isPropertyAccessExpression(expression) ? expression.name.text
        : ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression)
          ? expression.argumentExpression.text : ts.isElementAccessExpression(expression) ? "<computed>" : "fetch";
      const apiNamespace = !!receiverNode && ts.isPropertyAccessExpression(receiverNode) && receiverNode.name.text === "api";
      const normalizedReceiver = apiNamespace ? "api" : receiver;
      const exportedClient = imported.get(receiver) ?? receiver;
      if (ts.isIdentifier(expression) && expression.text === "fetch" ||
          normalizedReceiver === "api" || imported.has(receiver) || /Api$/.test(receiver)) {
        const clientCall = `${normalizedReceiver}.${method}`;
        const pathSignature = node.arguments[0]?.getText(sourceFile) ?? "";
        const definition = apiClientVerbs.get(`${exportedClient}.${method}`);
        const apiVerb = normalizedReceiver === "api" || receiver === "fetch"
          ? (receiver === "fetch" ? fetchMethod(node, sourceFile) : httpMethods.has(method) ? method : "unknown")
          : definition?.verb ?? "unknown";
        const routeSignatures = normalizedReceiver === "api" || receiver === "fetch"
          ? [`${apiVerb}:${pathSignature}`] : definition?.routeSignatures ?? [];
        if (apiVerb === "get" || apiVerb === "local") return ts.forEachChild(node, visit);
        const argumentsSignature = node.arguments.map((argument) => argument.getText(sourceFile)).join(", ");
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const occurrenceKey = `${line}:${clientCall}:${pathSignature}:${argumentsSignature}`;
        const occurrence = occurrences.get(occurrenceKey) ?? 0;
        occurrences.set(occurrenceKey, occurrence + 1);
        found.push({ clientCall, apiVerb, pathSignature, routeSignatures, argumentsSignature, line, occurrence });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found.sort((left, right) => left.line - right.line || left.clientCall.localeCompare(right.clientCall) || left.pathSignature.localeCompare(right.pathSignature) || left.occurrence - right.occurrence);
}

function fetchMethod(node, sourceFile) {
  const options = node.arguments[1];
  if (!options) return "get";
  if (!ts.isObjectLiteralExpression(options)) return "unknown";
  if (options.properties.some((property) => ts.isSpreadAssignment(property))) return "unknown";
  const property = options.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(sourceFile).replaceAll(/[\"']/g, "") === "method");
  if (!property) return "get";
  if (!ts.isPropertyAssignment(property)) return "unknown";
  const method = property.initializer;
  if (!ts.isStringLiteral(method)) return "unknown";
  const verb = method.text.toLowerCase();
  return httpMethods.has(verb) ? verb : "unknown";
}

export function extractStaticImports(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = sourceFile.statements
    .filter((statement) => (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier))
    .map((statement) => statement.moduleSpecifier.text);
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

export function operationListHash(operations) {
  return createHash("sha256").update(JSON.stringify([...operations].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))).digest("hex");
}

export function operationKey(source, operation) {
  return JSON.stringify([source, operation.clientCall, operation.apiVerb, operation.routeSignatures, operation.line, operation.pathSignature, operation.argumentsSignature, operation.occurrence]);
}

function operationLabel(source, operation) {
  return `${source}#${operation.clientCall}:${operation.apiVerb}@${operation.line}[${operation.routeSignatures.join("|")}](${operation.argumentsSignature})#${operation.occurrence}`;
}

export function validateOperationCoverage({ manifestEntries, inventory, readSource, exists, mountedSources, mountedUiOperations }) {
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

  if (!Array.isArray(inventory.clientOperations)) {
    failures.push("Invalid V10 operation coverage inventory: missing clientOperations");
    return failures;
  }
  const listedClientOperations = new Map();
  for (const operation of inventory.clientOperations) {
    const key = operationKey(operation.source, operation);
    if (!operation.source || !operation.clientCall || !Number.isInteger(operation.line) || listedClientOperations.has(key)) {
      failures.push(`Missing or duplicate UI client operation: ${operationLabel(operation.source, operation)}`);
      continue;
    }
    listedClientOperations.set(key, operation);
    const label = operationLabel(operation.source, operation);
    if (!exists(operation.source)) failures.push(`Missing mounted UI operation source: ${label}`);
    if (!operation.owner || !exists(operation.owner)) failures.push(`Missing canonical UI operation owner: ${label}`);
    if (operation.operationId) {
      const entry = manifestById.get(operation.operationId);
      if (!entry) failures.push(`UI client operation references an absent manifest operation: ${label}`);
      else if (entry.owner !== operation.owner) failures.push(`UI client operation owner does not match the manifest: ${label}`);
    } else if (typeof operation.reason !== "string" || operation.reason.trim().length < 48) {
      failures.push(`UI-only client operation requires an explicit exclusion reason: ${label}`);
    }
  }
  const scopedUiSources = new Set([
    ...inventory.operations.map((operation) => operation.uiSource),
    ...inventory.uiOnlyActions.map((action) => action.source),
    ...inventory.clientOperations.map((operation) => operation.source),
  ].filter(Boolean));
  const actualClientOperations = new Map();
  for (const source of scopedUiSources) {
    if (!exists(source)) continue;
    if (mountedSources && !mountedSources.has(source)) failures.push(`UI client operation source is not mounted by the current route registry: ${source}`);
    const actual = mountedUiOperations?.has(source)
      ? mountedUiOperations.get(source)
      : extractUiClientOperations(readSource(source), source);
    actualClientOperations.set(source, actual);
    for (const clientCall of actual) {
      const key = operationKey(source, clientCall);
      if (!listedClientOperations.has(key)) failures.push(`Unclassified mounted UI client operation: ${operationLabel(source, clientCall)}`);
    }
  }
  for (const operation of listedClientOperations.values()) {
    const actual = actualClientOperations.get(operation.source);
    if (actual && !actual.some((op) => operationKey(operation.source, op) === operationKey(operation.source, operation))) {
      failures.push(`Stale UI client operation inventory entry: ${operationLabel(operation.source, operation)}`);
    }
  }

  if (!Array.isArray(inventory.nonMaterialUiSources)) {
    failures.push("Invalid V10 operation coverage inventory: missing explicit non-material UI source exclusions");
    return failures;
  }
  const exclusions = new Map();
  for (const exclusion of inventory.nonMaterialUiSources) {
    if (!exclusion.source || exclusions.has(exclusion.source)) {
      failures.push(`Missing or duplicate non-material UI source exclusion: ${exclusion.source ?? "<unknown>"}`);
      continue;
    }
    exclusions.set(exclusion.source, exclusion);
  }
  const materialSources = new Set(scopedUiSources);
  const uiOperations = mountedUiOperations ?? new Map([...scopedUiSources].filter(exists)
    .map((source) => [source, extractUiClientOperations(readSource(source), source)]));
  for (const [source, calls] of uiOperations) {
    if (!calls.length || materialSources.has(source)) continue;
    const exclusion = exclusions.get(source);
    if (!exclusion) {
      failures.push(`Unclassified mounted UI source with client operations: ${source}`);
      continue;
    }
    if (typeof exclusion.reason !== "string" || exclusion.reason.trim().length < 48) {
      failures.push(`Non-material UI source exclusion requires an explicit reason: ${source}`);
    }
    if (exclusion.operationCallsSha256 !== operationListHash(calls)) {
      failures.push(`Non-material UI source operation inventory drift: ${source}`);
    }
  }
  for (const source of exclusions.keys()) {
    if (!uiOperations.has(source) || !uiOperations.get(source).length) {
      failures.push(`Stale non-material UI source exclusion: ${source}`);
    }
  }
  return failures;
}
