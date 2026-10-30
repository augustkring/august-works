import { describe, expect, it } from "vitest";
import {
  createHumanWorkflowCoverageSchema,
  updateCompanyMemberWithPermissionsSchema,
  updateCurrentUserProfileSchema,
} from "@paperclipai/shared";

describe("access validators", () => {
  it("accepts HTTP(S) and Paperclip asset image URLs", () => {
    expect(updateCurrentUserProfileSchema.safeParse({
      name: "Ada Lovelace",
      image: "https://example.com/avatar.png",
    }).success).toBe(true);
    expect(updateCurrentUserProfileSchema.safeParse({
      name: "Ada Lovelace",
      image: "/api/assets/avatar/content",
    }).success).toBe(true);
  });

  it("rejects data URI profile images", () => {
    expect(updateCurrentUserProfileSchema.safeParse({
      name: "Ada Lovelace",
      image: "data:image/png;base64,AAAA",
    }).success).toBe(false);
  });

  it("defaults omitted combined member grants to an empty list", () => {
    const result = updateCompanyMemberWithPermissionsSchema.parse({
      membershipRole: "operator",
    });

    expect(result.grants).toEqual([]);
  });

  it("bounds Human workflow coverage to one explicit manual or Task scope and a 30-day window", () => {
    const now = Date.now(), start = new Date(now + 60_000), end = new Date(now + 2 * 24 * 60 * 60_000);
    const base = { requestId: "a2a6c86b-4307-486a-8341-d2e2b9255731", delegateeUserId: "human-2",
      workflowId: "f55282b1-2631-45b6-aeb6-e177c5d39449", workflowRevisionId: "a55b9024-78d3-43c4-b070-1f6e571881cb",
      scopeType: "manual" as const, startsAt: start, expiresAt: end, reason: "Temporary absence" };
    expect(createHumanWorkflowCoverageSchema.safeParse(base).success).toBe(true);
    expect(createHumanWorkflowCoverageSchema.safeParse({ ...base, taskId: "4b953a3a-a530-4bc7-bc41-39aa2ad5f431" }).success).toBe(false);
    expect(createHumanWorkflowCoverageSchema.safeParse({ ...base, scopeType: "task", taskId: null }).success).toBe(false);
    expect(createHumanWorkflowCoverageSchema.safeParse({ ...base, expiresAt: new Date(start.getTime() + 31 * 24 * 60 * 60_000) }).success).toBe(false);
    expect(createHumanWorkflowCoverageSchema.safeParse({ ...base, expiresAt: start }).success).toBe(false);
  });
});
