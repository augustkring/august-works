import { describe, expect, it } from "vitest";
import { roadmapCalendar, roadmapSpan, shiftCalendar, scheduleVarianceDays } from "./roadmap-calendar";

describe("Roadmap UTC calendar and canonical date comparison", () => {
  it("aligns calendar weeks and quarters across a year boundary", () => {
    expect(roadmapCalendar(new Date("2027-01-03T23:00:00Z"), "week").start.toISOString()).toBe("2026-12-28T00:00:00.000Z");
    const quarter = roadmapCalendar(new Date("2026-11-03T08:00:00Z"), "quarter");
    expect(quarter.cells[0]!.label).toBe("Q4 2026"); expect(quarter.cells[1]!.from.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("clamps month ends instead of rolling January 31 into March", () => {
    expect(shiftCalendar(new Date("2027-01-31T12:00:00Z"), "month", 1).toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(shiftCalendar(new Date("2028-01-31T12:00:00Z"), "month", 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
  it("clips intervals and leaves unknown actuals unknown", () => {
    const calendar = roadmapCalendar(new Date("2026-10-01T00:00:00Z"), "day");
    expect(roadmapSpan(calendar.cells, "2026-09-01T00:00:00Z", "2026-10-02T00:00:00Z")).toEqual({ gridColumn: "1 / 3", clipped: true });
    expect(roadmapSpan(calendar.cells, null, "2026-10-02T00:00:00Z")).toBeNull();
    expect(scheduleVarianceDays("2026-10-03T00:00:00Z", null)).toBeNull();
    expect(scheduleVarianceDays("2026-10-03T00:00:00Z", "2026-10-05T12:00:00Z")).toBe(2.5);
  });
});
