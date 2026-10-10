import { expect, it } from "vitest";
import {
  maintenanceAttemptHistorySchema,
  maintenanceHistorySchema,
} from "./maintenance-history.js";

const entry = {
  attemptId: "40000000-0000-4000-8000-000000000001",
  startedAt: "2026-10-10T00:00:00.000Z",
  leaseExpiresAt: "2026-10-10T00:00:05.000Z",
  finishedAt: null,
  outcome: "unconfirmed",
  sourceMatchesCurrent: true,
};
const observation = {
  observedAt: "2026-10-10T00:00:10.000Z",
  hasMore: false,
  entries: [entry],
};
it("rejects activation claims, raw native fields, duplicate attempts and an enlarged lease", () => {
  expect(maintenanceAttemptHistorySchema.safeParse(observation).success).toBe(
    true,
  );
  for (const patch of [
    { policyOwnerUserId: "private-owner" },
    { outcome: "active" },
    { leaseExpiresAt: "2026-10-10T00:00:10.000Z" },
    { sourceMatchesCurrent: "unknown" },
    { finishedAt: "2026-10-10T00:00:03.000Z" },
  ])
    expect(
      maintenanceAttemptHistorySchema.safeParse({
        ...observation,
        entries: [{ ...entry, ...patch }],
      }).success,
    ).toBe(false);
  expect(
    maintenanceAttemptHistorySchema.safeParse({
      ...observation,
      entries: [entry, entry],
    }).success,
  ).toBe(false);
  expect(
    maintenanceAttemptHistorySchema.safeParse({
      ...observation,
      entries: Array.from({ length: 11 }, (_, i) => ({
        ...entry,
        attemptId: `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      })),
    }).success,
  ).toBe(false);
});
it("uses the original native observation to distinguish awaiting, unconfirmed and terminal records", () => {
  expect(
    maintenanceAttemptHistorySchema.safeParse({
      ...observation,
      observedAt: "2026-10-10T00:00:04.000Z",
      entries: [{ ...entry, outcome: "awaiting_receipt" }],
    }).success,
  ).toBe(true);
  expect(
    maintenanceAttemptHistorySchema.safeParse({
      ...observation,
      entries: [{ ...entry, outcome: "awaiting_receipt" }],
    }).success,
  ).toBe(false);
  expect(
    maintenanceAttemptHistorySchema.safeParse({
      ...observation,
      observedAt: "2026-10-10T00:00:04.000Z",
    }).success,
  ).toBe(false);
  for (const outcome of ["no_effect", "configuration_recorded"]) {
    expect(
      maintenanceAttemptHistorySchema.safeParse({
        ...observation,
        entries: [
          { ...entry, outcome, finishedAt: "2026-10-10T00:00:03.000Z" },
        ],
      }).success,
    ).toBe(true);
    expect(
      maintenanceAttemptHistorySchema.safeParse({
        ...observation,
        entries: [{ ...entry, outcome }],
      }).success,
    ).toBe(false);
  }
});
it("does not turn an old response into an observed empty history or accept mismatched observation clocks", () => {
  const view = {
    companyId: "40000000-0000-4000-8000-000000000002",
    installationId: "40000000-0000-4000-8000-000000000003",
    agentId: "40000000-0000-4000-8000-000000000004",
    installationVersion: 1,
    installationStatus: "active",
    observedAt: observation.observedAt,
    entries: [],
    hasMore: false,
  };
  expect(maintenanceHistorySchema.parse(view)).not.toHaveProperty(
    "attemptHistory",
  );
  expect(
    maintenanceHistorySchema.safeParse({ ...view, attemptHistory: observation })
      .success,
  ).toBe(true);
  expect(
    maintenanceHistorySchema.safeParse({
      ...view,
      observedAt: "2026-10-10T00:00:11Z",
      attemptHistory: observation,
    }).success,
  ).toBe(false);
});
