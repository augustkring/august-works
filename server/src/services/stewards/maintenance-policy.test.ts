import { expect, it } from "vitest";
import {
  packageMaintenanceRecurrenceAllows,
  packageStewardReviewIsCurrent,
  packageStewardReviewSchema,
} from "./maintenance-policy.js";
const id = "00000000-0000-4000-8000-000000000001",
  hash = "a".repeat(64),
  now = new Date("2026-10-10T00:00:00.125Z");
const review = {
  expectedInstallationVersion: 2,
  expectedInstalledVersionId: id,
  expectedUpdatedAt: now.toISOString(),
  expectedReleaseContentHash: hash,
};
it("binds a scan to exact native version, millisecond timestamp, installed source and release hash", () => {
  expect(
    packageStewardReviewIsCurrent(
      review,
      { version: 2, installedVersionId: id, updatedAt: now },
      hash,
    ),
  ).toBe(true);
  expect(
    packageStewardReviewIsCurrent(
      review,
      {
        version: 2,
        installedVersionId: id,
        updatedAt: new Date(now.getTime() + 1),
      },
      hash,
    ),
  ).toBe(false);
  expect(
    packageStewardReviewSchema.safeParse({ ...review, grant: true }).success,
  ).toBe(false);
});
it.each([
  [2, 9, true],
  [3, 9, false],
  [2, 10, false],
  [-1, 0, false],
  [1, 0, false],
  [NaN, 4, false],
  [1.5, 3, false],
])("bounds configured recurrence %s/%s as %s", (resource, company, allowed) => {
  expect(
    packageMaintenanceRecurrenceAllows(resource as number, company as number),
  ).toBe(allowed);
});
