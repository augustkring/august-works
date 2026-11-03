import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectMountedUiOperations } from "./check-aw-v10-operation-coverage.mjs";

const root = resolve(import.meta.dirname, "..");

// A source-level principal/input change must receive a separate review. This
// one exact contact-call transition is authorized by V10 §§17.2 and 17.7: the
// Human-only boundary is retained and the caller now sends the principal and
// session identity used by the backend guard.
const reviewedSignatureChanges = [{
  source: "ui/src/pages/CompanySettings.tsx",
  clientCall: "companiesApi.updateResponsibilityContacts",
  apiVerb: "write",
  routeSignatures: ["patch:`/companies/${companyId}/responsibility-contacts`"],
  from: {
    pathSignature: "selectedCompanyId!",
    argumentsSha256: "207f165b48359a20a1ee587408eb3e3510badec575e118e7ef7ab2751b614b32",
  },
  to: {
    pathSignature: "input.companyId",
    argumentsSha256: "ac92d4e041c2dd6a1d32038de938bfe57a61d9735510b038058aa60d0854a0d1",
  },
  expectedClassification: "HUMAN_ONLY",
  review: "Human-only contact management retains current Human Board owner/admin authority; caller binds the requested company, principal, and session. This signature change has explicit §17.2/§17.7 review.",
}];

function canonicalSignature(source, operation) {
  return JSON.stringify([
    source,
    operation.clientCall,
    operation.apiVerb,
    [...(operation.routeSignatures ?? [])].sort(),
    operation.pathSignature,
    operation.argumentsSignature,
  ]);
}

function changeSignature(source, operation) {
  return JSON.stringify([
    source,
    operation.clientCall,
    operation.apiVerb,
    [...(operation.routeSignatures ?? [])].sort(),
    operation.pathSignature,
    createHash("sha256").update(operation.argumentsSignature).digest("hex"),
  ]);
}

function reviewedChangeSignature(change, side) {
  const fields = change[side];
  return JSON.stringify([
    change.source,
    change.clientCall,
    change.apiVerb,
    [...change.routeSignatures].sort(),
    fields.pathSignature,
    fields.argumentsSha256,
  ]);
}

function allowlistedChange(source, existing, current) {
  const before = changeSignature(source, existing);
  const after = changeSignature(source, current);
  return reviewedSignatureChanges.find((change) =>
    reviewedChangeSignature(change, "from") === before &&
    reviewedChangeSignature(change, "to") === after
  );
}

export function refreshClientOperationSignatures(inventory, mountedUiOperations) {
  if (!Array.isArray(inventory?.clientOperations)) throw new Error("Inventory is missing clientOperations");
  const actual = new Map();
  for (const [source, operations] of mountedUiOperations) {
    for (const operation of operations) actual.set(canonicalSignature(source, operation), { source, operation });
  }
  const existing = new Map();
  for (const row of inventory.clientOperations) {
    const signature = canonicalSignature(row.source, row);
    if (!existing.has(signature)) existing.set(signature, []);
    existing.get(signature).push(row);
  }

  const consumed = new Set();
  const replacements = new Map();
  let reviewedChanges = 0;
  for (const [signature, rows] of existing) {
    const exact = actual.get(signature);
    if (exact) {
      const matchingRows = rows.slice().sort((left, right) => left.line - right.line || left.occurrence - right.occurrence);
      const matchingCurrent = mountedUiOperations.get(exact.source)
        .filter((operation) => canonicalSignature(exact.source, operation) === signature)
        .sort((left, right) => left.line - right.line || left.occurrence - right.occurrence);
      if (matchingRows.length !== matchingCurrent.length) throw new Error(`Ambiguous duplicate operation signature: ${exact.source} ${rows[0].clientCall}`);
      if (matchingCurrent.some((operation) => consumed.has(operation))) {
        throw new Error(`One current UI operation matches more than one inventory row: ${exact.source} ${rows[0].clientCall}`);
      }
      matchingRows.forEach((row, index) => {
        const current = matchingCurrent[index];
        consumed.add(current);
        replacements.set(row, current);
      });
      continue;
    }

    if (rows.length !== 1) throw new Error(`Unmatched or ambiguous existing operation signature (${rows.length} rows): ${rows[0].source} ${rows[0].clientCall}`);
    const row = rows[0];
    const candidates = (mountedUiOperations.get(row.source) ?? []).filter((operation) =>
      operation.clientCall === row.clientCall && operation.apiVerb === row.apiVerb &&
      JSON.stringify([...operation.routeSignatures].sort()) === JSON.stringify([...row.routeSignatures].sort()) &&
      !consumed.has(operation) && allowlistedChange(row.source, row, operation)
    );
    if (candidates.length !== 1) throw new Error(`No unique exact reviewed signature transition for ${row.source} ${row.clientCall}`);
    const current = candidates[0];
    const review = allowlistedChange(row.source, row, current);
    if (!review || review.expectedClassification !== "HUMAN_ONLY" || row.classification !== review.expectedClassification) {
      throw new Error(`Reviewed signature transition requires its exact ${review?.expectedClassification ?? "missing"} classification for ${row.source} ${row.clientCall}`);
    }
    consumed.add(current);
    replacements.set(row, current);
    reviewedChanges++;
  }

  const output = inventory.clientOperations.map((row) => {
    const current = replacements.get(row);
    if (!current) throw new Error(`Existing inventory row was not matched: ${row.source} ${row.clientCall}`);
    return {
      ...row,
      clientCall: current.clientCall,
      apiVerb: current.apiVerb,
      pathSignature: current.pathSignature,
      routeSignatures: current.routeSignatures,
      argumentsSignature: current.argumentsSignature,
      line: current.line,
      occurrence: current.occurrence,
    };
  });
  const unmatched = [];
  for (const [source, operations] of mountedUiOperations) {
    for (const operation of operations) if (!consumed.has(operation)) unmatched.push(`${source}#${operation.clientCall}@${operation.line}`);
  }
  if (unmatched.length) throw new Error(`New/unclassified UI operations require human review; refusing refresh:\n${unmatched.join("\n")}`);
  return { clientOperations: output, matched: output.length, reviewedChanges };
}

export async function refreshInventory({ rootPath = root, write = false } = {}) {
  const target = resolve(rootPath, "doc/operations/agent-native-ui-operation-coverage.json");
  const inventory = JSON.parse(readFileSync(target, "utf8"));
  const { mountedUiOperations } = collectMountedUiOperations(rootPath);
  const result = refreshClientOperationSignatures(inventory, mountedUiOperations);
  const updated = { ...inventory, clientOperations: result.clientOperations };
  if (write) writeFileSync(target, `${JSON.stringify(updated, null, 2)}\n`);
  return { ...result, wrote: write };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const write = process.argv.includes("--write");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--write");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(" ")}`);
  const result = await refreshInventory({ write });
  console.log(`${result.wrote ? "Refreshed" : "Verified"} ${result.matched} existing callsite entries; applied ${result.reviewedChanges} explicit reviewed signature change(s).`);
  if (!result.wrote) console.log("Dry run only. Pass --write to persist line/signature refreshes; new or changed unreviewed operations always fail closed.");
}
