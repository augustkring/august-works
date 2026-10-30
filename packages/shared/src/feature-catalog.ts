import { V8_FEATURES, V8_ROLLOUT, type V8FeatureKey } from "./v8-feature-flags.js";
import { V9_FEATURES, V9_ROLLOUT, type V9FeatureKey } from "./v9-feature-flags.js";
import { V6_FEATURES, V6_ROLLOUT, type V6FeatureKey } from "./v6-feature-flags.js";
import { V7_FEATURES, V7_ROLLOUT, type V7FeatureKey } from "./v7-feature-flags.js";
import { V5_FEATURES, V5_ROLLOUT, type V5FeatureKey } from "./v5-feature-flags.js";
import { z } from "zod";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";

/**
 * Feature catalog for cloud-managed instances.
 *
 * The instance-settings zod schema is the feature manifest; this module adds
 * only metadata about the flags the schema already declares. Keys are derived
 * from the schema type, so adding, removing, or renaming a boolean flag in
 * `instanceExperimentalSettingsSchema` without updating the metadata map is a
 * compile error (and vice versa).
 *
 * Tiers:
 * - `preference`: tenant-controllable taste setting; the cloud harness does
 *   not manage it.
 * - `managed`: the cloud harness may set this per fleet/stack via
 *   `PAPERCLIP_MANAGED_CONFIG`.
 * - `floor`: pinned by code on managed instances; no flag value may widen it.
 */
export const FEATURE_TIERS = ["preference", "managed", "floor"] as const;

export type FeatureTier = (typeof FEATURE_TIERS)[number];

type ExperimentalSettings = z.infer<typeof instanceExperimentalSettingsSchema>;

/**
 * The boolean flag keys of the experimental settings schema. Non-flag keys
 * (activation timestamps, numeric tuning values) are excluded.
 */
export type InstanceFeatureKey = {
  [K in keyof ExperimentalSettings]: ExperimentalSettings[K] extends boolean ? K : never;
}[keyof ExperimentalSettings];

interface FeatureCatalogBase {
  title: string;
  description: string;
  tier: FeatureTier;
  /** Desired default on cloud-managed instances. */
  cloudDefault: boolean;
  /** Must match the schema default; enforced by test. */
  selfHostedDefault: boolean;
}

export interface FeatureCatalogEntry extends FeatureCatalogBase {
  lifecycle: CapabilityLifecycle;
}

export const CAPABILITY_MATURITIES = ["internal", "experimental", "preview", "ga", "deprecated", "retired"] as const;
export type CapabilityMaturity = (typeof CAPABILITY_MATURITIES)[number];

/** Release and support facts are nullable until a named owner has qualified them. */
export interface CapabilityLifecycle {
  capabilityKey: InstanceFeatureKey;
  customerName: string;
  owner: string | null;
  maturity: CapabilityMaturity;
  firstSupportedVersion: string | null;
  customerSurfaces: string[];
  experienceProfiles: string[];
  entitlementKey: string | null;
  criticality: "unqualified" | "low" | "standard" | "high";
  dataCategories: string[];
  serviceDependencies: string[];
  docsRef: string | null;
  supportPathRef: string | null;
  supportLevel: "unqualified" | "no_compatibility_guarantee" | "preview" | "standard";
  releaseEvidenceRefs: string[];
  gaReadiness: {
    securityPrivacy: "unqualified" | "qualified" | "not_applicable";
    accessibility: "unqualified" | "qualified" | "not_applicable";
    operability: "unqualified" | "qualified" | "not_applicable";
    migrationPlan: "unqualified" | "qualified" | "not_applicable";
    criticalityEvidence: "unqualified" | "qualified" | "not_applicable";
  };
  deprecationAt: string | null;
  sunsetAt: string | null;
  replacementCapability: string | null;
  migrationGuideRef: string | null;
  lastReviewedAt: string | null;
}

