#!/usr/bin/env node
import { checkPlatformSkillOperatingKnowledge } from "./platform-skill-operating-knowledge.mjs";

const root = process.cwd();
const failures = await checkPlatformSkillOperatingKnowledge(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  const corpus = await import("node:fs/promises").then(fs => fs.readFile(`${root}/evals/platform-skill/cases.json`, "utf8").then(JSON.parse));
  console.log(`V10-145 source-integrity gates passed: ${corpus.cases.length} baseline cases, ${corpus.fieldRegressionCases.length} Human-reviewed field cases; profile qualification boundaries remain explicit.`);
}
