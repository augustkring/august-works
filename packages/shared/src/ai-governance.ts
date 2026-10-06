import { z } from "zod";
export const AI_USE_CASE_STATES = [
  "draft",
  "assessing",
  "approved",
  "restricted",
  "suspended",
  "retired",
] as const;
export const GOVERNANCE_FRAMEWORKS = [
  "eu_ai_act",
  "gdpr",
  "company_policy",
  "sector_overlay",
] as const;
export const PEOPLE_DOMAINS = [
  "none",
  "employment",
  "worker_monitoring",
  "hiring",
  "person_decision",
  "emotion_inference",
  "social_scoring",
  "sensitive_trait_inference",
] as const;
const prose = z.string().trim().min(10).max(4000),
  labels = z.array(z.string().trim().min(1).max(200)).max(32);
const risk = z.enum(["C0", "C1", "C2", "C3", "C4"]);
const sourceUrl = z
  .url()
  .max(1000)
  .refine((value) => {
    // Zod can run refinements after its URL check has already failed.
    // An unfinished form must return validation issues, never throw here.
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password &&
        !url.search && !url.hash;
    } catch {
      return false;
    }
  }, "Use a public HTTPS reference without credentials or query parameters");
export const useCasePurposeSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    description: prose,
    intendedPurpose: prose,
    prohibitedUses: labels.min(1),
    affectedPersonCategories: labels,
    dataCategories: labels,
    specialCategoryDataExpected: z.boolean(),
    peopleDomain: z.enum(PEOPLE_DOMAINS),
    customerFacing: z.boolean(),
    externalCommunication: z.boolean(),
    makesRecommendationsAboutPeople: z.boolean(),
    makesDecisionsAboutPeople: z.boolean(),
    materialLegalOrSimilarEffect: z.boolean(),
    foreseeableMisuse: labels.min(1),
    providerInstructionsRefs: z.array(sourceUrl).max(16),
    providerRoleFacts: z
      .object({
        madeAvailableBy: z.string().trim().min(2).max(200),
        trademarkOwner: z.string().trim().min(2).max(200),
        purposeDefinedBy: z.string().trim().min(2).max(200),
        integratedBy: z.string().trim().min(2).max(200),
        rebranded: z.boolean(),
        substantiallyModified: z.boolean(),
        contractualCooperationRefs: z.array(sourceUrl).max(16),
      })
      .strict(),
    criticality: z.enum(["low", "medium", "high", "critical"]),
    riskClass: risk,
    oversightProfileId: z.string().uuid(),
    retentionPurpose: z.string().trim().min(5).max(300),
    retentionDays: z.number().int().min(1).max(3650),
    nextReviewAt: z.iso.datetime(),
  })
  .strict();
export const createUseCaseSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
    purpose: useCasePurposeSchema,
  })
  .strict();
export const updateUseCaseSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    purpose: useCasePurposeSchema,
    changeReason: prose,
  })
  .strict();
export const oversightProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    riskClass: risk,
    mode: z.enum([
      "monitor_only",
      "review_before_material_action",
      "review_selected_outputs",
      "continuous_supervision",
      "mandatory_human_decision",
    ]),
    requiredReviewActions: labels.min(1),
    escalationRoles: z
      .array(z.enum(["owner", "admin"]))
      .min(1)
      .max(2),
    responseDeadlineSeconds: z.number().int().min(60).max(604800),
    overrideAllowed: z.boolean(),
    stopAuthority: z
      .array(z.enum(["owner", "admin"]))
      .min(1)
      .max(2),
  })
  .strict();
export const useCaseAssessmentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    framework: z.enum(GOVERNANCE_FRAMEWORKS),
    frameworkVersionOrDate: z.string().trim().min(5).max(200),
    classification: z.enum([
      "not_applicable",
      "limited_risk",
      "high_risk",
      "prohibited",
      "uncertain",
      "reviewed",
    ]),
    applicableRequirements: labels,
    facts: prose,
    evidenceRefs: z.array(sourceUrl).min(1).max(32),
    assessmentMethod: prose,
    reviewRequired: z.boolean(),
    reviewerAttestation: prose,
    friaApplicability: z.enum(["yes", "no", "uncertain", "review_required"]),
    friaApplicabilityReason: prose,
  })
  .strict();
export const useCaseDecisionSchema = z
  .object({ expectedVersion: z.number().int().positive(), rationale: prose })
  .strict();
export const useCaseDeploymentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    issueId: z.string().uuid(),
    agentId: z.string().uuid(),
  })
  .strict();
