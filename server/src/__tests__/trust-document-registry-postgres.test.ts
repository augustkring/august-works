import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeRegisteredClients,
  companies,
  createDb,
  documentRevisions,
  documents,
  trustDocumentAcceptances,
  trustDocumentActionReceipts,
  trustDocumentAccessGrants,
  trustDocumentAccessRevocations,
  trustDocumentRegistry,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

describePg("trust document acceptance receipt retention", () => {
  let db: ReturnType<typeof createDb>;
  let connectionString = "";
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const database = await startEmbeddedPostgresTestDatabase("paperclip-trust-documents-");
    connectionString = database.connectionString;
    db = createDb(connectionString);
    cleanup = database.cleanup;
  }, 30_000);

  afterAll(async () => {
    if (connectionString) await closeRegisteredClients(connectionString);
    await cleanup?.();
  });

  it("rejects direct receipt edits/deletes and permits only company-erasure cascade", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Trust test", issuePrefix: `T${companyId.slice(0, 6)}` });
    const [receipt] = await db.insert(trustDocumentAcceptances).values({
      companyId,
      registryEntryId: randomUUID(),
      documentRevisionId: randomUUID(),
      principalUserId: "human-1",
      documentVersion: "1",
      requestId: randomUUID(),
      requestHash: "a".repeat(64),
      surface: "contract-review",
    }).returning();

    await expect(db.update(trustDocumentAcceptances).set({ surface: "forged" })
      .where(eq(trustDocumentAcceptances.id, receipt.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.delete(trustDocumentAcceptances)
      .where(eq(trustDocumentAcceptances.id, receipt.id))).rejects.toMatchObject({ cause: { code: "55000" } });

    await db.delete(companies).where(eq(companies.id, companyId));
    expect(await db.select().from(trustDocumentAcceptances)
      .where(eq(trustDocumentAcceptances.companyId, companyId))).toHaveLength(0);
  });

  it("keeps notice/admin-action receipts immutable and protects registry action semantics", async () => {
    const companyId = randomUUID();
    const documentId = randomUUID();
    const revisionId = randomUUID();
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Action test", issuePrefix: `A${companyId.slice(0, 6)}` });
    await db.insert(documents).values({ id: documentId, companyId, latestBody: "fixture", latestRevisionNumber: 1,
      createdByUserId: "owner", updatedByUserId: "owner" });
    await db.insert(documentRevisions).values({ id: revisionId, companyId, documentId, revisionNumber: 1,
      body: "fixture", createdByUserId: "owner" });
    const [registry] = await db.insert(trustDocumentRegistry).values({ companyId, documentId,
      documentRevisionId: revisionId, owner: "owner", version: "1", effectiveAt: now,
      customerVisibility: "public", lastReviewedAt: now, materialChangeAction: "notice",
      acceptanceRequired: false, createdByUserId: "owner" }).returning();
    const [receipt] = await db.insert(trustDocumentActionReceipts).values({ companyId,
      registryEntryId: registry.id, documentRevisionId: revisionId, principalUserId: "human-1",
      documentVersion: "1", action: "notice_read", requestId: randomUUID(),
      requestHash: "b".repeat(64), surface: "fixture-notice" }).returning();

    await expect(db.update(trustDocumentActionReceipts).set({ surface: "forged" })
      .where(eq(trustDocumentActionReceipts.id, receipt.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.delete(trustDocumentActionReceipts)
      .where(eq(trustDocumentActionReceipts.id, receipt.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.update(trustDocumentRegistry).set({ materialChangeAction: "no_action" })
      .where(eq(trustDocumentRegistry.id, registry.id))).rejects.toMatchObject({ cause: { code: "55000" } });

    await db.delete(companies).where(eq(companies.id, companyId));
    expect(await db.select().from(trustDocumentActionReceipts)
      .where(eq(trustDocumentActionReceipts.companyId, companyId))).toHaveLength(0);
  });

  it("keeps exact gated grants and separate revocation receipts append-only", async () => {
    const companyId = randomUUID();
    const documentId = randomUUID();
    const revisionId = randomUUID();
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Gated access test", issuePrefix: `G${companyId.slice(0, 6)}` });
    await db.insert(documents).values({ id: documentId, companyId, latestBody: "fixture", latestRevisionNumber: 1,
      createdByUserId: "owner", updatedByUserId: "owner" });
    await db.insert(documentRevisions).values({ id: revisionId, companyId, documentId, revisionNumber: 1,
      body: "fixture", createdByUserId: "owner" });
    const [registry] = await db.insert(trustDocumentRegistry).values({ companyId, documentId,
      documentRevisionId: revisionId, owner: "owner", version: "1", effectiveAt: now,
      customerVisibility: "gated", ndaRequired: false, lastReviewedAt: now,
      materialChangeAction: "no_action", acceptanceRequired: false, createdByUserId: "owner" }).returning();
    const [grant] = await db.insert(trustDocumentAccessGrants).values({ companyId,
      registryEntryId: registry.id, documentRevisionId: revisionId, documentVersion: "1",
      granteeUserId: "member", grantedByUserId: "owner", expiresAt: new Date(now.getTime() + 60_000),
      requestId: randomUUID(), requestHash: "c".repeat(64), surface: "fixture-gated" }).returning();
    const [revocation] = await db.insert(trustDocumentAccessRevocations).values({ companyId,
      grantReceiptId: grant.id, revokedByUserId: "owner", requestId: randomUUID(),
      requestHash: "d".repeat(64), surface: "fixture-revoke" }).returning();
    await expect(db.update(trustDocumentAccessGrants).set({ surface: "forged" })
      .where(eq(trustDocumentAccessGrants.id, grant.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.delete(trustDocumentAccessGrants)
      .where(eq(trustDocumentAccessGrants.id, grant.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.update(trustDocumentAccessRevocations).set({ surface: "forged" })
      .where(eq(trustDocumentAccessRevocations.id, revocation.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(db.delete(trustDocumentAccessRevocations)
      .where(eq(trustDocumentAccessRevocations.id, revocation.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    await db.delete(companies).where(eq(companies.id, companyId));
    expect(await db.select().from(trustDocumentAccessGrants)
      .where(eq(trustDocumentAccessGrants.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(trustDocumentAccessRevocations)
      .where(eq(trustDocumentAccessRevocations.companyId, companyId))).toHaveLength(0);
  });
});
