import { and, eq } from "drizzle-orm";
import { toolConnections, toolCatalogEntries, type Db } from "@paperclipai/db";
import { workflowDraftToolChoiceSchema, workflowToolFields, workflowToolArgumentErrors, type WorkflowDraftToolChoice, type WorkflowDraftFlowOperation } from "@paperclipai/shared";
import { authorizationService, type AuthorizationActor } from "../authorization.js";
import { workflowCapabilityResolverService } from "./workflow-capability-resolver.js";
import { workflowCapabilityVisibility } from "./workflow-capability-visibility.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { validateWorkflowOutput } from "./workflow-output-schema.js";
import type { HttpError } from "../../errors.js";

/** Stored Original catalog only; never discovery, refresh, grant or invocation.
 * Complete scalar schemas can be shown without a raw JSON editor. */
async function toolChoices(tx: Db, companyId: string, rawActor: AuthorizationActor) {
  const actor = { ...rawActor, isInstanceAdmin: false, ignoreInstanceAdmin: true }, visible = workflowCapabilityVisibility(tx, companyId, actor);
  const schemas = new Map<string, Record<string, unknown>>();
  const currentUse = (await authorizationService(tx).decide({ actor, action: "tools:use", resource: { type: "company", companyId }, enforceResponsibleUserIntersection: true })).allowed;
  const result = await workflowCapabilityResolverService(tx).search(companyId, { q: "", kind: "connected_tool", limit: 20 }, async candidate => {
    if (!await visible(candidate) || !workflowToolFields(candidate.inputSchema)) return false;
    const [connection] = await tx.select({ enabled: toolConnections.enabled, status: toolConnections.status }).from(toolConnections)
      .where(and(eq(toolConnections.companyId, companyId), eq(toolConnections.id, String(candidate.source.connectionId)))).for("share");
    return !!connection?.enabled && connection.status === "active";
  });
  const choices: WorkflowDraftToolChoice[] = [];
  let bytes = 0;
  for (const candidate of result.candidates) {
    const schema = candidate.inputSchema!, fields = workflowToolFields(schema);
    const parsed = workflowDraftToolChoiceSchema.safeParse({ entryId: candidate.source.catalogEntryId, connectionId: candidate.source.connectionId,
      connectionName: candidate.source.connectionName, name: candidate.title, versionHash: candidate.configTemplate.catalogVersionHash,
      schemaHash: candidate.configTemplate.catalogSchemaHash, inputSchemaHash: nativeSha256(schema), fields, effect: candidate.sideEffectClass,
      access: currentUse ? "execution_check" : "permission_required" });
    if (parsed.success) {
      const size = Buffer.byteLength(JSON.stringify(parsed.data), "utf8");
      if (bytes + size > 65536) continue;
      bytes += size; choices.push(parsed.data); schemas.set(parsed.data.entryId, schema);
    }
  }
  return { choices, schemas };
}
export async function reviewDraftToolSelection(tx: Db, companyId: string, actor: AuthorizationActor) {
  return { coverage: "bounded" as const, choices: (await toolChoices(tx, companyId, actor)).choices };
}
export async function assertDraftToolSelection(tx: Db, companyId: string, actor: AuthorizationActor,
  operation: Extract<WorkflowDraftFlowOperation, { kind: "append_tool" }>, refuse: () => HttpError) {
  const current = await toolChoices(tx, companyId, actor), choice = current.choices.find(value => value.entryId === operation.entryId);
  if (!choice || choice.connectionId !== operation.connectionId || choice.versionHash !== operation.versionHash ||
    choice.schemaHash !== operation.schemaHash || choice.inputSchemaHash !== operation.inputSchemaHash || workflowToolArgumentErrors(choice.fields, operation.input).length) throw refuse();
  const [entry] = await tx.select({ id: toolCatalogEntries.id }).from(toolCatalogEntries).where(and(eq(toolCatalogEntries.companyId, companyId),
    eq(toolCatalogEntries.id, choice.entryId), eq(toolCatalogEntries.connectionId, choice.connectionId), eq(toolCatalogEntries.status, "active"))).for("share");
  if (!entry) throw refuse();
  try { validateWorkflowOutput(current.schemas.get(choice.entryId), operation.input); } catch { throw refuse(); }
}
