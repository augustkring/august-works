import { invalidateCognitiveRecords } from "./cognitive-privacy.js";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { memoryEvidence, memoryJobs, memoryRecords, type Db } from "@paperclipai/db";
import { z } from "zod";
import { conflict, forbidden, unprocessable } from "../../errors.js";
import { memoryService, type MemoryMutationActor } from "./memory-service.js";
import { assertMemoryRecordsRetained, lockMemoryPrivacy, memoryPayloadVisible, reapplyMemoryDeletionMarkers } from "./memory-privacy.js";
import { persistActivity } from "../activity-log.js";
import { executionPrincipalSchema } from "@paperclipai/shared";

import { memoryMaintenanceInputSchema } from "../v4-api-contracts.js";
export { memoryMaintenanceInputSchema } from "../v4-api-contracts.js";

const sourceSchema = z.object({ recordIds: memoryMaintenanceInputSchema.shape.recordIds,
  proposedLesson: memoryMaintenanceInputSchema.shape.proposedLesson,
  requester: executionPrincipalSchema, recordVersions: z.record(z.string(), z.string()) }).strict();

export async function memoryMaintenanceSources(db: Db, companyId: string, recordIds: string[], actor: MemoryMutationActor) {
  if (actor.principal.type === "agent" || (actor.principal.type === "system" && actor.principal.service !== "local-board")) throw forbidden("Memory maintenance requires a board operator");
  if (!(await memoryService(db).getRetentionPolicy(companyId, actor)).canManage) throw forbidden("Memory maintenance requires a current owner or administrator");
  for (const id of recordIds) {
    const detail = await memoryService(db).getShared(companyId, id, actor);
    if (!detail || detail.record.reviewState !== "accepted" || detail.record.retentionState !== "active" || detail.record.revokedAt || detail.record.supersededByRecordId) throw unprocessable("Select active accepted shared Memory records");
  }
  const rows = await db.select().from(memoryRecords).where(and(eq(memoryRecords.companyId, companyId),
    inArray(memoryRecords.id, recordIds), memoryPayloadVisible(), isNull(memoryRecords.ownerAgentId)));
  if (rows.length !== recordIds.length) throw conflict("Memory maintenance sources changed");
  const now = Date.now();
  if (rows.some((row) => (row.expiresAt && row.expiresAt.getTime() <= now) || (row.validUntil && row.validUntil.getTime() <= now) ||
    (row.validFrom && row.validFrom.getTime() > now))) throw conflict("Maintenance sources must be currently valid and unexpired");
  return rows;
}

