import { z } from "zod";
import { READINESS_ACTIONS } from "./readiness.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/);
/** Fixed protocol key; product display name remains Blentera Support. */
export const FIRST_PARTY_SUPPORT_PACKAGE_KEY = "paperclip-support" as const;
const evidence = z
  .object({
    uri: z
      .string()
      .url()
      .refine((value) => {
        try {
          const u = new URL(value);
          return u.protocol === "https:" && !u.username && !u.password &&
            !u.search && !u.hash;
        } catch {
          return false;
        }
      }),
    sha256: hash,
  })
  .strict();
export const packageComponentSchema = z
  .object({
    key,
    type: z.enum([
      "role_pack",
      "skill",
      "playbook",
      "workflow_template",
      "routine_template",
      "eval_suite",
      "sandbox_policy_template",
      "use_case_template",
      "onboarding_template",
    ]),
    sourceVersion: z.string().min(1).max(120),
    contentHash: hash,
    source: evidence,
    required: z.boolean(),
  })
  .strict();
export const packageReleaseSchema = z
  .object({
    packageKey: key,
    name: z.string().trim().min(1).max(200),
    description: z.string().min(1).max(4000),
    category: z.string().max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    releaseNotes: z.string().max(4000),
    manifest: z
      .object({
        purpose: z.string().min(1).max(2000),
        prohibitedUses: z.array(z.string().min(1).max(300)).min(1).max(30),
        role: z.string().min(1).max(120),
        audience: z.enum(["internal_test", "customer", "first_party_support"]),
        maximumRisk: z.enum(["C1", "C2", "C3"]),
        actionClasses: z.array(z.enum(READINESS_ACTIONS)).min(1).max(6),
        requiredKnowledge: z.array(z.string().min(1).max(120)).max(30),
        requiredConnections: z.array(z.string().min(1).max(120)).max(20),
        optionalConnections: z.array(z.string().min(1).max(120)).max(20),
        memoryPolicy: z.enum(["source_governed", "no_persistent_memory"]),
        humanApproval: z.literal("before_material_action"),
        supervision: z.literal("bounded_native"),
        verification: z.literal("independent_native"),
        sandboxAssurance: z.enum([
          "byo_customer_responsibility",
          "qualified_managed",
          "read_only_no_code_execution",
        ]),
        runtimeProviders: z
          .array(z.enum(["paperclip_native", "hermes", "openclaw"]))
          .min(1)
          .max(3),
        onboardingQuestions: z.array(z.string().min(1).max(300)).max(15),
        knownLimitations: z.array(z.string().min(1).max(1000)).min(1).max(30),
        sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
        license: z.string().min(1).max(120),
        commercialProductKey: z
          .enum([
            "agent_package_chief_of_staff",
            "agent_package_growth",
            "agent_package_research",
          ])
          .nullable(),
      })
      .strict(),
    components: z.array(packageComponentSchema).min(1).max(64),
    releaseEvidence: z
      .object({
        sbom: evidence.nullable(),
        provenance: evidence,
        signature: evidence.nullable(),
        scan: evidence.nullable(),
        evaluations: evidence.nullable(),
        protectedHoldout: evidence.nullable(),
        customerDemand: evidence.nullable().optional(),
        sandboxQualification: evidence.nullable(),
        releaseAuthorization: evidence,
        unresolvedCritical: z.array(z.string().min(1).max(300)).max(30),
        evaluatedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.components.map((c) => c.key)).size !==
      value.components.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["components"],
        message: "Component keys must be unique",
      });
    if (!value.components.some((c) => c.type === "role_pack" && c.required))
      ctx.addIssue({
        code: "custom",
        path: ["components"],
        message: "A required native Role Pack is necessary",
      });
    if (
      new Date(value.releaseEvidence.expiresAt) <=
      new Date(value.releaseEvidence.evaluatedAt)
    )
      ctx.addIssue({
        code: "custom",
        path: ["releaseEvidence"],
        message: "Evidence validity interval is empty",
      });
    if (
      value.manifest.audience === "internal_test" &&
      (value.manifest.maximumRisk !== "C1" ||
        value.manifest.commercialProductKey ||
        value.manifest.actionClasses.some((a) => a !== "internal_draft"))
    )
      ctx.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "Internal tests are free, C1 internal drafts only",
      });
    if (value.manifest.audience === "first_party_support") {
      if (value.packageKey !== FIRST_PARTY_SUPPORT_PACKAGE_KEY)
        ctx.addIssue({ code: "custom", path: ["packageKey"], message: "First-party support releases use the fixed platform package key" });
      if (
        value.manifest.maximumRisk !== "C1" ||
        value.manifest.actionClasses.length !== 1 ||
        value.manifest.actionClasses[0] !== "internal_draft" ||
        value.manifest.requiredConnections.length !== 0 ||
        value.manifest.optionalConnections.length !== 0 ||
        value.manifest.memoryPolicy !== "no_persistent_memory" ||
        value.manifest.commercialProductKey !== null ||
        value.manifest.sandboxAssurance !== "read_only_no_code_execution" ||
        value.manifest.runtimeProviders.length !== 1 ||
        value.manifest.runtimeProviders[0] !== "paperclip_native" ||
        value.manifest.requiredKnowledge.length === 0
      )
        ctx.addIssue({ code: "custom", path: ["manifest"], message: "First-party support is restricted to C1 internal drafts with no connections, no persistent memory, no commercial product, and the Native runtime" });
      if (value.components.some((component) => ["workflow_template", "routine_template", "use_case_template", "onboarding_template"].includes(component.type)))
        ctx.addIssue({ code: "custom", path: ["components"], message: "First-party support releases cannot contain autonomous or commercial activation templates" });
    }
  });
