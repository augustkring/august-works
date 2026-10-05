import { describe, expect, it } from "vitest";
import { arbitrateSupervision, type SupervisionSnapshot } from "./supervision-policy.js";
const healthy: SupervisionSnapshot = { planStatus: "running", featureEnabled: true, authorityCurrent: true, sourceCurrent: true, deadlineExpired: false, checkBudgetExhausted: false, readinessAllows: true, repeatedFailures: 0, repeatedFailureThreshold: 3, noProgress: false, humanWait: false, pendingFailedWorker: false, retryAvailable: true, liveAttempts: 1, possibleCompletion: false, hasVerifiedCompletion: false, verifierBudgetAvailable: true, independentVerifierRequired: true };
describe("deterministic supervision authority", () => {
  it.each(["authorityCurrent", "sourceCurrent", "featureEnabled"] as const)("%s overrides a Finish or Continue recommendation", key => {
    for (const recommendation of ["FINISH", "CONTINUE"] as const) expect(arbitrateSupervision({ ...healthy, [key]: false }, recommendation, true)).toMatchObject({ action: "STOP", effect: "stop" });
  });
  it("closes deadline and supervisor budget paths outside the model", () => {
    expect(arbitrateSupervision({ ...healthy, deadlineExpired: true }, "CONTINUE")).toMatchObject({ action: "STOP", reasonCode: "deadline_exceeded" });
    expect(arbitrateSupervision({ ...healthy, checkBudgetExhausted: true }, "CONTINUE")).toMatchObject({ action: "ESCALATE_HUMAN", effect: "stop" });
  });
  it("does not certify a success claim and distinguishes human waits from configured no-progress", () => {
    expect(arbitrateSupervision(healthy, "FINISH", true)).toMatchObject({ allowed: false, effect: "none" });
    expect(arbitrateSupervision({ ...healthy, humanWait: true, noProgress: true }, null)).toMatchObject({ action: "REQUEST_INPUT", effect: "none" });
    expect(arbitrateSupervision({ ...healthy, noProgress: true }, null)).toMatchObject({ action: "PAUSE", effect: "stop" });
  });
  it("bounds retries and refuses worker-authored reassignment or additional workers", () => {
    const failed = { ...healthy, pendingFailedWorker: true, liveAttempts: 0 };
    expect(arbitrateSupervision(failed, "RETRY", false).allowed).toBe(false);
    expect(arbitrateSupervision({ ...failed, retryAvailable: false }, "RETRY", true).allowed).toBe(false);
    expect(arbitrateSupervision(failed, "RETRY", true)).toMatchObject({ action: "RETRY", effect: "dispatch" });
    expect(arbitrateSupervision({ ...healthy, planStatus: "paused", liveAttempts: 0 }, "REASSIGN", false).allowed).toBe(false);
    expect(arbitrateSupervision(healthy, "SPAWN_WORKER", true).allowed).toBe(false);
  });
  it("degrades unsupported live steering to an attributable safe pause", () => {
    expect(arbitrateSupervision(healthy, "STEER", true)).toMatchObject({ action: "PAUSE", reasonCode: "live_steering_unqualified", effect: "stop" });
  });
});
