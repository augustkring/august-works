#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalScenario, checkPlatformSkillOperatingKnowledge, parsePromptfooProviderBlock } from "./platform-skill-operating-knowledge.mjs";

const root = process.cwd();
const errors = await checkPlatformSkillOperatingKnowledge(root);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const releases = JSON.parse(readFileSync(path.join(root, "skills-releases/blentera-platform/releases.json"), "utf8"));
const release = releases.at(-1);
const corpus = JSON.parse(readFileSync(path.join(root, "evals/platform-skill/cases.json"), "utf8"));
const baseConfig = readFileSync(path.join(root, "evals/promptfoo/promptfooconfig.yaml"), "utf8");
const providerBlock = baseConfig.match(/^providers:\s*\r?\n([\s\S]*?)^defaultTest:/m)?.[1];
if (!providerBlock) {
  console.error("The existing Promptfoo provider contract could not be read.");
  process.exit(1);
}
let providers;
try {
  providers = parsePromptfooProviderBlock(providerBlock);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const releaseDir = path.join(root, "skills-releases/blentera-platform", release.dir);
const skillText = readFileSync(path.join(releaseDir, "SKILL.md"), "utf8");
function anySignalExpression(signals, negate = false) {
  const checks = signals.map(value => "output.toLowerCase().includes(" + JSON.stringify(value.toLowerCase()) + ")");
  return (negate ? "!" : "") + "[" + checks.join(",") + "].some(Boolean)";
}
const tests = [...corpus.cases, ...corpus.fieldRegressionCases].map(testCase => {
  const reference = testCase.reference
    ? "\n\nRelevant one-level reference opened for this scenario (" + testCase.reference + "):\n" + readFileSync(path.join(releaseDir, testCase.reference), "utf8")
    : "";
  const scenario = canonicalScenario(testCase.scenario);
  const assertions = testCase.diagnosticOnly ? [] : [
    { type: "javascript", value: anySignalExpression(testCase.expectAny), metric: testCase.id + "_expected_behavior_signal" },
    ...(testCase.forbidAny.length ? [{ type: "javascript", value: anySignalExpression(testCase.forbidAny, true), metric: testCase.id + "_prohibited_behavior_signal" }] : []),
  ];
  return {
    description: "platform_skill." + testCase.id,
    metadata: { caseId: testCase.id, domain: testCase.domain, sourceKind: testCase.sourceKind ?? "canonical_contract_fixture", fieldRegression: Boolean(testCase.sourceKind), efficiencyMeasurement: testCase.measurement ?? null },
    vars: { scenario: scenario + reference },
    assert: assertions,
  };
});
const efficiencyCases = corpus.cases.filter(testCase => testCase.domain === "efficiency");
const promptSizes = corpus.cases.map(testCase => {
  const reference = testCase.reference ? readFileSync(path.join(releaseDir, testCase.reference), "utf8") : "";
  const promptBytes = Buffer.byteLength(skillText + "\n\nUser scenario:\n" + canonicalScenario(testCase.scenario) + (reference ? "\n\nRelevant one-level reference opened for this scenario (" + testCase.reference + "):\n" + reference : ""));
  return { id: testCase.id, promptBytes, estimatedTokens: Math.ceil(promptBytes / 4), referenceCount: testCase.reference ? 1 : 0 };
});
const totalReferenceLoads = promptSizes.reduce((total, item) => total + item.referenceCount, 0);
const totalPromptBytes = promptSizes.reduce((total, item) => total + item.promptBytes, 0);
const maxPromptBytes = Math.max(...promptSizes.map(item => item.promptBytes));
if (process.argv.includes("--check-only")) {
  console.log("Platform Skill eval binding verified: release=" + release.id + ", cases=" + tests.length + ", providers=" + providers.length + "; no model calls were made.");
  console.log("Efficiency preflight: cases=" + efficiencyCases.length + ", skillRootPackagesPerCase=1, relevantReferenceLoads=" + totalReferenceLoads + ", unrelatedReferenceLoads=0, toolCallsAvailable=0, runnerInvocations=1, runnerRetryPolicy=none, totalPromptBytes=" + totalPromptBytes + ", maxPromptBytes=" + maxPromptBytes + ", estimatedTokens=" + Math.ceil(totalPromptBytes / 4) + "; runtime activation/tool-call/provider-retry effects are not observable in this text-only runner.");
  process.exit(0);
}

const config = {
  description: "Blentera Platform Skill " + release.id + " Operating Knowledge evals (screening evidence only)",
  prompts: [{ id: "blentera-platform-" + release.id, raw: skillText + "\n\nUser scenario:\n{{scenario}}" }],
  providers,
  tests,
  evaluateOptions: { maxConcurrency: 1 },
};
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "platform-skill-evals-"));
try {
  const configPath = path.join(tempRoot, "promptfoo.json");
  writeFileSync(configPath, JSON.stringify(config));
  console.log("Running " + tests.length + " Platform Skill scenarios through existing Promptfoo providers (" + providers.map(provider => provider.label).join(", ") + "). Text-signal results do not establish runtime authorization or GA qualification. Efficiency preflight: relevant references=" + totalReferenceLoads + ", unrelated references=0, input bytes=" + totalPromptBytes + ", estimated input tokens=" + Math.ceil(totalPromptBytes / 4) + ". Promptfoo reports provider latency/token/cost diagnostics; runtime skill activation, tool calls, and provider-internal retries require runtime instrumentation and are not inferred here.");
  const result = spawnSync("npx", ["promptfoo@0.103.3", "eval", "--config", configPath, "--no-progress-bar", "--no-write"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
  });
  if (result.error) {
    console.error("Unable to run the existing Promptfoo eval engine: " + result.error.message);
    process.exitCode = 1;
  } else if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
