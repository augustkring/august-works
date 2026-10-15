import { describe, expect, it } from "vitest";
import { experienceObservationSchema, experienceObservationPreferenceCommandSchema,
  experienceObservationDuration, experienceObservationSummarySchema, EXPERIENCE_OBSERVATION_CONTRACT_ID } from "./experience-observations.js";
const base = { requestId: "10000000-0000-4000-8000-000000000001", preferenceVersion: 1, kind: "surface_opened", surface: "home", variant: "streamlined", step: null, durationBucket: null };
describe("strict local experience observations", () => {
  it("rejects content, identities, URLs and undeclared properties", () => {
    expect(experienceObservationSchema.parse(base)).toEqual(base);
    for (const field of ["companyId", "userId", "sourceId", "prompt", "name", "email", "output", "url", "error", "properties", "sessionReplay", "credentials"])
      expect(experienceObservationSchema.safeParse({ ...base, [field]: "PRIVATE_CANARY" }).success).toBe(false);
  });
  it("binds stage and timing metadata to their intended finite event families", () => {
    expect(experienceObservationSchema.safeParse({ ...base, kind: "activation_step_opened", surface: "activation", step: "intent" }).success).toBe(true);
    for (const change of [{ step: "intent" }, { kind: "activation_step_opened" }, { durationBucket: "under_minute" },
      { kind: "active_view_interval" }, { kind: "activation_step_opened", step: "intent" }])
      expect(experienceObservationSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it("requires a current opt-in version while allowing explicit withdrawal", () => {
    expect(experienceObservationPreferenceCommandSchema.safeParse({ requestId: base.requestId, enabled: true, expectedVersion: null }).success).toBe(false);
    expect(experienceObservationPreferenceCommandSchema.safeParse({ requestId: base.requestId, enabled: true, expectedVersion: 0 }).success).toBe(true);
    expect(experienceObservationPreferenceCommandSchema.safeParse({ requestId: base.requestId, enabled: false, expectedVersion: null }).success).toBe(true);
  });
  it("quantizes finite intervals without claiming effort or a UX target", () => {
    expect([0, 59999, 60000, 300000, 900000, 1800000].map(experienceObservationDuration)).toEqual([
      "under_minute", "under_minute", "one_to_five_minutes", "five_to_fifteen_minutes", "fifteen_to_thirty_minutes", "over_thirty_minutes",
    ]);
    for (const value of [-1, Infinity, NaN]) expect(() => experienceObservationDuration(value)).toThrow();
  });
  it("keeps summaries within the current owner and omits request and user identity", () => {
    const { requestId: _, preferenceVersion: __, ...row } = base;
    const summary = { companyId: "10000000-0000-4000-8000-000000000002", contractId: EXPERIENCE_OBSERVATION_CONTRACT_ID,
      observedAt: "2026-10-15T00:00:00.000Z", coverage: "opt_in_observations_only", retentionDays: 35, counts: [{ ...row, count: 1 }] };
    expect(experienceObservationSummarySchema.safeParse(summary).success).toBe(true);
    expect(experienceObservationSummarySchema.safeParse({ ...summary, counts: [{ ...row, requestId: base.requestId, count: 1 }] }).success).toBe(false);
    expect(experienceObservationSummarySchema.safeParse({ ...summary, userId: "PRIVATE" }).success).toBe(false);
  });
});