/** Pure native maintenance. All effects and the job receipt commit together. */
export async function executeMemoryMaintenance(db: Db, job: typeof memoryJobs.$inferSelect) {
  const source = sourceSchema.parse(job.sourceRefJson);
  await lockMemoryPrivacy(db, job.companyId);
  await assertMemoryRecordsRetained(db, job.companyId, source.recordIds);
  const records = await memoryMaintenanceSources(db, job.companyId, source.recordIds, { principal: source.requester });
  if (records.some((row) => source.recordVersions[row.id] !== row.updatedAt.toISOString())) throw conflict("Maintenance requires a fresh source snapshot");
  const now = new Date();
  let result: Record<string, unknown>;
  if (job.operationType === "index_refresh") {
    await reapplyMemoryDeletionMarkers(db, job.companyId);
    const indexes = await db.execute(sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'memory_records_search_idx'`);
    if (!indexes.length || !String(indexes[0]?.indexdef).includes("gin")) throw conflict("Native Memory search index is unavailable");
    // PostgreSQL maintains the GIN projection transactionally on each row write.
    // Refresh planner statistics after restore/maintenance; no external provider is impersonated.
    await db.execute(sql`ANALYZE memory_records`);
    result = { indexedRecordCount: records.length, provider: "native_postgres", nativeIndexCurrent: true };
  } else if (job.operationType === "dedupe") {
    const groups = new Map<string, typeof records>();
    for (const row of records) {
      // Exact reviewed claim, scope, sensitivity and validity only. No semantic merge of different claims.
      const key = JSON.stringify([row.bindingId, row.memoryType, row.scopeType, row.scopeId, row.subjectType, row.subjectId,
        row.sensitivityLabel, row.title, row.content, row.summary, row.validFrom, row.validUntil, row.expiresAt, row.retentionPolicy]);
      const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
    }
    let supersededCount = 0;
    for (const group of groups.values()) {
      group.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
      const canonical = group[0]!;
      for (const duplicate of group.slice(1)) {
        const evidence = await db.select().from(memoryEvidence).where(and(eq(memoryEvidence.companyId, job.companyId), eq(memoryEvidence.memoryRecordId, duplicate.id)));
        if (evidence.length) await db.insert(memoryEvidence).values(evidence.map(({ id: _id, memoryRecordId: _recordId, ...item }) => ({ ...item, memoryRecordId: canonical.id })));
        await db.update(memoryRecords).set({ supersededByRecordId: canonical.id, retentionState: "superseded", updatedAt: now })
          .where(and(eq(memoryRecords.companyId, job.companyId), eq(memoryRecords.id, duplicate.id), isNull(memoryRecords.supersededByRecordId)));
        await invalidateCognitiveRecords(db, job.companyId, [duplicate.id]);
        supersededCount++;
      }
    }
    result = { scannedRecordCount: records.length, supersededCount, canonicalRecordCount: groups.size };
  } else if (job.operationType === "compaction" || job.operationType === "reflection") {
    const reflection = job.operationType === "reflection";
    if (reflection && !source.proposedLesson) throw unprocessable("Reflection requires an explicit owner-proposed lesson");
    if (records.length < 2 || (!reflection && records.some((row) => !row.summary?.trim()))) throw unprocessable(reflection ? "A lesson requires at least two accepted sources" : "Compaction requires at least two accepted records with reviewed summaries");
    const first = records[0]!;
    if (records.some((row) => row.bindingId !== first.bindingId || row.scopeType !== first.scopeType || row.scopeId !== first.scopeId || row.subjectType !== first.subjectType || row.subjectId !== first.subjectId)) throw unprocessable("Selected sources must share a binding, scope and subject");
    const content = reflection ? source.proposedLesson!.content : records.map((row) => `[${row.id}] ${row.summary}`).join("\n\n");
    if (content.length > 64_000 || (!reflection && content.length >= records.reduce((sum, row) => sum + row.content.length, 0))) throw unprocessable("Reviewed summaries do not form a bounded smaller representation");
    const sensitivityRank = ["public", "internal", "confidential", "restricted"];
    const sensitivity = records.reduce((highest, row) => sensitivityRank.indexOf(row.sensitivityLabel) > sensitivityRank.indexOf(highest) ? row.sensitivityLabel : highest, first.sensitivityLabel);
    const dates = (field: "validFrom" | "validUntil" | "expiresAt") => records.flatMap((row) => row[field] ? [row[field]!.getTime()] : []);
    const from = dates("validFrom"), until = dates("validUntil"), expiry = dates("expiresAt");
    const candidate = await memoryService(db).createCandidate(job.companyId, { bindingId: first.bindingId, memoryType: reflection ? "lesson" : "observation",
      scope: { type: first.scopeType, id: first.scopeId }, subject: first.subjectType && first.subjectId ? { type: first.subjectType, id: first.subjectId } : null,
      ownerAgentId: null, title: reflection ? source.proposedLesson!.title : "Collected reviewed summaries", content, summary: null, sensitivity,
      importance: Math.max(...records.map((row) => row.importance)), confidenceScore: Math.min(...records.map((row) => row.confidenceScore)),
      validFrom: from.length ? new Date(Math.max(...from)).toISOString() : null,
      validUntil: until.length ? new Date(Math.min(...until)).toISOString() : null,
      observedAt: now.toISOString(), retentionPolicy: first.retentionPolicy,
      expiresAt: expiry.length ? new Date(Math.min(...expiry)).toISOString() : null,
      createdByOperationId: `memory-compaction:${job.jobKey}`, metadata: { sourceMemoryRecordIds: source.recordIds, maintenanceJobId: job.id },
      evidence: records.map((row) => ({ sourceClass: "accepted_memory", sourceProvider: "august_works_memory_maintenance", sourceType: "record",
        sourceRef: `memory://${row.id}`, sourceVersion: row.updatedAt.toISOString(), sourceUpdatedAt: row.updatedAt.toISOString(), observedAt: now.toISOString(),
        excerptHash: createHash("sha256").update(row.summary?.trim() ? row.summary : row.content).digest("hex"), citation: { label: "Reviewed source Memory", href: `/memory/${row.id}` }, trustLevel: "low", relation: "supports" })) }, { principal: source.requester });
    result = { proposedRecordId: candidate.record.id, reviewState: candidate.record.reviewState, sourceRecordCount: records.length };
  } else throw unprocessable("Maintenance operation is unavailable");
  const audit = await persistActivity(db, { companyId: job.companyId, actorType: source.requester.type,
    actorId: source.requester.type === "user" ? source.requester.userId : source.requester.type === "agent" ? source.requester.agentId : source.requester.service,
    action: `memory.${job.operationType}_completed`, entityType: "memory_job", entityId: job.id, details: result });
  return { result, publication: audit.publication };
}
