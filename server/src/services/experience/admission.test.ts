import { describe, expect, it } from "vitest";
import { withExperienceAdmission } from "./admission.js";
describe("Home admission includes stalled authority and late work", () => {
  it("returns at the deadline but holds admission until non-cooperative work settles", async () => {
    const releases: Array<() => void> = [];
    let started = 0;
    const requests = Array.from({ length: 4 }, () =>
      withExperienceAdmission(
        async () => {
          started++;
          await new Promise<void>((resolve) => releases.push(resolve));
          return "late private data";
        },
        { deadlineMs: 5 },
      ).catch((error) => error),
    );
    const results = await Promise.all(requests);
    expect(started).toBe(4);
    expect(results.every((result) => result instanceof Error)).toBe(true);
    let fifthStarted = false;
    await expect(
      withExperienceAdmission(async () => {
        fifthStarted = true;
        return "should not execute";
      }),
    ).rejects.toThrow("admission is full");
    expect(fifthStarted).toBe(false);
    for (const release of releases) release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      await withExperienceAdmission(async () => "reauthorized current data"),
    ).toBe("reauthorized current data");
  });
});
