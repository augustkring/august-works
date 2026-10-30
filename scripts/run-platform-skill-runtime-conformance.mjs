#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = "evals/platform-skill/runtime-conformance.json";
const RELEASE_PATH = "skills-releases/blentera-platform/releases.json";
const REQUIRED_SCENARIO_IDS = [
  "pinned-positive-delivery",
  "missing-or-stale-pin",
  "reserved-name-collision",
  "isolated-profile-boundary",
  "safe-recovery-boundary",
];
const REQUIRED_PROFILE_IDS = ["blentera-managed-native", "openclaw", "hermes-local", "a2a-or-custom"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(args) {
  const options = { profiles: [], dryRun: false, evidenceDir: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--profile") options.profiles.push(args[++index]);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--evidence-dir") options.evidenceDir = args[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.profiles.some((profile) => !profile)) throw new Error("--profile requires a profile id");
  if (options.evidenceDir && (options.evidenceDir.startsWith("/") || path.resolve(ROOT, options.evidenceDir) === ROOT ||
      !path.resolve(ROOT, options.evidenceDir).startsWith(`${ROOT}${path.sep}`)))
    throw new Error("Evidence directory must be repo-relative and remain inside the repository");
  return options;
}

async function file(pathname) {
  return readFile(path.resolve(ROOT, pathname));
}

async function loadContract() {
  return JSON.parse((await file(CONTRACT_PATH)).toString("utf8"));
}

export function validateContract(contract) {
  if (contract.contract !== "v10-platform-skill-cross-runtime-conformance") throw new Error("Unexpected runtime conformance contract id");
  if (!Array.isArray(contract.scenarios)) throw new Error("Runtime conformance scenarios must be an array");
  const scenarioIds = new Set(contract.scenarios.map(({ id }) => id));
  if (scenarioIds.size !== contract.scenarios.length ||
      [...scenarioIds].sort().join("\0") !== [...REQUIRED_SCENARIO_IDS].sort().join("\0") ||
      contract.scenarios.some(({ required }) => required !== true))
    throw new Error(`Scenario IDs must match the exact required common cases: ${REQUIRED_SCENARIO_IDS.join(", ")}`);
  if (!Array.isArray(contract.profiles)) throw new Error("Runtime conformance profiles must be an array");
  const profileIds = new Set(contract.profiles.map(({ id }) => id));
  if (profileIds.size !== contract.profiles.length ||
      [...profileIds].sort().join("\0") !== [...REQUIRED_PROFILE_IDS].sort().join("\0"))
    throw new Error(`Profile IDs must match the exact declared runtime inventory: ${REQUIRED_PROFILE_IDS.join(", ")}`);
  const profiles = new Set();
  for (const profile of contract.profiles) {
    if (profiles.has(profile.id)) throw new Error(`Duplicate profile ${profile.id}`);
    profiles.add(profile.id);
    if (!Array.isArray(profile.implementationSources) || profile.implementationSources.length === 0)
      throw new Error(`${profile.id} must pin the implementation source it claims`);
    if (profile.exactInstalledVersion !== null)
      throw new Error(`${profile.id} cannot claim an installed runtime version in source-only conformance`);
    const qualificationWithoutNotGa = profile.qualification.replace(/not[-_]ga/gi, "");
    if (/externally-qualified/i.test(profile.qualification) || /(^|[-_])ga(?:$|[-_])/i.test(qualificationWithoutNotGa))
      throw new Error(`${profile.id} cannot claim external qualification or GA status in source-only conformance`);
    const covered = new Set();
    for (const suite of profile.suites) {
      for (const id of suite.scenarios) {
        if (!scenarioIds.has(id)) throw new Error(`${profile.id} references unknown scenario ${id}`);
        covered.add(id);
      }
      if (!suite.path || !suite.selection || !suite.config) throw new Error(`${profile.id} has an incomplete test suite record`);
      if (suite.requiredTitles) {
        const selectors = suite.selection.split("|");
        if (!Array.isArray(suite.requiredTitles) || suite.requiredTitles.length === 0 ||
            new Set(suite.requiredTitles).size !== suite.requiredTitles.length ||
            suite.requiredTitles.some((title) => typeof title !== "string" || !selectors.some((selector) =>
              title === selector || title.startsWith(`${selector} (`))))
          throw new Error(`${profile.id} has invalid exact required test titles`);
      }
    }
    profile.sourceCoverage = [...scenarioIds].map((id) => ({ id, coveredBySourceTests: covered.has(id) }));
    profile.commonSuiteComplete = profile.sourceCoverage.every(({ coveredBySourceTests }) => coveredBySourceTests);
    if (profile.implementation === "no-common-skill-delivery-driver" && profile.suites.length)
      throw new Error(`${profile.id} cannot claim suites without a delivery driver`);
    if (profile.qualification !== "externally-qualified" && !/unqualified|not-GA|not_GA/i.test(profile.qualification))
      throw new Error(`${profile.id} must remain unqualified until external evidence is reviewed`);
  }
  return contract;
}


export function selectProfiles(contract, requestedProfiles = []) {
  const selected = requestedProfiles.length
    ? contract.profiles.filter(({ id }) => requestedProfiles.includes(id))
    : contract.profiles.filter(({ suites }) => suites.length > 0);
  if (!selected.length || selected.length !== new Set(requestedProfiles).size && requestedProfiles.length)
    throw new Error(`Unknown or unavailable profile id: ${requestedProfiles.join(", ")}`);
  return selected;
}

export function describeProfileScope(contract, selectedProfiles, requestedProfiles = []) {
  const runnableProfiles = contract.profiles.filter(({ suites }) => suites.length > 0).map(({ id }) => id);
  const declaredProfiles = contract.profiles.map(({ id }) => id);
  const executedProfiles = selectedProfiles.map(({ id }) => id);
  const executed = new Set(executedProfiles);
  return {
    mode: requestedProfiles.length ? "explicit-profile-selection" : "all-runnable-source-profiles",
    requestedProfiles: [...requestedProfiles],
    executedProfiles,
    runnableProfiles,
    unselectedRunnableProfiles: runnableProfiles.filter((id) => !executed.has(id)),
    unsupportedProfiles: contract.profiles.filter(({ suites }) => suites.length === 0).map(({ id }) => id),
    includesAllRunnableProfiles: runnableProfiles.every((id) => executed.has(id)),
    includesAllDeclaredProfiles: declaredProfiles.every((id) => executed.has(id)),
  };
}

export async function validateSuites(contract) {
  const pins = new Map();
  for (const profile of contract.profiles) {
    for (const sourcePath of profile.implementationSources) {
      const source = await file(sourcePath);
      pins.set(sourcePath, sha256(source));
    }
    for (const suite of profile.suites) {
      const source = await file(suite.path);
      const sourceText = source.toString("utf8");
      const missingAlternatives = suite.selection.split("|").filter((selection) => !sourceText.includes(selection));
      if (missingAlternatives.length) throw new Error(`${suite.path} is missing test title(s): ${missingAlternatives.join(", ")}`);
      const config = await file(suite.config);
      pins.set(suite.path, sha256(source));
      pins.set(suite.config, sha256(config));
    }
  }
  return Object.fromEntries([...pins].sort(([left], [right]) => left.localeCompare(right)));
}

export function attachRawReportReceipt(testSummary, receipt) {
  return { ...testSummary, rawReport: receipt,
    requiredTitles: testSummary.requiredTitles.map((required) => ({ ...required, rawReportSha256: receipt.sha256, rawReportPath: receipt.path })) };
}

export function selectedAssertionsPassed(testSummary) {
  return testSummary.parsed && testSummary.requiredTitles.length > 0 &&
    testSummary.requiredTitles.every(({ passed }) => passed) && testSummary.failed === 0;
}

export function parseSelectedTestResults(report, suite, root = ROOT) {
  if (!Array.isArray(report?.testResults))
    return { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0, parsed: false, requiredTitles: [] };
  const selectedPath = path.resolve(root, suite.path);
  const matchingFiles = report.testResults.filter(({ name }) => name && path.resolve(root, name) === selectedPath);
  if (matchingFiles.length !== 1 || !Array.isArray(matchingFiles[0].assertionResults))
    return { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0, parsed: false, requiredTitles: [] };
  const assertions = matchingFiles[0].assertionResults;
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for (const assertion of assertions) {
    if (assertion.status === "passed") counts.passed += 1;
    else if (assertion.status === "failed") counts.failed += 1;
    else if (assertion.status === "skipped" || assertion.status === "skip") counts.skipped += 1;
    else if (assertion.status === "todo" || assertion.status === "pending") counts.todo += 1;
    else return { ...counts, total: assertions.length, parsed: false, requiredTitles: [] };
  }
  const expected = suite.requiredTitles ?? suite.selection.split("|");
  const requiredTitles = expected.map((title) => {
    const matches = assertions.filter((assertion) => assertion.title === title ||
      assertion.fullName === title || assertion.fullName?.split(/\s+>\s+|\s+›\s+/).at(-1) === title);
    const candidates = matches.length === 0
      ? assertions.filter((assertion) => assertion.title?.startsWith(title.split(" (")[0])).map(({ title: candidateTitle, status }) => ({ title: candidateTitle, status }))
      : [];
    const statuses = matches.map(({ status }) => status);
    return { title, matches: matches.length, statuses,
      passed: statuses.length > 0 && statuses.every((status) => status === "passed"), ...(candidates.length ? { candidates } : {}) };
  });
  const diagnosticTitles = requiredTitles.some(({ passed }) => !passed)
    ? assertions.map(({ title, status }) => ({ title, status }))
    : [];
  return { ...counts, total: assertions.length, parsed: true, requiredTitles, ...(diagnosticTitles.length ? { diagnosticTitles } : {}) };
}

function commandFor(suite) {
  return ["pnpm", ["exec", "vitest", "run", "--config", suite.config, suite.path, "--testNamePattern", suite.selection, "--reporter=json"]];
}

async function runProfile(profile, sourcePins, options) {
  const results = [];
  for (const suite of profile.suites) {
    const [command, args] = commandFor(suite);
    let result = { status: 0, stdout: "", stderr: "" };
    let executedArgs = args;
    let testSummary = { passed: 0, failed: 0, skipped: 0, todo: 0, total: 0, parsed: false, requiredTitles: [] };
    if (!options.dryRun) {
      const outputDir = await mkdtemp(path.join(os.tmpdir(), "platform-skill-vitest-"));
      const jsonReport = path.join(outputDir, "vitest-report.json");
      try {
        executedArgs = [...args, "--outputFile", jsonReport];
        result = spawnSync(command, executedArgs, { cwd: ROOT, encoding: "utf8", env: { ...process.env, VITEST_MAX_THREADS: "1" } });
        try {
          const reportBytes = await readFile(jsonReport);
          const reportName = `${profile.id}-${sha256(suite.path).slice(0, 12)}-vitest.json`;
          const reportPath = path.join(options.evidenceDirAbsolute, "vitest-json", reportName);
          await mkdir(path.dirname(reportPath), { recursive: true });
          await writeFile(reportPath, reportBytes);
          const receipt = { path: path.relative(ROOT, reportPath), sha256: sha256(reportBytes), bytes: reportBytes.length };
          try {
            testSummary = attachRawReportReceipt(parseSelectedTestResults(JSON.parse(reportBytes.toString("utf8")), suite), receipt);
          } catch {
            testSummary = attachRawReportReceipt({ ...testSummary, parsed: false }, receipt);
          }
        } catch {
          testSummary = { ...testSummary, parsed: false };
        }
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    }
    results.push({
      suite: suite.path,
      config: suite.config,
      selection: suite.selection,
      command: [command, ...executedArgs],
      sourceSha256: sourcePins[suite.path],
      configSha256: sourcePins[suite.config],
      exitCode: result.status ?? 1,
      testSummary,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error?.message ?? "",
    });
  }
  return {
    profile: profile.id,
    runtime: profile.runtime,
    implementation: profile.implementation,
    qualification: profile.qualification,
    exactInstalledVersion: profile.exactInstalledVersion,
    commonSuiteComplete: profile.commonSuiteComplete,
    sourceCoverage: profile.sourceCoverage,
    suites: results,
    localSourceSuitesPassed: !options.dryRun && results.length > 0 && results.every(({ exitCode, testSummary }) => exitCode === 0 && selectedAssertionsPassed(testSummary)),
    sourceSuitesExecuted: !options.dryRun,
    externalQualification: "not-run; exact installed runtime/profile evidence and Human owner review are required",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/run-platform-skill-runtime-conformance.mjs [--profile ID] [--dry-run] [--evidence-dir repo/relative/path]");
    return 0;
  }
  const contract = validateContract(await loadContract());
  const sourcePins = await validateSuites(contract);
  const selected = selectProfiles(contract, options.profiles);
  const profileScope = describeProfileScope(contract, selected, options.profiles);
  const releaseBytes = await file(RELEASE_PATH);
  const releases = JSON.parse(releaseBytes.toString("utf8"));
  const currentRelease = releases.at(-1);
  if (!currentRelease) throw new Error("No immutable Platform Skill release is registered");

  const evidenceDir = options.evidenceDir ?? `doc/operations/aw-v10-evidence/platform-skill-runtime-conformance-${new Date().toISOString().slice(0, 10)}`;
  const evidenceDirAbsolute = path.resolve(ROOT, evidenceDir);
  if (!options.dryRun || options.evidenceDir) await mkdir(evidenceDirAbsolute, { recursive: true });
  const runOptions = { ...options, evidenceDirAbsolute };
  const profiles = [];
  for (const profile of selected) profiles.push(await runProfile(profile, sourcePins, runOptions));
  const report = {
    schemaVersion: 1,
    contract: contract.contract,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? "dry-run-not-executed" : "local-source-tests-only",
    repoRevision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    dependencies: { node: process.version, pnpm: spawnSync("pnpm", ["--version"], { cwd: ROOT, encoding: "utf8" }).stdout.trim() },
    sourcePins: { contract: sha256(await file(CONTRACT_PATH)), releaseRegistry: sha256(releaseBytes), sourceTestConfigAndImplementationFiles: sourcePins },
    release: {
      skillKey: currentRelease.skillKey,
      version: currentRelease.id,
      digest: currentRelease.contentDigest,
      sourceSha: currentRelease.sourceSha,
      operationManifestHash: currentRelease.operationManifestHash,
      toolCatalogContractHash: currentRelease.toolCatalogContractHash,
      compatibilityDeclarationIsExternalQualification: false,
      supersedes: currentRelease.supersedes ?? null,
    },
    releaseComparison: {
      championVersion: currentRelease.supersedes ?? null,
      candidateVersion: currentRelease.id,
      status: "champion-challenger evaluation is not run by this source-conformance harness",
      requiredBeforePromotion: ["paired evaluation results", "adversarial and recovery results", "complete applicable runtime conformance", "Human platform-owner review", "staged rollout and rollback evidence"],
    },
    profileScope,
    profiles,
    qualificationResult: options.dryRun
      ? "source-contract-valid; runtime-tests-not-run; runtime-remains-unqualified"
      : profiles.every(({ commonSuiteComplete, localSourceSuitesPassed }) => commonSuiteComplete && localSourceSuitesPassed)
        ? "source-suites-green-only; runtime-remains-unqualified"
        : "incomplete-or-failing-source-conformance; runtime-remains-unqualified",
  };
  if (!options.dryRun || options.evidenceDir) {
    await writeFile(path.resolve(ROOT, evidenceDir, `${profiles.map(({ profile }) => profile).join("+")}-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ qualificationResult: report.qualificationResult, profileScope, profiles: profiles.map(({ profile, commonSuiteComplete, localSourceSuitesPassed }) => ({ profile, commonSuiteComplete, localSourceSuitesPassed })), evidenceDir: options.evidenceDir ?? (!options.dryRun ? `doc/operations/aw-v10-evidence/platform-skill-runtime-conformance-${new Date().toISOString().slice(0, 10)}` : null) }, null, 2));
  return options.dryRun || report.qualificationResult === "source-suites-green-only; runtime-remains-unqualified" ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
