import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { heartbeatRuns, issueComments } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { nativeCommentProjectionHash } from "../services/native-runtime/canonical.js";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { withManagedNativeHeartbeatFixture } from "./helpers/managed-native-heartbeat-fixture.js";
import { qualifiedOpenCodeBinary, makeFixtureTreeWritable } from "./helpers/managed-native-opencode-e2e-fixture.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof import("@paperclipai/db").createDb>;
let root = "";
beforeAll(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  root = await mkdtemp(join(tmpdir(), "managed-native-conversation-followup-"));
  vi.stubEnv("PAPERCLIP_HOME", root);
  database = await startEmbeddedPostgresTestDatabase("managed-native-conversation-followup-");
  const { createDb } = await import("@paperclipai/db");
  db = createDb(database.connectionString, { maxConnections: 3 });
}, 60_000);
afterAll(async () => {
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (root) await makeFixtureTreeWritable(root).then(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
}, 30_000);

it("runs a Human chat follow-up as one source-bound Native successor with both comments preserved", async () => {
  const binary = qualifiedOpenCodeBinary();
  if (!binary) throw new Error("qualified_opencode_binary_unavailable");
  let human: { app: import("express").Express; humanCookie: string } | null = null;
  let companyId = "", agentId = "", issueId = "";
  let firstCommentId = "";
  let injectedCommentIds: string[] = [];
  let followupsPosted = false;
  const callRuns: string[] = [];
  const promptTextByRun = new Map<string, string[]>();

  await withManagedNativeHeartbeatFixture({ db, root, opencodeBinary: binary, timeoutSec: 300, schedulerMode: "serial",
    providerReply: ({ body, runId }) => {
      callRuns.push(runId);
      const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
      const text = messages.flatMap(message => typeof message.content === "string" ? [message.content]
        : Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>)
          .flatMap(part => typeof part.text === "string" ? [part.text] : []) : []).join("\n");
      promptTextByRun.set(runId, [...(promptTextByRun.get(runId) ?? []), text]);
      return { stop_reason: "end_turn", content: [{ type: "text", text: "I received this message and can continue." }] };
    },
    beforeProviderResponse: async ({ run, issueId: activeIssueId, companyId: activeCompanyId }) => {
      if (activeIssueId !== issueId || activeCompanyId !== companyId || followupsPosted) return;
      followupsPosted = true;
      if (run.status !== "running") throw new Error("native_followup_injection_run_not_active");
      if (!human) throw new Error("native_followup_current_human_session_missing");
      for (const body of ["Please include the first follow-up.", "Please include the second follow-up."]) {
        const sent = await request(human.app).post(`/api/issues/${issueId}/comments`)
          .set("cookie", human.humanCookie).set("Origin", "http://localhost")
          .send({ body, clientRequestId: randomUUID() });
        if (sent.status !== 201 || typeof sent.body?.id !== "string")
          throw new Error(`native_followup_comment_failed_${sent.status}`);
        injectedCommentIds.push(sent.body.id);
      }
    },
    driveScheduler: async ({ actor, companyId: currentCompany, agentId: currentAgent, heartbeat, humanApi, factsForRun }) => {
      if (!actor.userId) throw new Error("native_followup_current_human_missing");
      companyId = currentCompany;
      agentId = currentAgent;
      human = humanApi;
      const opened = await request(humanApi.app).post(`/api/companies/${companyId}/chats/${agentId}`)
        .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost");
      expect(opened.status).toBe(200);
      expect(typeof opened.body?.id).toBe("string");
      issueId = opened.body.id;
      const first = await request(humanApi.app).post(`/api/issues/${issueId}/comments`)
        .set("cookie", humanApi.humanCookie).set("Origin", "http://localhost")
        .send({ body: "Please answer this first chat turn.", clientRequestId: randomUUID() });
      expect(first.status).toBe(201);
      firstCommentId = first.body.id;

      await heartbeat.resumeQueuedRuns();
      await heartbeat.drainActiveRunExecutions();
      // The first response commits the deferred Human comments to the normal
      // queue. Re-enter the canonical scheduler; no Run or receipt is seeded.
      await heartbeat.resumeQueuedRuns();
      await heartbeat.drainActiveRunExecutions();
      await heartbeat.resumeQueuedRuns();
      await heartbeat.drainActiveRunExecutions();

      expect(followupsPosted).toBe(true);
      expect(injectedCommentIds).toHaveLength(2);
      const persistedComments = await db.select({ id: issueComments.id, authorUserId: issueComments.authorUserId,
        body: issueComments.body, presentation: issueComments.presentation, metadata: issueComments.metadata,
        payloadSourceSnapshot: issueComments.payloadSourceSnapshot, payloadSourceSnapshotInvalidated: issueComments.payloadSourceSnapshotInvalidated })
        .from(issueComments).where(and(eq(issueComments.companyId, companyId),
        eq(issueComments.issueId, issueId), inArray(issueComments.id, injectedCommentIds)))
        .orderBy(issueComments.createdAt, issueComments.id);
      expect(persistedComments.map(row => row.id)).toEqual(injectedCommentIds);
      expect(persistedComments.every(row => row.authorUserId === actor.userId)).toBe(true);
      expect(persistedComments.map(row => row.body)).toEqual([
        "Please include the first follow-up.", "Please include the second follow-up.",
      ]);

      const runs = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId),
        eq(heartbeatRuns.agentId, agentId), sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}`))
        .orderBy(heartbeatRuns.createdAt, heartbeatRuns.id);
      expect(runs).toHaveLength(2);
      const [predecessor, successor] = runs;
      expect(predecessor).toMatchObject({ runtimeMode: "native", status: "succeeded", nativeIssueId: issueId });
      expect(successor).toMatchObject({ runtimeMode: "native", status: "succeeded", nativeIssueId: issueId,
        retryOfRunId: null });
      expect(predecessor!.id).not.toBe(successor!.id);
      expect(predecessor!.contextSnapshot).toMatchObject({ issueId, wakeCommentId: firstCommentId });
      expect(successor!.contextSnapshot).toMatchObject({ issueId, wakeCommentIds: injectedCommentIds });
      expect((successor!.contextSnapshot as Record<string, unknown>).wakeCommentIds).not.toContain(firstCommentId);
      for (const comment of persistedComments) {
        const snapshot = nativePayloadSourceSnapshotSchema.parse(comment.payloadSourceSnapshot);
        expect(comment.payloadSourceSnapshotInvalidated).toBe(false);
        expect(snapshot.owner).toMatchObject({ kind: "comment", companyId, id: comment.id });
      }
      const successorProfile = successor!.runnerProfileJson && typeof successor!.runnerProfileJson === "object"
        ? successor!.runnerProfileJson as Record<string, unknown> : {};
      const wireIntents = Array.isArray(successorProfile.nativeAwModelWireIntents)
        ? successorProfile.nativeAwModelWireIntents as Array<Record<string, unknown>> : [];
      const conversationIntents = wireIntents.filter(intent => intent.modelPurpose === "conversation_model");
      const successorPrompts = promptTextByRun.get(successor!.id) ?? [];
      expect(successorPrompts.length).toBeGreaterThan(0);
      expect(conversationIntents).toHaveLength(successorPrompts.length);
      const sourceInputsByIntent = conversationIntents.map(intent => {
        const consumed = intent.consumedSourceSet && typeof intent.consumedSourceSet === "object"
          ? intent.consumedSourceSet as Record<string, unknown> : {};
        return Array.isArray(consumed.inputs) ? consumed.inputs as Array<Record<string, unknown>> : [];
      });
      const matchingSourceInputs = sourceInputsByIntent.find(inputs => injectedCommentIds.every(id =>
        inputs.some(source => source.kind === "comment" && source.commentId === id)));
      expect(matchingSourceInputs).toBeDefined();
      for (const comment of persistedComments) {
        expect(matchingSourceInputs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "comment",
          issueId, commentId: comment.id, contentHash: nativeCommentProjectionHash({ body: comment.body,
            presentation: comment.presentation, metadata: comment.metadata }) })]));
      }
      const successorPrompt = successorPrompts.join("\n");
      const firstBodyPosition = successorPrompt.indexOf("Please include the first follow-up.");
      const secondBodyPosition = successorPrompt.indexOf("Please include the second follow-up.");
      expect(firstBodyPosition).toBeGreaterThanOrEqual(0);
      expect(secondBodyPosition).toBeGreaterThan(firstBodyPosition);
      expect(factsForRun(predecessor!.id).providerCallCount).toBeGreaterThan(0);
      expect(factsForRun(successor!.id).providerCallCount).toBeGreaterThan(0);
      expect(callRuns).toEqual(expect.arrayContaining([predecessor!.id, successor!.id]));
      expect(callRuns.every(runId => runId === predecessor!.id || runId === successor!.id)).toBe(true);
    },
  });
}, 300_000);
