import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { analyticalLineageEdges, analyticalLineageManifests, managementReviewSnapshots, managementReviewSourceLinks, managementReviewManifestDependencies, managementReviewEvents, type Db } from "@paperclipai/db";
import { managementReviewDefinitionSchema, publishManagementReviewSchema, recordManagementReviewEventSchema, v7FeatureEnabled, v8FeatureEnabled, type ManagementReviewDefinition, type ManagementReviewView } from "@paperclipai/shared";
import type { AuthorizationActor } from "../authorization.js";
import { conflict, notFound } from "../../errors.js";
import { assertV7Authorization, v7HumanActorId } from "../v7-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
import { nativeSha256 } from "../native-runtime/canonical.js";
import { signDecisionSpec, verifyDecisionSpec } from "../decision-signing.js";
import { withV7ActivityTransaction, logActivity } from "../v7-mutations.js";
import { captureManagementSources } from "./capture.js";
import { composeManagementReview } from "./kernel.js";
import { inspectAnalyticalEvidenceAuthority } from "../analytical-evidence.js";
type Row = typeof managementReviewSnapshots.$inferSelect;
const LIMIT = 20065;
async function admit(tx: Db, companyId: string, actor: AuthorizationActor, write = false, requireFlags = true) {
  v7HumanActorId(actor); await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  await lockAnalyticalCompany(tx, companyId); await lockMemoryPrivacy(tx, companyId); await tx.execute(sql`set local statement_timeout='8s'`);
  await assertV7Authorization(tx, actor, companyId, write ? "users:manage_permissions" : "company_scope:read");
  if (requireFlags) { const flags = await instanceSettingsService(tx).getExperimental(); if (!v8FeatureEnabled(flags, "management_reviews_v8") || !v7FeatureEnabled(flags, "governance_evidence_v7")) throw notFound("Governed management reviews are not enabled"); }
}
async function root(tx: Db, companyId: string, id: string, lock = false) { const query = tx.select().from(managementReviewSnapshots).where(and(eq(managementReviewSnapshots.companyId, companyId), eq(managementReviewSnapshots.id, id))); const [row] = await (lock ? query.for("update") : query.for("share")); if (!row) throw notFound("Management review is unavailable"); return row; }
function proof(row: Pick<Row, "id" | "companyId" | "definition" | "sources" | "packet" | "contentHash" | "createdBy" | "createdAt" | "expiresAt">, edges: unknown, links: unknown, dependencies: string[]) { return { domain: "aw-management-review:v1", id: row.id, companyId: row.companyId, definitionHash: nativeSha256(row.definition), sourcesHash: nativeSha256(row.sources), contentHash: row.contentHash, packetHash: nativeSha256(row.packet), author: row.createdBy, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), lineageHash: nativeSha256(edges), primitiveHash: nativeSha256(links), dependencyHash: nativeSha256(dependencies) }; }
function publication(row: Row) { return { domain: "aw-management-publication:v1", id: row.id, companyId: row.companyId, contentHash: row.contentHash, publishedBy: row.publishedBy, publishedAt: row.publishedAt?.toISOString(), rationaleHash: nativeSha256(row.publicationRationale), supersedesId: row.supersedesId }; }
async function retained(tx: Db, companyId: string, actor: AuthorizationActor, row: Row): Promise<ManagementReviewView> {
  const definition = managementReviewDefinitionSchema.parse(row.definition);
  const [manifest] = await tx.select().from(analyticalLineageManifests).where(and(eq(analyticalLineageManifests.companyId, companyId), eq(analyticalLineageManifests.id, row.lineageManifestId))).for("share");
  if (!manifest || row.expiresAt <= new Date() || manifest.expiresAt.getTime() !== row.expiresAt.getTime() || manifest.createdAt.getTime() !== row.createdAt.getTime() || manifest.analysisType !== "management_review_snapshot" || manifest.analysisRef !== row.id || manifest.engineVersion !== "aw-native-management-skeleton-v1" || manifest.inputHash !== row.packet.inputHash || manifest.definitionHash !== row.packet.definitionHash) throw notFound("Management historical source manifest is unavailable");
  const edges = (await tx.select().from(analyticalLineageEdges).where(and(eq(analyticalLineageEdges.companyId, companyId), eq(analyticalLineageEdges.manifestId, manifest.id))).limit(LIMIT + 1)).map(({ inputType, inputRef, inputHash, relationship }) => ({ inputType, inputRef, inputHash, relationship })).sort((a, b) => `${a.inputType}:${a.inputRef}`.localeCompare(`${b.inputType}:${b.inputRef}`));
  const links = (await tx.select().from(managementReviewSourceLinks).where(and(eq(managementReviewSourceLinks.companyId, companyId), eq(managementReviewSourceLinks.reviewId, row.id))).limit(LIMIT + 1)).map(({ sourceType, sourceRef, sourceHash }) => ({ sourceType, sourceRef, sourceHash })).sort((a, b) => `${a.sourceType}:${a.sourceRef}`.localeCompare(`${b.sourceType}:${b.sourceRef}`));
  const dependencies = (await tx.select().from(managementReviewManifestDependencies).where(and(eq(managementReviewManifestDependencies.companyId, companyId), eq(managementReviewManifestDependencies.reviewId, row.id))).limit(LIMIT + 1)).map(dep => dep.sourceManifestId).sort();
  if (edges.length > LIMIT || links.length > LIMIT || dependencies.length > LIMIT || manifest.sourceCount !== edges.length || manifest.parameters.primitiveCount !== links.length || manifest.parameters.dependencyCount !== dependencies.length || manifest.parameters.signature !== row.signature || !verifyDecisionSpec(proof(row, edges, links, dependencies), row.signature)) throw notFound("Management signed historical source receipt is unavailable");
  const replay = composeManagementReview(definition, row.sources, row.createdAt.toISOString());
  if (replay.contentHash !== row.contentHash || nativeSha256(replay) !== nativeSha256(row.packet)) throw notFound("Management deterministic original source replay is unavailable");
  if (row.status !== "draft" && (!row.publicationSignature || !verifyDecisionSpec(publication(row), row.publicationSignature))) throw notFound("Management human publication receipt is unavailable");
  await inspectAnalyticalEvidenceAuthority(tx, companyId, actor, edges, performance.now() + 30000);
  // Resolve all current source purpose/ACL/native roots before disclosing any
  // original prose. Native lifecycle changes mark history, never rewrite it.
  const eventRows = await tx.select().from(managementReviewEvents).where(and(eq(managementReviewEvents.companyId, companyId), eq(managementReviewEvents.reviewId, row.id))).orderBy(asc(managementReviewEvents.ordinal)).limit(101);
  if (eventRows.length > 100) throw notFound("Management bounded event history is unavailable");
  const events = eventRows.map((event, index) => {
    const material = { id: event.id, companyId, reviewId: row.id, itemKey: event.itemKey, event: event.event, rationale: event.rationale, recordedBy: event.recordedBy, recordedAt: event.recordedAt.toISOString(), ordinal: event.ordinal, interpretation: "human_reported_event" as const };
    if (event.ordinal !== index + 1 || event.contentHash !== nativeSha256(material) || !verifyDecisionSpec({ domain: "aw-management-event:v1", contentHash: event.contentHash, ...material }, event.signature)) throw notFound("Management human event receipt is unavailable");
    return { id: material.id, itemKey: material.itemKey, event: material.event, rationale: material.rationale, recordedBy: material.recordedBy, recordedAt: material.recordedAt, ordinal: material.ordinal, interpretation: material.interpretation };
  });
  const current = await captureManagementSources(tx, companyId, actor, definition);
  const fresh = composeManagementReview(definition, current.sources, current.asOf.toISOString());
  return { id: row.id, companyId, status: row.status, definition, sources: row.sources, packet: row.packet, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), publishedBy: row.publishedBy, publishedAt: row.publishedAt?.toISOString() ?? null, currentQualification: fresh.inputHash === row.packet.inputHash ? "current" : "needs_revalidation", events };
}
export function managementReviewService(db: Db) {
  return {
    async controls(companyId: string, actor: AuthorizationActor, cursor?: string) { return db.transaction(async raw => { const tx = raw as unknown as Db; await admit(tx, companyId, actor, false, false); const rows = await tx.select({ id: managementReviewSnapshots.id, status: managementReviewSnapshots.status, createdAt: managementReviewSnapshots.createdAt, expiresAt: managementReviewSnapshots.expiresAt }).from(managementReviewSnapshots).where(and(eq(managementReviewSnapshots.companyId, companyId), cursor ? sql`${managementReviewSnapshots.id}>${cursor}::uuid` : undefined)).orderBy(asc(managementReviewSnapshots.id)).limit(21); return { items: rows.slice(0, 20).map(row => ({ ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() })), nextCursor: rows.length > 20 ? rows[19]!.id : null, coverage: "bounded_native_review_metadata" as const }; }); },
    async detail(companyId: string, actor: AuthorizationActor, id: string) { return db.transaction(async raw => { const tx = raw as unknown as Db; await admit(tx, companyId, actor); return retained(tx, companyId, actor, await root(tx, companyId, id)); }); },
    async create(companyId: string, actor: AuthorizationActor, raw: ManagementReviewDefinition) {
      const definition = managementReviewDefinitionSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const captured = await captureManagementSources(tx, companyId, actor, definition), packet = composeManagementReview(definition, captured.sources, captured.asOf.toISOString());
        if (new TextEncoder().encode(JSON.stringify(captured.sources)).length > 512000) throw conflict("Management original evidence exceeds the 512 KB retained source budget");
        const id = randomUUID(), lineageManifestId = randomUUID(), createdBy = v7HumanActorId(actor), material = { id, companyId, definition, sources: captured.sources, packet, contentHash: packet.contentHash, createdBy, createdAt: captured.asOf, expiresAt: captured.expiresAt }, signature = signDecisionSpec(proof(material, captured.edges, captured.links, captured.dependencies));
        await tx.insert(analyticalLineageManifests).values({ id: lineageManifestId, companyId, analysisType: "management_review_snapshot", analysisRef: id, engineVersion: packet.engineVersion, inputHash: packet.inputHash, definitionHash: packet.definitionHash, requestedBy: createdBy, sourceWatermark: captured.asOf.toISOString(), sourceCount: captured.edges.length, parameters: { signature, primitiveCount: captured.links.length, dependencyCount: captured.dependencies.length }, createdAt: captured.asOf, expiresAt: captured.expiresAt });
        for (let offset = 0; offset < captured.edges.length; offset += 500) await tx.insert(analyticalLineageEdges).values(captured.edges.slice(offset, offset + 500).map(edge => ({ ...edge, companyId, manifestId: lineageManifestId })));
        await tx.insert(managementReviewSnapshots).values({ ...material, lineageManifestId, signature, status: "draft" });
        for (let offset = 0; offset < captured.links.length; offset += 500) await tx.insert(managementReviewSourceLinks).values(captured.links.slice(offset, offset + 500).map(link => ({ ...link, companyId, reviewId: id })));
        for (let offset = 0; offset < captured.dependencies.length; offset += 500) await tx.insert(managementReviewManifestDependencies).values(captured.dependencies.slice(offset, offset + 500).map(sourceManifestId => ({ companyId, reviewId: id, sourceManifestId })));
        await logActivity(tx, { companyId, actorType: "user", actorId: createdBy, action: "management_review.drafted", entityType: "management_review", entityId: id, details: { contentHash: packet.contentHash } }, publications);
        return { id, companyId, status: "draft" as const, contentHash: packet.contentHash };
      });
    },
    async publish(companyId: string, actor: AuthorizationActor, id: string, raw: unknown) {
      const input = publishManagementReviewSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const row = await root(tx, companyId, id, true), view = await retained(tx, companyId, actor, row);
        if (row.status !== "draft" || row.contentHash !== input.expectedContentHash || view.currentQualification !== "current") throw conflict("Management review changed; capture and review a fresh packet before publication");
        if (input.supersedesId) { const prior = await root(tx, companyId, input.supersedesId, true); await retained(tx, companyId, actor, prior); if (prior.status !== "published" || prior.id === id) throw conflict("The explicit previous review must be currently published"); }
        const publishedBy = v7HumanActorId(actor), publishedAt = new Date(), next = { ...row, publishedBy, publishedAt, publicationRationale: input.rationale, supersedesId: input.supersedesId }, publicationSignature = signDecisionSpec(publication(next));
        await tx.update(managementReviewSnapshots).set({ status: "published", publishedBy, publishedAt, publicationRationale: input.rationale, publicationSignature, supersedesId: input.supersedesId }).where(and(eq(managementReviewSnapshots.companyId, companyId), eq(managementReviewSnapshots.id, id)));
        if (input.supersedesId) await tx.update(managementReviewSnapshots).set({ status: "superseded" }).where(and(eq(managementReviewSnapshots.companyId, companyId), eq(managementReviewSnapshots.id, input.supersedesId)));
        await logActivity(tx, { companyId, actorType: "user", actorId: publishedBy, action: "management_review.published", entityType: "management_review", entityId: id, details: { contentHash: row.contentHash, supersedesId: input.supersedesId } }, publications);
        return { id, companyId, status: "published" as const, contentHash: row.contentHash };
      });
    },
    async recordEvent(companyId: string, actor: AuthorizationActor, id: string, raw: unknown) {
      const input = recordManagementReviewEventSchema.parse(raw);
      return withV7ActivityTransaction(db, async (tx, publications) => {
        await admit(tx, companyId, actor, true); const row = await root(tx, companyId, id, true); await retained(tx, companyId, actor, row);
        if (row.status === "draft" || row.contentHash !== input.expectedContentHash || !row.definition.agenda.some(item => item.key === input.itemKey)) throw conflict("Human review event requires an exact published agenda item");
        const prior = await tx.select({ id: managementReviewEvents.id }).from(managementReviewEvents).where(and(eq(managementReviewEvents.companyId, companyId), eq(managementReviewEvents.reviewId, id))).limit(101); if (prior.length >= 100) throw conflict("Management review reached the bounded event history limit");
        const recordedBy = v7HumanActorId(actor), eventId = randomUUID(), recordedAt = new Date(), ordinal = prior.length + 1, material = { id: eventId, companyId, reviewId: id, itemKey: input.itemKey, event: input.event, rationale: input.rationale, recordedBy, recordedAt: recordedAt.toISOString(), ordinal, interpretation: "human_reported_event" }, contentHash = nativeSha256(material), signature = signDecisionSpec({ domain: "aw-management-event:v1", contentHash, ...material });
        await tx.insert(managementReviewEvents).values({ ...material, recordedAt, contentHash, signature });
        await logActivity(tx, { companyId, actorType: "user", actorId: recordedBy, action: "management_review.human_event", entityType: "management_review", entityId: id, details: { eventId, ordinal, event: input.event } }, publications);
        return { id: eventId, reviewId: id, ordinal, event: input.event, interpretation: "human_reported_event" as const };
      });
    },
  };
}
