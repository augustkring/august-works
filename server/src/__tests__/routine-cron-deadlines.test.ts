import { afterEach, describe, expect, it, vi } from "vitest";
import * as cron from "../services/cron.js";
import { nextCronTickInTimeZone } from "../services/routines.js";

afterEach(() => vi.restoreAllMocks());
describe("native routine calendar deadline search", () => {
  it("parses an annual UTC schedule once and formats only candidate UTC dates", () => {
    const parse = vi.spyOn(cron, "parseCron");
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    expect(nextCronTickInTimeZone("0 12 1 1 *", "UTC", new Date("2026-01-01T12:00:00Z")))
      .toEqual(new Date("2027-01-01T12:00:00Z"));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(format.mock.calls.length).toBeLessThanOrEqual(24);
  });
  it("rejects invalid reference dates and cron without entering a calendar scan", () => {
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    expect(() => nextCronTickInTimeZone("* * * * *", "UTC", new Date(NaN)))
      .toThrow("Invalid schedule reference time");
    expect(() => nextCronTickInTimeZone("not cron", "UTC", new Date())).toThrow();
    expect(format).not.toHaveBeenCalled();
  });
  it("returns no occurrence for impossible UTC dates without formatting millions of minutes", () => {
    const parse = vi.spyOn(cron, "parseCron");
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    expect(nextCronTickInTimeZone("0 12 31 2 *", "UTC", new Date("2026-01-01T00:00:00Z"))).toBeNull();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(format).not.toHaveBeenCalled();
  });
  it("preserves the original IANA calendar behavior across spring gaps and repeated autumn minutes", () => {
    expect(nextCronTickInTimeZone("30 2 * * *", "America/New_York", new Date("2026-03-07T07:30:00Z")))
      .toEqual(new Date("2026-03-09T06:30:00Z"));
    expect(nextCronTickInTimeZone("30 1 * * *", "America/New_York", new Date("2026-11-01T05:30:00Z")))
      .toEqual(new Date("2026-11-01T06:30:00Z"));
  });
});
