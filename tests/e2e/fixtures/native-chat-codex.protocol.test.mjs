import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./native-chat-codex.mjs", import.meta.url));
const threadId = "agent-chat-retained-protocol-test";

function startProvider() {
  const child = spawn(process.execPath, [fixture], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PAPERCLIP_AGENT_CHAT_EVENT_TRACE: "" },
  });
  const inbox = [];
  const waiters = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    const index = waiters.findIndex((waiter) => waiter.predicate(value));
    if (index === -1) inbox.push(value);
    else waiters.splice(index, 1)[0].resolve(value);
  });
  const waitFor = (predicate) => {
    const index = inbox.findIndex(predicate);
    if (index !== -1) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      let waiter;
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error("provider protocol response timed out"));
      }, 5_000);
      waiter = {
        predicate,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
      };
      waiters.push(waiter);
    });
  };
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return { child, send, waitFor };
}

async function runResumedTurn({ questionStatus, delegated = false } = {}) {
  const provider = startProvider();
  // Match CodexBackend::deliver_tool_result's actual app-server envelope.
  const toolReply = (id, result, operationId) => provider.send({ id, result: {
    success: true, contentItems: [{ type: "inputText", text: JSON.stringify(operationId
      ? { callId: id, ok: true, operationId, result } : result) }],
  } });
  try {
    provider.send({ id: 1, method: "initialize", params: {} });
    await provider.waitFor((message) => message.id === 1);
    provider.send({ id: 2, method: "thread/resume", params: { threadId } });
    await provider.waitFor((message) => message.id === 2);

    provider.send({ id: 3, method: "turn/start", params: { input: delegated ? [{ type: "text", text: JSON.stringify({
      completionContract: { revision: "root-plan-r7", criteria: [{ id: "retained-output", description: "Preserve the retained plan in output." }] },
    }) }] : [] } });
    const firstTool = await provider.waitFor((message) => message.method === "item/tool/call");
    assert.equal(firstTool.params.tool, "get_task_context");
    toolReply(firstTool.id, { activeTask: { id: "issue-1", workMode: "execution",
      ...(delegated ? { parentId: null, projectId: "project-1", status: "in_progress" } : {}) } });

    const historyTool = await provider.waitFor((message) => message.method === "item/tool/call");
    assert.equal(historyTool.params.tool, "get_task_history");
    const comment = questionStatus ? { action: "question" } : {
      action: "reply",
      text: "resumed provider identity check",
    };
    toolReply(historyTool.id, { comments: delegated ? [] : [{
      id: "comment-1",
      authorUserId: "user-1",
      body: `fixture:${Buffer.from(JSON.stringify(comment)).toString("base64url")}`,
    }] });

    if (delegated) {
      const read = await provider.waitFor((message) => message.method === "item/tool/call");
      assert.equal(read.params.tool, "read_document");
      assert.equal(read.params.arguments.key, "plan");
      toolReply(read.id, { document: { body: "The actual retained plan." } });
      const list = await provider.waitFor((message) => message.method === "item/tool/call");
      assert.equal(list.params.tool, "list_documents");
      toolReply(list.id, { documents: [] });
      const write = await provider.waitFor((message) => message.method === "item/tool/call");
      assert.equal(write.params.tool, "write_document");
      assert.equal(write.params.arguments.body, "Execution received plan: The actual retained plan.");
      toolReply(write.id, { document: { latestRevisionId: "output-revision" } });
      const finish = await provider.waitFor((message) => message.method === "item/tool/call");
      assert.equal(finish.params.tool, "paperclip_finish");
      assert.equal(finish.params.arguments.completionClaim.contractRevision, "root-plan-r7");
      assert.deepEqual(finish.params.arguments.completionClaim.criteria,
        [{ criterionId: "retained-output", status: "satisfied", evidenceRefs: [] }]);
      toolReply(finish.id, { disposition: "applied" });
    }
    if (questionStatus) {
      const interactions = await provider.waitFor((message) => message.method === "item/tool/call");
      assert.equal(interactions.params.tool, "call_api");
      toolReply(interactions.id, { ok: true, status: 200, data: [{ kind: "ask_user_questions", status: questionStatus }] }, "call_api");
      const progress = await provider.waitFor((message) => message.method === "item/tool/call");
      assert.equal(progress.params.tool, "report_progress");
      assert.equal(progress.params.arguments.body, "Clarification received.");
      toolReply(progress.id, { disposition: "applied" });
    }
    const started = await provider.waitFor((message) => message.method === "item/started");
    const completed = await provider.waitFor((message) => message.method === "item/completed");
    const turnCompleted = await provider.waitFor((message) => message.method === "turn/completed");
    assert.equal(started.params.turnId, completed.params.turnId);
    assert.equal(started.params.item.id, completed.params.item.id);
    assert.equal(turnCompleted.params.turn.id, started.params.turnId);
    assert.equal(started.params.item.type, "agentMessage");
    if (questionStatus) assert.equal(started.params.item.text, "Reply generation 0: Clarification received.");
    return { threadId: started.params.threadId, turnId: started.params.turnId, itemId: started.params.item.id };
  } finally {
    provider.child.kill("SIGTERM");
    await new Promise((resolve) => provider.child.once("exit", resolve));
  }
}

test("resumed provider processes emit distinct final item IDs for the same retained thread", async () => {
  const first = await runResumedTurn();
  const resumed = await runResumedTurn();

  assert.equal(first.threadId, threadId);
  assert.equal(resumed.threadId, threadId);
  assert.notEqual(first.turnId, resumed.turnId);
  assert.notEqual(first.itemId, resumed.itemId);
  assert.equal(first.itemId, `agent-chat-message-${first.turnId}`);
  assert.equal(resumed.itemId, `agent-chat-message-${resumed.turnId}`);
});

test("the provider resumes canonical answered questions without asking them again", async () => {
  await runResumedTurn({ questionStatus: "answered" });
});

test("a root project handoff task reads its saved plan and writes output without requiring a chat parent", async () => {
  await runResumedTurn({ delegated: true });
});
