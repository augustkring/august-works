import { describe, expect, it } from "vitest";
import { createControlledNativeSignoffBackend } from "./helpers/controlled-native-signoff-backend.js";

function execution(runId: string) {
  return { binding: { runId }, completionContract: { contract: { revision: 1, criteria: [] } } } as never;
}
function identity(runId: string) {
  return { runId, sessionId: `controlled-signoff-${runId}` } as never;
}
async function openAttempt(owner: ReturnType<typeof createControlledNativeSignoffBackend>, runId: string) {
  const backend = owner.controlledBackend(execution(runId));
  const session = await backend.openSession({ identity: identity(runId) });
  const events = session.events()[Symbol.asyncIterator]();
  const turn = await session.startTurn({ message: {} as never });
  return { session, events, turnId: turn.turnId };
}

describe("controlled Native signoff backend recovery", () => {
  it("keeps same-run retries behind the Human gate and independently releases other Runs", async () => {
    const owner = createControlledNativeSignoffBackend();
    try {
      const first = await openAttempt(owner, "same-run");
      const sameRun = await owner.waitForBackend("same-run");
      await sameRun.waitForStart();
      const firstEvent = first.events.next();
      await first.session.close({ reason: "retry" });
      await expect(firstEvent).resolves.toMatchObject({ done: true });

      const retry = await openAttempt(owner, "same-run");
      expect(retry.turnId).not.toBe(first.turnId);
      const retryEvent = retry.events.next();
      let retrySettled = false;
      void retryEvent.then(() => { retrySettled = true; });
      await Promise.resolve();
      expect(retrySettled).toBe(false);

      const other = await openAttempt(owner, "other-run");
      const otherRun = await owner.waitForBackend("other-run");
      await otherRun.waitForStart();
      const otherEvent = other.events.next();
      otherRun.release();
      await expect(otherEvent).resolves.toMatchObject({
        done: false,
        value: { runId: "other-run", turnId: other.turnId, eventType: "turn.completed" },
      });
      await Promise.resolve();
      expect(retrySettled).toBe(false);

      sameRun.release();
      await expect(retryEvent).resolves.toMatchObject({
        done: false,
        value: { runId: "same-run", turnId: retry.turnId, eventType: "turn.completed" },
      });
      await retry.session.close({ reason: "test_complete" });
      await other.session.close({ reason: "test_complete" });
    } finally {
      owner.close();
    }
  });
});
