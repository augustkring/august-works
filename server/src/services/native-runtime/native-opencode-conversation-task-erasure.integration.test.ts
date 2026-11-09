import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, issuePrivacySources, issues } from "@paperclipai/db";
import { nativePayloadSourceSnapshotSchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { enableV5ForTest } from "../../__tests__/helpers/v5-fixtures.js";
import { makeFixtureTreeWritable, qualifiedOpenCodeBinary } from "../../__tests__/helpers/managed-native-opencode-e2e-fixture.js";
import { runManagedNativeConversationFrame } from "../../__tests__/helpers/managed-native-conversation-frame.js";
import { documentService } from "../documents.js";
import { instanceSettingsService } from "../instance-settings.js";
import { canActorReadIssuePrivacy } from "../authorization.js";
import { issueService } from "../issues.js";
import { purgeDerivedWorkflowMemory } from "../memory/memory-privacy.js";

function hasPinnedOpenCodeProfile(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.PAPERCLIP_QUALIFIED_OPENCODE_BINARY?.trim()) return true;
  try { return Boolean(execFileSync("which", ["opencode"], { encoding: "utf8" }).trim()); }
  catch { return false; }
}

describe.skipIf(!hasPinnedOpenCodeProfile())("managed OpenCode conversation Task output erasure", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let root = "";
  let instanceId = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "managed-opencode-conversation-task-e2e-"));
    await chmod(root, 0o700);
    vi.stubEnv("PAPERCLIP_HOME", root);
    instanceId = `managed-opencode-conversation-task-${randomUUID()}`;
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", instanceId);
    vi.stubEnv("PAPERCLIP_AGENT_JWT_SECRET", `managed-opencode-conversation-task-${randomUUID()}-${randomUUID()}`);
    database = await startEmbeddedPostgresTestDatabase("managed-opencode-conversation-task-e2e-");
    db = createDb(database.connectionString);
    await instanceSettingsService(db).getExperimental();
    await enableV5ForTest(db);
    await instanceSettingsService(db).updateExperimental({ enableWorkflowsV1: true,
      role_packs_v5: false, skill_resolver_v5: false, readiness_engine_v7: true, orchestration_v7: true,
      enableContextEngineV1: true, enableCollectiveMemoryV1: true, enablePrivateAgentMemoryV1: true });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await database?.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (root) {
      await makeFixtureTreeWritable(root);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("binds an actual conversation dispatch to its created Task and erases that copy through the conversation retirement owner", async () => {
    const binary = qualifiedOpenCodeBinary();
    if (!binary) throw new Error("qualified_opencode_binary_unavailable");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const taskTitle = `Conversation output Task ${suffix}`;
    const callId = `conversation-task-${suffix}`;
    const idempotencyKey = randomUUID();
    const initialPlan = "# Execution plan\n\nCreate this private Task and verify that its producing Run controls retained output access.";
    let createdTaskId: string | null = null;
    let providerConsumedResult = false;
    let erasureChecked = false;
    const result = await runManagedNativeConversationFrame({ db, root, opencodeBinary: binary,
      conversationWorkMode: "standard", timeoutSec: 180,
      providerReply: ({ body, callIndex }) => {
        if (callIndex === 1) {
          const tools = Array.isArray(body.tools) ? body.tools as Array<Record<string, unknown>> : [];
          const tool = tools.find(value => typeof value.name === "string" && value.name.endsWith("create_task"));
          if (!tool) throw new Error("conversation_task_create_tool_not_advertised");
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: callId, name: tool.name,
            input: { idempotencyKey, title: taskTitle,
              description: "Created from the authenticated conversation model response.", initialPlan } }] };
        }
        if (callIndex !== 2) throw new Error("conversation_task_create_unexpected_provider_retry");
        const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
        const blocks = messages.flatMap(message => Array.isArray(message.content)
          ? message.content as Array<Record<string, unknown>> : []);
        const output = blocks.find(block => block.type === "tool_result" && block.tool_use_id === callId);
        if (!output || output.is_error === true) throw new Error("conversation_task_create_result_not_delivered");
        const content = typeof output.content === "string" ? output.content : Array.isArray(output.content)
          ? (output.content as Array<Record<string, unknown>>).map(part => typeof part.text === "string" ? part.text : "").join("") : "";
        const dto = JSON.parse(content) as { disposition?: string; task?: { id?: string } };
        expect(dto.disposition).toBe("applied");
        expect(dto.task?.id).toEqual(expect.any(String));
        createdTaskId = dto.task!.id!;
        providerConsumedResult = true;
        return undefined;
      },
      afterRunSettledBeforeTeardown: async facts => {
        if (!facts.run) throw new Error("The actual conversation fixture did not return its Run evidence");
        const companyId = facts.companyId, runId = facts.run.id, agentId = facts.agentId,
          issueId = facts.issueId, aliceActor = facts.actor;
        const childTasks = await db.select().from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.originRunId, runId)));
        expect(facts.run.status).toBe("succeeded");
        expect(childTasks).toHaveLength(1);
        const child = childTasks[0]!;
        expect(child.id).toBe(createdTaskId);
        expect((await documentService(db).getIssueDocumentByKey(child.id, "plan"))?.body).toBe(initialPlan);
        const snapshot = nativePayloadSourceSnapshotSchema.parse(child.payloadSourceSnapshot);
        const dispatches = snapshot.inputs.filter(source => source.kind === "conversation_model_dispatch");
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toMatchObject({ kind: "conversation_model_dispatch", runId, agentId, issueId });
        expect(snapshot.owner).toMatchObject({ kind: "issue", id: child.id, companyId });
        const edges = await db.select({ sourceKind: issuePrivacySources.sourceKind, sourceId: issuePrivacySources.sourceId })
          .from(issuePrivacySources).where(and(eq(issuePrivacySources.companyId, companyId), eq(issuePrivacySources.issueId, child.id)));
        expect(edges).toContainEqual({ sourceKind: "run_copy", sourceId: runId });
        expect(edges).not.toContainEqual({ sourceKind: "run", sourceId: runId });
        expect(await canActorReadIssuePrivacy(db, aliceActor, { id: child.id, companyId })).toBe(true);

        await db.transaction(async rawTx => {
          const tx = rawTx as unknown as typeof db;
          // Exercise the server retirement owner with the fixture Human.
          // Public chat-recovery route admission is a separate contract.
          // Retirement makes the producing Run a source-erasure candidate.
          await issueService(db).create(companyId, {
            privateWorkAdmission: "closed",
            title: "Conversation recovery fixture",
            status: "in_review",
            assigneeAgentId: agentId,
            createdByUserId: aliceActor.userId!,
            conversationAgentId: agentId,
            conversationUserId: aliceActor.userId!,
            conversationState: "waiting",
            payloadSourceProtocolVersion: 1,
            retireConversationId: issueId,
          }, tx, undefined, {
            manualInputActor: aliceActor,
            privacyActor: aliceActor,
            sourceAccessActor: aliceActor,
          });
          await purgeDerivedWorkflowMemory(tx, companyId, [], new Date(), {
            workflowRevisionIds: [], artifactVersionIds: [], runIds: [runId],
          });
        });
        const [retiredConversation] = await db.select().from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
        expect(retiredConversation).toMatchObject({ conversationState: "retired", status: "cancelled", hiddenAt: expect.any(Date) });
        const [erasedTask] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, child.id)));
        expect(erasedTask).toMatchObject({ title: "Erased workflow task", description: null,
          payloadSourceSnapshot: null, payloadSourceSnapshotInvalidated: true });
        expect(await canActorReadIssuePrivacy(db, aliceActor, { id: child.id, companyId })).toBe(false);
        erasureChecked = true;
      },
    });
    expect(result.runStatus).toBe("succeeded");
    expect(providerConsumedResult).toBe(true);
    expect(erasureChecked).toBe(true);
  }, 240_000);
});
