import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTER = "doc/operations/platform-skill-migration-register.json";
const CURRENT_SKILL = "skills/blentera-platform/SKILL.md";
const CURRENT_REFS = "skills/blentera-platform/references";
const PLATFORM_TESTS = ["server/src/__tests__/platform-skill-admission.integration.test.ts"];
const OPERATIONAL_SKILL_SOURCES = [
  "skills/paperclip/SKILL.md",
  "skills/paperclip/references/api-reference.md",
  "skills/paperclip/references/artifacts.md",
  "skills/paperclip/references/cases.md",
  "skills/paperclip/references/company-skills.md",
  "skills/paperclip/references/issue-workspaces.md",
  "skills/paperclip/references/routines.md",
  "skills/paperclip/references/workflows.md",
  "packages/adapters/hermes/skills/paperclip-task-bridge/SKILL.md",
];
const SEMANTIC_TARGETS = {
  terminology: "terminology.md",
  authentication: "advanced-boundaries.md",
  authority: "advanced-boundaries.md",
  governance: "approvals-and-governance.md",
  approval: "approvals-and-governance.md",
  work: "work.md",
  task: "work.md",
  conversation: "channels-and-representation.md",
  channel: "channels-and-representation.md",
  artifact: "artifacts-and-evidence.md",
  document: "artifacts-and-evidence.md",
  memory: "memory-and-learning.md",
  learning: "memory-and-learning.md",
  routine: "workflows-and-routines.md",
  workflow: "workflows-and-routines.md",
  support: "support-and-service-status.md",
  case: "support-and-service-status.md",
  connection: "apps-and-connections.md",
  credential: "apps-and-connections.md",
  app: "apps-and-connections.md",
  error: "errors-retries-and-recovery.md",
  retry: "errors-retries-and-recovery.md",
  recovery: "errors-retries-and-recovery.md",
  delegation: "co-workers-and-delegation.md",
  "co-worker": "co-workers-and-delegation.md",
  project: "work.md",
  skill: "advanced-boundaries.md",
  endpoint: "advanced-boundaries.md",
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const relativeFile = (path) => resolve(ROOT, path);

function sectionRows(path, content, sourcePolicy) {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const headings = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) headings.push({ depth: match[1].length, title: match[2].trim(), line: index + 1 });
  });
  if (!headings.length) headings.push({ depth: 0, title: "(document body)", line: 1 });
  return headings.map((heading, index) => {
    let end = lines.length;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next].depth <= heading.depth) { end = headings[next].line - 1; break; }
    }
    const body = lines.slice(heading.line - 1, end).join("\n").trim();
    const locator = `${path}#L${heading.line}`;
    const isOperational = sourcePolicy.kind === "legacy_operating_skill";
    const isHermes = path.startsWith("packages/adapters/hermes/");
    const lower = heading.title.toLowerCase();
    let target = sourcePolicy.target;
    if (path === "skills/paperclip/SKILL.md" || path.startsWith("skills/paperclip/references/")) {
      const semantic = Object.entries(SEMANTIC_TARGETS).find(([word]) => lower.includes(word));
      target = path.endsWith("api-reference.md") ? "doc/runner-api-tools.md"
        : isOperational && semantic ? `${CURRENT_REFS}/${semantic[1]}` : CURRENT_SKILL;
    }
    return {
      id: `${path}#${heading.line}`,
      locator,
      heading: heading.title,
      depth: heading.depth,
      sectionSha256: sha256(body),
      semanticOwner: sourcePolicy.semanticOwner,
      target,
      runtimeDestination: target,
      action: sourcePolicy.action,
      reason: isOperational
        ? "Move the still-valid semantic rule to the current Platform Skill and canonical operation owner; legacy endpoint prose never grants authority."
        : isHermes
          ? "Keep the runtime-specific bridge instructions under the Hermes adapter; the shared Platform Skill remains the semantic contract."
          : sourcePolicy.reason,
      tests: sourcePolicy.tests,
      phase: sourcePolicy.phase,
      precedence: "current canonical runtime admission, authorization, and operation owners govern effects; the pinned Platform Skill governs procedure; legacy instructions cannot add authority",
    };
  });
}