export const governanceObligationSchema = z
  .object({
    framework: z.enum(GOVERNANCE_FRAMEWORKS),
    authority: z.string().trim().min(2).max(300),
    citation: z.string().trim().min(2).max(500),
    jurisdictionOrScope: prose,
    applicabilityFacts: prose,
    applicabilityState: z.enum([
      "applicable",
      "not_applicable",
      "uncertain",
      "review_required",
    ]),
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime().nullable(),
    requiredControl: prose,
    evidenceRequired: labels.min(1),
    controlRefs: labels.min(1),
    nextReviewAt: z.iso.datetime(),
    reviewTrigger: prose,
    sourceVersionOrDate: z.string().trim().min(5).max(200),
    sourceUrl,
    // Optional for existing legal records. Analytical admission requires this
    // explicit human-approved purpose; a legal citation alone grants no use.
    analyticalPurpose: z.object({
      status: z.enum(["approved", "suspended"]),
      purpose: z.enum(["management_intelligence", "process_intelligence"]),
      capabilities: z.array(z.enum(["metrics", "strategy", "process", "forecast", "scenario", "experiment", "causal", "planning", "reviews"])).min(1).max(9),
      populationUnits: z.literal("business_objects"),
      peopleImpact: z.literal("none"),
      decisionBoundary: z.literal("advisory_only"),
      maxRetentionDays: z.number().int().min(1).max(3650),
      permittedSensitivity: z.array(z.enum(["internal", "confidential"])).min(1).max(2),
      prohibitedUses: labels.min(1),
      approvalRationale: prose,
    }).strict().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.effectiveUntil ||
      new Date(value.effectiveUntil) > new Date(value.effectiveFrom),
    "End of applicability must follow its effective date",
  );
export type UseCasePurpose = z.infer<typeof useCasePurposeSchema>;
export type OversightProfile = z.infer<typeof oversightProfileSchema>;
export type UseCaseAssessment = z.infer<typeof useCaseAssessmentSchema>;
export type GovernanceObligation = z.infer<typeof governanceObligationSchema>;
export interface AIUseCaseView {
  id: string;
  companyId: string;
  key: string;
  ownerUserId: string;
  version: number;
  purposeVersion: number;
  status: (typeof AI_USE_CASE_STATES)[number];
  purpose: UseCasePurpose;
  purposeHash: string;
  createdAt: string;
  updatedAt: string;
}
export interface GovernanceChange {
  classification:
    | "no_material_governance_change"
    | "review_required"
    | "operator_role_reassessment_required"
    | "regulatory_reclassification_required";
  changedFields: string[];
}
export interface GovernanceProfileView {
  id: string;
  companyId: string;
  profile: OversightProfile;
  profileHash: string;
  status: "active" | "revoked";
}
export interface GovernanceDetail {
  useCase: AIUseCaseView;
  assessments: Array<{
    id: string;
    purposeVersion: number;
    assessment: UseCaseAssessment;
    assessmentHash: string;
    assessedByUserId: string;
    createdAt: string;
  }>;
  history: Array<{
    purposeVersion: number;
    purpose: UseCasePurpose;
    purposeHash: string;
    changeClassification: string;
    changeReason: string;
    createdAt: string;
  }>;
  changes: Array<{
    id: string;
    classification: string;
    reasonCode: string;
    createdAt: string;
  }>;
  deployments: Array<{
    id: string;
    companyId: string;
    issueId: string;
    agentId: string;
    purposeVersion: number;
    status: "active" | "review_required" | "suspended" | "retired";
  }>;
  stopRequests: Array<{
    id: string;
    runId: string;
    status: "queued" | "delivering" | "delivered";
    attempts: number;
    errorCode: string | null;
  }>;
}
export interface GovernanceEvidencePack {
  schemaVersion: 1;
  companyId: string;
  generatedAt: string;
  packHash: string;
  coverage: "bounded_authorized_projection";
  detail: GovernanceDetail;
  oversight: GovernanceProfileView;
  inventory: Array<{
    deploymentId: string;
    issueId: string;
    agentId: string;
    adapterType: string;
    providerType: string | null;
    providerStatus: string | null;
    runtimeProfileRef: string | null;
    configurationHash: string | null;
    modelProvider: string | null;
    modelId: string | null;
    imageDigest: string | null;
    sandboxBackend: string | null;
    sandboxProfile: string | null;
    sandboxStatus: string | null;
    boundaryPolicyHash: string | null;
    currentAuthority: boolean;
    packages: Array<{ installationId: string; versionId: string; releaseHash: string; status: string; currentAuthority: boolean; releaseEvidence: import("./agent-packages.js").PackageRelease["releaseEvidence"] }>;
  }>;
  readiness: Array<{
    id: string;
    issueId: string;
    agentId: string;
    actionClass: string;
    status: string;
    assessedAt: string;
    expiresAt: string;
  }>;
  obligations: GovernanceObligationView[];
  auditRefs: Array<{ id: string; action: string; createdAt: string }>;
  limitations: string[];
}

export interface GovernanceObligationView {
  id: string;
  companyId: string;
  obligation: GovernanceObligation;
  obligationHash: string;
  ownerUserId: string;
  lastReviewedAt: string;
  nextReviewAt: string;
}