// These V10 links are copied only where current Help frontmatter names the
// corresponding screens and source services; they do not count as GA evidence.
const VERIFIED_HELP_LINKAGE: Partial<Record<InstanceFeatureKey, Partial<CapabilityLifecycle>>> = {
  enablePipelines: {
    owner: "augustkring/august-works",
    maturity: "preview",
    customerSurfaces: ["WORKFLOW", "WORKFLOW-DESCRIBE", "WORKFLOW-REVIEW", "WORKFLOW-TEST", "WORKFLOW-PUBLISH", "WORKFLOW-RECOVER"],
    dataCategories: ["Workflow definitions", "Step inputs", "Run history"],
    serviceDependencies: ["server/src/services/workflows/workflow-node-registry.ts", "server/src/services/workflows/workflow-service.ts"],
    docsRef: "docs/help/workflows-preview.md",
  },
  enableAiWorkflowAuthoring: {
    owner: "augustkring/august-works",
    maturity: "preview",
    customerSurfaces: ["WORKFLOW", "WORKFLOW-DESCRIBE", "WORKFLOW-REVIEW", "WORKFLOW-TEST", "WORKFLOW-PUBLISH", "WORKFLOW-RECOVER"],
    dataCategories: ["Workflow definitions", "Step inputs", "Run history"],
    serviceDependencies: ["server/src/services/workflows/workflow-node-registry.ts", "server/src/services/workflows/workflow-service.ts"],
    docsRef: "docs/help/workflows-preview.md",
  },
  enableApps: {
    owner: "augustkring/august-works",
    customerSurfaces: ["APPS", "SETTINGS-APPS-DATA"],
    dataCategories: ["Provider account identity", "Granted permissions", "Connection credentials"],
    serviceDependencies: ["server/src/services/tool-access.ts", "server/src/services/paperclip-cloud-connector.ts"],
    docsRef: "docs/help/apps-and-connections.md",
  },
  company_deletion_v6: {
    customerSurfaces: ["SETTINGS-DATA-PRIVACY", "SETTINGS-PEOPLE-ACCESS"],
    dataCategories: ["Company export package", "Membership and account access", "Deletion and retention state"],
    serviceDependencies: [
      "server/src/services/saas/account-deletion.ts",
      "server/src/services/saas/offboarding.ts",
      "server/src/services/saas/company-purge.ts",
    ],
    docsRef: "docs/help/export-and-delete.md",
  },
};

function capabilityLifecycle(key: InstanceFeatureKey, title: string): CapabilityLifecycle {
  // These two keys are retained compatibility switches; their capabilities are
  // always enabled and stored values are ignored by instance-settings.
  const compatibilityKey = key === "enableApps" || key === "enableMcpAggregators";
  const maturity: CapabilityMaturity = compatibilityKey ? "deprecated" : "experimental";
  return {
    capabilityKey: key,
    customerName: title,
    owner: historicalAdmissionFlagOwner(key),
    maturity,
    firstSupportedVersion: null,
    customerSurfaces: [],
    experienceProfiles: [],
    entitlementKey: null,
    criticality: "unqualified",
    dataCategories: [],
    serviceDependencies: [],
    docsRef: null,
    supportPathRef: "/company/help",
    supportLevel: compatibilityKey ? "unqualified" : "no_compatibility_guarantee",
    releaseEvidenceRefs: [],
    gaReadiness: {
      securityPrivacy: "unqualified",
      accessibility: "unqualified",
      operability: "unqualified",
      migrationPlan: "unqualified",
      criticalityEvidence: "unqualified",
    },
    deprecationAt: null,
    sunsetAt: null,
    replacementCapability: null,
    migrationGuideRef: null,
    lastReviewedAt: null,
    ...VERIFIED_HELP_LINKAGE[key],
  };
}

function historicalAdmissionFlagOwner(key: InstanceFeatureKey): string | null {
  if (Object.hasOwn(V5_FEATURES, key)) return V5_ROLLOUT[key as V5FeatureKey].owner;
  if (Object.hasOwn(V6_FEATURES, key)) return V6_ROLLOUT[key as V6FeatureKey].owner;
  if (Object.hasOwn(V7_FEATURES, key)) return V7_ROLLOUT[key as V7FeatureKey].owner;
  if (Object.hasOwn(V8_FEATURES, key)) return V8_ROLLOUT[key as V8FeatureKey].owner;
  if (Object.hasOwn(V9_FEATURES, key)) return V9_ROLLOUT[key as V9FeatureKey].owner;
  return null;
}