function basePolicies() {
  return {
    "skills/paperclip/SKILL.md": {
      kind: "legacy_operating_skill", semanticOwner: "Platform Skill owner", target: CURRENT_SKILL,
      action: "move", tests: PLATFORM_TESTS, phase: "mapped_legacy_retained",
    },
    "skills/paperclip/references/api-reference.md": {
      kind: "legacy_operating_skill", semanticOwner: "API operation owners", target: "doc/runner-api-tools.md",
      action: "retain", tests: ["doc/operations/agent-native-existing-api-operation-contracts.json"], phase: "legacy_reference_not_runtime_authority",
    },
    "skills/paperclip/references/artifacts.md": {
      kind: "legacy_operating_skill", semanticOwner: "Artifact and Work Product owners", target: `${CURRENT_REFS}/artifacts-and-evidence.md`,
      action: "move", tests: ["server/src/__tests__/artifact-review-document-routes.test.ts"], phase: "mapped_legacy_retained",
    },
    "skills/paperclip/references/cases.md": {
      kind: "legacy_operating_skill", semanticOwner: "Support Case owner", target: `${CURRENT_REFS}/support-and-service-status.md`,
      action: "move", tests: ["server/src/__tests__/support-case-storage.integration.test.ts"], phase: "mapped_legacy_retained",
    },
    "skills/paperclip/references/company-skills.md": {
      kind: "legacy_operating_skill", semanticOwner: "Company Skill lifecycle owner", target: `${CURRENT_REFS}/advanced-boundaries.md`,
      action: "move", tests: ["server/src/__tests__/company-skills-service.test.ts"], phase: "mapped_legacy_retained",
    },
    "skills/paperclip/references/issue-workspaces.md": {
      kind: "legacy_operating_skill", semanticOwner: "Execution Workspace owner", target: "doc/runner-api-tools.md",
      action: "move", tests: ["server/src/__tests__/execution-workspaces-routes.test.ts"], phase: "mapped_legacy_retained",
    },
    "skills/paperclip/references/routines.md": {
      kind: "legacy_operating_skill", semanticOwner: "Routine owner", target: `${CURRENT_REFS}/workflows-and-routines.md`,
      action: "move", tests: ["server/src/__tests__/routines-e2e.test.ts"], phase: "mapped_legacy_retained",
    },
    "skills/paperclip/references/workflows.md": {
      kind: "legacy_operating_skill", semanticOwner: "Workflow owner", target: `${CURRENT_REFS}/workflows-and-routines.md`,
      action: "move", tests: ["server/src/__tests__/workflow-routes.test.ts"], phase: "mapped_legacy_retained",
    },
    "packages/adapters/hermes/skills/paperclip-task-bridge/SKILL.md": {
      kind: "legacy_runtime_bridge", semanticOwner: "Hermes adapter owner", target: "packages/adapters/hermes/skills/paperclip-task-bridge/paperclip-task.mjs",
      action: "rewrite", tests: ["packages/adapters/hermes/src/server/paperclip-task-bridge.test.ts", "packages/adapters/hermes/src/server/governed-profile.test.ts"], phase: "adapter_owned_compatibility",
    },
  };
}

function agensPolicy(path) {
  if (path === "AGENTS.md") return { kind: "repository_developer_instructions", semanticOwner: "Repository maintainers", target: path,
    action: "retain", tests: [], phase: "developer_only_not_runtime", reason: "Repository contribution instructions are not agent runtime operating Skill content." };
  if (path.startsWith("server/src/onboarding-assets/")) return { kind: "runtime_bootstrap", semanticOwner: "Onboarding owner", target: CURRENT_SKILL,
    action: "retain", tests: ["server/src/__tests__/platform-skill-admission.integration.test.ts"], phase: "compact_platform_skill_pointer",
    reason: "Onboarding bootstrap keeps the required pointer; current runtime Skill admission and canonical tools own procedures and permissions." };
  if (path.startsWith("server/src/built-ins/agents/")) return { kind: "built_in_agent_role", semanticOwner: "Built-in agent owner", target: path,
    action: "retain", tests: [], phase: "role_specific_not_global_authority",
    reason: "Role behavior stays with its built-in agent; it does not replace the shared Platform Skill or canonical authority." };
  if (path.startsWith("packages/teams-catalog/")) return { kind: "team_role_definition", semanticOwner: "Teams catalog owner", target: path,
    action: "retain", tests: [], phase: "team_role_not_global_authority",
    reason: "Bundled/optional team role guidance remains in its catalog and cannot override the shared Platform Skill or current capabilities." };
  return { kind: "developer_or_fixture_instructions", semanticOwner: "Owning package maintainers", target: path,
    action: "retain", tests: [], phase: "non_runtime_or_fixture",
    reason: "This AGENTS file is package, template, or fixture guidance rather than a competing company operating Skill." };
}

