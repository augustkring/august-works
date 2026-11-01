import { z } from "zod";

export const SANDBOX_CONTROLS = ["filesystemPolicy", "processPrivilegePolicy", "syscallPolicy", "networkDestinationPolicy", "networkLayer7Policy", "credentialBrokering", "resourceLimits", "forceStop"] as const;
export const sandboxBackendSchema = z.enum(["existing_cell_container", "openshell"]);
export const sandboxProfileSchema = z.enum(["development", "compatibility", "standard_managed", "high_assurance_managed"]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = z.string().regex(/^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
const qualificationCredentialFixtureSchema = z.object({
  version: z.literal(1), fixtureId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/), fixtureHash: hash,
  profileId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/), profileHash: hash,
  binaries: z.tuple([z.literal("/usr/bin/curl")]), wrongBinaryPath: z.literal("/usr/bin/wget"),
  origin: z.string().url(), port: z.number().int().min(1).max(65535), method: z.literal("POST"),
  gatewayPublicId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  toolName: z.string().min(1).max(200), wrongToolName: z.string().min(1).max(200), argumentTemplateHash: hash,
  marker: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
}).strict().refine(value => value.wrongToolName !== value.toolName, "The negative canary tool must be distinct");
const qualificationFixturePath = z.string().min(1).max(512).refine(path => path.startsWith("/") && !path.includes("\u0000") && !path.includes("\\") && !path.split("/").some(part => part === "." || part === "..") && !/[\r\n*?]/.test(path) && !path.includes("//") && (path === "/" || !path.endsWith("/")), "Use a normalized absolute qualification fixture path");
const qualificationNetworkCaseSchema = z.object({
  urlTemplate: z.string().min(1).max(1024).refine(value => value.split("{nonce}").length === 2 && !/[\r\n\0]/.test(value)),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  marker: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
}).strict();
export const qualificationProbeFixtureSchema = z.object({
  version: z.literal(1), fixtureHash: hash,
  runAsUser: z.string().regex(/^[1-9]\d{0,9}$/), runAsGroup: z.string().regex(/^[1-9]\d{0,9}$/),
  filesystem: z.object({
    allowedReadPath: qualificationFixturePath, allowedReadMarker: z.string().regex(/^[A-Za-z0-9]$/),
    deniedReadPath: qualificationFixturePath, deniedReadMarker: z.string().regex(/^[A-Za-z0-9]$/),
    escapeOperand: z.string().min(1).max(512).refine(value => value.startsWith("/") && value.split("/").includes("..") && !/[\r\n\0]/.test(value) && !value.includes("\\")),
    escapeReadMarker: z.string().regex(/^[A-Za-z0-9]$/), escapeTargetPath: qualificationFixturePath,
    escapeViaRoot: qualificationFixturePath, workdirPath: qualificationFixturePath,
  }).strict(),
  network: z.object({
    version: z.literal(1), allow: qualificationNetworkCaseSchema, hostPortDeny: qualificationNetworkCaseSchema,
    wrongHostDeny: qualificationNetworkCaseSchema, redirectDeny: qualificationNetworkCaseSchema,
    dnsRedirectDeny: qualificationNetworkCaseSchema.extend({ resolveIp: z.string().min(1).max(45) }),
    l7Allow: qualificationNetworkCaseSchema, l7Deny: qualificationNetworkCaseSchema,
  }).strict(),
  credential: qualificationCredentialFixtureSchema.optional(),
}).strict().refine(value => value.filesystem.allowedReadPath !== value.filesystem.deniedReadPath &&
  value.filesystem.deniedReadPath !== value.filesystem.escapeTargetPath &&
  [value.filesystem.allowedReadPath, value.filesystem.deniedReadPath, value.filesystem.escapeTargetPath,
    value.filesystem.escapeViaRoot, value.filesystem.workdirPath].every(path => path !== "/") &&
  value.network.version === 1, "Qualification fixtures must describe distinct bounded paths and endpoints");
export type SandboxQualificationProbeFixture = z.infer<typeof qualificationProbeFixtureSchema>;

