import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  assets,
  companies,
  closeRegisteredClients,
  companyMemberships,
  createDb,
  issueAttachments,
  issueComments,
  issueReferenceMentions,
  issues,
} from "@paperclipai/db";
import {
  companySearchQuerySchema,
  LOW_TRUST_REVIEW_PRESET,
} from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { companySearchService } from "../services/company-search.js";
import type { NativeCommentSourceCapture } from "../services/agent-conversations.js";
import { buildPaperclipWakePayload } from "../services/heartbeat.js";
import { nativeCommentProjectionHash } from "../services/native-runtime/canonical.js";
import { issueReferenceService } from "../services/issue-references.js";
import { issueService } from "../services/issues.js";
import { buildLowTrustSourceTrust, LOW_TRUST_QUARANTINED_BODY } from "../services/source-trust.js";
import type { StorageService } from "../storage/types.js";

const externalTestDatabaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL;
const embeddedPostgresSupport = externalTestDatabaseUrl
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported
  ? describe.sequential
  : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue comment redaction tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("deleted issue comment redaction", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<
    ReturnType<typeof startEmbeddedPostgresTestDatabase>
  > | null = null;

  beforeAll(async () => {
    if (externalTestDatabaseUrl) {
      db = createDb(externalTestDatabaseUrl);
    } else {
      tempDb = await startEmbeddedPostgresTestDatabase(
        "paperclip-comment-redaction-",
      );
      db = createDb(tempDb.connectionString);
    }
    await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm"));
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueReferenceMentions);
    await db.delete(issueAttachments);
    await db.delete(issueComments);
    await db.delete(assets);
    await db.delete(issues);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    if (externalTestDatabaseUrl) {
      await closeRegisteredClients(externalTestDatabaseUrl);
    }
    await tempDb?.cleanup();
  });

  async function seedIssue() {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Comment Redaction Co",
      issuePrefix: `R${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier: "RED-1",
      title: "Deleted comment redaction",
      status: "todo",
      priority: "medium",
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "board-user-1",
      status: "active",
      membershipRole: "owner",
      updatedAt: new Date(),
    });
    return { companyId, issueId };
  }

  function createApp(companyId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "board-user-1",
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "owner", status: "active" }],
        source: "cloud_tenant",
        // cloud_tenant actors are never instance admins — reads flow through
        // the active company membership seeded in seedIssue().
        isInstanceAdmin: false,
      };
      next();
    });
    const storage: StorageService = {
      provider: "local_disk",
      putFile: vi.fn(async () => {
        throw new Error("Unexpected storage.putFile call");
      }),
      getObject: vi.fn(async () => {
        throw new Error("Unexpected storage.getObject call");
      }),
      headObject: vi.fn(async () => ({ exists: false })),
      deleteObject: vi.fn(async () => undefined),
    };
    app.use("/api", issueRoutes(db, storage));
    app.use(errorHandler);
    return app;
  }

  it("captures only selected inline comment renditions with their frozen sources, preserving unknown and deleted history", async () => {
    const { companyId, issueId } = await seedIssue();
    const [known] = await db.insert(issueComments).values({ companyId, issueId, body: "Selected known comment",
      authorUserId: "board-user-1", metadata: { version: 1, sections: [{ rows: [{ type: "text", text: "Selected metadata" }] }] }, payloadSourceProtocolVersion: 1 }).returning();
    // Canonical structural fixture, not native producer or permission proof.
    const [sealed] = await db.execute<{ snapshot: Record<string, unknown> }>(sql`with content as (
      select jsonb_build_object('version',1,'owner',jsonb_build_object('kind','comment','companyId',company_id,'id',id,
        'contentHash',public.aw_native_payload_body_hash('comment',to_jsonb(c))),
        'policy',jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,'runIds','[]'::jsonb,
          'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb) as value from issue_comments c where id=${known!.id}::uuid)
      update issue_comments set payload_source_snapshot=value || jsonb_build_object('digest',encode(sha256(convert_to(value::text,'UTF8')),'hex')),
        updated_at='2026-10-23T01:02:03.123456Z'::timestamptz from content where id=${known!.id}::uuid returning payload_source_snapshot as snapshot`);
    const [quarantined] = await db.insert(issueComments).values({ companyId, issueId, body: "QUARANTINED_PRIVATE_COMMENT",
      authorUserId: "board-user-1", metadata: { version: 1, sections: [{ rows: [{ type: "text", text: "QUARANTINED_PRIVATE_METADATA" }] }] }, sourceTrust: buildLowTrustSourceTrust({ issueId }) }).returning();
    const [long] = await db.insert(issueComments).values({ companyId, issueId, body: "L".repeat(6000), authorUserId: "board-user-1" }).returning();
    const [deleted] = await db.insert(issueComments).values({ companyId, issueId, body: "DELETED_COMMENT_BODY", deletedAt: new Date(), authorUserId: "board-user-1" }).returning();
    const foreign = { companyId: randomUUID(), issueId: randomUUID() };
    await db.insert(companies).values({ id: foreign.companyId, name: "Other source company", issuePrefix: randomUUID() });
    await db.insert(issues).values({ id: foreign.issueId, companyId: foreign.companyId, title: "Other source Task" });
    const [foreignComment] = await db.insert(issueComments).values({ ...foreign, body: "FOREIGN_COMMENT_BODY", authorUserId: "board-user-1" }).returning();
    const input = { db, companyId, contextSnapshot: { issueId, wakeReason: "issue_commented",
      wakeCommentIds: [known!.id, quarantined!.id, long!.id, deleted!.id, foreignComment!.id, randomUUID()] } };
    const normal = await buildPaperclipWakePayload(input);
    const captures: NativeCommentSourceCapture[] = [];
    const payload = (await buildPaperclipWakePayload({ ...input, onInlineCommentSourceCapture: capture => captures.push(capture) }))!;
    expect(payload).toEqual(normal);
    expect(captures.map(capture => capture.input.commentId)).toEqual([known!.id, quarantined!.id, long!.id]);
    const versions = await db.execute<{ id: string; version: string }>(sql`select id,extract(epoch from updated_at)::text as version from issue_comments where company_id=${companyId}::uuid`);
    const byId = new Map(versions.map(row => [row.id, row.version]));
    for (const [index, capture] of captures.entries()) {
      const comment = payload.comments.find(comment => comment.id === capture.input.commentId)!;
      expect(capture).toEqual({ input: { kind: "comment", issueId, commentId: comment.id, sourceVersion: byId.get(String(comment.id)),
        contentHash: nativeCommentProjectionHash({ body: comment.body, presentation: comment.presentation, metadata: comment.metadata }) },
        payloadSourceSnapshot: index === 0 ? sealed!.snapshot : null });
      expect(comment).not.toHaveProperty("payloadSourceSnapshot");
      expect(comment).not.toHaveProperty("sourceVersion");
    }
    expect(captures[0]!.input.sourceVersion).toMatch(/123456$/);
    expect(payload.comments.find(comment => comment.id === quarantined!.id)!.body).toBe(LOW_TRUST_QUARANTINED_BODY);
    expect(String(payload.comments.find(comment => comment.id === long!.id)!.body)).toHaveLength(4000);
    expect(JSON.stringify(payload)).not.toContain("FOREIGN_COMMENT_BODY");
    expect(JSON.stringify(payload)).not.toContain("DELETED_COMMENT_BODY");
    expect(JSON.stringify(payload)).not.toContain("QUARANTINED_PRIVATE_COMMENT");
    const retained = structuredClone(captures);
    await db.update(issueComments).set({ body: "Later changed comment", payloadSourceSnapshot: null, updatedAt: new Date() }).where(eq(issueComments.id, known!.id));
    expect(captures).toEqual(retained);
    const later: NativeCommentSourceCapture[] = [];
    await buildPaperclipWakePayload({ ...input, onInlineCommentSourceCapture: capture => later.push(capture) });
    expect(later[0]!.payloadSourceSnapshot).toBeNull();
    expect(later[0]!.input.contentHash).not.toBe(retained[0]!.input.contentHash);
  });

  it("captures only the body-budgeted inline comment prefix and preserves the explicit fallback state", async () => {
    const { companyId, issueId } = await seedIssue();
    const comments = await db.insert(issueComments).values(Array.from({ length: 4 }, (_, index) => ({ companyId, issueId,
      body: String(index).repeat(6000), authorUserId: "board-user-1" }))).returning();
    const captures: NativeCommentSourceCapture[] = [];
    const payload = (await buildPaperclipWakePayload({ db, companyId, contextSnapshot: { issueId, wakeReason: "issue_commented",
      wakeCommentIds: comments.map(comment => comment.id) }, onInlineCommentSourceCapture: capture => captures.push(capture) }))!;
    expect(payload.comments).toHaveLength(3);
    expect(captures.map(capture => capture.input.commentId)).toEqual(comments.slice(0, 3).map(comment => comment.id));
    expect(payload.truncated).toBe(true);
    expect(payload.fallbackFetchNeeded).toBe(true);
    expect(captures.every(capture => capture.payloadSourceSnapshot === null)).toBe(true);
  });

  it("redacts deleted comment bodies from ordinary reads, heartbeat context, and wake payloads", async () => {
    const { companyId, issueId } = await seedIssue();
    const commentId = randomUUID();
    const deletedAt = new Date("2026-06-03T12:00:00.000Z");
    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorUserId: "board-user-1",
      body: "secret deleted body",
      presentation: { kind: "system_notice", tone: "warning" },
      metadata: {
        version: 1,
        sections: [{ rows: [{ type: "text", text: "secret metadata" }] }],
      },
      deletedAt,
      deletedByType: "user",
      deletedByUserId: "board-user-1",
    });

    const comments = await issueService(db).listComments(issueId, {
      order: "asc",
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: commentId,
      body: "",
      presentation: null,
      metadata: null,
      deletedAt,
      deletedByType: "user",
      deletedByUserId: "board-user-1",
    });

    const exactComment = await issueService(db).getComment(commentId);
    expect(exactComment?.body).toBe("");
    expect(exactComment?.metadata).toBeNull();

    const heartbeatContext = await request(createApp(companyId))
      .get(`/api/issues/${issueId}/heartbeat-context`)
      .query({ wakeCommentId: commentId });
    expect(heartbeatContext.status, JSON.stringify(heartbeatContext.body)).toBe(
      200,
    );
    expect(heartbeatContext.body.wakeComment).toMatchObject({
      id: commentId,
      body: "",
      metadata: null,
      deletedByUserId: "board-user-1",
    });
    expect(JSON.stringify(heartbeatContext.body)).not.toContain(
      "secret deleted body",
    );
    expect(JSON.stringify(heartbeatContext.body)).not.toContain(
      "secret metadata",
    );

    const wakePayload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        commentId,
        wakeCommentIds: [commentId],
        wakeReason: "issue_commented",
      },
    });

    expect(wakePayload?.comments).toEqual([
      expect.objectContaining({
        id: commentId,
        body: "",
        bodyTruncated: false,
        presentation: null,
        metadata: null,
        deletedAt: deletedAt.toISOString(),
        deletedByUserId: "board-user-1",
      }),
    ]);
    expect(JSON.stringify(wakePayload)).not.toContain("secret deleted body");
    expect(JSON.stringify(wakePayload)).not.toContain("secret metadata");
  });

  it("never includes a same-company comment from another issue in a wake payload", async () => {
    const { companyId, issueId } = await seedIssue();
    const foreignIssueId = randomUUID();
    await db.insert(issues).values({
      id: foreignIssueId,
      companyId,
      identifier: "RED-2",
      title: "Foreign issue",
      status: "todo",
      priority: "medium",
    });
    const [sourceComment, foreignComment] = await db
      .insert(issueComments)
      .values([
        {
          companyId,
          issueId,
          authorUserId: "board-user-1",
          body: "Full external instruction. TRAILING-CLAUSE: keep this exact requirement.",
        },
        {
          companyId,
          issueId: foreignIssueId,
          authorUserId: "board-user-1",
          body: "FOREIGN-ISSUE-SECRET must never cross the task boundary",
        },
      ])
      .returning();

    const wakePayload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        wakeCommentId: sourceComment!.id,
        wakeCommentIds: [sourceComment!.id, foreignComment!.id],
        wakeReason: "issue_commented",
      },
    });

    expect(wakePayload?.comments).toEqual([
      expect.objectContaining({
        id: sourceComment!.id,
        issueId,
        body: "Full external instruction. TRAILING-CLAUSE: keep this exact requirement.",
        bodyTruncated: false,
      }),
    ]);
    expect(wakePayload?.commentWindow).toEqual({
      requestedCount: 2,
      includedCount: 1,
      missingCount: 1,
    });
    expect(JSON.stringify(wakePayload)).not.toContain("FOREIGN-ISSUE-SECRET");
  });

  it("includes bounded attachment descriptors only for requested comments in the same company and issue", async () => {
    const { companyId, issueId } = await seedIssue();
    const otherIssueId = randomUUID();
    const otherCompanyId = randomUUID();
    const otherCompanyIssueId = randomUUID();
    await db.insert(companies).values({
      id: otherCompanyId,
      name: "Other Attachment Co",
      issuePrefix: "OAT",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values([
      {
        id: otherIssueId,
        companyId,
        identifier: "RED-ATT-2",
        title: "Other attachment issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: otherCompanyIssueId,
        companyId: otherCompanyId,
        identifier: "OAT-1",
        title: "Other company attachment issue",
        status: "todo",
        priority: "medium",
      },
    ]);
    const [
      sourceComment,
      unrequestedComment,
      quarantinedComment,
      otherIssueComment,
      otherCompanyComment,
    ] = await db
      .insert(issueComments)
      .values([
        {
          companyId,
          issueId,
          authorUserId: "board-user-1",
          body: "Inspect the attached evidence.",
        },
        {
          companyId,
          issueId,
          authorUserId: "board-user-1",
          body: "Same task, not part of this wake.",
        },
        {
          companyId,
          issueId,
          body: "Quarantined file instructions.",
          sourceTrust: {
            preset: LOW_TRUST_REVIEW_PRESET,
            disposition: "quarantined",
            sourceIssueId: issueId,
          },
        },
        {
          companyId,
          issueId: otherIssueId,
          authorUserId: "board-user-1",
          body: "Other task.",
        },
        {
          companyId: otherCompanyId,
          issueId: otherCompanyIssueId,
          authorUserId: "other-user",
          body: "Other company.",
        },
      ])
      .returning();
    const attachmentFixtures = [
      {
        companyId,
        issueId,
        issueCommentId: sourceComment!.id,
        filename: "evidence.png",
      },
      {
        companyId,
        issueId,
        issueCommentId: unrequestedComment!.id,
        filename: "same-task-unrequested.txt",
      },
      {
        companyId,
        issueId,
        issueCommentId: quarantinedComment!.id,
        filename: "quarantined.txt",
      },
      {
        companyId,
        issueId: otherIssueId,
        issueCommentId: otherIssueComment!.id,
        filename: "other-task.txt",
      },
      {
        companyId: otherCompanyId,
        issueId: otherCompanyIssueId,
        issueCommentId: otherCompanyComment!.id,
        filename: "other-company.txt",
      },
    ];
    for (const [index, fixture] of attachmentFixtures.entries()) {
      const [asset] = await db
        .insert(assets)
        .values({
          companyId: fixture.companyId,
          provider: "local_disk",
          objectKey: `wake-attachment-${index}`,
          contentType: index === 0 ? "image/png" : "text/plain",
          byteSize: index === 0 ? 2048 : 128,
          sha256: `sha-${index}`,
          originalFilename: fixture.filename,
          createdByUserId: "board-user-1",
        })
        .returning();
      await db.insert(issueAttachments).values({
        companyId: fixture.companyId,
        issueId: fixture.issueId,
        issueCommentId: fixture.issueCommentId,
        assetId: asset!.id,
      });
    }

    const wakePayload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        wakeCommentIds: [
          sourceComment!.id,
          sourceComment!.id,
          quarantinedComment!.id,
          otherIssueComment!.id,
          otherCompanyComment!.id,
        ],
        wakeReason: "issue_commented",
      },
    });

    expect(wakePayload?.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sourceComment!.id,
          attachments: [
            expect.objectContaining({
              filename: "evidence.png",
              contentType: "image/png",
              byteSize: 2048,
            }),
          ],
        }),
        expect.objectContaining({ id: quarantinedComment!.id }),
      ]),
    );
    expect(
      wakePayload?.comments.find(
        (comment) => comment.id === quarantinedComment!.id,
      ),
    ).not.toHaveProperty("attachments");
    expect(JSON.stringify(wakePayload)).not.toContain(
      "same-task-unrequested.txt",
    );
    expect(JSON.stringify(wakePayload)).not.toContain("other-task.txt");
    expect(JSON.stringify(wakePayload)).not.toContain("other-company.txt");
    expect(JSON.stringify(wakePayload)).not.toContain("quarantined.txt");

    const lowTrustWakePayload = await buildPaperclipWakePayload({
      db,
      companyId,
      contextSnapshot: {
        issueId,
        wakeCommentIds: [quarantinedComment!.id],
        wakeReason: "issue_commented",
      },
      exposeLowTrustRaw: true,
    });
    expect(lowTrustWakePayload?.comments).toEqual([
      expect.objectContaining({
        id: quarantinedComment!.id,
        attachments: [
          expect.objectContaining({ filename: "quarantined.txt" }),
        ],
      }),
    ]);
  });

  it("serializes comment timestamps as ISO strings through the redacted comments route (PAP-16607)", async () => {
    const { companyId, issueId } = await seedIssue();
    const commentId = randomUUID();
    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorUserId: "board-user-1",
      body: "ordinary comment",
    });

    const response = await request(createApp(companyId)).get(
      `/api/issues/${issueId}/comments`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toHaveLength(1);
    // Secret redaction must not collapse Date instances to `{}` — the chat
    // renderer needs parseable timestamps.
    expect(typeof response.body[0].createdAt).toBe("string");
    expect(Number.isNaN(new Date(response.body[0].createdAt).getTime())).toBe(
      false,
    );
    expect(typeof response.body[0].updatedAt).toBe("string");
  });

  it("excludes deleted comment bodies from company search", async () => {
    const { companyId, issueId } = await seedIssue();
    await db.insert(issueComments).values({
      companyId,
      issueId,
      body: "vanished-search-needle",
      deletedAt: new Date("2026-06-03T12:00:00.000Z"),
      deletedByType: "user",
      deletedByUserId: "board-user-1",
    });

    const result = await companySearchService(db).search(
      companyId,
      companySearchQuerySchema.parse({
        q: "vanished-search-needle",
        scope: "comments",
      }),
    );

    expect(result.results).toEqual([]);
  });

  it("clears issue references sourced from deleted comment bodies", async () => {
    const companyId = randomUUID();
    const sourceIssueId = randomUUID();
    const targetIssueId = randomUUID();
    const commentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Reference Redaction Co",
      issuePrefix: "REF",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values([
      {
        id: sourceIssueId,
        companyId,
        identifier: "REF-1",
        title: "Source issue",
        status: "todo",
        priority: "medium",
      },
      {
        id: targetIssueId,
        companyId,
        identifier: "REF-2",
        title: "Target issue",
        status: "todo",
        priority: "medium",
      },
    ]);
    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId: sourceIssueId,
      body: "Follow up in REF-2",
    });

    const refs = issueReferenceService(db);
    await refs.syncComment(commentId);
    expect(
      (await refs.listIssueReferenceSummary(sourceIssueId)).outbound.map(
        (item) => item.issue.id,
      ),
    ).toEqual([targetIssueId]);

    await db.update(issueComments).set({
      deletedAt: new Date("2026-06-03T12:00:00.000Z"),
      deletedByType: "user",
      deletedByUserId: "board-user-1",
    });
    await refs.syncComment(commentId);

    expect(
      (await refs.listIssueReferenceSummary(sourceIssueId)).outbound,
    ).toEqual([]);
  });
});
