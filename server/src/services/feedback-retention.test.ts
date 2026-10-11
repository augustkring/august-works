import { describe, expect, it } from "vitest";
import { FEEDBACK_RETENTION_DEFAULTS } from "@paperclipai/shared";
import { evaluateFeedbackRetention, loadFeedbackRetentionConfiguration } from "./feedback-retention.js";

const date = (value: string) => new Date(value + "T12:00:00Z");
const base = { now: date("2026-05-01"), createdAt: date("2025-05-01"), closedAt: null,
  extendedUntil: null, legalHold: null };
describe("feedback retention lifecycle planning", () => {
  it("uses immutable owner-selected house defaults without enabling an executor", () => {
    const result = loadFeedbackRetentionConfiguration({});
    expect(result).toEqual({ closedFeedbackDays: 90, imageDays: 30, openFeedbackMonths: 12 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty("automaticDeletion");
  });
  it("loads bounded startup overrides and rejects unsafe or undeclared values without logging them", () => {
    expect(loadFeedbackRetentionConfiguration({ AW_FEEDBACK_RETENTION_JSON:
      JSON.stringify({ closedFeedbackDays: 60, imageDays: 14, openFeedbackMonths: 6 }) })).toEqual(
        { closedFeedbackDays: 60, imageDays: 14, openFeedbackMonths: 6 });
    for (const raw of ["private-canary", "x".repeat(1025), JSON.stringify({ ...FEEDBACK_RETENTION_DEFAULTS, automaticDeletion: true }),
      JSON.stringify({ ...FEEDBACK_RETENTION_DEFAULTS, imageDays: 0 }), JSON.stringify({ ...FEEDBACK_RETENTION_DEFAULTS, openFeedbackMonths: 1.5 })])
      expect(() => loadFeedbackRetentionConfiguration({ AW_FEEDBACK_RETENTION_JSON: raw })).toThrow(/^Invalid feedback retention configuration$/);
  });
  it("bounds open cases at twelve calendar months and handles leap-day and month-end anniversaries", () => {
    expect(evaluateFeedbackRetention(base, FEEDBACK_RETENTION_DEFAULTS).caseEligible).toBe(true);
    expect(evaluateFeedbackRetention({ ...base, createdAt: date("2024-02-29") }, FEEDBACK_RETENTION_DEFAULTS).caseDueAt)
      .toBe("2025-02-28T12:00:00.000Z");
    expect(evaluateFeedbackRetention({ ...base, createdAt: date("2026-01-31") }, { ...FEEDBACK_RETENTION_DEFAULTS, openFeedbackMonths: 1 }).caseDueAt)
      .toBe("2026-02-28T12:00:00.000Z");
  });
  it("uses ninety days after closure for the case and follow-ups, thirty days after upload for images", () => {
    const result = evaluateFeedbackRetention({ ...base, closedAt: date("2026-04-01"), imageCreatedAt: date("2026-04-01") }, FEEDBACK_RETENTION_DEFAULTS);
    expect(result).toMatchObject({ caseDueAt: "2026-06-30T12:00:00.000Z", caseEligible: false,
      imageDueAt: "2026-05-01T12:00:00.000Z", imageEligible: true });
  });
  it("blocks both content paths under an indefinite or current incident/legal hold", () => {
    for (const releaseAt of [null, date("2026-05-02")])
      expect(evaluateFeedbackRetention({ ...base, imageCreatedAt: date("2025-05-01"), legalHold: { releaseAt } }, FEEDBACK_RETENTION_DEFAULTS))
        .toMatchObject({ held: true, caseEligible: false, imageEligible: false });
    expect(evaluateFeedbackRetention({ ...base, legalHold: { releaseAt: base.now } }, FEEDBACK_RETENTION_DEFAULTS).caseEligible).toBe(true);
  });
  it("honors a reasoned native case extension without silently extending image retention", () => {
    expect(evaluateFeedbackRetention({ ...base, extendedUntil: date("2026-06-01"), imageCreatedAt: date("2025-05-01") }, FEEDBACK_RETENTION_DEFAULTS))
      .toMatchObject({ caseEligible: false, imageEligible: true });
    expect(evaluateFeedbackRetention({ ...base, extendedUntil: date("2026-04-01") }, FEEDBACK_RETENTION_DEFAULTS).caseDueAt).toBe("2026-05-01T12:00:00.000Z");
  });
  it("refuses impossible or invalid native clocks instead of issuing a deletion decision", () => {
    for (const patch of [{ now: new Date(NaN) }, { createdAt: date("2026-05-02") }, { closedAt: date("2024-05-01") },
      { imageCreatedAt: date("2026-05-02") }, { legalHold: { releaseAt: new Date(NaN) } }])
      expect(() => evaluateFeedbackRetention({ ...base, ...patch }, FEEDBACK_RETENTION_DEFAULTS)).toThrow();
  });
});
