import { afterEach, expect, it, vi } from "vitest";
import { getConversationAuthoring } from "./conversation-authoring";
import { api } from "./client";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const result = { companyId: id(1), conversationId: id(2), agentId: id(3), generation: 1,
  observedAt: "2026-10-13T00:00:00Z", proposals: [], hasMore: false, modelCalled: false };
afterEach(() => vi.restoreAllMocks());
it("binds the private read to current principal, Agent and conversation generation without model effects", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(result), post = vi.spyOn(api, "post");
  const controller = new AbortController();
  expect(await getConversationAuthoring(id(1), "person@example.test", id(2), id(3), 1, controller.signal)).toEqual(result);
  expect(get).toHaveBeenCalledWith(`/companies/${id(1)}/conversations/${id(2)}/authoring?expectedUserId=person%40example.test`, { signal: controller.signal, cache: "no-store" });
  expect(post).not.toHaveBeenCalled();
});
it.each(["companyId", "conversationId", "agentId", "generation"] as const)("rejects a response with a mismatched %s", async field => {
  vi.spyOn(api, "get").mockResolvedValue({ ...result, [field]: field === "generation" ? 2 : id(9) });
  await expect(getConversationAuthoring(id(1), "author", id(2), id(3), 1)).rejects.toThrow();
});
it("rejects private extra fields and arbitrary model-provided destinations", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ ...result, prompt: "PRIVATE intent" });
  await expect(getConversationAuthoring(id(1), "author", id(2), id(3), 1)).rejects.toThrow();
  get.mockResolvedValue({ ...result, proposals: [{ kind: "workflow", id: id(4), name: "Actual proposal", authoredRevisionId: id(5), authoredRevisionNumber: 1,
    currentDraftRevisionId: id(5), currentPublishedRevisionId: null, state: "draft", stepCount: 1, triggerCount: 1, href: "https://unrelated.invalid/claimed-draft" }] });
  await expect(getConversationAuthoring(id(1), "author", id(2), id(3), 1)).rejects.toThrow();
});

it.each(["foreign_href", "body_copy", "missing_coverage", "duplicate"])("rejects invalid saved task references: %s", async failure => {
  const task = { kind: "task", id: id(7), title: "Actual saved task", titleTruncated: false,
    status: "backlog", statusVersion: 1, executionStarted: false, href: `/issues/${id(7)}` };
  vi.spyOn(api, "get").mockResolvedValue({ ...result,
    savedTasks: failure === "duplicate" ? [task, task] : [{ ...task,
      ...(failure === "foreign_href" ? { href: `/issues/${id(8)}` } : {}),
      ...(failure === "body_copy" ? { description: "PRIVATE" } : {}) }],
    ...(failure === "missing_coverage" ? {} : { hasMoreTasks: false }) });
  await expect(getConversationAuthoring(id(1), "author", id(2), id(3), 1)).rejects.toThrow();
});
it.each(["foreign_href", "active_unconfigured", "counts", "body_copy"])("rejects invalid saved routine declarations: %s", async failure => {
  const routine = { kind: "routine", id: id(8), title: "Actual saved routine", authoredRevisionId: id(9), authoredRevisionNumber: 1,
    currentRevisionId: id(9), currentRevisionNumber: 1, status: failure === "active_unconfigured" ? "active" : "paused",
    executionConfigured: false, triggerCount: 0, enabledTriggerCount: failure === "counts" ? 1 : 0,
    href: failure === "foreign_href" ? `/routines/${id(7)}` : `/routines/${id(8)}`,
    ...(failure === "body_copy" ? { description: "PRIVATE" } : {}) };
  vi.spyOn(api, "get").mockResolvedValue({ ...result, savedRoutines: [routine], hasMoreRoutines: false });
  await expect(getConversationAuthoring(id(1), "author", id(2), id(3), 1)).rejects.toThrow();
});

it.each(["wrong_version", "incomplete", "extra_payload"])("refuses an invalid flow preview: %s", async mismatch => {
  const preview = { id: id(5), version: mismatch === "wrong_version" ? 2 : 1, coverage: "complete", steps: [] };
  vi.spyOn(api, "get").mockResolvedValue({ ...result, proposals: [{ kind: "workflow", id: id(4), name: "Actual draft",
    authoredRevisionId: id(5), authoredRevisionNumber: 1, currentDraftRevisionId: id(5), currentPublishedRevisionId: null,
    state: "draft", stepCount: mismatch === "incomplete" ? 1 : 0, triggerCount: 0, href: `/workflows/${id(4)}`,
    preview: mismatch === "extra_payload" ? { ...preview, prompt: "PRIVATE" } : preview }] });
  await expect(getConversationAuthoring(id(1), "author", id(2), id(3), 1)).rejects.toThrow();
});

it.each(["foreign_href","body_copy","missing_coverage","duplicate"])("rejects invalid Foundation proposal references: %s",async failure=>{
  const proposal={kind:"foundation_proposal",id:id(11),foundationDocumentId:id(12),title:"Actual Foundation policy",
    baseRevisionId:id(13),currentRevisionId:id(13),status:"pending",href:`/foundation/${id(12)}`};
  vi.spyOn(api,"get").mockResolvedValue({...result,
    savedFoundationProposals:failure==="duplicate"?[proposal,proposal]:[{...proposal,
      ...(failure==="foreign_href"?{href:`/foundation/${id(14)}`}:{ }),
      ...(failure==="body_copy"?{proposedBody:"PRIVATE"}:{ })}],
    ...(failure==="missing_coverage"?{}:{hasMoreFoundationProposals:false})});
  await expect(getConversationAuthoring(id(1),"author",id(2),id(3),1)).rejects.toThrow();
});
