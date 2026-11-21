import { describe, it, expect } from "vitest";
import {
  createCustomerFeedbackSchema,
  customerFeedbackSchema,
  customerFeedbackExperienceMeasureMarkerSchema,
  feedbackTriageSchema,
} from "./customer-feedback.js";
import { summarizeCustomerFeedbackMeasures } from "./customer-success-quality.js";
const base = {
  idempotencyKey: "ac55bb0e-9a10-4040-a075-d9bd3aee4034",
  category: "IDEA",
  body: "Help plan my day",
  context: {
    surfaceKey: "home",
    locale: "da",
    timezone: "Europe/Copenhagen",
    viewportClass: "compact",
  },
};
describe("customer feedback privacy contract", () => {
  it("retains the old immutable payload shape and admits only bounded reported environment and matching screen categories", () => {
    const legacy = createCustomerFeedbackSchema.parse(base);
    expect(legacy.context).toEqual(base.context);
    const context = {
      ...base.context,
      screenContractId: "HOME",
      clientReleaseBuildId: "a".repeat(40),
      clientEnvironment: {
        source: "reported_user_agent",
        browser: { family: "chrome", majorVersion: 143 },
        operatingSystem: { family: "windows", majorVersion: 10 },
      },
    };
    expect(
      createCustomerFeedbackSchema.safeParse({ ...base, context }).success,
    ).toBe(true);
    for (const patch of [
      { screenContractId: "SUPPORT-ACCESS" },
      { screenContractId: "private-screen-id" },
      { userAgent: "private-ua" },
      { relevantFeatureFlagIds: ["customer_feedback_v9"] },
      { clientReleaseBuildId: "private-release" },
      {
        clientEnvironment: {
          ...context.clientEnvironment,
          rawUserAgent: "private-ua",
        },
      },
      {
        clientEnvironment: {
          ...context.clientEnvironment,
          browser: { family: "unknown", majorVersion: 143 },
        },
      },
      {
        clientEnvironment: {
          ...context.clientEnvironment,
          browser: { family: "chrome", majorVersion: 1000 },
        },
      },
    ])
      expect(
        createCustomerFeedbackSchema.safeParse({
          ...base,
          context: { ...context, ...patch },
        }).success,
      ).toBe(false);
  });
  it("rejects unexpected content and unsafe diagnostics even with diagnostics selected", () => {
    expect(
      createCustomerFeedbackSchema.safeParse({
        ...base,
        modelOutput: "private",
      }).success,
    ).toBe(false);
    expect(
      createCustomerFeedbackSchema.safeParse({
        ...base,
        includeDiagnostics: true,
        diagnostics: { logs: "raw content" },
      }).success,
    ).toBe(false);
    expect(
      createCustomerFeedbackSchema.safeParse({
        ...base,
        context: { ...base.context, timezone: "Invalid/Zone" },
      }).success,
    ).toBe(false);
    expect(createCustomerFeedbackSchema.safeParse({
      ...base,
      context: { ...base.context, problemClassification: { area: "task_completion", impact: "blocked" } },
    }).success).toBe(false);
  });
  it("requires a visible customer question for needs-info status", () => {
    expect(
      feedbackTriageSchema.safeParse({
        idempotencyKey: base.idempotencyKey,
        expectedVersion: 0,
        internalState: "NEEDS_INFO",
        internalNote: "Internal only",
      }).success,
    ).toBe(false);
    expect(feedbackTriageSchema.safeParse({ idempotencyKey: base.idempotencyKey, expectedVersion: 0, internalState: "CLASSIFIED", problemClassification: { area: "task_completion", impact: "limited" } }).success).toBe(true);
    expect(feedbackTriageSchema.safeParse({ idempotencyKey: base.idempotencyKey, expectedVersion: 0, internalState: "CLASSIFIED", problemClassification: { area: "inferred_from_clicks", impact: "limited" } }).success).toBe(false);
    expect(feedbackTriageSchema.safeParse({ idempotencyKey: base.idempotencyKey, expectedVersion: 0, internalState: "CLASSIFIED", problemClassification: null }).success).toBe(true);
  });
  it("requires explicit opt-in for bounded ratings and counts eligibility separately from each dimension", () => {
    expect(createCustomerFeedbackSchema.safeParse({ ...base, experienceMeasure: { offered: true, satisfaction: "satisfied" } }).success).toBe(false);
    expect(createCustomerFeedbackSchema.safeParse({ ...base, experienceMeasure: { offered: true, consent: "granted", satisfaction: "satisfied" } }).success).toBe(false);
    expect(createCustomerFeedbackSchema.safeParse({ ...base, experienceMeasure: { offered: true, consent: "granted", satisfaction: "satisfied", effort: "easy", comment: "private text" } }).success).toBe(false);
    expect(createCustomerFeedbackSchema.safeParse({ ...base, experienceMeasure: { offered: true, consent: "withdrawn" } }).success).toBe(false);
    const result = summarizeCustomerFeedbackMeasures({ from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z", submissions: [
      { experienceMeasure: { offered: true } },
      { experienceMeasure: { offered: true, consent: "granted", satisfaction: "satisfied", effort: "difficult" } },
      { experienceMeasure: { offered: true, availability: "withdrawn" } },
      { experienceMeasure: { offered: true, availability: "unavailable" } },
      {},
    ] });
    expect(result.denominator).toEqual({ offeredFeedbackSubmissions: 4, consentedResponses: 1, withdrawnResponses: 1, unconsentedSubmissions: 1, unavailableResponses: 1 });
    expect(result.satisfaction).toEqual({ count: 1, distribution: expect.objectContaining({ satisfied: 1, very_satisfied: 0 }) });
    expect(result.effort).toEqual({ count: 1, distribution: expect.objectContaining({ difficult: 1, easy: 0 }) });
    expect("score" in result).toBe(false);
    expect(customerFeedbackExperienceMeasureMarkerSchema.safeParse({ offered: true, consent: "granted" }).success).toBe(true);
    expect(customerFeedbackExperienceMeasureMarkerSchema.safeParse({ offered: true, consent: "granted", satisfaction: "satisfied" }).success).toBe(false);
  });
  it("allows only the authorized source receipt to carry current ratings and reports withdrawal without values", () => {
    const receipt = {
      id: base.idempotencyKey, feedbackId: "AWF-AC55BB0E9A104040A075D9BD3AEE4034", companyId: base.idempotencyKey,
      category: "IDEA", body: base.body, goal: "", blocksWork: false, omitName: false,
      experienceMeasureStatus: "granted", experienceMeasure: { satisfaction: "satisfied", effort: "easy" },
      status: "RECEIVED", version: 0, createdAt: "2026-10-30T00:00:00.000Z", messages: [],
    };
    expect(customerFeedbackSchema.safeParse(receipt).success).toBe(true);
    expect(customerFeedbackSchema.safeParse({ ...receipt, experienceMeasureStatus: "withdrawn", experienceMeasure: undefined }).success).toBe(true);
    expect(customerFeedbackSchema.safeParse({ ...receipt, experienceMeasureStatus: "withdrawn" }).success).toBe(false);
    expect(customerFeedbackSchema.safeParse({ ...receipt, experienceMeasure: { satisfaction: "satisfied", effort: "easy", comment: "private" } }).success).toBe(false);
  });
});
