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

async function runResumedTurn() {
  const provider = startProvider();
  try {
    provider.send({ id: 1, method: "initialize", params: {} });
    await provider.waitFor((message) => message.id === 1);
    provider.send({ id: 2, method: "thread/resume", params: { threadId } });
    await provider.waitFor((message) => message.id === 2);

    provider.send({ id: 3, method: "turn/start", params: { input: [] } });
    const firstTool = await provider.waitFor((message) => message.method === "item/tool/call");
    assert.equal(firstTool.params.tool, "get_task_context");
    provider.send({ id: firstTool.id, result: { activeTask: { id: "issue-1", workMode: "execution" } } });

    const historyTool = await provider.waitFor((message) => message.method === "item/tool/call");
    assert.equal(historyTool.params.tool, "get_task_history");
    const comment = {
      action: "reply",
      text: "resumed provider identity check",
    };
    provider.send({ id: historyTool.id, result: { comments: [{
      id: "comment-1",
      authorUserId: "user-1",
      body: `fixture:${Buffer.from(JSON.stringify(comment)).toString("base64url")}`,
    }] } });

    const started = await provider.waitFor((message) => message.method === "item/started");
    const completed = await provider.waitFor((message) => message.method === "item/completed");
    const turnCompleted = await provider.waitFor((message) => message.method === "turn/completed");
    assert.equal(started.params.turnId, completed.params.turnId);
    assert.equal(started.params.item.id, completed.params.item.id);
    assert.equal(turnCompleted.params.turn.id, started.params.turnId);
    assert.equal(started.params.item.type, "agentMessage");
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
