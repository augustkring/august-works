import { z } from "zod";
import { hireAgentCatalogSchema } from "./agent-authoring.js";

/** Conversation proposes a Native setup, never copied instructions, a live
 * Agent, runtime, credentials, grants or package installation. A package pin
 * resolves only through the existing customer catalog. */
export const agentSetupAuthoringInputSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(1).max(120).regex(/^[^\u0000\uD800-\uDFFF]*$/u),
  packageVersionId: z.uuid().optional(),
});
export const agentSetupAuthoringInputJsonSchema = z.toJSONSchema(agentSetupAuthoringInputSchema);
export const agentSetupCatalogInputSchema = z.strictObject({ query: z.string().trim().max(200).default("") });
export const agentSetupCatalogInputJsonSchema = z.toJSONSchema(agentSetupCatalogInputSchema);
export const agentSetupCatalogViewSchema = z.strictObject({ coverage: z.literal("bounded"), modelCalled: z.literal(false),
  capabilities: hireAgentCatalogSchema });
export const agentSetupAuthoringReceiptSchema = z.strictObject({
  draftId: z.uuid(), requestId: z.uuid(), kind: z.enum(["custom", "hire"]),
  currentVersion: z.number().int().positive(), currentStatus: z.enum(["draft", "discarded"]),
  packageVersionId: z.uuid().nullable(), href: z.string(),
  // Historical creation consequence. These fields do not claim that the
  // Human has never subsequently prepared, installed or activated anything.
  creationCreatedAgent: z.literal(false), creationInstalledPackage: z.literal(false),
  creationGrantedAuthority: z.literal(false), creationStartedExecution: z.literal(false),
  requiresHumanReview: z.literal(true),
}).superRefine((value, ctx) => {
  const prefix = value.kind === "hire" ? "/agents/hire/drafts" : "/agents/custom";
  if (value.href !== `${prefix}/${value.draftId}` || (value.kind === "hire") !== (value.packageVersionId !== null))
    ctx.addIssue({ code: "custom", message: "Use the Original setup reference and exact package pin" });
});
