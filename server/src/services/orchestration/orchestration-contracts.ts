import { and, desc, eq, sql } from "drizzle-orm";
import { completionContracts, orchestrationPlans, orchestrationWorkers, type Db } from "@paperclipai/db";
import { orchestrationCompletionSchema, type OrchestrationCompletion } from "@paperclipai/shared";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { conflict } from "../../errors.js";
export const V7_COMPLETION_SCHEMA = "aw.completion-contract.v7";
/** Keeps the existing native criteria wire shape while adding server-owned acceptance requirements. */
export async function writeOrchestrationContract(tx: Db, companyId: string, issueId: string, input: OrchestrationCompletion, actorId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paperclip:native-completion-contract:${companyId}:${issueId}`}, 0))`);
  const [previous] = await tx.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId), eq(completionContracts.issueId, issueId))).orderBy(desc(completionContracts.revision)).limit(1);
  const revision = (previous?.revision ?? 0) + 1;
  const contract = { revision: String(revision), objective: input.objective, criteria: [
    ...input.requiredOutputs.map(output => ({ id: `output_${output.key}`, requirement: `Save the required ${output.key} document on this canonical Task; the server will verify its current revision and declared schema.` })),
    ...input.businessInvariants.map((requirement, index) => ({ id: `invariant_${index}`, requirement })),
    ...input.evidenceRequirements.map((requirement, index) => ({ id: `evidence_${index}`, requirement })),
    ...input.prohibitedOutcomes.map((outcome, index) => ({ id: `prohibited_${index}`, requirement: `Do not produce this outcome: ${outcome}` })),
    ...input.requiredPostconditions.map((condition, index) => ({ id: `postcondition_${index}`, requirement: condition.kind === "tool_receipt" ? `Provide the authoritative successful ${condition.toolName} receipt bound to the declared arguments and required approval.` : `Verify canonical Task ${condition.issueId} is ${condition.status}.` })),
  ], v7: input };
  const [row] = await tx.insert(completionContracts).values({ companyId, issueId, revision, schemaVersion: V7_COMPLETION_SCHEMA, policyVersion: "aw-orchestration-v7.1", risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal", contractJson: contract,
    canonicalSha256: nativeSha256({ schemaVersion: V7_COMPLETION_SCHEMA, contract }), createdByActorType: "user", createdByActorId: actorId, supersedesContractId: previous?.id ?? null }).returning();
  return row!;
}
export async function retainedOrchestrationContract(db: Db, companyId: string, issueId: string) {
  const [worker] = await db.select({ worker: orchestrationWorkers, plan: orchestrationPlans }).from(orchestrationWorkers).innerJoin(orchestrationPlans, and(eq(orchestrationPlans.companyId, orchestrationWorkers.companyId), eq(orchestrationPlans.id, orchestrationWorkers.planId)))
    .where(and(eq(orchestrationWorkers.companyId, companyId), eq(orchestrationWorkers.issueId, issueId), sql`${orchestrationPlans.status} not in ('completed','cancelled','failed')`)).limit(1);
  const [parent] = worker ? [] : await db.select().from(orchestrationPlans).where(and(eq(orchestrationPlans.companyId, companyId), eq(orchestrationPlans.issueId, issueId), sql`${orchestrationPlans.status} not in ('completed','cancelled','failed')`)).limit(1);
  const contractId = worker?.worker.completionContractId ?? parent?.completionContractId;
  if (!contractId) return null;
  const [row] = await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId), eq(completionContracts.issueId, issueId), eq(completionContracts.id, contractId)));
  const [latest] = await db.select().from(completionContracts).where(and(eq(completionContracts.companyId, companyId), eq(completionContracts.issueId, issueId))).orderBy(desc(completionContracts.revision)).limit(1);
  if (!row || row.id !== latest?.id || row.schemaVersion !== V7_COMPLETION_SCHEMA) throw conflict("Orchestration completion contract changed; revise the plan before execution");
  orchestrationCompletionSchema.parse(row.contractJson.v7);
  return { row, contract: { revision: String(row.revision), objective: String(row.contractJson.objective), criteria: row.contractJson.criteria as Array<{ id: string; requirement: string }> } };
}
