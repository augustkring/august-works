import { describe, expect, it } from "vitest";
import { createIssueSchema, updateIssueSchema } from "./issue.js";
import { addProjectAccessMemberSchema, createProjectSchema, updateProjectSchema } from "./project.js";

describe("private work contracts", () => {
  it("preserves omitted visibility on updates instead of publishing stored private work", () => {
    expect(createIssueSchema.parse({ title: "Task" }).visibility).toBe("open");
    expect(createProjectSchema.parse({ name: "Project" }).visibility).toBe("open");
    expect(createIssueSchema.parse({ title: "Task", visibility: "private" }).visibility).toBe("private");
    expect(createProjectSchema.parse({ name: "Project", visibility: "private" }).visibility).toBe("private");
    expect(updateIssueSchema.parse({ title: "Renamed" })).not.toHaveProperty("visibility");
    expect(updateProjectSchema.parse({ name: "Renamed" })).not.toHaveProperty("visibility");
    expect(updateIssueSchema.safeParse({ visibility: "secret" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ visibility: "secret" }).success).toBe(false);
  });

  it("bounds project subjects and rejects malformed Agent identities or client-provided grants", () => {
    expect(addProjectAccessMemberSchema.parse({ subjectType: "user", subjectId: " user-1 " }).subjectId).toBe("user-1");
    expect(addProjectAccessMemberSchema.safeParse({ subjectType: "agent", subjectId: "user-1" }).success).toBe(false);
    expect(addProjectAccessMemberSchema.safeParse({ subjectType: "user", subjectId: " " }).success).toBe(false);
    expect(addProjectAccessMemberSchema.safeParse({ subjectType: "user", subjectId: "x".repeat(256) }).success).toBe(false);
    expect(addProjectAccessMemberSchema.safeParse({ subjectType: "user", subjectId: "user-1", isInstanceAdmin: true }).success).toBe(false);
  });
});
