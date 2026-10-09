import { and, eq, inArray } from "drizzle-orm";
import { analyticalLineageEdges, issues, type Db } from "@paperclipai/db";
import type { BusinessEvent } from "@paperclipai/shared";
import { nativeSha256 } from "./native-runtime/canonical.js";
import { conflict } from "../errors.js";
import type { AuthorizationActor } from "./authorization.js";
import { businessEventService } from "./business-events.js";

/** Called under native company → Memory admission. Recorded object links and
 * current erasure ancestry have different meanings; this stores both as edges
 * without fabricating additional historical event relationships. */
export async function retainNativeEventLineage(tx: Db, companyId: string, manifestId: string, events: readonly BusinessEvent[], policies: readonly { id: string; obligationHash: string }[]) {
  const edges = new Map<string, typeof analyticalLineageEdges.$inferInsert>();
  function edge(inputType: typeof analyticalLineageEdges.$inferInsert["inputType"], inputRef: string, inputHash: string, relationship: "source" | "policy" = "source") {
    edges.set(`${inputType}:${inputRef}`, { companyId, manifestId, inputType, inputRef, inputHash, relationship });
  }
  for (const event of events) {
    edge("business_event_source", event.source.ref, event.source.contentHash);
    for (const object of event.objects) edge(object.objectType, object.objectId, nativeSha256({ objectType: object.objectType, objectId: object.objectId }));
  }
  const issueIds = [...new Set(events.flatMap(event => event.objects.filter(object => object.objectType === "issue").map(object => object.objectId)))];
  if (issueIds.length) for (const issue of await tx.select({ projectId: issues.projectId }).from(issues).where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)))) {
    if (issue.projectId) edge("project", issue.projectId, nativeSha256({ projectId: issue.projectId }));
  }
  for (const policy of policies) edge("governance_obligation", policy.id, policy.obligationHash, "policy");
  const values = [...edges.values()];
  for (let start = 0; start < values.length; start += 500) await tx.insert(analyticalLineageEdges).values(values.slice(start, start + 500));
}

export async function inspectNativeEventLineage(tx: Db, companyId: string, actor: AuthorizationActor, manifestId: string, events: readonly BusinessEvent[], policyRefs: readonly string[]) {
  const edges=await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId,companyId),eq(analyticalLineageEdges.manifestId,manifestId))).limit(8033);
  const sources=edges.filter(edge=>edge.inputType==="business_event_source");
  const expected=new Map(events.map(event=>[event.source.ref,event.source.contentHash]));
  const edgeKeys=new Set(edges.map(edge=>`${edge.relationship}:${edge.inputType}:${edge.inputRef}`));
  if(edges.length>8032 || sources.length!==expected.size || sources.some(edge=>expected.get(edge.inputRef)!==edge.inputHash || edge.relationship!=="source")
    || policyRefs.some(id=>!edgeKeys.has(`policy:governance_obligation:${id}`))
    || events.some(event=>event.objects.some(object=>!edgeKeys.has(`source:${object.objectType}:${object.objectId}`))))
    throw conflict("Native event lineage no longer covers its retained snapshot");
  await businessEventService(tx).inspectCurrentObjectSources(companyId,actor,edges.flatMap(edge=>
    edge.inputType==="issue" || edge.inputType==="project" ? [{objectType:edge.inputType,objectId:edge.inputRef,qualifier:"related" as const}] : []));
}
