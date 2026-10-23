import { describe, expect, it } from "vitest";
import {
  createSupportCaseSchema, replySupportCaseSchema, deriveSupportCaseSubject,
  SUPPORT_CASE_COPY, SUPPORT_CASE_LIMITS,
} from "./customer-support.js";

const command = { idempotencyKey: "c18e87f2-90f2-4cde-8e17-24b6ab5b3545", expectedUserId: "actual-human" };
describe("customer support intake policy", () => {
  it("accepts a description alone and preserves unanswered impact", () => {
    const result = createSupportCaseSchema.parse({ ...command, description: "I cannot open my work" });
    expect(result.category).toBe("other");
    expect(result.impact).toBeNull();
    expect(result.subject).toBeUndefined();
    expect(result.safeContext).toBeUndefined();
    expect(deriveSupportCaseSubject("  Work is unavailable\nMore details  ")).toBe("Work is unavailable");
  });
  it("preserves explicit choices and an edited subject without inferring impact", () => {
    const result = createSupportCaseSchema.parse({ ...command, description: "Cannot connect", category: "apps_connections", subject: "My chosen subject" });
    expect(result.category).toBe("apps_connections");
    expect(result.subject).toBe("My chosen subject");
    expect(result.impact).toBeNull();
    expect(createSupportCaseSchema.parse({ ...result, impact: "blocked" }).impact).toBe("blocked");
  });
  it("rejects unreviewable automatic context and caller-selected authority or status", () => {
    for (const patch of [{ status: "RESOLVED" }, { openedByUserId: "another-human" }, { providerCaseRef: "external" },
      { safeContext: { taskBody: "private task" } }, { safeContext: { url: "https://example.test/?token=secret" } },
      { safeContext: { errorCode: "private exception text" } }, { safeContext: { operationId: "raw log" } }]) {
      expect(createSupportCaseSchema.safeParse({ ...command, description: "Help", ...patch }).success).toBe(false);
    }
    expect(createSupportCaseSchema.parse({ ...command, description: "Help", safeContext: { surface: "work", errorCode: "REQUEST_TIMEOUT" } }).safeContext)
      .toEqual({ surface: "work", errorCode: "REQUEST_TIMEOUT" });
  });
  it("uses the published limits and refuses empty requests and replies", () => {
    expect(createSupportCaseSchema.safeParse({ ...command, description: "  " }).success).toBe(false);
    expect(createSupportCaseSchema.safeParse({ ...command, description: "x".repeat(SUPPORT_CASE_LIMITS.description + 1) }).success).toBe(false);
    expect(replySupportCaseSchema.safeParse({ ...command, body: "  " }).success).toBe(false);
    expect(replySupportCaseSchema.safeParse({ ...command, body: "x".repeat(SUPPORT_CASE_LIMITS.reply + 1) }).success).toBe(false);
    expect(deriveSupportCaseSubject("x".repeat(250))).toHaveLength(SUPPORT_CASE_LIMITS.subject);
  });
  it("uses the prescribed bilingual support wording", () => {
    expect(SUPPORT_CASE_COPY.da.statuses.WAITING_FOR_YOU).toBe("Afventer dit svar");
    expect(SUPPORT_CASE_COPY.da.statuses.CLOSED).toBe("Afsluttet");
    expect(SUPPORT_CASE_COPY.da.impacts.limited).toBe("Jeg kan fortsætte med begrænsninger");
    expect(SUPPORT_CASE_COPY.en.deliveryPending).toBe("Received; delivery pending");
  });
});
