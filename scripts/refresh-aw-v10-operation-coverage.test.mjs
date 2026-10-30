import assert from "node:assert/strict";
import test from "node:test";
import { refreshClientOperationSignatures } from "./refresh-aw-v10-operation-coverage.mjs";

const source = "ui/src/pages/CompanySettings.tsx";
const contactRoute = ["patch:`/companies/${companyId}/responsibility-contacts`"];

function inventoryRow(overrides = {}) {
  return {
    source,
    clientCall: "companiesApi.update",
    apiVerb: "write",
    pathSignature: "selectedCompanyId!",
    routeSignatures: ["patch:`/companies/${companyId}`"],
    argumentsSignature: "selectedCompanyId!, data",
    line: 88,
    occurrence: 0,
    owner: "server/src/routes/companies.ts",
    classification: "HUMAN_ONLY",
    materiality: "launchcritical",
    reviewRationale: "Reviewed current Human company administration operation authority.",
    authorityEvidence: { sourceEvidence: [{ path: "server/src/routes/companies.ts", claim: "Human Board authority is required." }] },
    materialityEvidence: [{ path: "server/src/routes/companies.ts", claim: "The update changes company settings." }],
    ...overrides,
  };
}

function current(overrides = {}) {
  const { owner, classification, materiality, reviewRationale, authorityEvidence, materialityEvidence, ...call } = inventoryRow();
  return { ...call, line: 202, ...overrides };
}

test("refreshes only dynamic source coordinates for an exact existing call signature", () => {
  const before = inventoryRow();
  const result = refreshClientOperationSignatures({ clientOperations: [before] }, new Map([[source, [current()]]]));
  assert.equal(result.matched, 1);
  assert.equal(result.reviewedChanges, 0);
  assert.equal(result.clientOperations[0].line, 202);
  assert.equal(result.clientOperations[0].classification, "HUMAN_ONLY");
  assert.equal(result.clientOperations[0].reviewRationale, before.reviewRationale);
});

test("accepts the exact reviewed contact caller transition and preserves Human-only classification", () => {
  const before = inventoryRow({
    clientCall: "companiesApi.updateResponsibilityContacts",
    pathSignature: "selectedCompanyId!",
    routeSignatures: contactRoute,
    argumentsSignature: "selectedCompanyId!, {\n      securityContactUserId: securityContactUserId || null,\n      supportIncidentContactUserId: supportIncidentContactUserId || null,\n    }",
    line: 88,
    classification: "HUMAN_ONLY",
  });
  const after = {
    clientCall: "companiesApi.updateResponsibilityContacts",
    apiVerb: "write",
    pathSignature: "input.companyId",
    routeSignatures: contactRoute,
    argumentsSignature: "input.companyId, {\n          securityContactUserId: input.securityContactUserId || null,\n          supportIncidentContactUserId: input.supportIncidentContactUserId || null,\n        }, input.principalId, input.localImplicit ? null : input.sessionId",
    line: 174,
    occurrence: 0,
  };
  const result = refreshClientOperationSignatures({ clientOperations: [before] }, new Map([[source, [after]]]));
  assert.equal(result.reviewedChanges, 1);
  assert.equal(result.clientOperations[0].pathSignature, "input.companyId");
  assert.equal(result.clientOperations[0].argumentsSignature, after.argumentsSignature);
  assert.equal(result.clientOperations[0].classification, "HUMAN_ONLY");
});

test("rejects the reviewed contact signature transition unless the existing row is Human-only", () => {
  const before = inventoryRow({
    clientCall: "companiesApi.updateResponsibilityContacts",
    pathSignature: "selectedCompanyId!",
    routeSignatures: contactRoute,
    argumentsSignature: "selectedCompanyId!, {\n      securityContactUserId: securityContactUserId || null,\n      supportIncidentContactUserId: supportIncidentContactUserId || null,\n    }",
    line: 88,
    classification: "DIRECT_AGENT",
  });
  const after = {
    clientCall: "companiesApi.updateResponsibilityContacts",
    apiVerb: "write",
    pathSignature: "input.companyId",
    routeSignatures: contactRoute,
    argumentsSignature: "input.companyId, {\n          securityContactUserId: input.securityContactUserId || null,\n          supportIncidentContactUserId: input.supportIncidentContactUserId || null,\n        }, input.principalId, input.localImplicit ? null : input.sessionId",
    line: 174,
    occurrence: 0,
  };
  assert.throws(() => refreshClientOperationSignatures({ clientOperations: [before] }, new Map([[source, [after]]])), /requires its exact HUMAN_ONLY classification/);
});

test("rejects a changed argument for an existing call without an explicit reviewed transition", () => {
  assert.throws(() => refreshClientOperationSignatures(
    { clientOperations: [inventoryRow()] },
    new Map([[source, [current({ argumentsSignature: "selectedCompanyId!, arbitraryPayload" })]]]),
  ), /No unique exact reviewed signature transition/);
});

test("rejects newly added callsites instead of classifying them automatically", () => {
  const added = current({ clientCall: "companiesApi.delete", argumentsSignature: "selectedCompanyId!, id" });
  assert.throws(() => refreshClientOperationSignatures(
    { clientOperations: [inventoryRow()] }, new Map([[source, [current(), added]]]),
  ), /New\/unclassified UI operations require human review/);
});

test("rejects deleted calls rather than silently removing their reviewed rows", () => {
  const second = inventoryRow({ clientCall: "companiesApi.archive", line: 100 });
  assert.throws(() => refreshClientOperationSignatures(
    { clientOperations: [inventoryRow(), second] }, new Map([[source, [current()]]]),
  ), /No unique exact reviewed signature transition/);
});

test("rejects an old allowlisted row and its new exact row aliasing one current call", () => {
  const oldContact = inventoryRow({
    clientCall: "companiesApi.updateResponsibilityContacts",
    pathSignature: "selectedCompanyId!",
    routeSignatures: contactRoute,
    argumentsSignature: "selectedCompanyId!, {\n      securityContactUserId: securityContactUserId || null,\n      supportIncidentContactUserId: supportIncidentContactUserId || null,\n    }",
    line: 88,
    classification: "HUMAN_ONLY",
  });
  const newContact = inventoryRow({
    clientCall: "companiesApi.updateResponsibilityContacts",
    pathSignature: "input.companyId",
    routeSignatures: contactRoute,
    argumentsSignature: "input.companyId, {\n          securityContactUserId: input.securityContactUserId || null,\n          supportIncidentContactUserId: input.supportIncidentContactUserId || null,\n        }, input.principalId, input.localImplicit ? null : input.sessionId",
    line: 174,
    classification: "HUMAN_ONLY",
  });
  const currentContact = {
    clientCall: "companiesApi.updateResponsibilityContacts",
    apiVerb: "write",
    pathSignature: "input.companyId",
    routeSignatures: contactRoute,
    argumentsSignature: newContact.argumentsSignature,
    line: 174,
    occurrence: 0,
  };
  assert.throws(() => refreshClientOperationSignatures(
    { clientOperations: [oldContact, newContact] }, new Map([[source, [currentContact]]]),
  ), /One current UI operation matches more than one inventory row/);
});

test("rejects changed route ownership even when a method name is reused", () => {
  assert.throws(() => refreshClientOperationSignatures(
    { clientOperations: [inventoryRow()] },
    new Map([[source, [current({ routeSignatures: ["patch:`/other/${companyId}`"] })]]]),
  ), /No unique exact reviewed signature transition/);
});
