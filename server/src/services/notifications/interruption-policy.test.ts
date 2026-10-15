import { describe, expect, it } from "vitest";
import { routeNotification } from "./interruption-policy.js";
import type { NotificationPolicy } from "@paperclipai/shared";
const policy: NotificationPolicy = {
  version: 1,
  cadence: "immediate",
  timezone: "Europe/Copenhagen",
  quietHours: { startMinute: 22 * 60, endMinute: 8 * 60 },
  digestMinute: 9 * 60,
};
describe("Native interruption routing", () => {
  it("keeps mandatory security delivery immediate while useful work can stay in app", () => {
    const now = new Date("2026-10-09T22:00:00Z");
    expect(
      routeNotification({
        category: "security",
        emailEnabled: false,
        policy: { ...policy, cadence: "in_app_only" },
        now,
      }),
    ).toEqual({
      channel: "email",
      notBefore: now,
      groupKey: null,
      mandatory: true,
    });
    expect(
      routeNotification({
        category: "work_update",
        emailEnabled: true,
        policy: { ...policy, cadence: "in_app_only" },
        now,
      }),
    ).toEqual({ channel: "in_app_only" });
  });
  it("defers overnight email to the user's current local quiet-hour boundary", () => {
    const result = routeNotification({
      category: "approval",
      emailEnabled: true,
      policy,
      now: new Date("2026-10-09T21:17:41Z"),
    });
    expect(result).toMatchObject({
      channel: "email",
      notBefore: new Date("2026-10-10T06:00:00Z"),
      mandatory: false,
    });
  });
  it("follows autumn and spring clock changes without sending inside quiet hours", () => {
    for (const [start, end] of [
      ["2026-10-24T22:00:00Z", "2026-10-25T07:00:00Z"],
      ["2026-03-28T22:00:00Z", "2026-03-29T06:00:00Z"],
    ])
      expect(
        routeNotification({
          category: "approval",
          emailEnabled: true,
          policy,
          now: new Date(start!),
        }),
      ).toMatchObject({ channel: "email", notBefore: new Date(end!) });
  });
  it("batches digests by local day, advances passed digest time and avoids repeated fold-hour delivery", () => {
    const result = routeNotification({
      category: "work_update",
      emailEnabled: true,
      policy: { ...policy, cadence: "digest" },
      now: new Date("2026-10-09T08:00:00Z"),
    });
    expect(result).toMatchObject({
      channel: "email",
      notBefore: new Date("2026-10-10T07:00:00Z"),
      groupKey: "digest:Europe/Copenhagen:2026-10-10",
    });
    const fold = {
      ...policy,
      cadence: "digest" as const,
      quietHours: null,
      digestMinute: 2 * 60 + 30,
    };
    const first = routeNotification({
      category: "work_update",
      emailEnabled: true,
      policy: fold,
      now: new Date("2026-10-25T00:20:00Z"),
    });
    const second = routeNotification({
      category: "work_update",
      emailEnabled: true,
      policy: fold,
      now: new Date("2026-10-25T01:20:00Z"),
    });
    expect(first).toMatchObject({
      groupKey: "digest:Europe/Copenhagen:2026-10-25",
    });
    expect(second).toMatchObject({
      groupKey: "digest:Europe/Copenhagen:2026-10-25",
    });
  });
  it("fails closed for invalid stored settings and preserves predecessor behavior without a policy", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(
      routeNotification({
        category: "work_update",
        emailEnabled: true,
        policy: { ...policy, timezone: "invalid" },
        now,
      }),
    ).toEqual({ channel: "in_app_only" });
    expect(
      routeNotification({ category: "billing", emailEnabled: true, now }),
    ).toMatchObject({ channel: "email", notBefore: now });
  });
});
