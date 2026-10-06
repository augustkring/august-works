import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { companyMemberships, issues, projectGoals, projectMilestones, strategyExecutionLinks, strategyExecutionLinkVersions, strategyExecutionLinkApprovals, strategyExecutionSourceBindings, type Db } from "@paperclipai/db";
import { approveStrategyExecutionLinkSchema, createStrategyExecutionLinkSchema, retireStrategyExecutionLinkSchema, reviseStrategyExecutionLinkSchema, strategyExecutionLinkDefinitionSchema, v7FeatureEnabled, v8FeatureEnabled, type ApproveStrategyExecutionLink, type CreateStrategyExecutionLink, type RetireStrategyExecutionLink, type ReviseStrategyExecutionLink, type StrategyExecutionLinkDefinition, type StrategyExecutionLinkView } from "@paperclipai/shared";
import { conflict, notFound } from "../../errors.js";
import type { AuthorizationActor } from "../authorization.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { currentAnalyticalPurpose } from "../analytical-purpose.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { logActivity, withV7ActivityTransaction } from "../v7-mutations.js";
import { authorizeStrategyReference, strategyReferenceId, validateCurrentStrategyReference } from "./references.js";

type Link = typeof strategyExecutionLinks.$inferSelect;
type Version = typeof strategyExecutionLinkVersions.$inferSelect;
const DAY = 86_400_000;
function view(row: Link, status: StrategyExecutionLinkView["status"] = row.status): StrategyExecutionLinkView {
  return { id: row.id, companyId: row.companyId, revision: row.revision, status, approvedVersionId: row.approvedVersionId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function versionView(row: Version) {
  return { id: row.id, companyId: row.companyId, linkId: row.linkId, revision: row.revision, definition: row.definition, contentHash: row.contentHash, createdAt: row.createdAt.toISOString(), nextReviewAt: row.nextReviewAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
}
export function strategyExecutionService(db: Db) {
  async function boundary(tx: Db, companyId: string, actor: AuthorizationActor, write = false, flagsRequired = true) {
    v7HumanActorId(actor);
    await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
    const flags = await instanceSettingsService(tx).getExperimental();
    if (flagsRequired && (!v8FeatureEnabled(flags, "strategy_execution_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7"))) throw notFound("Governed strategy execution is not enabled");
    await tx.execute(sql`set local statement_timeout='8s'`);
    await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
  }
  async function root(tx: Db, companyId: string, id: string, write = false) {
    const query = tx.select().from(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), eq(strategyExecutionLinks.id, id)));
    const [row] = await (write ? query.for("update") : query.for("share"));
    if (!row) throw notFound("Strategy link not found");
    const erased = await tx.execute<{ erased: boolean }>(sql`select aw_strategy_source_erased(${companyId}::uuid,${id}::uuid) as erased`);
    if (erased[0]?.erased) throw notFound("Strategy source was erased");
    return row;
  }
  async function version(tx: Db, companyId: string, linkId: string, id: string) {
    const [row] = await tx.select().from(strategyExecutionLinkVersions).where(and(eq(strategyExecutionLinkVersions.companyId, companyId), eq(strategyExecutionLinkVersions.linkId, linkId), eq(strategyExecutionLinkVersions.id, id))).for("share");
    if (!row || !strategyExecutionLinkDefinitionSchema.safeParse(row.definition).success || nativeSha256(row.definition) !== row.contentHash) throw conflict("Strategy version integrity is unavailable");
    if (row.expiresAt <= new Date()) throw notFound("Strategy version retention expired");
    return row;
  }
  function fixed(row: Link, definition: StrategyExecutionLinkDefinition) {
    if (row.fromType !== definition.from.type || row.fromRef !== strategyReferenceId(definition.from) || row.toType !== definition.to.type || row.toRef !== strategyReferenceId(definition.to) || row.relationship !== definition.relationship) throw conflict("A revision cannot move native strategy endpoints or relationship; create a separate link");
  }
  async function authority(tx: Db, companyId: string, actor: AuthorizationActor, definition: StrategyExecutionLinkDefinition) {
    const from = await authorizeStrategyReference(tx, companyId, actor, definition.from, definition.sensitivity);
    const to = await authorizeStrategyReference(tx, companyId, actor, definition.to, definition.sensitivity);
    await currentAnalyticalPurpose(tx, companyId, definition, "strategy");
    return { issueIds: [...new Set([...from.issueIds, ...to.issueIds])], projectIds: [...new Set([...from.projectIds, ...to.projectIds])] };
  }
  async function executionOwnership(tx: Db, companyId: string, definition: StrategyExecutionLinkDefinition) {
    if (definition.relationship !== "advanced_by") return;
    const { from, to } = definition;
    let goalId: string | null = null, projectId: string | null = null, milestoneId: string | null = null;
    if (to.type === "issue") {
      const [row] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, to.id)));
      goalId = row?.goalId ?? null; projectId = row?.projectId ?? null; milestoneId = row?.milestoneId ?? null;
    } else if (to.type === "milestone") {
      const [row] = await tx.select().from(projectMilestones).where(and(eq(projectMilestones.companyId, companyId), eq(projectMilestones.id, to.id)));
      goalId = row?.goalId ?? null; projectId = row?.projectId ?? null;
    } else if (to.type === "project") projectId = to.id;
    if (from.type === "goal" && goalId !== from.id) {
      const [binding] = projectId ? await tx.select().from(projectGoals).where(and(eq(projectGoals.companyId, companyId), eq(projectGoals.goalId, from.id), eq(projectGoals.projectId, projectId))).for("share") : [];
      if (!binding) throw conflict("Execution relationship requires existing native Goal ownership; it cannot assign work");
    }
    if (from.type === "project" && projectId !== from.id || from.type === "milestone" && milestoneId !== from.id) throw conflict("Execution relationship differs from native project or milestone ownership");
  }
  async function current(tx: Db, companyId: string, actor: AuthorizationActor, pin: Pick<Version, "definition" | "nextReviewAt">) {
    const now = new Date();
    if (pin.nextReviewAt <= now) throw conflict("Strategy link requires its scheduled human review");
    if (pin.definition.ownerUserId !== v7HumanActorId(actor)) {
      const [owner] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, pin.definition.ownerUserId), eq(companyMemberships.status, "active"))).for("share");
      if (!owner) throw conflict("Strategy link owner is no longer a current company human");
    }
    await validateCurrentStrategyReference(tx, companyId, actor, pin.definition.from, now);
    await validateCurrentStrategyReference(tx, companyId, actor, pin.definition.to, now);
    await executionOwnership(tx, companyId, pin.definition);
  }
  async function dependencyCycle(tx: Db, companyId: string, definition: StrategyExecutionLinkDefinition, omitId?: string) {
    if (definition.relationship !== "depends_on") return;
    const rows = await tx.select().from(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), eq(strategyExecutionLinks.status, "active"), eq(strategyExecutionLinks.relationship, "depends_on"))).limit(10_001);
    if (rows.length > 10_000) throw conflict("Dependency graph exceeds this bounded native review; no partial cycle claim is published");
    const edges = new Map<string, string[]>();
    for (const row of rows) if (row.id !== omitId) { const key = `${row.fromType}:${row.fromRef}`; edges.set(key, [...(edges.get(key) ?? []), `${row.toType}:${row.toRef}`]); }
    const desired = `${definition.from.type}:${strategyReferenceId(definition.from)}`;
    const pending = [`${definition.to.type}:${strategyReferenceId(definition.to)}`], visited = new Set<string>();
    while (pending.length) { const item = pending.pop()!; if (item === desired) throw conflict("Dependency would create a cycle"); if (!visited.has(item)) { visited.add(item); pending.push(...(edges.get(item) ?? [])); } }
  }
  async function audit(tx: Db, publications: Parameters<typeof logActivity>[2], companyId: string, actor: AuthorizationActor, action: string, id: string, details: Record<string, unknown>) {
    await logActivity(tx, { companyId, actorType: "user", actorId: v7HumanActorId(actor), action, entityType: "strategy_execution_link", entityId: id, details }, publications);
  }
  async function addVersion(tx: Db, companyId: string, actor: AuthorizationActor, linkId: string, revision: number, definition: StrategyExecutionLinkDefinition) {
    const ancestry = await authority(tx, companyId, actor, definition);
    const createdAt = new Date();
    const proposed = { definition, nextReviewAt: new Date(createdAt.getTime() + definition.reviewFrequencyDays * DAY) };
    await current(tx, companyId, actor, proposed);
    const [row] = await tx.insert(strategyExecutionLinkVersions).values({ companyId, linkId, revision, definition, contentHash: nativeSha256(definition), createdBy: v7HumanActorId(actor), createdAt, nextReviewAt: proposed.nextReviewAt, expiresAt: new Date(createdAt.getTime() + definition.retentionDays * DAY) }).returning();
    const bindings = [...ancestry.issueIds.map(issueId => ({ companyId, linkId, issueId })), ...ancestry.projectIds.map(projectId => ({ companyId, linkId, projectId }))];
    if (bindings.length) await tx.insert(strategyExecutionSourceBindings).values(bindings).onConflictDoNothing();
    return row;
  }
  async function inspect(tx: Db, companyId: string, actor: AuthorizationActor, row: Link) {
    const pins = await tx.select().from(strategyExecutionLinkVersions).where(and(eq(strategyExecutionLinkVersions.companyId, companyId), eq(strategyExecutionLinkVersions.linkId, row.id))).orderBy(desc(strategyExecutionLinkVersions.revision)).limit(101);
    const currentPin = row.approvedVersionId ? await version(tx, companyId, row.id, row.approvedVersionId) : pins[0] && await version(tx, companyId, row.id, pins[0].id);
    if (!currentPin) throw conflict("Strategy link has no retained definition");
    const retained = pins.slice(0, 100).filter(pin => pin.expiresAt > new Date());
    await authority(tx, companyId, actor, currentPin.definition);
    for (const pin of retained) {
      await version(tx, companyId, row.id, pin.id); fixed(row, pin.definition);
      await authorizeStrategyReference(tx, companyId, actor, pin.definition.from, pin.definition.sensitivity);
      await authorizeStrategyReference(tx, companyId, actor, pin.definition.to, pin.definition.sensitivity);
      // Historical policy references are immutable provenance, not a current
      // grant. The effective version's current purpose must cover retained
      // history too, including its sensitivity and retention.
      await currentAnalyticalPurpose(tx, companyId, { ...currentPin.definition, sensitivity: pin.definition.sensitivity, retentionDays: Math.max(currentPin.definition.retentionDays, pin.definition.retentionDays) }, "strategy");
    }
    if (row.approvedVersionId) {
      const [receipt] = await tx.select().from(strategyExecutionLinkApprovals).where(and(eq(strategyExecutionLinkApprovals.companyId, companyId), eq(strategyExecutionLinkApprovals.linkId, row.id), eq(strategyExecutionLinkApprovals.versionId, currentPin.id))).for("share");
      if (!receipt) throw conflict("Strategy approval evidence is unavailable");
    }
    let reviewReason: string | null = null;
    if (row.status === "active") try { await current(tx, companyId, actor, currentPin); } catch (error) {
      if (!error || typeof error !== "object" || !("status" in error) || error.status !== 409) throw error;
      reviewReason = "The approved source, native ownership or review period changed; human review is required";
    }
    return { link: view(row, reviewReason ? "needs_review" : row.status), effectiveVersion: versionView(currentPin), versions: retained.map(versionView), hasMoreVersions: pins.length > 100, reviewReason };
  }
  return {
    async list(companyId: string, actor: AuthorizationActor, cursor?: string) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await boundary(tx, companyId, actor);
        const rows = await tx.select().from(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), cursor ? sql`${strategyExecutionLinks.id}>${cursor}::uuid` : undefined)).orderBy(asc(strategyExecutionLinks.id)).limit(101);
        const items = [];
        for (const row of rows.slice(0, 100)) try { await root(tx, companyId, row.id); const detail = await inspect(tx, companyId, actor, row); items.push({ ...detail.link, definition: detail.effectiveVersion.definition, reviewReason: detail.reviewReason, nextReviewAt: detail.effectiveVersion.nextReviewAt, expiresAt: detail.effectiveVersion.expiresAt }); } catch (error) { if (!error || typeof error !== "object" || !("status" in error) || ![403,404,409].includes(Number(error.status))) throw error; }
        return { items, nextCursor: rows.length > 100 ? rows[99].id : null, coverage: "bounded_current_authorized_page" as const };
      });
    },
    async detail(companyId: string, actor: AuthorizationActor, id: string) {
      return db.transaction(async rawTx => { const tx = rawTx as unknown as Db; await boundary(tx, companyId, actor); return inspect(tx, companyId, actor, await root(tx, companyId, id)); });
    },
    async create(companyId: string, actor: AuthorizationActor, raw: CreateStrategyExecutionLink) {
      const input = createStrategyExecutionLinkSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true); await authority(tx, companyId, actor, input.definition);
        const [row] = await tx.insert(strategyExecutionLinks).values({ companyId, fromType: input.definition.from.type, fromRef: strategyReferenceId(input.definition.from), toType: input.definition.to.type, toRef: strategyReferenceId(input.definition.to), relationship: input.definition.relationship, createdBy: v7HumanActorId(actor) }).returning();
        const pin = await addVersion(tx, companyId, actor, row.id, 1, input.definition);
        await audit(tx, publications, companyId, actor, "strategy_link.created", row.id, { versionId: pin.id, contentHash: pin.contentHash });
        return { link: view(row), version: versionView(pin) };
      });
    },
    async revise(companyId: string, actor: AuthorizationActor, id: string, raw: ReviseStrategyExecutionLink) {
      const input = reviseStrategyExecutionLinkSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true); const row = await root(tx, companyId, id, true);
        if (row.revision !== input.expectedRevision || row.status === "retired") throw conflict("Strategy link changed; refresh before revising");
        fixed(row, input.definition);
        const pin = await addVersion(tx, companyId, actor, id, row.revision + 1, input.definition);
        await tx.update(strategyExecutionLinks).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(strategyExecutionLinks.id, id));
        await audit(tx, publications, companyId, actor, "strategy_link.version_created", id, { versionId: pin.id, contentHash: pin.contentHash }); return versionView(pin);
      });
    },
    async approve(companyId: string, actor: AuthorizationActor, id: string, raw: ApproveStrategyExecutionLink) {
      const input = approveStrategyExecutionLinkSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true); const row = await root(tx, companyId, id, true);
        if (row.revision !== input.expectedRevision || row.status === "retired" || row.approvedVersionId === input.versionId) throw conflict("Strategy link changed or approval was already recorded");
        const pin = await version(tx, companyId, id, input.versionId); fixed(row, pin.definition);
        await authority(tx, companyId, actor, pin.definition); await current(tx, companyId, actor, pin); await dependencyCycle(tx, companyId, pin.definition, id);
        await tx.insert(strategyExecutionLinkApprovals).values({ companyId, linkId: id, versionId: pin.id, approvedBy: v7HumanActorId(actor), rationale: input.rationale }).onConflictDoNothing();
        const [updated] = await tx.update(strategyExecutionLinks).set({ status: "active", approvedVersionId: pin.id, revision: row.revision + 1, updatedAt: new Date() }).where(eq(strategyExecutionLinks.id, id)).returning();
        await audit(tx, publications, companyId, actor, "strategy_link.approved", id, { versionId: pin.id, contentHash: pin.contentHash }); return view(updated);
      });
    },
    async retire(companyId: string, actor: AuthorizationActor, id: string, raw: RetireStrategyExecutionLink) {
      const input = retireStrategyExecutionLinkSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await boundary(tx, companyId, actor, true, false); const row = await root(tx, companyId, id, true);
        if (row.revision !== input.expectedRevision || row.status === "retired") throw conflict("Strategy link changed; refresh before retirement");
        const pins = await tx.select().from(strategyExecutionLinkVersions).where(and(eq(strategyExecutionLinkVersions.companyId, companyId), eq(strategyExecutionLinkVersions.linkId, id))).orderBy(desc(strategyExecutionLinkVersions.revision)).limit(1);
        if (pins[0]) { await authorizeStrategyReference(tx, companyId, actor, pins[0].definition.from, pins[0].definition.sensitivity); await authorizeStrategyReference(tx, companyId, actor, pins[0].definition.to, pins[0].definition.sensitivity); }
        const [updated] = await tx.update(strategyExecutionLinks).set({ status: "retired", revision: row.revision + 1, updatedAt: new Date() }).where(eq(strategyExecutionLinks.id, id)).returning();
        await audit(tx, publications, companyId, actor, "strategy_link.retired", id, { rationaleHash: nativeSha256(input.rationale) }); return view(updated);
      });
    },
    /** Native retention worker; admission is owned by its scheduler, not HTTP. */
    async eraseExpired(companyId: string, now = new Date()) {
      return db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
        await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId);
        const pins = await tx.select({ linkId: strategyExecutionLinkVersions.linkId }).from(strategyExecutionLinkVersions).where(and(eq(strategyExecutionLinkVersions.companyId, companyId), lte(strategyExecutionLinkVersions.expiresAt, now))).limit(100);
        if (!pins.length) return 0;
        return (await tx.delete(strategyExecutionLinks).where(and(eq(strategyExecutionLinks.companyId, companyId), inArray(strategyExecutionLinks.id, pins.map(pin => pin.linkId)))).returning({ id: strategyExecutionLinks.id })).length;
      });
    },
    /** Internal bounded sweep, including paused companies and disabled features.
     * Oldest retained expiry is served first; each company erases at most 100 roots. */
    async sweepExpired(now = new Date()) {
      const due = await db.transaction(async rawTx => {
        const tx = rawTx as unknown as Db; await tx.execute(sql`set local statement_timeout='8s'`);
        return tx.select({ companyId: strategyExecutionLinkVersions.companyId }).from(strategyExecutionLinkVersions)
          .where(lte(strategyExecutionLinkVersions.expiresAt, now)).groupBy(strategyExecutionLinkVersions.companyId)
          .orderBy(sql`min(${strategyExecutionLinkVersions.expiresAt})`, asc(strategyExecutionLinkVersions.companyId)).limit(21);
      });
      let erased = 0;
      for (const company of due.slice(0, 20)) erased += await this.eraseExpired(company.companyId, now);
      return { checkedCompanies: Math.min(due.length, 20), erasedLinks: erased, hasMoreCompanies: due.length > 20 };
    },
  };
}
