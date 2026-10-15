import { describe, expect, it } from "vitest";
import { FEEDBACK_REQUIRED_POLICY_KEYS } from "@paperclipai/shared";
import { loadFeedbackDataProcessingAdmission } from "./feedback-data-processing.js";

// Declared software configuration only; no approved legal policy or GA evidence.
const configuration = {
  schemaVersion: 1,
  privacyOwner: "test-privacy-owner",
  policyVersion: "software-fixture-v1",
  policies: Object.fromEntries(
    FEEDBACK_REQUIRED_POLICY_KEYS.map((key) => [
      key,
      `fixture.${key.toLowerCase()}`,
    ]),
  ),
};
const configured = () => ({
  AW_FEEDBACK_DATA_PROCESSING_JSON: JSON.stringify(configuration),
});
describe("Privacy-owned feedback configuration admission", () => {
  it("keeps an unset preview explicit and refuses an unset GA at startup", () => {
    expect(loadFeedbackDataProcessingAdmission({})).toMatchObject({
      configuration: null,
      retentionStatus: "owner_decision_required",
      gaAllowed: false,
    });
    expect(() =>
      loadFeedbackDataProcessingAdmission({
        AW_CUSTOMER_FEEDBACK_CHANNEL: "ga",
      }),
    ).toThrow("all six Privacy-owned");
  });
  it.each(FEEDBACK_REQUIRED_POLICY_KEYS)(
    "refuses declared configuration missing %s without exposing private values",
    (key) => {
      const copy = structuredClone(configuration);
      delete copy.policies[key];
      expect(() =>
        loadFeedbackDataProcessingAdmission({
          AW_FEEDBACK_DATA_PROCESSING_JSON: JSON.stringify(copy),
        }),
      ).toThrow(/^Invalid feedback data processing configuration$/);
    },
  );
  it("keeps complete declared references frozen and unqualified, and refuses GA even with all keys", () => {
    const env = configured(),
      admission = loadFeedbackDataProcessingAdmission(env);
    expect(admission.retentionStatus).toBe("configured_execution_unqualified");
    expect(admission.gaAllowed).toBe(false);
    expect(Object.isFrozen(admission.configuration?.policies)).toBe(true);
    env.AW_FEEDBACK_DATA_PROCESSING_JSON = "changed";
    expect(admission.configuration?.policyVersion).toBe(
      configuration.policyVersion,
    );
    expect(() =>
      loadFeedbackDataProcessingAdmission({
        ...configured(),
        AW_CUSTOMER_FEEDBACK_CHANNEL: "ga",
      }),
    ).toThrow("qualified native data processing behavior");
  });
  it.each([
    "",
    "{private-canary",
    "x".repeat(16385),
    JSON.stringify({ ...configuration, gaAllowed: true }),
    JSON.stringify({ ...configuration, privacyOwner: "private-canary\nowner" }),
    JSON.stringify({
      ...configuration,
      policies: { ...configuration.policies, submissionRetention: 30 },
    }),
  ])(
    "refuses malformed, oversized, undeclared or numeric policy input with a bounded safe error",
    (raw) => {
      expect(() =>
        loadFeedbackDataProcessingAdmission({
          AW_FEEDBACK_DATA_PROCESSING_JSON: raw,
        }),
      ).toThrow(/^Invalid feedback data processing configuration$/);
    },
  );
  it("refuses an unknown channel instead of treating a typo as preview", () => {
    expect(() =>
      loadFeedbackDataProcessingAdmission({
        AW_CUSTOMER_FEEDBACK_CHANNEL: "production",
      }),
    ).toThrow(/^Invalid customer feedback release channel$/);
  });
});
