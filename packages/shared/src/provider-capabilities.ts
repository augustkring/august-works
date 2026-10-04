import { z } from "zod";

export const PROVIDER_CAPABILITY_FEATURES = ["sessions", "cancellation", "steering", "structuredOutput", "skillsDiscovery", "skillsSync", "toolDiscovery", "memoryScoping"] as const;
export type ProviderCapabilityFeature = (typeof PROVIDER_CAPABILITY_FEATURES)[number];
const advertisedItemSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  version: z.string().max(200).nullable().default(null),
}).strict();
export const providerCapabilitySnapshotSchema = z.object({
  provider: z.string().min(1).max(100),
  version: z.string().max(200).nullable(),
  features: z.object(Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((k) => [k, z.boolean()])) as Record<ProviderCapabilityFeature, z.ZodBoolean>).strict(),
  skills: z.array(advertisedItemSchema).max(500),
  tools: z.array(advertisedItemSchema).max(500),
  discoveredAt: z.string().datetime(),
  hash: z.string().min(1).max(100),
  interfaces: z.array(z.object({ protocol: z.string().min(1).max(100), url: z.string().url().max(2000) }).strict()).max(16).optional(),
  securityRequirements: z.array(z.record(z.string().min(1).max(100), z.array(z.string().max(200)).max(32))).max(16).optional(),
  providerOrganization: z.string().max(200).nullable().optional(),
  protocolVersion: z.string().max(100).nullable().optional(),
}).strict();
export type ProviderCapabilitySnapshot = z.infer<typeof providerCapabilitySnapshotSchema>;
export const PROVIDER_ISOLATION_WARNING_VERSION = "v5-shared-runtime-1";
export const PROVIDER_ISOLATION_WARNING = "Reduced isolation: participating companies share provider-local memory and state. August Works scopes its own context and tools, but cannot isolate that shared provider state.";

export const createProviderBindingSchema = z.object({
  providerType: z.enum(["openclaw", "hermes", "a2a", "paperclip_native", "custom"]),
  providerEndpointRef: z.string().min(1).max(200).nullable().default(null),
  providerAgentRef: z.string().min(1).max(200),
  isolationMode: z.enum(["isolated_per_presence", "shared_trusted_runtime"]).default("isolated_per_presence"),
}).strict();
export const attachProviderBindingSchema = z.object({
  providerBindingId: z.string().uuid(),
  providerProfileRef: z.string().min(1).max(200),
}).strict();
export const providerConformanceInputSchema = z.object({ acknowledgeProviderRuns: z.literal(true), maximumCostCents: z.number().int().min(1).max(10000), isolationPeer: z.object({ companyId: z.string().uuid(), agentId: z.string().uuid() }).strict().nullable().default(null) }).strict();
export const acknowledgeSharedRuntimeSchema = z.object({ warningVersion: z.literal(PROVIDER_ISOLATION_WARNING_VERSION), acknowledged: z.literal(true) }).strict();

export const revalidateProviderBindingSchema = z.object({ expectedSnapshotHash: z.string().min(1).max(100), rationale: z.string().trim().min(20).max(4000) }).strict();
