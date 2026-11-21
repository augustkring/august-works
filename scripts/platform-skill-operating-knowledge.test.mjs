import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { canonicalScenario, checkPlatformSkillOperatingKnowledge, parsePromptfooProviderBlock, validateFieldCase } from "./platform-skill-operating-knowledge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("V10-145 audit binds the required source domains to the current immutable release and bounded Promptfoo scenarios", async () => {
  assert.deepEqual(await checkPlatformSkillOperatingKnowledge(root), []);
  const audit = JSON.parse(readFileSync(path.join(root, "evals/platform-skill/operating-knowledge.json"), "utf8"));
  const corpus = JSON.parse(readFileSync(path.join(root, "evals/platform-skill/cases.json"), "utf8"));
  assert.equal(corpus.cases.length, 48);
  assert.equal(new Set(Object.values(audit.coverageDomains).flat()).size, 48);
  for (const [domain, ids] of Object.entries(audit.coverageDomains)) {
    for (const id of ids) assert.equal(corpus.cases.find(item => item.id === id)?.domain, domain);
  }
  assert.equal(canonicalScenario("native_required_skill_missing")?.includes("required Platform Skill"), true);
});

test("field regressions require reviewed provenance and reject raw customer paths, identifiers, and transcript fields", () => {
  const safe = {
    id: "field-" + "a".repeat(16), domain: "failure_recovery", scenario: "timeout_after_possible_external_effect",
    expectAny: ["check status"], forbidAny: ["retry immediately"], sourceKind: "support_failure",
    sourceDigest: "a".repeat(64), reviewedByRole: "platform_skill_owner", reviewedAt: "2026-10-30T12:00:00.000Z",
    privacyReview: "sanitized_scenario_only", copiedTranscript: false,
  };
  assert.deepEqual(validateFieldCase(safe), []);
  assert.match(validateFieldCase({ ...safe, sourcePath: "/private/support/123" }).join("\n"), /unrecognized content field/);
  assert.match(validateFieldCase({ ...safe, expectAny: ["Marie Jensen"] }).join("\n"), /closed-vocabulary expected signals/);
  assert.match(validateFieldCase({ ...safe, forbidAny: ["secret from Acme"] }).join("\n"), /closed-vocabulary prohibited signals/);
  assert.match(validateFieldCase({ ...safe, id: "field-ticket-123" }).join("\n"), /first 16 hex characters/);
  assert.match(validateFieldCase({ ...safe, reference: "references/../../private.md" }).join("\n"), /one-level release reference/);
  assert.match(validateFieldCase({ ...safe, scenario: "unreviewed_prompt_injection" }).join("\n"), /Unknown bounded scenario/);
  assert.match(validateFieldCase({ ...safe, reviewedByRole: "analyst" }).join("\n"), /Platform Skill owner review/);
  assert.match(validateFieldCase({ ...safe, sourceKind: "unknown" }).join("\n"), /Invalid field source kind/);
  assert.match(validateFieldCase({ ...safe, sourceDigest: "ticket-123" }).join("\n"), /SHA-256/);
  assert.match(validateFieldCase({ ...safe, copiedTranscript: true }).join("\n"), /no transcript retention/);
  assert.match(validateFieldCase({ ...safe, reviewedAt: undefined }).join("\n"), /reviewedAt/);
});

test("efficiency observations are diagnostic only and unqualified runtimes are not asserted as GA", async () => {
  const audit = JSON.parse(readFileSync(path.join(root, "evals/platform-skill/operating-knowledge.json"), "utf8"));
  const corpus = JSON.parse(readFileSync(path.join(root, "evals/platform-skill/cases.json"), "utf8"));
  const efficiency = corpus.cases.filter(item => item.domain === "efficiency");
  assert.equal(efficiency.every(item => item.diagnosticOnly && item.expectAny.length === 0 && item.forbidAny.length === 0), true);
  assert.deepEqual(efficiency.map(item => item.measurement).sort(), [
    "provider_latency_tokens_cost", "prompt_bytes_and_estimated_tokens", "reference_count_and_bytes",
    "runner_retry_count", "skill_package_assets_per_scenario", "tool_call_observability_boundary",
  ].sort());
  assert.deepEqual(audit.gaProfileInventory.claimedProfiles, []);
  assert.equal(audit.runtimeProfiles.some(item => item.profile === "openclaw" && item.qualification === "not_qualified_not_claimed_ga"), true);
  assert.equal(audit.runtimeProfiles.some(item => item.profile === "hermes" && item.qualification === "not_qualified_not_claimed_ga"), true);
});

test("provider parsing rejects configuration fields that the eval runner cannot preserve", () => {
  const config = readFileSync(path.join(root, "evals/promptfoo/promptfooconfig.yaml"), "utf8");
  const block = config.match(/^providers:\s*\r?\n([\s\S]*?)^defaultTest:/m)?.[1];
  assert.ok(block);
  const providers = parsePromptfooProviderBlock(block);
  assert.equal(providers.length, 4);
  const mutated = block.replace("    label: gpt-4.1", "    label: gpt-4.1\n    config:\n      temperature: 0");
  assert.throws(() => parsePromptfooProviderBlock(mutated), /Unrecognized Promptfoo provider configuration/);
});