export function isCapabilityAdvertisedForNewUse(key: InstanceFeatureKey): boolean {
  return isCapabilityMaturityAdvertisedForNewUse(INSTANCE_FEATURE_CATALOG[key].lifecycle.maturity);
}

export function isCapabilityMaturityAdvertisedForNewUse(maturity: CapabilityMaturity): boolean {
  return maturity !== "internal" && maturity !== "retired";
}

/** Apply lifecycle availability to the effective admission flags without changing stored settings. */
export function applyCapabilityLifecycleAvailability<T extends object>(
  flags: T,
  catalog: Partial<Record<InstanceFeatureKey, Pick<FeatureCatalogEntry, "lifecycle">>> = INSTANCE_FEATURE_CATALOG,
): T {
  const effective = { ...flags } as unknown as Record<string, unknown>;
  for (const [key, entry] of Object.entries(catalog) as Array<[
    InstanceFeatureKey,
    Pick<FeatureCatalogEntry, "lifecycle"> | undefined,
  ]>) {
    if (entry && !isCapabilityMaturityAdvertisedForNewUse(entry.lifecycle.maturity)) {
      effective[key] = false;
    }
  }
  return effective as T;
}

export function capabilityGaAdmissionIssues(lifecycle: CapabilityLifecycle): string[] {
  const issues: string[] = [];
  if (!lifecycle.owner) issues.push("owner");
  if (!lifecycle.docsRef) issues.push("docs/help");
  if (lifecycle.supportLevel === "unqualified" || lifecycle.supportLevel === "no_compatibility_guarantee") {
    issues.push("support path");
  }
  if (lifecycle.releaseEvidenceRefs.length === 0) issues.push("release evidence");
  if (!lifecycle.lastReviewedAt) issues.push("review date");
  for (const [gate, status] of Object.entries(lifecycle.gaReadiness)) {
    if (status === "unqualified") issues.push(gate);
  }
  return issues;
}

export function capabilityLifecyclePolicyIssues(lifecycle: CapabilityLifecycle): string[] {
  const issues = capabilityLifecycleDateIssues(lifecycle);
  if (lifecycle.maturity === "ga") issues.unshift(...capabilityGaAdmissionIssues(lifecycle));
  return issues;
}

export function capabilityEnablementIssues(
  patch: Record<string, unknown>,
  catalog: Partial<Record<InstanceFeatureKey, Pick<FeatureCatalogEntry, "lifecycle">>> = INSTANCE_FEATURE_CATALOG,
): Array<{ capabilityKey: string; maturity: CapabilityMaturity }> {
  return Object.entries(patch).flatMap(([key, value]) => {
    const lifecycle = catalog[key as InstanceFeatureKey]?.lifecycle;
    return value === true && lifecycle && !isCapabilityMaturityAdvertisedForNewUse(lifecycle.maturity)
      ? [{ capabilityKey: key, maturity: lifecycle.maturity }]
      : [];
  });
}

const v5Catalog = Object.fromEntries(Object.entries(V5_FEATURES).map(([key, [title, description]]) => [key, { title, description, tier: "managed", cloudDefault: false, selfHostedDefault: false }])) as Record<V5FeatureKey, FeatureCatalogBase>;

const v6Catalog = Object.fromEntries(Object.entries(V6_FEATURES).map(([key, [title, description]]) => [key, { title, description, tier: "managed", cloudDefault: false, selfHostedDefault: false }])) as Record<V6FeatureKey, FeatureCatalogBase>;

