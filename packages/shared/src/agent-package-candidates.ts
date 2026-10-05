import { rolePackItemSchema, RUNTIME_POLICY_KEYS } from "./role-packs.js";
import {
  packageReleaseSchema,
  type PackageRelease,
  type PackageComponent,
} from "./agent-packages.js";
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