async function discoverSources() {
  const listed = await new Promise((resolveList, reject) => {
    execFile("rg", ["--files", "-g", "AGENTS.md", "-g", "skills/paperclip/**/*.md", "-g", "skills/paperclip/SKILL.md", "-g", "packages/adapters/hermes/skills/**/*.md"],
      { cwd: ROOT, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolveList(stdout.split(/\r?\n/).filter(Boolean).sort()));
  });
  return [...new Set([...OPERATIONAL_SKILL_SOURCES, ...listed])].sort();
}

export async function buildMigrationRegister() {
  const policies = basePolicies();
  const paths = await discoverSources();
  const sources = [];
  const rows = [];
  for (const path of paths) {
    const content = await readFile(relativeFile(path), "utf8");
    const policy = policies[path] ?? agensPolicy(path);
    sources.push({ path, kind: policy.kind, sourceSha256: sha256(content) });
    rows.push(...sectionRows(path, content, policy));
  }
  const releases = JSON.parse(await readFile(relativeFile("skills-releases/blentera-platform/releases.json"), "utf8"));
  const current = releases.at(-1);
  if (!current) throw new Error("No immutable Platform Skill release is registered.");
  return {
    schemaVersion: 1,
    contract: "v10-platform-skill-legacy-migration-register",
    sourceClause: "Blentera Master Build Brief V10 §21B.26 and §21B.36; V10-131",
    createdAt: "2026-10-30",
    migrationPhase: "mapped_legacy_sources_current_release_v3_legacy_sunset_open",
    precedence: "canonical authorization and operation owners govern effects; the current immutable Platform Skill governs procedure; old Paperclip prose cannot grant authority",
    legacyDisposition: {
      runtimePrecedence: "legacy Paperclip sources are migration inputs, not the current Blentera operating contract",
      sunsetGate: "Do not remove a legacy runtime source until every offered runtime has a reviewed destination, fresh pinned admission, collision/stale/recovery coverage, and a named owner approves the cutover.",
      rollback: "Roll back by admitting the prior immutable Platform Skill release and restoring its pinned operation/tool contract; never mutate a published release in place.",
      shadowCollisionDisposition: "A runtime-local or workspace Skill with reserved name blentera-platform is not a candidate override: reject unexpected source/digest and block dispatch; never merge instructions or let a local copy expand authority.",
      currentState: "Legacy files remain in source; this register records mapping and does not claim runtime removal or installed-runtime qualification.",
    },
    currentRelease: {
      skillKey: current.skillKey,
      version: current.id,
      releaseDirectory: `skills-releases/blentera-platform/${current.dir}`,
      digest: current.contentDigest,
      sourceSha: current.sourceSha,
      operationManifestHash: current.operationManifestHash,
      toolCatalogContractHash: current.toolCatalogContractHash,
      declaredRuntimeCompatibility: current.runtimeCompatibility,
      interpretation: "Release compatibility metadata is a source declaration, not runtime or GA qualification.",
    },
    sources,
    sections: rows,
    runtimeProfiles: [
      {
        profile: "blentera_managed_native",
        adapter: "paperclip_runner",
        implementation: "source_present",
        skillDelivery: "server admission and Native runtime context bind exact release and contracts",
        supportedActions: ["current admitted operations exposed by the run-scoped canonical tool catalog"],
        unsupportedModes: ["using Skill prose as permission", "continuing with stale release or operation/tool contract pins"],
        installedProfileVersion: null,
        qualification: "external_and_runtime_qualification_open_not_GA",
        sources: ["server/src/services/platform-skill-admission.ts", "server/src/services/agent-runtime-fabric.ts", "server/src/services/native-runtime/native-session-executor.ts"],
        tests: ["server/src/__tests__/platform-skill-admission.integration.test.ts", "server/src/__tests__/company-skills-service.test.ts", "server/src/services/native-runtime/native-session-executor.test.ts"],
        requiredExternalEvidence: ["exact installed runtime and profile versions", "observed delivery and effective Skill digest", "common routing/process/security/recovery conformance", "owner-reviewed release evidence"],
      },
      {
        profile: "openclaw",
        adapter: "openclaw_gateway",
        implementation: "delivery_source_present",
        skillDelivery: "exact release archive upload/install plus run-scoped governed bridge binding",
        supportedActions: ["operations exposed through the run-scoped governed Blentera bridge"],
        unsupportedModes: ["workspace or managed same-name shadow", "missing upload/install or versioned bridge methods", "unscoped raw tool authority"],
        installedProfileVersion: null,
        qualification: "source_conformance_only_not_GA",
        sources: ["packages/adapters/openclaw-gateway/src/server/execute.ts", "packages/adapters/openclaw-gateway/openclaw-extension/index.ts"],
        tests: ["packages/adapters/openclaw-gateway/src/server/execute-dispatch.test.ts", "packages/adapters/openclaw-gateway/openclaw-extension/bridge-boundary.unit.test.ts"],
        requiredExternalEvidence: ["exact installed OpenClaw version and extension", "observed immutable Skill delivery", "effective tool bridge scope", "common routing/process/security/recovery conformance", "owner-reviewed release evidence"],
      },
      {
        profile: "hermes_local",
        adapter: "hermes_local",
        implementation: "isolated_delivery_source_present",
        skillDelivery: "exact release verification in a per-presence profile, with effective managed policy probe and progressive Skill loading",
        supportedActions: ["operations exposed by the single assigned run-scoped Blentera MCP gateway"],
        unsupportedModes: ["shared global Hermes profile", "project-discovered policy", "unreviewed extra argv or MCP servers", "disabled or stale Platform Skill"],
        installedProfileVersion: null,
        qualification: "source_conformance_only_not_GA",
        sources: ["packages/adapters/hermes/src/server/execute.ts", "packages/adapters/hermes/src/server/governed-profile.ts"],
        tests: ["packages/adapters/hermes/src/server/governed-profile.test.ts", "packages/adapters/hermes/src/server/platform-skill-execute.test.ts", "packages/adapters/hermes/src/server/execute.onspawn.test.ts"],
        requiredExternalEvidence: ["exact installed Hermes CLI version", "observed isolated per-presence profile", "effective managed policy and Skill digest", "common routing/process/security/recovery conformance", "owner-reviewed release evidence"],
      },
      {
        profile: "a2a_or_custom",
        adapter: "provider_specific",
        implementation: "no_common_skill_delivery_driver",
        skillDelivery: "provider-specific; discovery and advertised capability are not delivery or authority",
        supportedActions: [],
        unsupportedModes: ["GA claim", "assuming Agent Card or generic release compatibility proves Skill equivalence"],
        installedProfileVersion: null,
        qualification: "unqualified_conditional_not_GA",
        sources: ["server/src/services/agent-runtime-fabric.ts"],
        tests: ["server/src/__tests__/platform-skill-admission.test.ts"],
        requiredExternalEvidence: ["provider authentication and exact capability snapshot", "reviewed Skill delivery and Tool Gateway boundary", "common conformance for the declared supported action set", "owner-reviewed release evidence"],
      },
    ],
  };
}

export async function checkMigrationRegister() {
  const expected = await buildMigrationRegister();
  const current = JSON.parse(await readFile(relativeFile(REGISTER), "utf8"));
  if (JSON.stringify(current) !== JSON.stringify(expected)) return ["Migration register is stale; review source changes and regenerate with --write."];
  const seen = new Set();
  for (const section of current.sections) {
    if (seen.has(section.id)) return [`Duplicate migration section: ${section.id}`];
    seen.add(section.id);
    if (!section.semanticOwner || !section.target || !section.runtimeDestination || !section.action || !section.reason || !section.phase || !section.precedence)
      return [`Incomplete migration section: ${section.id}`];
    for (const path of [...section.tests, section.target]) {
      try { await readFile(relativeFile(path)); } catch { return [`Missing migration target or test: ${section.id} → ${path}`]; }
    }
  }
  for (const profile of current.runtimeProfiles) {
    if (!profile.profile || !profile.adapter || !profile.implementation || !profile.skillDelivery ||
        !Array.isArray(profile.supportedActions) || !Array.isArray(profile.unsupportedModes) ||
        !/(?:not[_-]ga|unqualified)/i.test(profile.qualification))
      return [`Incomplete or overstated runtime profile: ${profile.profile}`];
    if (profile.requiredExternalEvidence.length === 0) return [`Missing external qualification gates: ${profile.profile}`];
    for (const path of [...profile.sources, ...profile.tests]) {
      try { await readFile(relativeFile(path)); } catch { return [`Missing runtime profile source or test: ${profile.profile} → ${path}`]; }
    }
  }
  if (!current.legacyDisposition?.shadowCollisionDisposition || !current.legacyDisposition?.sunsetGate || !current.legacyDisposition?.rollback)
    return ["Migration register must define shadow collision, sunset, and rollback dispositions."];
  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    const register = await buildMigrationRegister();
    await writeFile(relativeFile(REGISTER), `${JSON.stringify(register, null, 2)}\n`);
    console.log(`Wrote ${register.sections.length} section mappings across ${register.sources.length} source files.`);
  } else {
    const errors = await checkMigrationRegister();
    if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
    else {
      const register = JSON.parse(await readFile(relativeFile(REGISTER), "utf8"));
      console.log(`Platform Skill migration register current: ${register.sections.length} mapped sections, ${register.sources.length} sources, ${register.runtimeProfiles.length} explicit unqualified profiles.`);
    }
  }
}