const INSTANCE_FEATURE_CATALOG_BASE: Record<InstanceFeatureKey, FeatureCatalogBase> = {
  ...Object.fromEntries(Object.entries(V9_FEATURES).map(([key, [title, description]]) => [key, {
    title, description, tier: "managed", cloudDefault: false, selfHostedDefault: false,
  }])) as Record<V9FeatureKey, FeatureCatalogBase>,
  ...Object.fromEntries(Object.entries(V8_FEATURES).map(([key, [title, description]]) => [key, {
    title, description, tier: "managed", cloudDefault: false, selfHostedDefault: false,
  }])) as Record<V8FeatureKey, FeatureCatalogBase>,
  ...Object.fromEntries(Object.entries(V7_FEATURES).map(([key, [title, description]]) => [key, {
    title, description, tier: "managed", cloudDefault: false, selfHostedDefault: false,
  }])) as Record<V7FeatureKey, FeatureCatalogBase>,
  ...v5Catalog,
  ...v6Catalog,
  enableEnvironments: {
    title: "Environments",
    description:
      "Show environment management in company settings and allow project and agent environment assignment controls.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableNativeRunner: {
    title: "Blentera Runner",
    description:
      "Allow explicitly configured local Codex, OpenCode, and qualified ACPX agents to use the experimental Rust Blentera Runner, including authenticated sandbox ingress when required. Onboarding remains on legacy adapters.",
    tier: "managed",
    cloudDefault: false,
    // On by default for self-hosted instances. Requires a Rust toolchain (or
    // PAPERCLIP_RUNNER_BINARY) for `pnpm dev`, which builds runnerd whenever
    // this is on.
    selfHostedDefault: true,
  },
  enableManagedSandboxOnly: {
    title: "Managed Environment Only",
    description:
      "Hide the local environment and run all agents in the platform-managed environment.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableIsolatedWorkspaces: {
    title: "Isolated Workspaces",
    description:
      "Show execution workspace controls in project configuration and allow isolated workspace behavior for task runs.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableIsolatedWorkspacesByDefault: {
    title: "Isolated Workspaces By Default",
    description:
      "Treat a project that has no execution workspace policy of its own as if it selected isolated workspaces, so its tasks get a per-task worktree instead of sharing the project checkout. Requires Isolated Workspaces. A project that carries its own policy keeps it.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableStreamlinedLeftNavigation: {
    title: "Streamlined Left Navigation",
    description: "Use the streamlined main sidebar navigation layout.",
    tier: "preference",
    cloudDefault: true,
    selfHostedDefault: true,
  },
  enableStreamlinedUi: {
    title: "Streamlined UI",
    description:
      "Use the streamlined application shell, shared task collections, focused task detail layout, contextual navigation, and simplified main sidebar.",
    tier: "preference",
    cloudDefault: true,
    selfHostedDefault: true,
  },
  enableApps: {
    title: "Apps (compatibility)",
    description:
      "Deprecated compatibility key. Apps is always enabled; stored and managed values are ignored.",
    tier: "managed",
    cloudDefault: true,
    selfHostedDefault: true,
  },
  enableChatConnectors: {
    title: "Chat connectors",
    description:
      "Show experimental chat connector setup and Board surfaces. Existing connections keep running when hidden; GitHub and other tool connectors are unaffected.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableMemoryConnectors: {
    title: "Memory connectors",
    description: "Show experimental Mem0, Zep, Supermemory, Cognee, and Honcho setup. Existing connections keep running when hidden.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableMcpAggregators: {
    title: "MCP aggregators (compatibility)",
    description: "Deprecated compatibility key. MCP aggregators are always enabled; stored and managed values are ignored.",
    tier: "managed",
    cloudDefault: true,
    selfHostedDefault: true,
  },
  enablePipelines: {
    title: "Pipelines",
    description: "Enable pipeline definitions and pipeline-driven case production surfaces.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableCases: {
    title: "Cases",
    description:
      "Durable work products that tasks create and iterate on. Adds the Cases tab and the agent case API.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableAgentChat: {
    title: "Agent Chat",
    description: "Persistent task-backed conversations that clarify goals and hand work off to tasks.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableConferenceRoomChat: {
    title: "Conference Room Chat",
    description:
      "Add the Conference Room team chat, the live activity feed, and the redesigned onboarding; restyles task threads as chat bubbles.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableClassicTaskInterface: {
    title: "Classic Task Interface",
    description:
      "Restore the pre-chat task detail page: the page-level header with inline description editor, the plain comment thread, and the fixed Properties sidebar. Chat-only features (streaming activity folding, inline plan/question cards, the three-mode composer) are unavailable in the classic view.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableIssuePlanDecompositions: {
    title: "Task Plan Decomposition",
    description: "Show accepted-plan decomposition history on task detail pages.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableExperimentalFileViewer: {
    title: "Experimental File Viewer",
    description:
      "Show task detail controls for browsing and previewing workspace files relative to a task.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableStatusCards: {
    title: "Status Cards",
    description:
      "Enable the experimental shared status-card board, update engine, and gated API.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableExternalObjects: {
    title: "External Objects",
    description:
      "Detect external URLs in issues and show resolved status for pull requests, tickets, and other referenced work objects.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableSmokeLab: {
    title: "Smoke Lab",
    description:
      "Add the Smoke Lab tab and dashboard card for exercising integration paths against deterministic local fixtures. Private deployments only.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableBuiltInAgents: {
    title: "Built-in Agents",
    description:
      "Show Paperclip-managed built-in agent surfaces, including roster badges, the Built-in agents tab, and setup controls.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableBetaSkills: {
    title: "Beta skills",
    description: "Allow agents to pin beta releases of the Paperclip core skill.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableSummaries: {
    title: "Summaries",
    description:
      "Show Summarizer-generated status slots on project and workspace pages, with on-demand refresh and revision history.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableDecisions: {
    title: "Decisions",
    description:
      "Show the Decisions item in the main sidebar — the attention home that surfaces tasks awaiting input.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableGoalsSidebarLink: {
    title: "Goals Sidebar Link",
    description: "Restore the Goals item in the main sidebar while the goals surface is being evaluated.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableSimplifiedEnglishInteractions: {
    title: "Simplified English Interactions",
    description:
      "Instruct agents to write user interactions (confirmations, questions, suggested tasks) in ASD-STE100 Simplified Technical English with brief decision context.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableServerInfoDebugView: {
    title: "Server Info Debug View",
    description:
      "Show a Server section in the account drawer with the current server restart time and running commit.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enablePaperclipDeveloperMode: {
    title: "Paperclip Developer Mode",
    description:
      "Show internal Paperclip maintainer tools and observability links, including Honeycomb trace queries on run pages.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  autoRestartDevServerWhenIdle: {
    title: "Auto-Restart Dev Server When Idle",
    description:
      "In local development, wait for queued and running agent runs to finish, then restart the server automatically when backend changes make the current boot stale.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkspaceBranchReconcileForward: {
    title: "Workspace Branch Reconcile Forward",
    description:
      "Let execution workspaces reconcile a diverged recorded branch forward instead of failing branch containment.",
    tier: "managed",
    cloudDefault: true,
    selfHostedDefault: true,
  },
  enableWorkspaceDirtyQuarantineRepair: {
    title: "Workspace Dirty Quarantine Repair",
    description:
      "Let workspace runtime recovery quarantine and repair dirty execution workspaces before runs.",
    tier: "managed",
    cloudDefault: true,
    selfHostedDefault: true,
  },
  enableOwnerInstanceAdmin: {
    title: "Owner Instance Admin",
    description:
      "On cloud-managed instances, grant the stack owner instance-admin access to their own dedicated instance. Elevation is computed at the trusted-header auth boundary; no instance admin role rows are created. Inert on self-hosted instances.",
    tier: "managed",
    cloudDefault: true,
    selfHostedDefault: false,
  },
  enableSandboxDuplexBridge: {
    title: "Sandbox Duplex Bridge",
    description:
      "Let a run open the sandbox duplex command-stream bridge when the provider grants the capability. The host reads this per run before it selects the transport. Off keeps the file bridge for every run.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableRunnerPreviewIngress: {
    title: "Runner Preview Ingress (Deprecated)",
    description:
      "Compatibility-only key retained for older managed configs. Runner ingress follows the Paperclip Runner setting.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorktreeRunExecution: {
    title: "Worktree Run Execution",
    description:
      "Let the scheduler execute runs inside an isolated git-worktree preview instance for tasks created after activation.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableFoundationV1: {
    title: "August Works Foundation V1",
    description: "Enable the additive Company Foundation implementation and customer-facing Foundation surfaces.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableContextEngineV1: {
    title: "August Works Context Engine V1",
    description: "Enable governed context assembly, normalized evidence, authority resolution, budgets, and Context Manifests.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowsV1: {
    title: "August Works Workflows V1",
    description: "Enable versioned workflow persistence and backend workflow APIs without replacing existing Tasks, Routines, or Pipelines.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowBuilderV1: {
    title: "August Works Workflow Builder V1",
    description: "Enable the August Works visual workflow builder surfaces for explicitly allowed instances.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowAgentNodes: {
    title: "Workflow Agent Nodes",
    description: "Allow published workflows to use governed August Works agent execution nodes.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowExternalAgentNodes: {
    title: "Workflow External Agent Nodes",
    description: "Allow published workflows to use scoped OpenClaw or other external-agent nodes.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableCollectiveMemoryV1: {
    title: "Collective Memory V1",
    description: "Enable governed shared organizational memory records, evidence, review, correction, and revocation.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enablePrivateAgentMemoryV1: {
    title: "Private Agent Memory V1",
    description: "Enable persistent agent-private memory and explicit promotion into governed shared memory.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableMemoryPostRunExtractionV1: {
    title: "Memory Post-Run Extraction V1",
    description: "Allow successful agent runs to submit governed shared Memory candidates from the same semantic completion turn. Candidates remain pending review and never bypass Memory policy.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableAutomationArtifactsV1: {
    title: "Automation Artifacts V1",
    description: "Enable validated, versioned deterministic automation artifacts in the governed execution plane.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableAutomationArtifactCodeExecutionV1: {
    title: "Automation Artifact Code Execution V1",
    description: "Allow qualified generated TypeScript artifacts to execute only inside the governed sandbox after hash-bound validation and security gates pass.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowOptimizerSuggestions: {
    title: "Workflow Optimizer Suggestions",
    description: "Enable observation and suggestion-only optimizer capabilities without production replacement.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowOptimizerShadow: {
    title: "Workflow Optimizer Shadow",
    description: "Enable safe shadow evaluation for optimizer candidates with live side effects suppressed.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableWorkflowOptimizerPromotion: {
    title: "Workflow Optimizer Promotion",
    description: "Enable governed optimizer promotion and canary paths only after replay, shadow, fallback, and risk gates exist.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableAiWorkflowAuthoring: {
    title: "AI Workflow Authoring",
    description: "Allow AI to author and edit typed workflow drafts without bypassing validation, testing, approval, or publishing policy.",
    tier: "managed",
    cloudDefault: false,
    selfHostedDefault: false,
  },
  enableFirstTaskPlanProposal: {
    title: "First task: propose with a plan document",
    description:
      "When the user's first request is a single task, the chief of staff writes a short plan document and a checkbox card instead of a one-card confirmation. Applies to organizations created after the toggle is flipped.",
    tier: "preference",
    cloudDefault: false,
    selfHostedDefault: false,
  },
};

