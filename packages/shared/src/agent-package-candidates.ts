import { rolePackItemSchema, RUNTIME_POLICY_KEYS } from "./role-packs.js";
import {
  packageReleaseSchema,
  type PackageRelease,
  type PackageComponent,
} from "./agent-packages.js";
import { SPECIALIST_CANDIDATES, specialistReleaseCandidate } from "./specialist-packages.js";
/** Shipped internal protocol fixture; publishing still needs real operator evidence.
 * No business specialist or physical-isolation qualification is implied. */
export const INTERNAL_SOURCE_REVIEW_ROLE_ITEMS = RUNTIME_POLICY_KEYS.map(
  (ref) =>
    rolePackItemSchema.parse({
      type: "required_policy",
      ref,
      loadPoint: "always",
    }),
);
export const INTERNAL_SOURCE_REVIEW_MANIFEST = {
  purpose: "Prepare an internal source-bound draft for human review",
  prohibitedUses: [
    "External communication",
    "Administrative changes",
    "Decisions or recommendations about people",
    "Self-certification of completed work",
  ],
  role: "general",
  audience: "internal_test",
  maximumRisk: "C1",
  actionClasses: ["internal_draft"],
  requiredKnowledge: [],
  requiredConnections: [],
  optionalConnections: [],
  memoryPolicy: "source_governed",
  humanApproval: "before_material_action",
  supervision: "bounded_native",
  verification: "independent_native",
  sandboxAssurance: "byo_customer_responsibility",
  runtimeProviders: ["paperclip_native"],
  onboardingQuestions: [
    "Which existing Task and approved sources should the draft use?",
  ],
  knownLimitations: [
    "Internal protocol evaluation only; customer outcomes, model portability, cost and physical sandbox enforcement are not qualified.",
  ],
  license: "MIT",
  commercialProductKey: null,
} as const;
export function internalSourceReviewRelease(input: {
  sourceRevision: string;
  roleComponent: PackageComponent;
  releaseEvidence: PackageRelease["releaseEvidence"];
}): PackageRelease {
  return packageReleaseSchema.parse({
    packageKey: "aw-internal-source-review",
    name: "Internal source review",
    description:
      "Read-only protocol evaluation using governed native sources and human review",
    category: "internal_evaluation",
    version: "1.0.0",
    releaseNotes: "Initial internal evaluation distribution",
    manifest: {
      ...INTERNAL_SOURCE_REVIEW_MANIFEST,
      sourceRevision: input.sourceRevision,
    },
    components: [input.roleComponent],
    releaseEvidence: input.releaseEvidence,
  });
}

/** Versioned software candidate for the V10 no-technical-setup starter. This
 * profile is not a published or qualified capability: the exact model route,
 * tariff, deployment source policy and independent evidence remain owned by
 * the release process. */
export const BLENTERA_MANAGED_STARTER_PROFILE = {
  profileKey: "v10-managed-customer-starter",
  version: "1.0.0",
  packageKey: "blentera-meeting-notes-starter",
  commercialProductKey: SPECIALIST_CANDIDATES["blentera-meeting-notes-starter"].manifest.commercialProductKey,
  intent: "Turn meeting notes into a clear internal follow-up draft for review",
  sourceScope: {
    inputs: ["human_supplied_meeting_notes"],
    additionalSources: "only_currently_authorized_sources_explicitly_selected_by_the_human",
    maximumCharacters: null,
    testedInputLimitsRequiredBeforeRelease: true,
    activationIntentCharacters: 4000,
    retainedMemory: false,
  },
  defaults: {
    packageKey: "blentera-meeting-notes-starter",
    enabledConnections: [],
    externalActions: false,
    automaticScheduling: false,
  },
  onboardingQuestions: [
    "Which meeting notes should become an internal follow-up draft?",
    "Which people or dates should remain explicit placeholders for your review?",
  ],
  result: ["summary", "suggested_next_steps", "follow_up_draft"],
  authority: {
    maximumRisk: "C1",
    actionClasses: ["internal_draft"],
    externalCommunication: false,
    toolsGranted: false,
    humanReviewBeforeMaterialAction: true,
    independentReviewRequiredForVerifiedFirstValue: true,
  },
  evaluation: {
    suiteComponentKey: "starter-evaluations",
    suiteVersion: "1.0.0",
    judgments: [
      "source_fidelity: every factual statement is supported by the supplied meeting notes or marked as uncertain",
      "commitment_status: distinguish proposed follow-ups from commitments the participants explicitly agreed",
      "owner_and_deadline: do not invent an owner or deadline; leave unknown fields explicit for Human review",
    ],
  },
  execution: {
    runtime: "paperclip_native",
    exactCurrentWorkerModelQualificationRequired: true,
    mutableLatestModelAliasesAllowed: false,
    currency: "USD",
    currentV9ActivationOwnerMaximumModelCostMinor: 0,
    note: "Current activation-owner constraint, not a claim that model service is free",
  },
  releaseGates: [
    "exact model, data route, token/output bounds and tariff are current and operator-qualified",
    "the exact starter component and source revisions are pinned",
    "customer-demand, evaluation, protected-holdout, scan and SBOM evidence are current",
    "representative customer review accepts usefulness, source handling and recovery",
  ],
} as const;

/** Builds the existing V7 package-release artifact from a reviewed Role Pack
 * and caller-owned evidence. Missing evidence is never manufactured here. */
export function managedCustomerStarterReleaseCandidate(input: {
  sourceRevision: string;
  components: PackageComponent[];
  releaseEvidence: PackageRelease["releaseEvidence"];
}): PackageRelease {
  const candidate = specialistReleaseCandidate(BLENTERA_MANAGED_STARTER_PROFILE.packageKey, {
    sourceRevision: input.sourceRevision,
    version: BLENTERA_MANAGED_STARTER_PROFILE.version,
    components: input.components,
    releaseEvidence: input.releaseEvidence,
  });
  return packageReleaseSchema.parse({
    ...candidate,
    name: "Meeting follow-up drafts",
    description: "AI software that prepares an internal follow-up draft from Human-supplied meeting notes for review.",
    manifest: {
      ...candidate.manifest,
      purpose: BLENTERA_MANAGED_STARTER_PROFILE.intent,
      onboardingQuestions: [...BLENTERA_MANAGED_STARTER_PROFILE.onboardingQuestions],
      memoryPolicy: "no_persistent_memory",
    },
  });
}
