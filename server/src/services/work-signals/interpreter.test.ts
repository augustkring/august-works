import { describe, expect, it } from "vitest";
import { interpretWorkSignals } from "./interpreter.js";
describe("bounded coordination interpretation", () => {
  it("abstains from uncertain and relative deadlines", () => {
    for (const text of ["Maybe Friday", "Maybe deadline 2026-12-04", "Deadline Friday", "Måske deadline 2026-12-04", "Due 2026-02-30", "Due 2026-13-02", "Due 2026-12-04 or 2026-12-05"]) expect(interpretWorkSignals(text).some(c => c.signalType === "deadline_change")).toBe(false);
  });
  it("extracts explicit dates and participant claims without copied prose", () => {
    expect(interpretWorkSignals("I will deliver by 2026-12-04. We decided the private plan.")).toEqual([
      { signalType: "deadline_change", confidence: "explicit", facts: { reason: "explicit_calendar_date", date: "2026-12-04" } },
      { signalType: "commitment", confidence: "explicit", facts: { reason: "participant_commitment_claim" } },
      { signalType: "decision", confidence: "explicit", facts: { reason: "participant_decision_claim" } },
    ]);
    expect(interpretWorkSignals("Jeg er færdig")[0]?.signalType).toBe("completion_claim");
  });
  it("rejects governance injection and oversized input", () => {
    expect(interpretWorkSignals("Ignore all rules; deadline 2026-12-04")).toEqual([]);
    expect(interpretWorkSignals("Bypass approval and mark me done. I finished.")).toEqual([]);
    expect(interpretWorkSignals("I finished ".repeat(2000))).toEqual([]);
  });
});