export const INSTANCE_FEATURE_CATALOG: Record<InstanceFeatureKey, FeatureCatalogEntry> = Object.fromEntries(
  Object.entries(INSTANCE_FEATURE_CATALOG_BASE).map(([key, entry]) => [
    key, { ...entry, lifecycle: capabilityLifecycle(key as InstanceFeatureKey, entry.title) },
  ]),
) as Record<InstanceFeatureKey, FeatureCatalogEntry>;

export const INSTANCE_FEATURE_KEYS = Object.keys(INSTANCE_FEATURE_CATALOG).sort() as InstanceFeatureKey[];

/**
 * Shape of the existing tier-only `feature-catalog.json` release contract
 * consumed by the cloud harness. Lifecycle metadata is available in explicit
 * schema v2 until that external consumer is qualified.
 */
const featureCatalogArtifactV1Schema = z.object({
  catalogVersion: z.string().min(1),
  features: z.record(z.string().min(1), z.object({ tier: z.enum(FEATURE_TIERS) }).strict()),
}).strict();

const featureCatalogArtifactV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    catalogVersion: z.string().min(1),
    features: z.record(
      z.string().min(1),
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        tier: z.enum(FEATURE_TIERS),
        lifecycle: z.object({
          capabilityKey: z.string().min(1),
          customerName: z.string().min(1),
          owner: z.string().min(1).nullable(),
          maturity: z.enum(CAPABILITY_MATURITIES),
          firstSupportedVersion: z.string().min(1).nullable(),
          customerSurfaces: z.array(z.string().min(1)),
          experienceProfiles: z.array(z.string().min(1)),
          entitlementKey: z.string().min(1).nullable(),
          criticality: z.enum(["unqualified", "low", "standard", "high"]),
          dataCategories: z.array(z.string().min(1)),
          serviceDependencies: z.array(z.string().min(1)),
          docsRef: z.string().min(1).nullable(),
          supportPathRef: z.string().min(1).nullable(),
          supportLevel: z.enum(["unqualified", "no_compatibility_guarantee", "preview", "standard"]),
          releaseEvidenceRefs: z.array(z.string().min(1)),
          gaReadiness: z.object({
            securityPrivacy: z.enum(["unqualified", "qualified", "not_applicable"]),
            accessibility: z.enum(["unqualified", "qualified", "not_applicable"]),
            operability: z.enum(["unqualified", "qualified", "not_applicable"]),
            migrationPlan: z.enum(["unqualified", "qualified", "not_applicable"]),
            criticalityEvidence: z.enum(["unqualified", "qualified", "not_applicable"]),
          }).strict(),
          deprecationAt: z.string().min(1).nullable(),
          sunsetAt: z.string().min(1).nullable(),
          replacementCapability: z.string().min(1).nullable(),
          migrationGuideRef: z.string().min(1).nullable(),
          lastReviewedAt: z.string().min(1).nullable(),
        }).strict(),
      }).strict(),
    ),
  })
  .strict();

