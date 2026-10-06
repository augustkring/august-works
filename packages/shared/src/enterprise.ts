import { z } from "zod";
const https = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password &&
        !u.search && !u.hash;
    } catch {
      return false;
    }
  }, "A fixed HTTPS endpoint is required");
const evidence = z
  .object({ uri: https, sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const enterpriseOperatingEnvelopeSchema = z
  .object({
    awProcessingRegions: z.array(z.string().min(1).max(80)).min(1).max(10),
    providers: z
      .array(
        z
          .object({
            provider: z.string().min(1).max(120),
            purpose: z.string().min(1).max(300),
            responsibility: z.enum(["aw_subprocessor", "customer_selected"]),
            regions: z.array(z.string().max(80)).max(10),
            dataCategories: z.array(z.string().max(120)).max(20),
            retentionDescription: z.string().max(1000),
            dpaStatus: z
              .enum([
                "unknown",
                "pending",
                "reviewed",
                "customer_selected_responsibility",
              ])
              .default("unknown"),
            criticality: z
              .enum(["low", "material", "high"])
              .default("material"),
            status: z
              .enum(["unknown", "active", "withdrawn"])
              .default("unknown"),
            assuranceEvidence: evidence.nullable(),
            exitDescription: z.string().max(1000),
          })
          .strict(),
      )
      .max(40),
    dedicatedPlacement: z.enum(["none", "dedicated_gateway", "dedicated_vm"]),
    retentionPolicyDescription: z.string().min(1).max(1000),
    contractEvidence: evidence.nullable(),
    supportAccess: z.literal("native_scoped_owner_approval"),
    limitations: z.array(z.string().min(1).max(1000)).min(1).max(30),
  })
  .strict();
export type EnterpriseOperatingEnvelope = z.infer<
  typeof enterpriseOperatingEnvelopeSchema
>;
export const enterpriseIdentityConfigurationSchema = z.discriminatedUnion(
  "protocol",
  [
    z
      .object({
        protocol: z.literal("oidc"),
        issuer: https,
        domain: z.string().regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
        clientId: z.string().min(1).max(200),
        discoveryEndpoint: https,
        privateKeySecretId: z.string().uuid(),
        privateKeySecretVersion: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        protocol: z.literal("saml"),
        issuer: https,
        domain: z.string().regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
        entryPoint: https,
        certificate: z.string().min(100).max(32000),
      })
      .strict(),
  ],
);
export type EnterpriseIdentityConfiguration = z.infer<
  typeof enterpriseIdentityConfigurationSchema
>;
export const enterpriseIdentityPolicySchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    configuration: enterpriseIdentityConfigurationSchema,
    operatingEnvelope: enterpriseOperatingEnvelopeSchema,
    scimRequired: z.boolean(),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export const enterpriseSubjectBindingSchema = z
  .object({
    userId: z.string().min(1).max(200),
    subject: z.string().min(1).max(500),
    manageMembershipLifecycle: z.boolean().default(false),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export type EnterpriseIdentityPolicyInput = z.input<
  typeof enterpriseIdentityPolicySchema
>;
export type EnterpriseSubjectBindingInput = z.input<
  typeof enterpriseSubjectBindingSchema
>;
export interface EnterpriseIdentityPolicyView {
  id: string;
  companyId: string;
  providerId: string;
  version: number;
  configurationHash: string;
  status: string;
  configuration: EnterpriseIdentityConfiguration;
  operatingEnvelope: EnterpriseOperatingEnvelope;
  scimConfigured: boolean;
  scimRequired: boolean;
  scimCredentialId: string | null;
  scimCredentialExpiresAt: string | null;
  qualification: {
    uri: string;
    sha256: string;
    sourceRevision: string;
    qualifiedByUserId: string;
    expiresAt: string;
    signingKey: {
      secretId: string;
      version: number;
      valueSha256: string;
    } | null;
  } | null;
}
export interface EnterpriseSubjectBindingView {
  issuer: string;
  id: string;
  companyId: string;
  providerId: string;
  userId: string;
  subject: string;
  status: string;
  managedMembership: boolean;
}
export const enterpriseQualificationSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    uri: https,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
  })
  .strict();
export const enterprisePolicyDecisionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();

export const enterpriseCredentialRotationSchema = enterprisePolicyDecisionSchema
  .extend({ expectedCredentialId: z.string().uuid().nullable() })
  .strict();

export interface CompanyStateExport {
  schema: "aw.company-state.v7";
  companyId: string;
  exportedAt: string;
  files: Record<string, string>;
  sha256: string;
  limitations: string[];
}
