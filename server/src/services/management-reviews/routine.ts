import { and, eq } from "drizzle-orm";
import { businessMetrics, type Db } from "@paperclipai/db";
import { managementReviewDefinitionSchema, routineManagementReviewTemplateSchema, type ExecutionPrincipal, type ManagementReviewDefinition, type RoutineManagementReviewTemplate } from "@paperclipai/shared";
import { conflict, forbidden } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { businessMetricService } from "../business-metrics/service.js";
import type { logActivity } from "../v7-mutations.js";
import { workflowDelegationForActor } from "../workflows/workflow-delegation.js";
import { managementReviewService } from "./service.js";

/** Reuse the native Routine's server-assigned delegation, never its responsibility label. */
export function assertRoutineReviewDelegation(template: RoutineManagementReviewTemplate | null | undefined, targetKind: string | null, principal: ExecutionPrincipal | null) {
  if (template && (targetKind !== "workflow" || principal?.type !== "user")) throw forbidden("Review draft cadence requires an explicitly Human-configured Workflow Routine");
}

export async function draftRoutineManagementReview(tx: Db, companyId: string, principal: ExecutionPrincipal | null, raw: RoutineManagementReviewTemplate, asOf: Date, publications: Parameters<typeof logActivity>[2]) {
  assertRoutineReviewDelegation(raw, "workflow", principal);
  if (principal?.type !== "user") throw forbidden("Current Human review delegation required");
  await workflowDelegationForActor(tx, companyId, { userId: principal.userId });
  const actor: AuthorizationActor = { type: "board", source: "session", userId: principal.userId, companyIds: [companyId] };
  const template = routineManagementReviewTemplateSchema.parse(raw), day = 86_400_000, deadline = performance.now() + 30_000;
  const period = { from: new Date(asOf.getTime() - template.periodDays * day).toISOString(), until: asOf.toISOString() };
  const sources: ManagementReviewDefinition["sources"] = [];
  for (const item of template.sources) {
    if (performance.now() >= deadline) throw conflict("Routine review selectors exceeded their current Source budget");
    if (item.selector.kind === "canonical") {
      sources.push({ key: item.key, source: { kind: "canonical", reference: item.selector.reference } });
      continue;
    }
    const [metric] = await tx.select({ publishedVersionId: businessMetrics.publishedVersionId, status: businessMetrics.status }).from(businessMetrics)
      .where(and(eq(businessMetrics.companyId, companyId), eq(businessMetrics.id, item.selector.metricId))).for("share");
    if (metric?.status !== "published" || !metric.publishedVersionId) throw conflict("Routine review needs the current published native metric");
    const until = new Date(asOf.getTime() - item.selector.offsetDays * day), from = new Date(until.getTime() - template.periodDays * day);
    const observation = await businessMetricService(tx).query(companyId, actor, { metricId: item.selector.metricId, versionId: metric.publishedVersionId, from: from.toISOString(), until: until.toISOString(), dimensions: item.selector.dimensions, maxRows: item.selector.maxRows }, publications);
    sources.push({ key: item.key, source: { kind: "analytical", reference: { type: "metric_observation", id: observation.id, metricId: observation.metricId, metricVersionId: observation.versionId } } });
  }
  if (performance.now() >= deadline) throw conflict("Routine review selectors exceeded their current Source budget");
  const { periodDays: _periodDays, sources: _selectors, agenda, ...definition } = template;
  return managementReviewService(tx).create(companyId, actor, managementReviewDefinitionSchema.parse({ ...definition, period, sources,
    agenda: agenda.map(({ dueAfterDays, ...item }) => ({ ...item, dueAt: new Date(asOf.getTime() + dueAfterDays * day).toISOString() })) }), publications);
}
