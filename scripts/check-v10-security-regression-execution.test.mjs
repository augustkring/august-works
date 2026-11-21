import test from "node:test";
import assert from "node:assert/strict";
import { assertSecuritySelectorsExecuted, assertSecurityShardExecuted, mergeSecurityShardReports } from "./check-v10-security-regression-execution.mjs";

const root = "/repo";
const result = (name, statuses) => ({
  name: `${root}/${name}`,
  assertionResults: statuses.map((status) => ({ status })),
});

test("rejects selected suites when every matched assertion is skipped", () => {
  const report = { testResults: [result("server/src/auth.test.ts", ["skipped", "skipped"])] };
  assert.throws(
    () => assertSecuritySelectorsExecuted(report, [{ path: "server/src/auth.test.ts", kind: "file" }], root),
    /executed zero tests/,
  );
});

test("rejects a report that executed a different file than the selected file", () => {
  const report = { testResults: [result("server/src/other.test.ts", ["passed"])] };
  assert.throws(
    () => assertSecuritySelectorsExecuted(report, [{ path: "server/src/auth.test.ts", kind: "file" }], root),
    /matched 0 test file\(s\) but executed zero tests/,
  );
});

test("requires each file and directory selector to contribute an executed assertion", () => {
  const report = {
    testResults: [
      result("packages/db/src/client.test.ts", ["passed", "failed"]),
      result("packages/db/src/skipped.test.ts", ["skipped"]),
      result("server/src/auth.test.ts", ["passed"]),
      result("server/src/unselected.test.ts", ["skipped"]),
    ],
  };
  const selected = assertSecuritySelectorsExecuted(report, [
    { path: "packages/db/src", kind: "directory" },
    { path: "server/src/auth.test.ts", kind: "file" },
  ], root);
  assert.deepEqual(selected, [
    { path: "packages/db/src", matchedFiles: 2, executedTests: 2 },
    { path: "server/src/auth.test.ts", matchedFiles: 1, executedTests: 1 },
  ]);
});

test("rejects a directory selector with no matched executed files even if unrelated files ran", () => {
  const report = { testResults: [result("server/src/other.test.ts", ["passed"])] };
  assert.throws(
    () => assertSecuritySelectorsExecuted(report, [{ path: "server/src/auth", kind: "directory" }], root),
    /matched 0 test file\(s\) but executed zero tests/,
  );
});


test("requires each shard JSON receipt to contain at least one executed assertion", () => {
  assert.equal(assertSecurityShardExecuted({ testResults: [result("server/src/auth.test.ts", ["passed"])] }), 1);
  assert.throws(() => assertSecurityShardExecuted({ testResults: [result("server/src/auth.test.ts", ["skipped"])] }), /executed zero tests/);
});

test("aggregate receipts preserve directory coverage across separate shards", () => {
  const merged = mergeSecurityShardReports([
    { testResults: [result("server/src/auth/tenant.test.ts", ["passed"])] },
    { testResults: [result("server/src/auth/permissions.test.ts", ["failed"])] },
  ]);
  assert.deepEqual(
    assertSecuritySelectorsExecuted(merged, [{ path: "server/src/auth", kind: "directory" }], root),
    [{ path: "server/src/auth", matchedFiles: 2, executedTests: 2 }],
  );
  assert.throws(() => mergeSecurityShardReports([{ testResults: [] }, {}]), /each include a testResults array/);
});
