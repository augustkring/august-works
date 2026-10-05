import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { chatDeliveries, chatEndpoints, chatIdentityLinks, heartbeatRuns, issues, projects, workSignalCandidates, type Db } from "@paperclipai/db";
import { workSignalDecisionSchema, type WorkSignalDecisionInput, type WorkSignalView } from "@paperclipai/shared";
import { conflict, forbidden, notFound } from "../../errors.js";
import { assertAgentRunWriteAllowed } from "../../agent-run-cancellation.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, assertV7Enabled, v7HumanActorId } from "../v7-authorization.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { resolveSlackTaskAuthority, type SlackTaskBinding } from "../connectors/slack-authority.js";
import { executeGovernedSlackTool } from "../connectors/slack.js";
import { projectControlService } from "../project-control.js";
import { issueThreadInteractionService } from "../issue-thread-interactions.js";
import { interpretWorkSignals } from "./interpreter.js";

const normalizedSource = z.object({ resource: z.object({ providerResourceId: z.string().min(1) }), message: z.object({ providerMessageId: z.string().regex(/^\d+\.\d+$/) }), filtering: z.object({ contentRetained: z.boolean() }).optional() }).passthrough();
const messageResult = z.object({ messages: z.array(z.object({ ts: z.string(), text: z.string(), user: z.string().nullable().optional() })).max(1) });
const channelResult = z.object({ channel: z.object({ id: z.string(), private: z.boolean().default(false), direct: z.boolean().default(false) }) });
const gatewayResult = z.object({ data: z.unknown() });
type Row = typeof workSignalCandidates.$inferSelect;
function view(row: Row): WorkSignalView {
  const expired = row.expiresAt <= new Date();
  return { id: row.id, companyId: row.companyId, issueId: row.issueId, targetIssueId: row.targetIssueId, sourceDeliveryId: row.sourceDeliveryId, signalType: row.signalType, status: expired ? "invalidated" : row.status, version: row.version, sensitivity: row.sensitivity, confidence: row.confidence, facts: expired ? null : row.facts, proposalId: row.proposalId, interactionId: row.interactionId, followupAttempts: row.followupAttempts, followupErrorCode: row.followupErrorCode, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
}
async function sourceRevision(db: Db, companyId: string, endpointId: string, sourceEventKey: string) {
  const [latest] = await db.select({ id: chatDeliveries.id, kind: chatDeliveries.eventKind }).from(chatDeliveries).where(and(eq(chatDeliveries.companyId, companyId), eq(chatDeliveries.endpointId, endpointId), sql`${chatDeliveries.normalizedEvent}->'message'->>'targetProviderEventId'=${sourceEventKey}`)).orderBy(desc(chatDeliveries.createdAt), desc(chatDeliveries.id)).limit(1);
  if (latest?.kind === "message_deleted" || latest?.kind === "message_restored") throw conflict("Source was withdrawn; a fresh native conversation is required");
  return latest?.id ?? "original";
}

/** Uses the existing task-bound Slack gateway. No credential path, transcript
 * store, autonomous calendar updates or provider-message sender is introduced. */
export function workSignalService(db: Db) {
  async function task(tx: Db, actor: AuthorizationActor, companyId: string, issueId: string, mutate = false) {
    const [row] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("share");
    if (!row || row.hiddenAt) throw notFound("Source Task is unavailable");
    await assertV7Authorization(tx, actor, companyId, mutate ? "issue:mutate" : "issue:read", { type: "issue", companyId, issueId, projectId: row.projectId, parentIssueId: row.parentId, assigneeAgentId: row.assigneeAgentId, assigneeUserId: row.assigneeUserId, status: row.status });
    return row;
  }
  async function owner(tx: Db, actor: AuthorizationActor, row: Row) {
    if (v7HumanActorId(actor) !== row.sourceUserId) throw forbidden("Only the linked source participant can review this candidate");
    await task(tx, actor, row.companyId, row.issueId);
    if (row.targetIssueId) await task(tx, actor, row.companyId, row.targetIssueId);
    const [link] = await tx.select().from(chatIdentityLinks).where(and(eq(chatIdentityLinks.companyId, row.companyId), eq(chatIdentityLinks.endpointId, row.endpointId), eq(chatIdentityLinks.principalId, row.sourcePrincipalId), eq(chatIdentityLinks.paperclipUserId, row.sourceUserId), eq(chatIdentityLinks.status, "linked"))).for("share");
    if (!link || link.revokedAt || link.expiresAt && link.expiresAt <= new Date()) throw forbidden("The current source identity is no longer linked");
  }
  async function fresh(binding: SlackTaskBinding) {
    const authority = await resolveSlackTaskAuthority(db, binding);
    if (!authority.deliveryId || !authority.conversation) throw forbidden("Work signals require an accepted native Slack delivery");
    const [delivery] = await db.select().from(chatDeliveries).where(and(eq(chatDeliveries.companyId, binding.companyId), eq(chatDeliveries.id, authority.deliveryId), eq(chatDeliveries.endpointId, authority.endpoint.id)));
    if (!delivery || delivery.state !== "processed" || delivery.principalId !== authority.principalId || !["mention", "message", "direct_message"].includes(delivery.eventKind)) throw forbidden("The accepted source participant is required");
    const source = normalizedSource.parse(delivery.normalizedEvent);
    if (source.filtering?.contentRetained === false) throw conflict("Source content was withdrawn");
    const channel = source.resource.providerResourceId.replace(/^slack:/, "");
    const revision = await sourceRevision(db, binding.companyId, authority.endpoint.id, delivery.providerEventId);
    const info = await executeGovernedSlackTool(db, binding, "slack_channel_info", { channel });
    const threadTs = authority.conversation.externalThreadId?.split(":").at(-1);
    const read = await executeGovernedSlackTool(db, binding, "slack_message", { channel, ts: source.message.providerMessageId, ...(threadTs && /^\d+\.\d+$/.test(threadTs) ? { thread_ts: threadTs } : {}) });
    if (info.status !== "completed" || read.status !== "completed") throw forbidden("Current governed Slack read was not allowed");
    const visibility = channelResult.parse(gatewayResult.parse(info.result).data).channel, message = messageResult.parse(gatewayResult.parse(read.result).data).messages[0];
    if (!message || message.ts !== source.message.providerMessageId || message.user !== authority.slackUserId) throw conflict("The current source message is unavailable or belongs to another participant");
    const sensitivity = visibility.private || visibility.direct ? "restricted" as const : "internal" as const;
    return { authority, delivery, channel, message, revision, hash: nativeSha256({ text: message.text, user: message.user, ts: message.ts, sensitivity }), readInvocationId: read.invocationId, sensitivity };
  }
  async function retained(tx: Db, row: Row) {
    await tx.select({ id: chatEndpoints.id }).from(chatEndpoints).where(and(eq(chatEndpoints.companyId, row.companyId), eq(chatEndpoints.id, row.endpointId))).for("share");
    if (!row.sourceDeliveryId || row.invalidatedAt || row.expiresAt <= new Date()) throw conflict("Candidate source is no longer current");
    const [source] = await tx.select().from(chatDeliveries).where(and(eq(chatDeliveries.companyId, row.companyId), eq(chatDeliveries.id, row.sourceDeliveryId))).for("share");
    if (!source || (source.normalizedEvent.filtering as { contentRetained?: boolean } | undefined)?.contentRetained === false || await sourceRevision(tx, row.companyId, row.endpointId, row.sourceEventKey) !== row.sourceRevision) throw conflict("Candidate source changed; extract a fresh version");
  }
  async function currentRead(actor: AuthorizationActor, row: Row) {
    await owner(db, actor, row);
    const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, row.companyId), eq(heartbeatRuns.id, row.runId)));
    if (!run || run.status !== "running" || run.responsibleUserId !== row.sourceUserId || run.nativeIssueId !== row.issueId) throw conflict("A live continuation of the original source Task is required for a fresh Slack read");
    await assertAgentRunWriteAllowed(db, row.companyId, { agentId: run.agentId, runId: run.id });
    const source = await fresh({ companyId: row.companyId, issueId: row.issueId, agentId: run.agentId, runId: run.id, endpointId: row.endpointId });
    if (source.hash !== row.sourceHash || source.revision !== row.sourceRevision || source.authority.userId !== row.sourceUserId) throw conflict("Candidate source changed; extract a fresh version");
    return source;
  }
  async function deliverFollowups(limit = 20, companyId?: string, signalId?: string) {
    try { await assertV7Enabled(db, "proactive_followup_v7"); } catch (error) { if (error && typeof error === "object" && "status" in error && error.status === 404) return { applied: 0, failed: 0 }; throw error; }
    let applied = 0, failed = 0;
    const seen: string[] = [];
    for (let i = 0; i < Math.min(100, Math.max(1, limit)); i++) {
      const job = await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db;
        await assertV7Enabled(tx, "proactive_followup_v7");
        const [row] = await tx.select().from(workSignalCandidates).where(and(companyId ? eq(workSignalCandidates.companyId, companyId) : undefined, signalId ? eq(workSignalCandidates.id, signalId) : undefined,
          eq(workSignalCandidates.status, "review_requested"), sql`${workSignalCandidates.interactionId} is null and ${workSignalCandidates.followupAttempts}<3 and (${workSignalCandidates.followupLeaseUntil} is null or ${workSignalCandidates.followupLeaseUntil}<=now()) and aw_v7_work_source_retained(${workSignalCandidates}) and not (${workSignalCandidates.id}::text=any(select jsonb_array_elements_text(${JSON.stringify(seen)}::jsonb)))`)).orderBy(workSignalCandidates.updatedAt).limit(1).for("update", { skipLocked: true });
        if (!row) return null;
        const [claimed] = await tx.update(workSignalCandidates).set({ followupAttempts: row.followupAttempts + 1, followupLeaseUntil: new Date(Date.now() + 90_000), updatedAt: new Date() }).where(eq(workSignalCandidates.id, row.id)).returning();
        return claimed!;
      });
      if (!job) break;
      seen.push(job.id);
      // A durable human request authorizes only this native, human-only card.
      // Current access is checked again; no Slack message or agent is spawned.
      const actor: AuthorizationActor = { type: "board", source: "session", userId: job.sourceUserId, companyIds: [job.companyId] };
      try {
        await owner(db, actor, job); await task(db, actor, job.companyId, job.issueId, true); await assertV7Enabled(db, "proactive_followup_v7");
        const interaction = await issueThreadInteractionService(db).create({ id: job.issueId, companyId: job.companyId }, { kind: "request_confirmation", resolverPolicy: "human_only", continuationPolicy: "none", addresseeUserId: job.sourceUserId, idempotencyKey: `v7-work-signal:${job.id}`, title: "Work claim needs review", summary: "Review the original source and current Task evidence. Acknowledging this request does not update commitments, owners or completion.", payload: { version: 1, allowDeclineReason: true, prompt: "Review this coordination candidate in Work Signals?" } }, { userId: job.sourceUserId });
        const ack = await db.update(workSignalCandidates).set({ interactionId: interaction.id, followupErrorCode: null, followupLeaseUntil: null, updatedAt: new Date() }).where(and(eq(workSignalCandidates.companyId, job.companyId), eq(workSignalCandidates.id, job.id), eq(workSignalCandidates.followupAttempts, job.followupAttempts), eq(workSignalCandidates.status, "review_requested"))).returning({ id: workSignalCandidates.id });
        if (ack.length) applied++;
      } catch {
        failed++;
        await db.update(workSignalCandidates).set({ followupErrorCode: "native_review_delivery_failed", followupLeaseUntil: null, updatedAt: new Date() }).where(and(eq(workSignalCandidates.companyId, job.companyId), eq(workSignalCandidates.id, job.id), eq(workSignalCandidates.followupAttempts, job.followupAttempts)));
      }
    }
    return { applied, failed };
  }
  return {
    deliverFollowups,
    list: async (actor: AuthorizationActor, companyId: string) => {
      await assertV7Enabled(db, "work_signals_v7");
      const rows = await db.select().from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.sourceUserId, v7HumanActorId(actor)))).orderBy(desc(workSignalCandidates.createdAt)).limit(100);
      const result: WorkSignalView[] = [];
      for (const row of rows) { try { await owner(db, actor, row); result.push(view(row)); } catch (error) { if (error && typeof error === "object" && "status" in error && (error.status === 403 || error.status === 404)) continue; throw error; } }
      return result;
    },
    extract: async (actor: AuthorizationActor, companyId: string, issueId: string) => {
      await assertV7Enabled(db, "work_signals_v7");
      if (actor.type !== "agent" || !actor.agentId || !actor.runId || actor.companyId !== companyId) throw forbidden("Extraction requires the actual owned native Task worker");
      const [run] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.agentId, actor.agentId)));
      if (!run || run.status !== "running" || run.nativeIssueId !== issueId) throw forbidden("A live Task-bound run is required");
      await task(db, actor, companyId, issueId);
      const source = await fresh({ companyId, issueId, agentId: actor.agentId, runId: actor.runId });
      const candidates = interpretWorkSignals(source.message.text);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await assertV7Enabled(tx, "work_signals_v7"); await assertAgentRunWriteAllowed(tx, companyId, actor);
        const ownedTask = await task(tx, actor, companyId, issueId);
        if (ownedTask.assigneeAgentId !== actor.agentId || ownedTask.executionRunId && ownedTask.executionRunId !== actor.runId || ownedTask.checkoutRunId && ownedTask.checkoutRunId !== actor.runId) throw forbidden("The source Task changed its execution owner");
        const probe = { companyId, endpointId: source.authority.endpoint.id, sourceDeliveryId: source.delivery.id, sourceEventKey: source.delivery.providerEventId, sourceRevision: source.revision, invalidatedAt: null, expiresAt: new Date(Date.now() + 7 * 86_400_000) } as Row;
        await retained(tx, probe);
        const result: WorkSignalView[] = [];
        for (const candidate of candidates) {
          const [row] = await tx.insert(workSignalCandidates).values({ ...probe, issueId, sourcePrincipalId: source.authority.principalId, sourceUserId: source.authority.userId, sourceChannel: source.channel, sourceMessageId: source.message.ts, sourceHash: source.hash, runId: run.id, readInvocationId: source.readInvocationId, sensitivity: source.sensitivity, ...candidate }).onConflictDoNothing().returning();
          if (row) { result.push(view(row)); await logActivity(tx, { companyId, actorType: "agent", actorId: actor.agentId!, action: "work_signal.detected", entityType: "work_signal", entityId: row.id, details: { issueId, signalType: row.signalType, sourceDeliveryId: row.sourceDeliveryId } }, publications); }
        }
        return result;
      });
    },
    decide: async (actor: AuthorizationActor, companyId: string, id: string, action: "apply" | "ignore" | "review", raw: WorkSignalDecisionInput) => {
      const input = workSignalDecisionSchema.parse(raw); await assertV7Enabled(db, "work_signals_v7");
      const [initial] = await db.select().from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.id, id)));
      if (!initial) throw notFound("Work candidate not found");
      if (action !== "ignore") await currentRead(actor, initial); else await owner(db, actor, initial);
      const result = await withV7ActivityTransaction(db, async (tx, publications) => {
        await lockMemoryPrivacy(tx, companyId); await assertV7Enabled(tx, "work_signals_v7");
        // Native delivery admission locks the endpoint before invalidating its
        // candidates. Acquire source and identity locks before the candidate.
        if (action !== "ignore") await retained(tx, initial);
        await owner(tx, actor, initial);
        const [row] = await tx.select().from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.id, id))).for("update");
        if (!row || row.version !== input.expectedVersion || row.status !== "candidate" && !(["review", "ignore"].includes(action) && row.status === "review_requested")) throw conflict("Candidate changed; refresh before reviewing");
        let proposalId: string | null = null;
        if (action === "apply") {
          if (row.signalType !== "deadline_change" || row.confidence !== "explicit" || !row.facts?.date || row.sensitivity === "restricted") throw conflict("This signal requires a source-scoped human review; only explicit dates from shared sources can produce a Roadmap draft");
          if (!input.targetIssueId) throw conflict("Choose the existing Task explicitly; message text does not select an authorized target");
          const target = await task(tx, actor, companyId, input.targetIssueId, true);
          if (!target.projectId || target.harnessKind === "conversation") throw conflict("Bind the source to an existing project Task before proposing a deadline");
          const [project] = await tx.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.id, target.projectId)));
          if (!project) throw notFound("Project not found");
          const proposal = await projectControlService(tx).propose(actor, companyId, project.id, { expectedProjectUpdatedAt: project.updatedAt.toISOString(), changes: [{ issueId: target.id, expectedUpdatedAt: target.updatedAt.toISOString(), patch: { plannedEndAt: `${row.facts.date}T00:00:00.000Z` } }], reason: "Participant reported an explicit deadline; human planning review is required.", evidence: [`work_signal:${row.id}`] }, publications);
          proposalId = proposal.id;
        }
        if (action === "review") {
          await assertV7Enabled(tx, "proactive_followup_v7");
          await task(tx, actor, companyId, row.issueId, true);
          // One pending native follow-up per Task; repeated extraction cannot spam it.
          const [other] = await tx.select({ id: workSignalCandidates.id }).from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.issueId, row.issueId), eq(workSignalCandidates.status, "review_requested"), sql`${workSignalCandidates.id}<>${row.id} and ${workSignalCandidates.expiresAt}>now() and (${workSignalCandidates.interactionId} is null or exists(select 1 from issue_thread_interactions i where i.company_id=${companyId} and i.id=${workSignalCandidates.interactionId} and i.status='pending'))`)).limit(1);
          if (other) throw conflict("This Task already has a Work Signals follow-up; resolve it first");
        }
        const [updated] = await tx.update(workSignalCandidates).set({ status: action === "apply" ? "proposed" : action === "review" ? "review_requested" : "ignored", proposalId, targetIssueId: action === "apply" ? input.targetIssueId : row.targetIssueId, version: row.version + 1, updatedAt: new Date() }).where(eq(workSignalCandidates.id, id)).returning();
        await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action: `work_signal.${action}`, entityType: "work_signal", entityId: id, details: { issueId: row.issueId, proposalId, rationale: input.rationale } }, publications);
        return updated!;
      });
      if (action === "review") {
        await deliverFollowups(1, companyId, id);
        const [updated] = await db.select().from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.id, id)));
        return view(updated!);
      }
      return view(result);
    },
    validateProposal: async (actor: AuthorizationActor, companyId: string, proposalId: string) => {
      const [row] = await db.select().from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.proposalId, proposalId)));
      if (!row) return;
      await assertV7Enabled(db, "work_signals_v7"); await currentRead(actor, row); await retained(db, row);
    },
    pinProposalSource: async (tx: Db, actor: AuthorizationActor, companyId: string, proposalId: string) => {
      const [row] = await tx.select().from(workSignalCandidates).where(and(eq(workSignalCandidates.companyId, companyId), eq(workSignalCandidates.proposalId, proposalId)));
      if (!row) return;
      await assertV7Enabled(tx, "work_signals_v7"); await retained(tx, row); await owner(tx, actor, row);
    },
    expire: async (limit = 20) => {
      const rows = await db.execute(sql`select company_id,id from work_signal_candidates where invalidated_at is null and not aw_v7_work_source_retained(work_signal_candidates) order by expires_at limit ${Math.min(100, Math.max(1, limit))}`);
      for (const row of rows) await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await lockMemoryPrivacy(tx, String(row.company_id));
        await tx.update(workSignalCandidates).set({ facts: null, status: "invalidated", invalidatedAt: new Date(), updatedAt: new Date() }).where(and(eq(workSignalCandidates.companyId, String(row.company_id)), eq(workSignalCandidates.id, String(row.id))));
      });
      return rows.length;
    },
  };
}