const qualificationTargetSchema = z.object({
  hostEpoch: z.number().int().positive(), companyId: z.string().uuid(), bindingId: z.string().uuid(), bindingVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), cellId: z.string().uuid(), cellGeneration: z.string().regex(/^[1-9]\d{0,18}$/), sandboxRef: z.string().regex(/^aw-v7-[a-f0-9-]{36}$/),
  sandboxId: z.string().uuid(), containerId: z.string().regex(/^[a-f0-9]{64}$/),
  imageDigest: digest, hostKernelVersion: z.string().trim().min(1).max(200), runtimeBinarySha256: hash, openshellCliSha256: hash, dockerEngineIdHash: hash, policyHash: hash, provisioningHash: hash,
  resourceLimits: z.object({ cpuMillis: z.number().int().min(100).max(64000), memoryBytes: z.number().int().min(67108864).max(137438953472), diskBytes: z.number().int().min(1048576).max(1099511627776), pidsLimit: z.number().int().min(16).max(16384) }).strict(),
  qualificationCredentialFixture: qualificationCredentialFixtureSchema.optional(),
  policyVersion: z.number().int().nonnegative(), configRevision: z.string().min(1).max(200),
  phase: z.enum(["Ready", "Stopped"]), mechanism: z.literal("openshell_create_sandbox_v0.1.2"), probePolicyHash: hash, probeFixtureHash: hash, targetHash: hash,
}).strict();
const controlSchema = z.object(Object.fromEntries(SANDBOX_CONTROLS.map(key => [key, z.boolean()])) as Record<typeof SANDBOX_CONTROLS[number], z.ZodBoolean>).strict();
export const sandboxCapabilitySnapshotSchema = controlSchema.extend({
  backend: sandboxBackendSchema, backendVersion: z.string().trim().min(1).max(100), hostKernelVersion: z.string().trim().min(1).max(200).nullable(), sandboxImageDigest: digest,
  filesystemEnforcementMode: z.enum(["hard_requirement", "best_effort", "unknown"]), staticPolicyRequiresRecreate: z.boolean(), dynamicNetworkPolicy: z.boolean(),
  policyProverBoundaryCheck: z.boolean(), policyProverCoverage: z.array(z.enum(SANDBOX_CONTROLS)).max(8), credentialBindingDimensions: z.array(z.enum(["company", "presence", "host", "port", "method", "path", "binary", "expiry", "revocation"])).max(9),
  /** Exact setup target and policy used by protected qualification probes;
   * this evidence is not transferable to a later admission target. */
  qualificationTarget: qualificationTargetSchema.optional(),
  /** Protected nonsecret fixture metadata used only to derive the initial
   * qualification-only CreateSandbox policy. It carries no authority by itself. */
  qualificationProbeFixture: qualificationProbeFixtureSchema.optional(),
  qualificationCredentialFixture: qualificationCredentialFixtureSchema.optional(),
  credentialBrokerProviderProfile: z.object({ id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/), hash }).strict().optional(),
  /** Separately qualified OpenShell auth-injection profile for the managed
   * worker-model endpoint. It is never interchangeable with ToolGateway. */
  modelBrokerProviderProfile: z.object({ id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/), hash }).strict().optional(),
  testedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), qualificationHash: hash, evidenceKind: z.enum(["local_fixture", "protected_host_report"]),
}).strict().superRefine((value, ctx) => {
  if (value.evidenceKind !== "protected_host_report" && value.qualificationProbeFixture)
    ctx.addIssue({ code: "custom", path: ["qualificationProbeFixture"], message: "only the protected host may provide qualification fixtures" });
  if (value.evidenceKind === "protected_host_report" && !value.qualificationTarget) {
    const preflight = value.qualificationProbeFixture;
    if (!preflight || !value.hostKernelVersion || value.qualificationHash !== preflight.fixtureHash ||
      (value.qualificationCredentialFixture?.fixtureHash ?? null) !== (preflight.credential?.fixtureHash ?? null) ||
      value.policyProverBoundaryCheck || value.policyProverCoverage.length > 0 || SANDBOX_CONTROLS.some(control => value[control]))
      ctx.addIssue({ code: "custom", path: ["qualificationProbeFixture"], message: "preflight metadata grants no capability and requires the exact protected fixture hash" });
  }
  if (value.evidenceKind === "protected_host_report" && value.qualificationTarget &&
    (!value.hostKernelVersion || value.hostKernelVersion !== value.qualificationTarget.hostKernelVersion ||
      !value.qualificationProbeFixture || value.qualificationTarget.probeFixtureHash !== value.qualificationProbeFixture.fixtureHash ||
      (value.qualificationCredentialFixture?.fixtureHash ?? null) !== (value.qualificationProbeFixture.credential?.fixtureHash ?? null) ||
      (value.qualificationProbeFixture.credential?.fixtureHash ?? null) !== (value.qualificationTarget.qualificationCredentialFixture?.fixtureHash ?? null)))
    ctx.addIssue({ code: "custom", path: ["qualificationTarget"], message: "protected reports require an exact host, image, fixture and probe target" });
});
const absolutePath = z.string().min(1).max(1000).refine(path => path.startsWith("/") && !path.includes("\u0000") && !path.includes("\\") && !path.split("/").some(part => part === "." || part === "..") && !/[\r\n*?]/.test(path) && !path.includes("//") && (path === "/" || !path.endsWith("/")), "Use a normalized absolute path without traversal or wildcard syntax");
// OpenShell 0.1.2 REST matchers use glob::Pattern, including character classes.
// Authoritative AW prefixes are literal paths; only the private projection
// may append its controlled descendant wildcard. Filesystem paths remain
// literal Landlock paths and may legitimately contain brackets.
const requestPath = absolutePath.refine(path => !/[%?#\[\]]/.test(path), "Use a literal request path without encoded, query or wildcard syntax");
const hostname = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).refine(value => !value.endsWith(".localhost") && !value.endsWith(".local") && !value.endsWith(".internal"), "An explicit public DNS hostname is required");
const destinationSchema = z.object({ hostname, port: z.number().int().min(1).max(65535), methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])).min(1).max(7), pathPrefixes: z.array(requestPath).min(1).max(16) }).strict();
const credentialBindingSchema = z.object({ connectionId: z.string().uuid(), grantVersionHash: hash, hostname, port: z.number().int().min(1).max(65535), methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])).min(1).max(7), pathPrefixes: z.array(requestPath).min(1).max(16), binary: absolutePath.nullable(), ttlSeconds: z.number().int().min(1).max(900) }).strict();
export const sandboxPolicySchema = z.object({
  schemaVersion: z.literal(1), profile: sandboxProfileSchema, broadAutonomy: z.boolean(), riskClass: z.enum(["C0", "C1", "C2", "C3", "C4"]),
  filesystem: z.object({ readPaths: z.array(absolutePath).max(64), writePaths: z.array(absolutePath).max(32), deniedPaths: z.array(absolutePath).max(64) }).strict(),
  process: z.object({ uid: z.number().int().positive(), noNewPrivileges: z.literal(true), capabilities: z.array(z.string().regex(/^CAP_[A-Z_]+$/)).max(0), allowedBinaries: z.array(absolutePath).max(32), allowedSyscalls: z.array(z.string().regex(/^[a-z_][a-z_0-9]{0,63}$/)).max(256) }).strict(),
  network: z.object({ defaultDeny: z.literal(true), destinations: z.array(destinationSchema).max(64), denyPrivateAndMetadata: z.literal(true) }).strict(),
  credentials: z.object({ mode: z.enum(["none", "legacy_injected", "brokered"]), bindings: z.array(credentialBindingSchema).max(64) }).strict(),
  resources: z.object({ cpuMillis: z.number().int().min(100).max(64000), memoryBytes: z.number().int().min(67108864).max(137438953472), diskBytes: z.number().int().min(1048576).max(1099511627776), pidsLimit: z.number().int().min(16).max(16384), wallClockSeconds: z.number().int().min(1).max(86400) }).strict(),
  requiredControls: z.array(z.enum(SANDBOX_CONTROLS)).max(8),
}).strict();
export const sandboxBindingCreateSchema = z.object({ runtimeCellId: z.string().uuid(), expectedCellGeneration: z.string().regex(/^[1-9]\d{0,18}$/), backend: sandboxBackendSchema, profile: sandboxProfileSchema, boundaryPolicy: sandboxPolicySchema }).strict();
export const sandboxCompileSchema = z.object({ expectedVersion: z.number().int().positive(), executionManifestId: z.string().uuid(), candidatePolicy: sandboxPolicySchema }).strict();
export const sandboxAdmissionSchema = z.object({ expectedVersion: z.number().int().positive(), policySnapshotId: z.string().uuid() }).strict();
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type SandboxCapabilitySnapshot = z.infer<typeof sandboxCapabilitySnapshotSchema>;
export type SandboxBindingCreateInput = z.infer<typeof sandboxBindingCreateSchema>;
export type SandboxCompileInput = z.infer<typeof sandboxCompileSchema>;
export type SandboxAdmissionInput = z.infer<typeof sandboxAdmissionSchema>;
export interface SandboxPosture {
  runtimeCellId: string; generation: string;
  state: "legacy_boundary" | "awaiting_qualification" | "backend_qualified" | "quarantined";
  profile: SandboxPolicy["profile"] | null;
  executionEnforced: boolean;
}
export interface SandboxPolicyCompilation {
  schemaVersion: 1; compilerVersion: "aw-v7.2"; boundaryPolicyHash: string; candidatePolicyHash: string; staticPolicyFingerprint: string;
  proverResult: "pass" | "fail" | "unsupported"; unsupportedFeatures: string[]; failedBoundaries: string[];
  enforcementProfile: SandboxPolicy["profile"]; sourcePolicyRefs: string[]; compiledPolicy: SandboxPolicy;
  modelBrokerEndpoint?: { hostname: string; port: number; path: "/runtime-tools/model/v1/messages" };
}
