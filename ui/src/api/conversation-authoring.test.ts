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
