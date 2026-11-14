#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export function assertSecuritySelectorsExecuted(report, selectors, root = repoRoot) {
  if (!Array.isArray(report?.testResults)) {
    throw new Error("Vitest JSON report is missing the testResults array");
  }
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw new Error("Security selector execution guard requires at least one selected path");
  }

  const absoluteRoot = path.resolve(root);
  const reportFiles = report.testResults.map((result) => ({
    path: path.resolve(result.name ?? ""),
    assertions: Array.isArray(result.assertionResults) ? result.assertionResults : [],
  }));
  const results = [];

  for (const selector of selectors) {
    if (!selector || typeof selector.path !== "string" || !["file", "directory"].includes(selector.kind)) {
      throw new Error(`Invalid security selector descriptor: ${JSON.stringify(selector)}`);
    }
    const selectedPath = path.resolve(absoluteRoot, selector.path);
    if (selectedPath !== absoluteRoot && !selectedPath.startsWith(`${absoluteRoot}${path.sep}`)) {
      throw new Error(`Security selector escapes the repository: ${selector.path}`);
    }

    const matchedFiles = reportFiles.filter((file) => selector.kind === "file"
      ? file.path === selectedPath
      : file.path === selectedPath || file.path.startsWith(`${selectedPath}${path.sep}`));
    const executedTests = matchedFiles.reduce((count, file) => count + file.assertions.filter((assertion) =>
      assertion.status === "passed" || assertion.status === "failed").length, 0);
    if (executedTests === 0) {
      throw new Error(`Security selector ${selector.path} (${selector.kind}) matched ${matchedFiles.length} test file(s) but executed zero tests`);
    }
    results.push({ path: selector.path, matchedFiles: matchedFiles.length, executedTests });
  }

  return results;
}

export function assertSecurityShardExecuted(report) {
  if (!Array.isArray(report?.testResults)) {
    throw new Error("Vitest JSON report is missing the testResults array");
  }
  const executedTests = report.testResults.reduce((total, result) => total +
    (Array.isArray(result.assertionResults) ? result.assertionResults : []).filter((assertion) =>
      assertion.status === "passed" || assertion.status === "failed").length, 0);
  if (executedTests === 0) throw new Error("Security regression shard executed zero tests");
  return executedTests;
}

export function mergeSecurityShardReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0 || reports.some((report) => !Array.isArray(report?.testResults))) {
    throw new Error("Security shard reports must each include a testResults array");
  }
  return { testResults: reports.flatMap((report) => report.testResults) };
}

function mergeShardReports(reportDirectory, expectedCount) {
  const reportPaths = readdirSync(reportDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(reportDirectory, name));
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || reportPaths.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} security shard reports, found ${reportPaths.length}`);
  }
  const reports = reportPaths.map((reportPath) => JSON.parse(readFileSync(reportPath, "utf8")));
  return mergeSecurityShardReports(reports);
}

function main(argv) {
  if (argv[0] === "--shard") {
    if (argv.length !== 2) throw new Error("Usage: node scripts/check-v10-security-regression-execution.mjs --shard <vitest-json-report>");
    const executedTests = assertSecurityShardExecuted(JSON.parse(readFileSync(argv[1], "utf8")));
    process.stdout.write(`Executed ${executedTests} test(s) in this security shard.\n`);
    return;
  }
  if (argv[0] === "--aggregate") {
    const [, reportDirectory, expectedCountText, ...selectedPaths] = argv;
    const expectedCount = Number(expectedCountText);
    if (!reportDirectory || selectedPaths.length === 0) {
      throw new Error("Usage: node scripts/check-v10-security-regression-execution.mjs --aggregate <report-directory> <shard-count> <selected-path> [...]");
    }
    const selectors = selectedPaths.map((selectedPath) => {
      const absolutePath = path.resolve(repoRoot, selectedPath);
      const stats = statSync(absolutePath);
      return { path: selectedPath, kind: stats.isDirectory() ? "directory" : "file" };
    });
    const results = assertSecuritySelectorsExecuted(mergeShardReports(reportDirectory, expectedCount), selectors, repoRoot);
    for (const result of results) {
      process.stdout.write(`Executed ${result.executedTests} test(s) from ${result.path} (${result.matchedFiles} matched file(s)).\n`);
    }
    return;
  }
  const [reportPath, ...selectedPaths] = argv;
  if (!reportPath || selectedPaths.length === 0) {
    throw new Error("Usage: node scripts/check-v10-security-regression-execution.mjs <vitest-json-report> <selected-path> [...]");
  }
  const selectors = selectedPaths.map((selectedPath) => {
    const absolutePath = path.resolve(repoRoot, selectedPath);
    const stats = statSync(absolutePath);
    return { path: selectedPath, kind: stats.isDirectory() ? "directory" : "file" };
  });
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const results = assertSecuritySelectorsExecuted(report, selectors, repoRoot);
  for (const result of results) {
    process.stdout.write(`Executed ${result.executedTests} test(s) from ${result.path} (${result.matchedFiles} matched file(s)).\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