export type PackageRelease = z.infer<typeof packageReleaseSchema>;
export type PackageComponent = z.infer<typeof packageComponentSchema>;
export const packageInstallSchema = z
  .object({
    installationRequestId: z.uuid().optional(),
    versionId: z.string().uuid(),
    agentId: z.string().uuid(),
    components: z
      .array(
        z
          .object({
            key,
            resourceId: z.string().uuid(),
            versionId: z.string().uuid(),
          })
          .strict(),
      )
      .max(64),
    aiUseCaseId: z.string().uuid().nullable().default(null),
    updatePolicy: z.enum(["manual", "auto_low_risk"]).default("manual"),
    acceptInternalEvaluation: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => new Set(v.components.map((c) => c.key)).size === v.components.length,
    "Resolved keys must be unique",
  );
export const packageDecisionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
export const packageUpdateSchema = packageInstallSchema
  .extend({
    expectedVersion: z.number().int().positive(),
    approveMaterialChange: z.boolean(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine((value) => value.installationRequestId === undefined, "Installation request IDs are for initial installation only");
export interface PackageCatalogView {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  versionId: string;
  version: string;
  contentHash: string;
  state: string;
  manifest: PackageRelease["manifest"];
  components: PackageComponent[];
  releaseEvidence: PackageRelease["releaseEvidence"];
}
export const packageInstallationStatusSchema = z.enum([
  "configuring", "readiness_blocked", "ready", "active", "needs_update", "degraded", "suspended", "uninstalled",
]);
/** A recorded request identifies its current Native installation. This is not
 * an immutable historical status, activation or qualification receipt. */
export const packageInstallationRequestReceiptSchema = z.strictObject({
  companyId: z.uuid(), requestId: z.uuid(), installationId: z.uuid(),
  installationVersion: z.number().int().positive(), installationStatus: packageInstallationStatusSchema,
  observedAt: z.iso.datetime(),
});
export const packageInstallationRequestLocatorSchema = z.strictObject({ companyId: z.uuid(), requestId: z.uuid() });
export const packageInstallationRequestQuerySchema = z.strictObject({ expectedUserId: z.string().min(1).max(300) });
export type PackageInstallationRequestReceipt = z.infer<typeof packageInstallationRequestReceiptSchema>;
export const pendingPackageInstallationRequestSchema = z.strictObject({
  companyId: z.uuid(), principal: z.string().min(1).max(300), requestId: z.uuid(),
});
export const pendingPackageInstallationRequestInventorySchema = z.array(pendingPackageInstallationRequestSchema).max(32)
  .refine(values => new Set(values.map(value => JSON.stringify([value.companyId, value.principal]))).size === values.length,
    "Only one unresolved installation per current company/requester");
export interface PackageInstallationView {
  id: string;
  companyId: string;
  packageId: string;
  installedVersionId: string;
  agentId: string;
  aiUseCaseId: string | null;
  version: number;
  status: z.infer<typeof packageInstallationStatusSchema>;
  updatePolicy: "manual" | "auto_low_risk";
  installedByUserId: string;
  installationRequestId?: string | null;
  components: Array<{
    key: string;
    type: string;
    resourceId: string;
    versionId: string;
    contentHash: string;
  }>;
  activationHash: string | null;
  readiness: {
    status: string;
    reasons: string[];
    warnings: string[];
    assessmentIds: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}
export interface PackageInstallOptions {
  agents: Array<{ id: string; name: string }>;
  components: Array<{
    type: string;
    resourceId: string;
    versionId: string;
    contentHash: string;
    name: string;
  }>;
}
export interface PackagePreview {
  manifest: PackageRelease["manifest"];
  components: PackageInstallationView["components"];
  readiness: NonNullable<PackageInstallationView["readiness"]>;
  requiresActivation: true;
  grantsCreated: 0;
}

export type PackageUpdateInput = z.infer<typeof packageUpdateSchema>;

export type PackageInstallInput = z.input<typeof packageInstallSchema>;
export type PackageUpdateDraftInput = z.input<typeof packageUpdateSchema>;
