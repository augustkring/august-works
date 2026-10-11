import { expect, it } from "vitest";
import { ACTIVATION_MEASUREMENT_CONTRACT, experienceMeasuresSchema, experienceDurationBucket, experienceSetupBucket } from "./experience-measures.js";
const current = { companyId: "11111111-1111-4111-8111-111111111111", observedAt: "2026-10-11T00:00:00Z", contractId: ACTIVATION_MEASUREMENT_CONTRACT.id,
  status: "verified", creationToVerificationBucket: "under_minute", recordedSetupChangesBucket: "one", setupWindow: "complete", usableBaseline: "unavailable" };
it("rejects arbitrary or private fields and a fabricated usable-account baseline", () => {
  expect(experienceMeasuresSchema.parse(current)).toEqual(current);
  expect([...ACTIVATION_MEASUREMENT_CONTRACT.allowedFields].sort()).toEqual(Object.keys(experienceMeasuresSchema.parse(current)).sort());
  for (const field of ["userId", "runId", "prompt", "output", "secret", "error", "properties", "receiptId"])
    expect(experienceMeasuresSchema.safeParse({ ...current, [field]: "PRIVATE" }).success).toBe(false);
  expect(experienceMeasuresSchema.safeParse({ ...current, usableBaseline: "verified" }).success).toBe(false);
});
it("withdraws all prior measurements and distinguishes bounded data from a zero count", () => {
  const withdrawn = { ...current, status: "withdrawn", creationToVerificationBucket: null, recordedSetupChangesBucket: null, setupWindow: "not_applicable" };
  expect(experienceMeasuresSchema.parse(withdrawn)).toEqual(withdrawn);
  expect(experienceMeasuresSchema.safeParse({ ...withdrawn, creationToVerificationBucket: "under_minute" }).success).toBe(false);
  expect(experienceMeasuresSchema.safeParse({ ...withdrawn, recordedSetupChangesBucket: "none" }).success).toBe(false);
  expect(experienceMeasuresSchema.safeParse({ ...current, setupWindow: "bounded", recordedSetupChangesBucket: null }).success).toBe(true);
  expect(experienceMeasuresSchema.safeParse({ ...current, setupWindow: "bounded", recordedSetupChangesBucket: "none" }).success).toBe(false);
  expect(experienceMeasuresSchema.safeParse({ ...current, recordedSetupChangesBucket: null }).success).toBe(false);
});
it("uses defined bucket boundaries without accepting negative, infinite, fractional or excessive inputs", () => {
  expect([0,60000,300000,1800000,7200000,86400000].map(experienceDurationBucket)).toEqual([
    "under_minute", "one_to_five_minutes", "five_to_thirty_minutes", "thirty_minutes_to_two_hours", "two_hours_to_day", "over_day"]);
  expect([0,1,2,6,11,31,128].map(experienceSetupBucket)).toEqual(["none", "one", "two_to_five", "six_to_ten", "eleven_to_thirty", "over_thirty", "over_thirty"]);
  for (const value of [-1, NaN, Infinity]) expect(() => experienceDurationBucket(value)).toThrow();
  for (const value of [-1, 0.5, 129, Infinity, NaN]) expect(() => experienceSetupBucket(value)).toThrow();
});
