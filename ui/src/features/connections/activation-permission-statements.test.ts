import { expect, it } from "vitest";
import { GOOGLE_WORKSPACE_CONNECTOR_PROFILES, activationConnectionReviewSchema } from "@paperclipai/shared";
import { activationPermissionStatements } from "./activation-permission-statements";
import en from "../../i18n/experience/en.json";
import da from "../../i18n/experience/da.json";

const id = "10000000-0000-4000-8000-000000000001";
const review = activationConnectionReviewSchema.parse({ companyId: id, onboardingRunId: id, onboardingVersion: 1,
  packageVersionId: id, packageContentHash: "a".repeat(64), applicationId: id, applicationKey: "gmail",
  applicationName: "Gmail", galleryKey: "gmail", connectionMethodKey: "paperclip-read", methodHash: "b".repeat(64),
  providerScopes: ["https://www.googleapis.com/auth/gmail.readonly"], scopeProfile: "gmail.read", grantKind: "user",
  deferAgentAccess: true, supersedesConsentId: null, existingConnection: null, reviewHash: "c".repeat(64),
  explanation: { providerName: "Gmail", resource: "https://gmailmcp.googleapis.com/mcp/v1", capabilityName: "Authored capability", providerWriteTools: [] },
  preview: { neededNow: ["Original explanation"], why: "Author's exact purpose", usedBy: "Original explanation",
    canRead: ["Original explanation"], canChange: ["Original explanation"], notRequested: ["Original explanation"],
    automatic: ["Original explanation"], asksFirst: ["Original explanation"] } });
function translate(locale: typeof en) {
  return (key: string, values?: Record<string, string>) => {
    const message = key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], locale);
    if (typeof message !== "string") throw new Error(`Missing permission statement: ${key}`);
    return message.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values?.[name] ?? "");
  };
}

it("discloses every Original profile scope and write tool in English and Danish without losing exact identifiers", () => {
  for (const locale of [en, da]) for (const [scopeProfile, profile] of Object.entries(GOOGLE_WORKSPACE_CONNECTOR_PROFILES)) {
    const value = { ...review, scopeProfile, providerScopes: [...profile.scopes],
      explanation: { ...review.explanation, resource: profile.serverUrl, providerWriteTools: [...profile.writeTools] } };
    const before = structuredClone(value), preview = activationPermissionStatements(value, translate(locale));
    expect(preview.why).toBe(review.preview.why);
    expect(preview.neededNow.join(" ")).toContain(profile.serverUrl);
    for (const scope of profile.scopes) {
      expect(preview.neededNow.join(" ")).toContain(scope);
      expect(preview.canRead.join(" ")).toContain(scope);
      expect(preview.canRead.join(" ")).not.toContain(locale.activation.connectionConsent.explanation.unmappedScope.split("{{")[0]);
    }
    for (const tool of profile.writeTools) expect(preview.canChange.join(" ")).toContain(`(${tool})`);
    expect(value).toEqual(before);
  }
});

it("keeps unknown provider scopes explicit and distinguishes broad provider send rights from AW authorization", () => {
  const preview = activationPermissionStatements({ ...review, providerScopes: [
    "https://www.googleapis.com/auth/gmail.compose", "https://example.test/unassessed-scope"],
    explanation: { ...review.explanation, providerWriteTools: ["create_draft", "unassessed_tool"] } }, translate(da));
  expect(preview.canRead.join(" ")).toContain("Administrer kladder og send e-mails");
  expect(preview.canRead.join(" ")).toContain("kræver sin egen detaljerede gennemgang: https://example.test/unassessed-scope");
  expect(preview.canChange.join(" ")).toContain("Opret e-mailkladder (create_draft), unassessed_tool");
  expect(preview.notRequested.join(" ")).toContain("Ingen August Works-tilladelse til at sende beskeder");
});

it("explains retained metadata without claiming validated setup in both supported languages", () => {
  for (const locale of [en, da]) {
    const value = { ...review, supersedesConsentId: id, existingConnection: { id, name: "Retained Gmail", setupHash: "d".repeat(64), needsValidation: true as const } };
    const preview = activationPermissionStatements(value, translate(locale));
    expect(preview.neededNow[0]).toBe(translate(locale)("activation.connectionConsent.explanation.retained",
      { provider: review.explanation.providerName, connection: "Retained Gmail", resource: review.explanation.resource }));
    expect(preview.why).toBe(review.preview.why);
    expect(preview.neededNow[1]).toContain(review.providerScopes[0]);
  }
});
