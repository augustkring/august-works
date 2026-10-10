import { z } from "zod";

export const ACTIVATION_STEPS = [
  "intent",
  "discovery_permission",
  "discovery_progress",
  "material_facts",
  "capability",
  "access",
  "review",
  "running",
  "result",
  "activated",
] as const;
export const activationWebsiteSchema = z
  .string()
  .trim()
  .max(253)
  .refine(
    (value) =>
      !value ||
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
        value,
      ),
    "Enter a domain such as example.com, without a path or credentials",
  );
export const activationStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  step: z.enum(ACTIVATION_STEPS),
  website: activationWebsiteSchema,
  intent: z.string().trim().max(4000),
  discovery: z.enum(["not_requested", "customer_context"]),
  companyPurpose: z.string().trim().max(2000),
  missionFoundationId: z.uuid().nullable(),
  packageVersionId: z.uuid().nullable(),
  firstValueAt: z.iso.datetime().nullable(),
  receipts: z
    .array(
      z.strictObject({
        requestId: z.uuid(),
        requestHash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(32),
});
export type ActivationState = z.infer<typeof activationStateSchema>;
export function initialActivationState(website = ""): ActivationState {
  return activationStateSchema.parse({
    schemaVersion: 1,
    step: "intent",
    website,
    intent: "",
    discovery: "not_requested",
    companyPurpose: "",
    missionFoundationId: null,
    packageVersionId: null,
    firstValueAt: null,
    receipts: [],
  });
}
const envelope = {
  requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
};
export const activationCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...envelope,
    operation: z.literal("save_draft"),
    intent: z.string().trim().max(4000).optional(),
    companyPurpose: z.string().trim().max(2000).optional(),
  }),
  z.strictObject({
    ...envelope,
    operation: z.literal("save_intent"),
    intent: z.string().trim().min(1).max(4000),
  }),
  z.strictObject({ ...envelope, operation: z.literal("build_customer_draft") }),
  z.strictObject({ ...envelope, operation: z.literal("continue_discovery") }),
  z.strictObject({
    ...envelope,
    operation: z.literal("confirm_material_facts"),
    companyPurpose: z.string().trim().min(1).max(2000),
  }),
  z.strictObject({
    ...envelope,
    operation: z.literal("select_capability"),
    packageVersionId: z.uuid(),
  }),
  z.strictObject({ ...envelope, operation: z.literal("continue_access") }),
]);
export type ActivationCommand = z.infer<typeof activationCommandSchema>;
export const activationViewSchema = z.strictObject({
  runId: z.uuid(),
  companyId: z.uuid(),
  companyName: z.string(),
  version: z.number().int().positive(),
  status: z.enum(["in_progress", "completed", "abandoned"]),
  state: activationStateSchema.omit({ receipts: true }),
  sources: z
    .array(
      z.strictObject({
        id: z.enum(["customer_context", "website", "connections"]),
        status: z.enum(["available", "not_requested", "not_connected"]),
      }),
    )
    .max(3),
  capabilities: z
    .array(
      z.strictObject({
        versionId: z.uuid(),
        name: z.string().max(200),
        purpose: z.string().max(2000),
        requiredConnections: z.array(z.string().max(120)).max(20),
        knownLimitations: z.array(z.string().max(1000)).max(30),
      }),
    )
    .max(20),
  blockers: z
    .array(
      z.enum([
        "no_qualified_capability",
        "required_access_pending",
        "safe_execution_unqualified",
      ]),
    )
    .max(3),
});
export type ActivationView = z.infer<typeof activationViewSchema>;
