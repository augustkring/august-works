import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { memoryService } from "../../services/memory/memory-service.js";
import { issueService } from "../../services/issues.js";
import { nativeSha256 } from "../../services/native-runtime/canonical.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { accessService } from "../../services/access.js";

/** Real Original Memory approval with explicit disposable software evidence. */
export async function seedApprovedAuthoringPreference(db: Db, companyId: string, agentId: string, userId: string) {
  await instanceSettingsService(db).updateExperimental({ enableCollectiveMemoryV1: true });
  await accessService(db).setPrincipalPermission(companyId, "agent", agentId, "company_scope:read", true, userId);
  const owner = memoryService(db), actor = { principal: { type: "user" as const, userId } };
  const binding = await owner.createCompanyBinding(companyId, { key: `prefs-${randomUUID()}`, name: "Approved company preference",
    providerKey: "local", config: {}, enabled: true }, actor);
  const body = `Use concise paragraphs for the reviewed internal draft ${randomUUID()}`, observedAt = new Date().toISOString();
  const task = await issueService(db).create(companyId, { title: "Human-provided preference evidence", description: body, createdByUserId: userId });
  const candidate = await owner.createCandidate(companyId, { bindingId: binding.id, memoryType: "preference", scope: { type: "company", id: null },
    subject: null, ownerAgentId: null, title: "Concise internal drafts", content: body, summary: null, sensitivity: "internal",
    importance: 50, confidenceScore: 1, validFrom: null, validUntil: null, observedAt, retentionPolicy: "approved_work_preference",
    expiresAt: new Date(Date.now()+86400000).toISOString(), createdByOperationId: randomUUID(), metadata: {}, evidence: [{
      sourceClass: "task", sourceProvider: "august_works_tasks", sourceType: "issue", sourceRef: `issue://${task.id}`,
      sourceVersion: task.updatedAt.toISOString(), sourceUpdatedAt: task.updatedAt.toISOString(), observedAt,
      excerptHash: nativeSha256(body), citation: { label: task.title }, trustLevel: "high", relation: "supports" }] }, actor);
  await owner.reviewCandidate(companyId, candidate.record.id, { decision: "accept", reason: "Human reviewed the organizational preference" }, actor);
  return { id: candidate.record.id, body, taskId: task.id };
}