/** Accepts existing v1 artifacts and explicit lifecycle-rich v2 artifacts. */
export const featureCatalogArtifactSchema = z.union([
  featureCatalogArtifactV1Schema,
  featureCatalogArtifactV2Schema,
]);

export type FeatureCatalogArtifact = z.infer<typeof featureCatalogArtifactV1Schema>;
export type FeatureCatalogArtifactV2 = z.infer<typeof featureCatalogArtifactV2Schema>;
export type FeatureCatalogArtifactInput = z.infer<typeof featureCatalogArtifactSchema>;

/** Preserve the existing tier-only artifact contract. */
export function buildFeatureCatalogArtifact(catalogVersion: string): FeatureCatalogArtifact {
  if (catalogVersion.trim().length === 0) {
    throw new Error("catalogVersion must be a non-empty string");
  }
  const features: FeatureCatalogArtifact["features"] = {};
  for (const key of INSTANCE_FEATURE_KEYS) {
    features[key] = { tier: INSTANCE_FEATURE_CATALOG[key].tier };
  }
  return { catalogVersion, features };
}

/** Build the lifecycle-rich artifact explicitly; do not switch release builds until consumers qualify v2. */
export function buildFeatureCatalogArtifactV2(catalogVersion: string): FeatureCatalogArtifactV2 {
  if (catalogVersion.trim().length === 0) {
    throw new Error("catalogVersion must be a non-empty string");
  }
  const features: FeatureCatalogArtifactV2["features"] = {};
  for (const key of INSTANCE_FEATURE_KEYS) {
    const entry = INSTANCE_FEATURE_CATALOG[key];
    const policyIssues = capabilityLifecyclePolicyIssues(entry.lifecycle);
    if (policyIssues.length > 0) {
      throw new Error(`Invalid lifecycle metadata for ${key}: ${policyIssues.join(", ")}`);
    }
    features[key] = {
      title: entry.title,
      description: entry.description,
      tier: entry.tier,
      lifecycle: entry.lifecycle,
    };
  }
  return { schemaVersion: 2, catalogVersion, features };
}

function capabilityLifecycleDateIssues(lifecycle: CapabilityLifecycle): string[] {
  const issues: string[] = [];
  if ((lifecycle.deprecationAt || lifecycle.sunsetAt) && !lifecycle.replacementCapability) {
    issues.push("replacement capability");
  }
  if ((lifecycle.deprecationAt || lifecycle.sunsetAt) && !lifecycle.migrationGuideRef) {
    issues.push("migration guide");
  }
  if (lifecycle.sunsetAt && !lifecycle.deprecationAt) issues.push("deprecation date before sunset");
  return issues;
}

/** Deterministic serialization (sorted keys, trailing newline) for the artifact file. */
export function renderFeatureCatalogArtifact(catalogVersion: string, schemaVersion: 1 | 2 = 1): string {
  const artifact = schemaVersion === 2
    ? buildFeatureCatalogArtifactV2(catalogVersion)
    : buildFeatureCatalogArtifact(catalogVersion);
  return `${JSON.stringify(artifact, null, 2)}\n`;
}
