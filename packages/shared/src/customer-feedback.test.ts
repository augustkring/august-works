import { describe, it, expect } from "vitest";
import {
  createCustomerFeedbackSchema,
  feedbackTriageSchema,
} from "./customer-feedback.js";
const base = {
  idempotencyKey: "ac55bb0e-9a10-4040-a075-d9bd3aee4034",
  category: "IDEA",
  body: "Help plan my day",
  context: {
    surfaceKey: "home",
    locale: "da",
    timezone: "Europe/Copenhagen",
    viewportClass: "compact",
  },
};
describe("customer feedback privacy contract", () => {
  it("rejects unexpected content and unsafe diagnostics even with diagnostics selected", () => {
    expect(
      createCustomerFeedbackSchema.safeParse({
        ...base,
        modelOutput: "private",
      }).success,
    ).toBe(false);
    expect(
      createCustomerFeedbackSchema.safeParse({
        ...base,
        includeDiagnostics: true,
        diagnostics: { logs: "raw content" },
      }).success,
    ).toBe(false);
    expect(
      createCustomerFeedbackSchema.safeParse({
        ...base,
        context: { ...base.context, timezone: "Invalid/Zone" },
      }).success,
    ).toBe(false);
  });
  it("requires a visible customer question for needs-info status", () => {
    expect(
      feedbackTriageSchema.safeParse({
        idempotencyKey: base.idempotencyKey,
        expectedVersion: 0,
        internalState: "NEEDS_INFO",
        internalNote: "Internal only",
      }).success,
    ).toBe(false);
  });
});
