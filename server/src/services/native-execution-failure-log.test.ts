import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeExecutionFailureLogFields } from "./heartbeat.js";

describe("Native execution failure log privacy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps error text, SQL, parameters, and SQL-bearing deadlock detail out of logs", () => {
    const marker = "private-request-marker-7f42";
    const error = new Error(marker, {
      cause: {
        code: "40P01",
        query: `UPDATE private_profile SET prompt='${marker}'`,
        parameters: [marker],
        detail: [
          "Process 123 waits for ShareLock on transaction 456; blocked by process 789.",
          "Process 789 waits for ShareLock on transaction 123; blocked by process 123.",
          `Process 123: UPDATE private_profile SET prompt='${marker}'`,
          `Process 789: SELECT '${marker}'`,
        ].join("\n"),
      },
    });

    const normal = nativeExecutionFailureLogFields({
      error,
      runId: "00000000-0000-4000-8000-000000000001",
      failureCode: "adapter_failed",
    });
    expect(normal).toMatchObject({ failureCode: "adapter_failed", sqlState: "40P01" });
    expect(JSON.stringify(normal)).not.toContain(marker);
    expect(JSON.stringify(normal)).not.toContain("UPDATE private_profile");

    const diagnostic = nativeExecutionFailureLogFields({
      error,
      runId: "00000000-0000-4000-8000-000000000001",
      failureCode: "adapter_failed",
      includeDeadlockLockGraph: true,
    });
    expect(diagnostic.deadlockWaitEdges).toEqual([
      { waitingProcess: "123", lockMode: "Share", transactionId: "456", blockedByProcess: "789" },
      { waitingProcess: "789", lockMode: "Share", transactionId: "123", blockedByProcess: "123" },
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain(marker);
    expect(JSON.stringify(diagnostic)).not.toContain("UPDATE private_profile");
    expect(JSON.stringify(diagnostic)).not.toContain("Process 123:");
  });

  it("bounds opt-in failure diagnostics to SQLSTATE and allowlisted service frames", () => {
    vi.stubEnv("PAPERCLIP_NATIVE_SOURCE_CLOSURE_DIAGNOSTICS", "1");
    const marker = "private-diagnostic-marker-31af";
    const cause = Object.assign(new Error(marker), {
      code: "55P03",
      stack: `Error: ${marker}\n    at owner (/workspace/server/src/services/native-runtime/native-session-executor.ts:123:45)\n    at private (/tmp/${marker}.ts:9:2)`,
    });
    const error = new Error(marker, { cause: { cause: { cause, code: "not-a-sql-state" } } });
    const fields = nativeExecutionFailureLogFields({ error, runId: "00000000-0000-4000-8000-000000000001",
      failureCode: "adapter_failed" });
    expect(fields).toMatchObject({ sqlState: "55P03",
      serviceFrames: ["native-runtime/native-session-executor.ts:123:45"] });
    expect(JSON.stringify(fields)).not.toContain(marker);
    expect(JSON.stringify(fields)).not.toContain("/tmp/");
  });
});
