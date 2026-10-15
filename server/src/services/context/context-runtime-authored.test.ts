import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { assembleFreshNativeGovernedContext } from "./context-runtime.js";
import type { ContextAssemblyResult } from "./context-engine.js";
describe("Fresh Native context respects the authored source boundary", () => {
  it("keeps the task-only boundary when Foundation is globally enabled", async () => {
    const assemble = vi.fn(async () => ({ markdown: "Current task input" }) as ContextAssemblyResult);
    const value = await assembleFreshNativeGovernedContext({} as Db, { enabled: true, foundationEnabled: true, sourceScope: "task_only",
      companyId: "company", agentId: "agent", runId: "run", issueId: "task", responsibleUserId: "owner", issueTitle: "Current work" }, { assemble });
    expect(value).toBe("Current task input");
    expect(assemble).toHaveBeenCalledWith(expect.objectContaining({ sourceScope: "task_only", enforceResponsibleUserIntersection: true, issueId: "task", responsibleUserId: "owner" }));
  });
  it("does not acquire context when the owner is disabled", async () => {
    const assemble = vi.fn();
    expect(await assembleFreshNativeGovernedContext({} as Db, { enabled: false, foundationEnabled: true, sourceScope: "task_only",
      companyId: "company", agentId: "agent", runId: "run", issueId: "task", issueTitle: "Current work" }, { assemble })).toBeNull();
    expect(assemble).not.toHaveBeenCalled();
  });
});
