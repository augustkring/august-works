import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../services/authorization.js";
import { firstPartySupportModelGateway } from "../services/orchestration/first-party-support-model-gateway.js";

const actor: AuthorizationActor = {
  type: "board",
  userId: "human-fixture-id",
  sessionId: "session-fixture-id",
  source: "session",
  authenticatedCredentialExpiresAt: Date.now() + 60_000,
};

describe("first-party Support model gateway defaults", () => {
  it("is unavailable without an explicitly pinned operator profile and never touches Help or provider transport", async () => {
    const helpSearch = vi.fn();
    const fetch = vi.fn();
    const gateway = firstPartySupportModelGateway({} as Db, {
      profiles: [],
      sourceSha: "a".repeat(40),
      protectedEvidenceOrigin: "https://qualification.test.invalid",
      helpSearch,
      credential: () => undefined,
      fetch: fetch as never,
    });
    await expect(gateway.availability(actor, "00000000-0000-4000-8000-000000000001", {
      expectedUserId: actor.userId,
      locale: "en",
    })).resolves.toEqual({ available: false });
    await expect(gateway.answer(actor, "00000000-0000-4000-8000-000000000001", {
      requestId: "00000000-0000-4000-8000-000000000002",
      expectedUserId: actor.userId,
      question: "How do I export a board?",
      locale: "en",
      consent: true,
      consentPolicyRevision: "c".repeat(64),
    })).resolves.toEqual({
      requestId: "00000000-0000-4000-8000-000000000002",
      kind: "unavailable",
      citations: [],
    });
    expect(helpSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
