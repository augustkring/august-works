import test from "node:test";
import assert from "node:assert/strict";
import { assertSecuritySelectorsExecuted } from "./check-v10-security-regression-execution.mjs";

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
