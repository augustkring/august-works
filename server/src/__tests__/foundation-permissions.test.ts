import { describe, expect, it } from "vitest";
import { grantsForHumanRole } from "../services/company-member-roles.js";

function keys(role: "owner" | "admin" | "operator" | "viewer") {
  return grantsForHumanRole(role).map((grant) => grant.permissionKey);
}

describe("Foundation human permission defaults", () => {
  it("keeps canonical approval restricted to owner/admin roles", () => {
    expect(keys("owner")).toEqual(expect.arrayContaining([
      "foundation:read",
      "foundation:propose",
      "foundation:edit",
      "foundation:approve",
    ]));
    expect(keys("admin")).toEqual(expect.arrayContaining([
      "foundation:read",
      "foundation:propose",
      "foundation:edit",
      "foundation:approve",
    ]));
    expect(keys("operator")).toEqual(expect.arrayContaining([
      "foundation:read",
      "foundation:propose",
      "foundation:edit",
    ]));
    expect(keys("operator")).not.toContain("foundation:approve");
    expect(keys("viewer")).toEqual(["foundation:read"]);
  });
});
