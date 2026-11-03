import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authAccounts,
  authTwoFactors,
  authSessions,
  authUsers,
  closeRegisteredClients,
  companies,
  companyMemberships,
  createDb,
  documentRevisions,
  documents,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  issueDocuments,
  type Db,
} from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { HttpError } from "../errors.js";
import { issueService } from "../services/issues.js";
import { trustDocumentRoutes } from "../routes/trust-documents.js";
import { startEmbeddedPostgresTestDatabase, getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePg = support.supported ? describe.sequential : describe.skip;

async function createStandaloneTrustDocument(db: Db, companyId: string, userId: string, title: string, body: string, now: Date) {
  const documentId = randomUUID();
  const revisionId = randomUUID();
  await db.insert(documents).values({ id: documentId, companyId, title,
    format: "markdown", latestBody: body, latestRevisionId: null, latestRevisionNumber: 1,
    createdByUserId: userId, updatedByUserId: userId, sourceTrust: null, createdAt: now, updatedAt: now });
  await db.insert(documentRevisions).values({ id: revisionId, companyId, documentId, revisionNumber: 1,
    title, format: "markdown", body, createdByUserId: userId,
    payloadSourceProtocolVersion: 1, createdAt: now });
  await db.execute(sql`update document_revisions as source set payload_source_snapshot = (
    with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
      'kind','document_revision','companyId',source.company_id::text,'id',source.id::text,
      'contentHash',public.aw_native_payload_body_hash('document_revision',to_jsonb(source))),
      'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
        'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload)
    where source.id=${revisionId}::uuid`);
  await db.update(documents).set({ latestRevisionId: revisionId }).where(eq(documents.id, documentId));
  return { documentId, revisionId };
}

async function appendStandaloneTrustRevision(db: Db, companyId: string, documentId: string, userId: string,
  title: string, body: string, revisionNumber: number, now: Date) {
  const revisionId = randomUUID();
  await db.insert(documentRevisions).values({ id: revisionId, companyId, documentId, revisionNumber,
    title, format: "markdown", body, createdByUserId: userId, payloadSourceProtocolVersion: 1, createdAt: now });
  await db.execute(sql`update document_revisions as source set payload_source_snapshot = (
    with payload as (select jsonb_build_object('version',1,'owner',jsonb_build_object(
      'kind','document_revision','companyId',source.company_id::text,'id',source.id::text,
      'contentHash',public.aw_native_payload_body_hash('document_revision',to_jsonb(source))),
      'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
        'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value)
    select value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')) from payload)
    where source.id=${revisionId}::uuid`);
  await db.update(documents).set({ latestRevisionId: revisionId, latestRevisionNumber: revisionNumber,
    latestBody: body, updatedByUserId: userId, updatedAt: now }).where(eq(documents.id, documentId));
  return revisionId;
}

describePg("V10 trust document route lifecycle on PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("trust-document-routes-");
    db = createDb(database.connectionString, { maxConnections: 8 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (database) await closeRegisteredClients(database.connectionString);
    await database?.cleanup();
  }, 30_000);

  it("registers and projects a current source, records/replays explicit acceptance, then rechecks live privacy and auth after waits", async () => {
    const companyId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const legacyUserId = randomUUID();
    const legacySessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60_000);
    const email = `trust-${userId}@example.test`;
    const legacyEmail = `trust-legacy-${legacyUserId}@example.test`;

    await db.insert(companies).values({ id: companyId, name: "Trust fixture", issuePrefix: `TR${companyId.slice(0, 6)}` });
    await db.insert(authUsers).values([
      { id: userId, name: "Trust Human", email, emailVerified: true, createdAt: now, updatedAt: now },
      { id: legacyUserId, name: "Legacy Session Human", email: legacyEmail, emailVerified: true,
        createdAt: now, updatedAt: now },
    ]);
    await db.insert(authAccounts).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId,
      password: "fixture-password-hash", createdAt: now, updatedAt: now });
    const [user] = await db.select().from(authUsers).where(eq(authUsers.id, userId));
    await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), createdAt: now, updatedAt: now,
      expiresAt, authenticationMethod: "password", authenticatedAt: now, authenticatorVersion: user!.authenticatorVersion });
    await db.insert(authSessions).values({ id: legacySessionId, userId: legacyUserId, token: randomUUID(),
      createdAt: now, updatedAt: now, expiresAt });
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: legacyUserId, status: "active", membershipRole: "member" },
    ]);

    const application = express();
    application.use(express.json());
    application.use(actorMiddleware(db, {
      deploymentMode: "authenticated",
      resolveSession: async req => {
        const cookie = req.header("cookie") ?? "";
        const presentedSessionId = cookie.split(";").map(part => part.trim())
          .find(part => part.startsWith("fixture-session="))?.slice("fixture-session=".length);
        if (presentedSessionId !== sessionId && presentedSessionId !== legacySessionId) return null;
        const legacy = presentedSessionId === legacySessionId;
        const currentUserId = legacy ? legacyUserId : userId;
        const currentSessionId = presentedSessionId!;
        const [session] = await db.select().from(authSessions).where(eq(authSessions.id, currentSessionId));
        const [currentUser] = await db.select().from(authUsers).where(eq(authUsers.id, currentUserId));
        return session && currentUser
          ? { session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt },
            user: { id: currentUser.id, email: currentUser.email, name: currentUser.name } }
          : null;
      },
    }));
    application.use("/api", trustDocumentRoutes(db));
    const routeErrors: unknown[] = [];
    application.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!(error instanceof HttpError) || error.status >= 500) routeErrors.push(error);
      errorHandler(error, req, res, next);
    });
    const http = request(application);
    const docsPath = `/api/companies/${companyId}/trust/documents`;
    const acceptPath = `/api/companies/${companyId}/trust/acceptances`;
    const ownerCookie = { Cookie: `fixture-session=${sessionId}` };
    const legacyCookie = { Cookie: `fixture-session=${legacySessionId}` };
    const unrelated = await http.get(`/api/companies/${companyId}/unmatched-route`).expect(404);
    expect(unrelated.headers["cache-control"]).toBeUndefined();
    await http.get(docsPath).query({ expectedUserId: userId }).expect(403);

    // Seed canonical standalone native document revisions with valid source
    // snapshots, then register them through the real route.
    const sourceIssue = await issueService(db).create(companyId, {
      title: "Import source task", createdByUserId: userId,
    });
    const body = "Fixture body must never appear in the registry response.";
    const sourceDocument = await createStandaloneTrustDocument(db, companyId, userId, "Fixture policy", body, now);
    const noticeDocument = await createStandaloneTrustDocument(db, companyId, userId, "Notice fixture", "Notice body.", now);
    const adminDocument = await createStandaloneTrustDocument(db, companyId, userId, "Admin fixture", "Admin acknowledgment body.", now);
    const noActionDocument = await createStandaloneTrustDocument(db, companyId, userId, "No action fixture", "No action body.", now);
    const documentId = sourceDocument.documentId;
    const revisionId = sourceDocument.revisionId;
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    const [revision] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, revisionId));
    expect(revision!.payloadSourceProtocolVersion).toBe(1);
    expect(revision!.payloadSourceSnapshotInvalidated).toBe(false);
    expect(revision!.payloadSourceSnapshot).not.toBeNull();

    const effectiveAt = new Date(now.getTime() - 60_000).toISOString();
    const register = await http.post(docsPath).set(ownerCookie).send({
      expectedUserId: userId,
      documentId: document!.id,
      documentRevisionId: revision!.id,
      effectiveAt,
      evidenceRefs: ["fixture-evidence"],
      customerVisibility: "public",
      ndaRequired: false,
      lastReviewedAt: effectiveAt,
      nextReviewOrTrigger: "fixture review cycle",
      expiresAt: null,
      acceptanceRequired: true,
    }).expect(201);
    expect(register.headers["cache-control"]).toBe("private, no-store");
    expect(register.body).toMatchObject({ documentId: document!.id, documentRevisionId: revision!.id,
      version: "1", materialChangeAction: "reacceptance" });
    const registryMetadata = { expectedUserId: userId, effectiveAt, evidenceRefs: ["fixture-evidence"],
      customerVisibility: "public", ndaRequired: false, lastReviewedAt: effectiveAt,
      nextReviewOrTrigger: "fixture review cycle", expiresAt: null };
    const noticeRegister = await http.post(docsPath).set(ownerCookie).send({ ...registryMetadata,
      documentId: noticeDocument.documentId, documentRevisionId: noticeDocument.revisionId,
      materialChangeAction: "notice" }).expect(201);
    const adminRegister = await http.post(docsPath).set(ownerCookie).send({ ...registryMetadata,
      documentId: adminDocument.documentId, documentRevisionId: adminDocument.revisionId,
      materialChangeAction: "customer_admin_acknowledgment" }).expect(201);
    const noActionRegister = await http.post(docsPath).set(ownerCookie).send({ ...registryMetadata,
      documentId: noActionDocument.documentId, documentRevisionId: noActionDocument.revisionId,
      acceptanceRequired: false }).expect(201);
    expect(noticeRegister.body.materialChangeAction).toBe("notice");
    expect(adminRegister.body.materialChangeAction).toBe("customer_admin_acknowledgment");
    expect(noActionRegister.body.materialChangeAction).toBe("no_action");

    const listed = await http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId });
    const routeError = routeErrors[0];
    const errorDetail = routeError instanceof Error
      ? `${routeError.name}: ${routeError.message}\n${routeError.stack}\nCause: ${String(routeError.cause)}`
      : JSON.stringify(routeError);
    expect(listed.status, `${JSON.stringify(listed.body)}\n${errorDetail}`).toBe(200);
    expect(listed.headers["cache-control"]).toContain("no-store");
    expect(listed.body).toMatchObject({ configured: true });
    expect(listed.body.documents).toHaveLength(4);
    expect(listed.body.documents.find((row: { id: string }) => row.id === register.body.id)).toMatchObject({
      id: register.body.id, documentId: document!.id, documentRevisionId: revision!.id,
      title: "Fixture policy", version: "1", owner: userId, customerVisibility: "public",
      ndaRequired: false, materialChangeAction: "reacceptance", acceptanceRequired: true,
    });
    const projected = listed.body.documents.find((row: { id: string }) => row.id === register.body.id);
    expect(projected).not.toHaveProperty("body");
    expect(projected).not.toHaveProperty("createdByUserId");
    expect(projected).not.toHaveProperty("createdByAgentId");
    expect(projected).not.toHaveProperty("payloadSourceSnapshot");
    expect(JSON.stringify(projected)).not.toContain("Fixture body must never appear");
    const content = await http.get(`${docsPath}/${register.body.id}/content`).set(ownerCookie)
      .query({ expectedUserId: userId }).expect(200);
    expect(content.body).toMatchObject({ document: {
      id: register.body.id, documentRevisionId: revision!.id, version: "1", title: "Fixture policy",
    }, format: "markdown", body: "Fixture body must never appear in the registry response." });

    // A live provider session with no native proof remains usable at account
    // generation zero; this covers legacy/SSO semantics without an MFA gate.
    const legacyRead = await http.get(docsPath).set(legacyCookie)
      .query({ expectedUserId: legacyUserId }).expect(200);
    expect(legacyRead.body.configured).toBe(true);
    expect(legacyRead.body.documents.some((row: { id: string }) => row.id === register.body.id)).toBe(true);

    // Gated evidence is absent from the public projection and requires a
    // current administrator's exact-version, expiring Human grant.
    const gatedListPath = `/api/companies/${companyId}/trust/gated/documents`;
    const gatedContentPath = (registryEntryId: string) => `${gatedListPath}/${registryEntryId}/content`;
    const gatedGrantPath = `/api/companies/${companyId}/trust/gated/grants`;
    const gatedRevokePath = (grantReceiptId: string) => `${gatedGrantPath}/${grantReceiptId}/revoke`;
    const gatedDoc = await createStandaloneTrustDocument(db, companyId, userId, "Gated report", "Gated body fixture.", now);
    const ndaDoc = await createStandaloneTrustDocument(db, companyId, userId, "NDA report", "NDA body fixture.", now);
    const expiringDoc = await createStandaloneTrustDocument(db, companyId, userId, "Expiring report", "Expiring body fixture.", now);
    const supersededDoc = await createStandaloneTrustDocument(db, companyId, userId, "Superseded report", "Old gated body.", now);
    const privateDoc = await createStandaloneTrustDocument(db, companyId, userId, "Private-linked report", "Private linked body.", now);
    const registerGated = async (source: { documentId: string; revisionId: string }, ndaRequired = false) =>
      http.post(docsPath).set(ownerCookie).send({ ...registryMetadata, documentId: source.documentId,
        documentRevisionId: source.revisionId, customerVisibility: "gated", ndaRequired,
        materialChangeAction: "no_action" }).expect(201);
    const gatedRegister = await registerGated(gatedDoc);
    const ndaRegister = await registerGated(ndaDoc, true);
    const expiringRegister = await registerGated(expiringDoc);
    const supersededRegister = await registerGated(supersededDoc);
    const privateRegister = await registerGated(privateDoc);
    const publicProjection = await http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId }).expect(200);
    expect(publicProjection.body.documents.some((row: { id: string }) => row.id === gatedRegister.body.id)).toBe(false);
    const gatedAdminProjection = await http.get(gatedListPath).set(ownerCookie).query({ expectedUserId: userId }).expect(200);
    expect(gatedAdminProjection.body.documents.find((row: { document: { id: string } }) =>
      row.document.id === gatedRegister.body.id)).toMatchObject({ access: { state: "grant_required" } });
    expect(gatedAdminProjection.body.documents.find((row: { document: { id: string } }) =>
      row.document.id === ndaRegister.body.id)).toMatchObject({ access: {
        state: "nda_binding_unconfigured", requiredBindingOwner: "canonical_nda_agreement", receiptReference: null,
      } });
    expect((await http.get(gatedListPath).set(legacyCookie).query({ expectedUserId: legacyUserId }).expect(200))
      .body.documents).toEqual([]);
    const grantCommand = { expectedUserId: userId, requestId: randomUUID(),
      registryEntryId: gatedRegister.body.id, version: "1", granteeUserId: legacyUserId,
      expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(), surface: "fixture-gated-review" };
    const grant = await http.post(gatedGrantPath).set(ownerCookie).send(grantCommand).expect(201);
    expect(grant.headers["cache-control"]).toBe("private, no-store");
    expect(grant.body).toMatchObject({ companyId, registryEntryId: gatedRegister.body.id,
      documentRevisionId: gatedDoc.revisionId, documentVersion: "1", granteeUserId: legacyUserId,
      grantedByUserId: userId, surface: "fixture-gated-review" });
    expect(await http.post(gatedGrantPath).set(ownerCookie).send(grantCommand).expect(200).then(response => response.body))
      .toEqual(grant.body);
    await http.post(gatedGrantPath).set(legacyCookie).send({ ...grantCommand,
      expectedUserId: legacyUserId, requestId: randomUUID() }).expect(403);
    await http.post(gatedGrantPath).set(ownerCookie).send({ ...grantCommand,
      requestId: randomUUID(), granteeUserId: randomUUID() }).expect(409);
    const gatedContentQuery = { expectedUserId: legacyUserId, grantReceiptId: grant.body.id };
    const gatedContent = await http.get(gatedContentPath(gatedRegister.body.id)).set(legacyCookie)
      .query(gatedContentQuery).expect(200);
    expect(gatedContent.headers["cache-control"]).toBe("private, no-store");
    expect(gatedContent.body).toMatchObject({ grantReceiptId: grant.body.id, format: "markdown",
      body: "Gated body fixture.", document: { id: gatedRegister.body.id, ndaRequired: false, version: "1" } });
    await db.update(companies).set({ status: "suspended" }).where(eq(companies.id, companyId));
    await http.get(gatedContentPath(gatedRegister.body.id)).set(legacyCookie).query(gatedContentQuery).expect(403);
    await db.update(companies).set({ status: "active" }).where(eq(companies.id, companyId));
    expect((await http.get(gatedListPath).set(legacyCookie).query({ expectedUserId: legacyUserId }).expect(200))
      .body.documents).toMatchObject([{ access: { state: "granted", grantReceiptId: grant.body.id } }]);
    await http.get(gatedContentPath(gatedRegister.body.id)).set(legacyCookie)
      .query({ ...gatedContentQuery, grantReceiptId: randomUUID() }).expect(404);
    await http.get(`/api/companies/${randomUUID()}/trust/gated/documents/${gatedRegister.body.id}/content`)
      .set(ownerCookie).query({ expectedUserId: userId, grantReceiptId: grant.body.id }).expect(403);
    const ndaDenied = await http.post(gatedGrantPath).set(ownerCookie).send({ ...grantCommand,
      requestId: randomUUID(), registryEntryId: ndaRegister.body.id }).expect(409);
    expect(ndaDenied.body.details).toMatchObject({ code: "trust_nda_binding_unconfigured",
      state: "nda_binding_unconfigured", registryEntryId: ndaRegister.body.id,
      requiredBindingOwner: "canonical_nda_agreement", receiptReference: null });
    await http.post(gatedGrantPath).set(ownerCookie).send({ ...grantCommand,
      requestId: randomUUID(), version: "wrong" }).expect(409);

    // Revocation and expiry remove the recipient's list entry and body access.
    const revokeCommand = { expectedUserId: userId, requestId: randomUUID(),
      grantReceiptId: grant.body.id, surface: "fixture-revoke" };
    await http.post(gatedRevokePath(grant.body.id)).set(legacyCookie).send({ ...revokeCommand,
      expectedUserId: legacyUserId, requestId: randomUUID() }).expect(403);
    const revoked = await http.post(gatedRevokePath(grant.body.id)).set(ownerCookie).send(revokeCommand).expect(201);
    expect(revoked.headers["cache-control"]).toBe("private, no-store");
    expect(revoked.body).toMatchObject({ companyId, grantReceiptId: grant.body.id, revokedByUserId: userId });
    await http.post(gatedRevokePath(grant.body.id)).set(ownerCookie).send(revokeCommand).expect(200);
    await http.get(gatedContentPath(gatedRegister.body.id)).set(legacyCookie).query(gatedContentQuery).expect(404);
    const expiringGrant = await http.post(gatedGrantPath).set(ownerCookie).send({ ...grantCommand,
      requestId: randomUUID(), registryEntryId: expiringRegister.body.id,
      expiresAt: new Date(Date.now() + 1_000).toISOString() }).expect(201);
    await new Promise(resolve => setTimeout(resolve, 1_100));
    await http.get(gatedContentPath(expiringRegister.body.id)).set(legacyCookie)
      .query({ expectedUserId: legacyUserId, grantReceiptId: expiringGrant.body.id }).expect(404);

    const supersededGrant = await http.post(gatedGrantPath).set(ownerCookie).send({ ...grantCommand,
      requestId: randomUUID(), registryEntryId: supersededRegister.body.id }).expect(201);
    const supersededRevisionId = await appendStandaloneTrustRevision(db, companyId, supersededDoc.documentId,
      userId, "Superseded report v2", "New gated body.", 2, now);
    const supersedingRevision = await http.post(docsPath).set(ownerCookie).send({ ...registryMetadata,
      documentId: supersededDoc.documentId, documentRevisionId: supersededRevisionId,
      customerVisibility: "gated", ndaRequired: false, materialChangeAction: "no_action" }).expect(201);
    expect(supersedingRevision.body.documentRevisionId).toBe(supersededRevisionId);
    await http.get(gatedContentPath(supersededRegister.body.id)).set(legacyCookie)
      .query({ expectedUserId: legacyUserId, grantReceiptId: supersededGrant.body.id }).expect(404);

    const privateGrant = await http.post(gatedGrantPath).set(ownerCookie).send({ ...grantCommand,
      requestId: randomUUID(), registryEntryId: privateRegister.body.id }).expect(201);
    const gatedPrivateIssue = await issueService(db).create(companyId, {
      title: "Private gated source task", createdByUserId: userId,
    });
    await db.insert(issueDocuments).values({ companyId, issueId: gatedPrivateIssue.id,
      documentId: privateDoc.documentId, key: "gated-private-source" });
    await http.get(gatedContentPath(privateRegister.body.id)).set(legacyCookie)
      .query({ expectedUserId: legacyUserId, grantReceiptId: privateGrant.body.id }).expect(404);
    const memberGatedProjection = await http.get(gatedListPath).set(legacyCookie)
      .query({ expectedUserId: legacyUserId }).expect(200);
    expect(memberGatedProjection.body.documents.some((row: { document: { id: string } }) =>
      row.document.id === privateRegister.body.id)).toBe(false);

    const noticePath = `/api/companies/${companyId}/trust/notices/read`;
    const adminAckPath = `/api/companies/${companyId}/trust/admin-acknowledgments`;
    const noticeReadCommand = { expectedUserId: legacyUserId, requestId: randomUUID(),
      registryEntryId: noticeRegister.body.id, version: "1", surface: "fixture-notice" };
    const noticeRead = await http.post(noticePath).set(legacyCookie).send(noticeReadCommand).expect(201);
    expect(noticeRead.body).toMatchObject({ action: "notice_read", principal: legacyUserId,
      registryEntryId: noticeRegister.body.id, documentVersion: "1", surface: "fixture-notice" });
    expect(await http.post(noticePath).set(legacyCookie).send(noticeReadCommand).expect(200).then(response => response.body))
      .toEqual(noticeRead.body);
    await http.post(noticePath).set(legacyCookie).send({ ...noticeReadCommand, version: "2", requestId: randomUUID() }).expect(409);
    await http.post(adminAckPath).set(legacyCookie).send({ expectedUserId: legacyUserId, requestId: randomUUID(),
      registryEntryId: adminRegister.body.id, version: "1", surface: "fixture-admin-ack" }).expect(403);
    const adminAckCommand = { expectedUserId: userId, requestId: randomUUID(),
      registryEntryId: adminRegister.body.id, version: "1", surface: "fixture-admin-ack" };
    const adminAck = await http.post(adminAckPath).set(ownerCookie).send(adminAckCommand).expect(201);
    expect(adminAck.body).toMatchObject({ action: "customer_admin_acknowledgment", principal: userId,
      registryEntryId: adminRegister.body.id, documentVersion: "1", surface: "fixture-admin-ack" });
    await http.post(adminAckPath).set(ownerCookie).send(adminAckCommand).expect(200);
    await http.post(noticePath).set(legacyCookie).send({ expectedUserId: legacyUserId, requestId: randomUUID(),
      registryEntryId: noActionRegister.body.id, version: "1", surface: "fixture-no-action" }).expect(409);

    const requestId = randomUUID();
    const acceptanceCommand = { expectedUserId: legacyUserId, requestId,
      registryEntryId: register.body.id, version: "1", surface: "fixture-checkout" };
    const accepted = await http.post(acceptPath).set(legacyCookie).send(acceptanceCommand).expect(201);
    expect(accepted.headers["cache-control"]).toBe("private, no-store");
    expect(accepted.body).toMatchObject({ requestId, companyId, principal: legacyUserId,
      registryEntryId: register.body.id, documentRevisionId: revision!.id,
      documentVersion: "1", surface: "fixture-checkout" });
    expect(new Date(accepted.body.acceptedAt).getTime()).toBeGreaterThanOrEqual(now.getTime());
    const replay = await http.post(acceptPath).set(legacyCookie).send(acceptanceCommand).expect(200);
    expect(replay.body).toEqual(accepted.body);
    await http.post(acceptPath).set(legacyCookie)
      .send({ ...acceptanceCommand, surface: "different-fixture-surface" }).expect(409);

    // A later source-trust annotation and then a private task association both
    // suppress the already registered entry and stop new acceptance.
    await db.update(documents).set({ sourceTrust: {
      preset: "low_trust_review", disposition: "quarantined", sourceIssueId: sourceIssue.id,
    } }).where(eq(documents.id, document!.id));
    const afterSourceTrust = await http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId }).expect(200);
    expect(afterSourceTrust.body.documents.some((row: { id: string }) => row.id === register.body.id)).toBe(false);
    await http.post(acceptPath).set(legacyCookie)
      .send({ ...acceptanceCommand, requestId: randomUUID() }).expect(409);
    await db.update(documents).set({ sourceTrust: null }).where(eq(documents.id, document!.id));

    const privateIssue = await issueService(db).create(companyId, {
      title: "Private source task", createdByUserId: userId,
    });
    await db.insert(issueDocuments).values({ companyId, issueId: privateIssue.id,
      documentId: document!.id, key: "private-source" });
    const hiddenAfterLink = await http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId }).expect(200);
    expect(hiddenAfterLink.body.documents.some((row: { id: string }) => row.id === register.body.id)).toBe(false);
    await http.get(`${docsPath}/${register.body.id}/content`).set(ownerCookie)
      .query({ expectedUserId: userId }).expect(404);
    await http.post(acceptPath).set(legacyCookie)
      .send({ ...acceptanceCommand, requestId: randomUUID() }).expect(409);
    await db.delete(issueDocuments).where(eq(issueDocuments.documentId, document!.id));

    // Hold the source row so LIST's FOR UPDATE waits. The middleware has
    // already resolved an active actor; revocation during that wait must be
    // observed by the route's transaction-local company authorization.
    let release!: () => void;
    let signalReady!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { signalReady = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`select id from documents where id=${document!.id}::uuid for update`);
      signalReady();
      await released;
    });
    await ready;
    const pendingList = http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId }).then(response => response);
    let observedLockWait = false;
    try {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const [waiting] = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock'
            and query ilike '%trust_document_registry%'`);
        if ((waiting?.count ?? 0) > 0) { observedLockWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(observedLockWait).toBe(true);
      await db.update(companyMemberships).set({ status: "revoked" })
        .where(eq(companyMemberships.companyId, companyId));
    } finally {
      release();
    }
    await holder;
    const revokedList = await pendingList;
    expect(revokedList.status).toBe(403);
    await db.update(companyMemberships).set({ status: "active" })
      .where(eq(companyMemberships.companyId, companyId));

    // The original native erasure owner redacts immutable revision content and
    // clears its source snapshot, which atomically sets the server-owned
    // invalidation marker. A null snapshot after that transition is unknown,
    // never evidence that this same version became source-free.
    await db.update(documentRevisions).set({ title: "Erased learning evidence", body: "", changeSummary: null,
      payloadSourceSnapshot: null }).where(eq(documentRevisions.id, revision!.id));
    await db.update(documents).set({ title: "Erased learning evidence", latestBody: "" })
      .where(eq(documents.id, document!.id));
    const [erasedRevision] = await db.select().from(documentRevisions).where(eq(documentRevisions.id, revision!.id));
    expect(erasedRevision!.payloadSourceSnapshot).toBeNull();
    expect(erasedRevision!.payloadSourceSnapshotInvalidated).toBe(true);
    const erasedProjection = await http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId }).expect(200);
    expect(erasedProjection.body.documents.some((row: { id: string }) => row.id === register.body.id)).toBe(false);
    await http.get(`${docsPath}/${register.body.id}/content`).set(ownerCookie)
      .query({ expectedUserId: userId }).expect(404);
    await http.post(acceptPath).set(legacyCookie).send({ ...acceptanceCommand, requestId: randomUUID() }).expect(409);

    // A native factor lifecycle change clears proof and increments the
    // authenticator generation without deleting a pending session. The route
    // must reject that stale provider session while it still exists.
    await db.insert(authTwoFactors).values({ id: randomUUID(), userId,
      secret: "fixture-pending-secret", backupCodes: "fixture-pending-backup-codes", verified: false });
    const [pendingSession] = await db.select().from(authSessions).where(eq(authSessions.id, sessionId));
    expect(pendingSession).toMatchObject({ authenticationMethod: null, authenticatorVersion: null });
    await http.get(docsPath).set(ownerCookie).query({ expectedUserId: userId }).expect(403);

    // Rotate the provider credential through its original trigger owner. The
    // session is now removed; authorization cannot survive the admission-time
    // actor carrier either.
    await db.update(authAccounts).set({ password: "rotated-fixture-password" })
      .where(eq(authAccounts.userId, userId));
    await http.get(docsPath).query({ expectedUserId: userId }).expect(403);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
