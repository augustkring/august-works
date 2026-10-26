#!/usr/bin/env node
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";

let threadId = `agent-chat-${process.pid}`;
let turnNumber = 0;
const pendingTools = new Map();
const lineReader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function note(event) {
  const destination = process.env.PAPERCLIP_AGENT_CHAT_EVENT_TRACE;
  if (!destination) return;
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.appendFileSync(destination, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch { /* Fixture diagnostics never affect the provider protocol. */ }
}

function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

function completionContractFrom(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return completionContractFrom(JSON.parse(value), depth + 1); }
    catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = completionContractFrom(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const direct = value.completionContract;
  if (direct && typeof direct.revision === "string" && Array.isArray(direct.criteria))
    return direct;
  for (const nested of Object.values(value)) {
    const found = completionContractFrom(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, output);
  return output;
}

function decodeComment(comment) {
  const body = typeof comment?.body === "string" ? comment.body : "";
  if (body.startsWith("fixture:")) {
    try { return JSON.parse(Buffer.from(body.slice(8), "base64url").toString("utf8")); }
    catch { return { action: "reply", text: body }; }
  }
  return { action: "reply", text: body };
}

function tool(turn, name, args, next) {
  const id = `agent-chat-tool-${turn.number}-${turn.step++}`;
  pendingTools.set(id, { turn, name, next });
  note({ event: "tool_call", turn: turn.number, tool: name, workMode: turn.workMode ?? null });
  send({ id, method: "item/tool/call", params: {
    threadId, turnId: turn.turnId, callId: id, tool: name, arguments: args,
  } });
}

function toolValue(message) {
  const text = message.result?.contentItems?.[0]?.text;
  if (typeof text !== "string") return message.result;
  try { return JSON.parse(text); } catch { return text; }
}

function progress(turn, body, next = () => finish(turn, body)) {
  tool(turn, "report_progress", {
    idempotencyKey: `${turn.commentId ?? `turn-${turn.number}`}-${turn.step}`,
    body,
  }, next);
}

function finish(turn, text) {
  const emitReply = () => {
    const item = { id: `agent-chat-message-${turn.number}`, type: "agentMessage", phase: "final_answer", channel: "final", text };
    send({ method: "item/started", params: { threadId, turnId: turn.turnId, item } });
    send({ method: "item/completed", params: { threadId, turnId: turn.turnId, item: { ...item, status: "completed" } } });
    note({ event: "final_item_emitted", turn: turn.number, processId: process.pid });
    if ([...pendingTools.values()].some((pending) => pending.turn === turn))
      throw new Error("fixture attempted to complete a turn with pending tool replies");
    send({ method: "turn/completed", params: { threadId, turn: { id: turn.turnId, status: "completed" } } });
    note({ event: "turn_completed_emitted", turn: turn.number, processId: process.pid });
  };
  const reportYieldedReply = turn.workMode === "planning" ||
    (turn.workMode === "ask" && turn.command?.action !== "question");
  if (!reportYieldedReply) return emitReply();
  if (!turn.completionContract?.revision || !Array.isArray(turn.completionContract.criteria))
    throw new Error("planning turn lacks the current completion contract");
  const result = {
    schema: "paperclip.run_result.v1",
    reportedWorkDisposition: "yielded",
    summary: text,
    completionClaim: {
      contractRevision: turn.completionContract.revision,
      objectiveSatisfied: false,
      criteria: turn.completionContract.criteria.map(({ id }) => ({
        criterionId: id, status: "unknown", evidenceRefs: [],
      })),
      remainingWork: [{ description: "Wait for the next message in this conversation.", blocksCompletion: true }],
    },
    evidence: [], verification: [], attentionRequests: [], artifacts: [],
    continuation: {
      kind: "response_wake",
      summary: "Wait for the next message in this conversation.",
      idempotencyKey: `agent-chat-response:${turn.commentId ?? turn.number}`,
    },
  };
  tool(turn, "paperclip_finish", result, emitReply);
}

function resultText(value) {
  if (typeof value === "string") return value;
  return value?.message ?? value?.error ?? value?.details?.message ?? JSON.stringify(value);
}

function actionAfterHistory(turn, comments) {
  const humanComments = comments.filter(comment => comment?.authorUserId);
  const current = humanComments.at(-1);
  const command = decodeComment(current);
  note({ event: "turn_context", turn: turn.number, workMode: turn.workMode ?? null, action: command.action });
  const needsContext = humanComments.length === 0 || command.action === "question" ||
    (command.action === "project" && command.direct === true) ||
    (command.action === "plan" && command.approval === true);
  if (!turn.activeTask) {
    return tool(turn, "get_task_context", {}, context => {
      turn.companyId = context?.company?.id;
      turn.issueId = context?.activeTask?.id;
      turn.activeTask = context?.activeTask;
      actionAfterHistory(turn, comments);
    });
  }
  if (humanComments.length === 0 && turn.activeTask?.parentId && turn.activeTask?.projectId)
    return executeDelegatedTask(turn);
  turn.commentId = current?.id;
  turn.command = command;
  turn.comments = comments;
  turn.generation = humanComments.filter(comment => comment.body === "/new").length;

  if (command.action === "history") {
    let index = 0;
    const append = () => {
      if (index >= 65) return finish(turn, "History message 64");
      const body = `History message ${String(index++).padStart(2, "0")}`;
      progress(turn, body, append);
    };
    return append();
  }

  if (command.action === "question") {
    return tool(turn, "call_api", {
      operationId: "GET /api/issues/{id}/interactions", pathParams: { id: turn.issueId },
    }, value => {
      const interactions = value?.data ?? value;
      const answered = Array.isArray(interactions) && interactions.some(item =>
        item.kind === "ask_user_questions" && ["resolved", "accepted", "completed"].includes(item.status));
      if (answered) return progress(turn, "Clarification received.", () => finish(turn, `Reply generation ${turn.generation}: Clarification received.`));
      tool(turn, "request_human_input", {
        idempotencyKey: current.id,
        interactionKind: "questions",
        title: "A quick question",
        prompt: "Who is the welcome note for?",
        continuationPolicy: "wake_assignee",
        payload: { version: 1, questions: [{
          id: "audience", prompt: "Who is the welcome note for?", selectionMode: "single", required: true,
          options: [{ id: "garden", label: "Garden club" }, { id: "book", label: "Book club" }],
        }] },
      }, () => finish(turn, "Please choose an audience."));
    });
  }

  if (command.action === "plan") {
    if (!command.approval) return writePlan(turn, command.text, false);
    return tool(turn, "call_api", {
      operationId: "GET /api/issues/{id}/interactions", pathParams: { id: turn.issueId },
    }, value => {
      const interactions = value?.data ?? value;
      const accepted = Array.isArray(interactions) && interactions.some(item =>
        item.kind === "request_confirmation" && ["accepted", "resolved", "completed"].includes(item.status));
      if (accepted) {
        const plan = command.text;
        return createProject(turn, { name: "Approved plan project", key: current.id }, {
          plan, count: 1, preservePlan: true,
        });
      }
      return writePlan(turn, command.text, true);
    });
  }
  if (command.action === "project") {
    if (turn.workMode === "planning" || turn.workMode === "ask")
      return finish(turn, "I can discuss a project plan here, but I will not create a project in this mode.");
    return createProject(turn, command, false);
  }
  if (command.action === "handoff") return handoff(turn, command);
  if (command.action === "delayed") {
    return progress(turn, "Turn started before feature disable.", () => setTimeout(() =>
      progress(turn, "Active turn settled after feature disable.", () => finish(turn, "Active turn settled after feature disable.")), 3_000));
  }
  if (command.action === "hold") return progress(turn, "Provider is streaming and ready to stop.", () => {
    turn.held = true;
    heldTurns.set(turn.turnId, turn);
  });

  const text = typeof command === "object" && command.action === "reply"
    ? `Reply generation ${turn.generation}: ${command.text}`
    : "Codex completed the fake turn.";
  progress(turn, text, () => finish(turn, text));
}

function executeDelegatedTask(turn) {
  tool(turn, "read_document", { key: "plan" }, planValue => {
    const plan = planValue?.document ?? planValue;
    if (typeof plan?.body !== "string") return finish(turn, "The delegated task has no readable plan.");
    tool(turn, "list_documents", {}, documentsValue => {
      const documents = documentsValue?.documents ?? documentsValue?.data?.documents ?? [];
      const previous = documents.find(document => document.key === "output");
      const output = `Execution received plan: ${plan.body}`;
      tool(turn, "write_document", {
        idempotencyKey: `${turn.activeTask.id}-output-${turn.number}`,
        key: "output", title: "Output", body: output,
        baseRevisionId: previous?.latestRevisionId ?? null,
      }, () => {
        const result = {
          schema: "paperclip.run_result.v1", reportedWorkDisposition: "done",
          summary: "Completed the assigned plan.",
          completionClaim: { contractRevision: "1", objectiveSatisfied: true,
            criteria: [{ criterionId: "objective", status: "satisfied", evidenceRefs: [] }], remainingWork: [] },
          evidence: [], verification: [], attentionRequests: [], artifacts: [],
        };
        tool(turn, "paperclip_finish", result, () => finish(turn, result.summary));
      });
    });
  });
}

function writePlan(turn, body, approval, afterWrite) {
  tool(turn, "list_documents", {}, value => {
    const documents = value?.documents ?? value?.data?.documents ?? [];
    const previous = documents.find(document => document.key === "plan");
    tool(turn, "write_document", {
      idempotencyKey: `${turn.commentId}-plan-${turn.number}`,
      key: "plan", title: "Plan", body,
      baseRevisionId: previous?.latestRevisionId ?? null,
    }, result => {
      if (!approval) {
        if (afterWrite) return afterWrite(result);
        return progress(turn, "The draft plan is ready for discussion.", () => finish(turn, "The draft plan is ready for discussion."));
      }
      const revision = result?.latestRevisionId ?? result?.document?.latestRevisionId ?? result?.revisionId;
      tool(turn, "request_human_input", {
        idempotencyKey: `${turn.commentId}-plan-approval`,
        interactionKind: "confirmation", title: "Approve plan handoff",
        prompt: "Hand this plan off to an assigned project task?",
        targetRevisionId: revision ?? null,
        continuationPolicy: "wake_assignee",
        payload: { version: 1, acceptLabel: "Approve handoff", rejectLabel: "Revise", rejectRequiresReason: true,
          target: { type: "issue_document", key: "plan", revisionId: revision } },
      }, () => finish(turn, "The draft plan is ready for discussion."));
    });
  });
}

function createProject(turn, command, thenHandoff) {
  const args = {
    idempotencyKey: command.key ?? turn.commentId,
    name: command.name ?? "Fixture project",
    repositoryUrls: command.urls,
    repositoryIds: command.ids,
    workspace: command.workspace,
  };
  const useTool = command.direct !== true;
  const invoke = next => tool(turn, useTool ? "create_project" : "call_api",
    useTool ? args : {
      operationId: "POST /api/companies/{companyId}/projects",
      pathParams: { companyId: turn.companyId }, body: args,
    }, next);
  invoke(value => {
    const project = value?.data ?? value;
    const status = value?.status;
    if (value?.ok === false || status >= 400 || value?.success === false) {
      const error = resultText(value);
      return progress(turn, `Expected tool result: ${error}`, () => finish(turn, `Expected tool result: ${error}`));
    }
    if (!project?.id) {
      const error = resultText(value);
      return progress(turn, `Expected tool result: ${error}`, () => finish(turn, `Expected tool result: ${error}`));
    }
    // Reuse the same idempotency key: this exercises Native's canonical
    // mutation-receipt boundary and must return the same project.
    const retryArgs = { ...args };
    tool(turn, "create_project", retryArgs, retry => {
      const retried = retry?.data ?? retry;
      if (retried?.id !== project.id) return finish(turn, "Project retry created a duplicate");
      if (thenHandoff) {
        if (thenHandoff.preservePlan) return createTasks(turn, project, thenHandoff.plan, thenHandoff.count);
        return writePlan(turn, thenHandoff.plan, false,
          () => createTasks(turn, project, thenHandoff.plan, thenHandoff.count));
      }
      progress(turn, `Project registered: ${project.name}`, () => finish(turn, `Project registered: ${project.name}`));
    });
  });
}

function handoff(turn, command) {
  const withProject = project => {
    const plan = command.plan ?? "# Plan\n\nWrite the welcome note.";
    const count = command.split ? 2 : 1;
    if (command.projectId) return createTasks(turn, { id: command.projectId }, plan, count);
    if (command.approvedPlan) return createTasks(turn, project, command.approvedPlan, count);
    // The chat conversation itself retains the requested handoff plan before
    // creating project tasks; each child then receives its own initial plan.
    writePlan(turn, plan, false, () => createTasks(turn, project, plan, count));
  };
  if (command.projectId) return withProject({ id: command.projectId });
  createProject(turn, { ...command, action: "handoff" }, { plan: command.plan ?? "# Plan\n\nWrite the welcome note.", count: command.split ? 2 : 1 });
}

function createTasks(turn, project, plan, count) {
  let index = 0;
  const created = [];
  const next = () => {
    if (index >= count) {
      const links = created.map(task => `[${task.identifier ?? task.id}](/issues/${task.id})`);
      return progress(turn, `Handed off: ${links.join(", ")}`, () => finish(turn, `Handed off: ${links.join(", ")}`));
    }
    const current = index++;
    const args = {
      title: `Execution ${current + 1}`,
      projectId: project.id,
      initialPlan: `${plan}\nPart ${current + 1}`,
      idempotencyKey: `${turn.commentId}-${current}`,
    };
    tool(turn, "create_task", args, task => {
      const taskData = task?.issue ?? task?.task ?? task;
      if (!taskData?.id) return finish(turn, `Expected tool result: ${resultText(task)}`);
      tool(turn, "create_task", args, retry => {
        const retried = retry?.issue ?? retry?.task ?? retry;
        if (retried?.id !== taskData.id) return finish(turn, "Task retry created a duplicate");
        created.push(taskData);
        next();
      });
    });
  };
  next();
}

const heldTurns = new Map();

function handleToolResult(message) {
  const pending = pendingTools.get(message.id);
  if (!pending) return false;
  pendingTools.delete(message.id);
  const value = toolValue(message);
  const details = value && typeof value === "object" ? value : {};
  const rawCode = message.error?.code ?? details.errorCode ?? details.code;
  const errorCode = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(rawCode) ? rawCode : null;
  note({ event: "tool_result", turn: pending.turn.number, tool: pending.name,
    failed: Boolean(message.error || details.isError === true || details.ok === false || details.success === false || details.error),
    errorCode });
  pending.next(value);
  return true;
}

lineReader.on("line", line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (handleToolResult(message)) return;
  const id = message.id;
  switch (message.method) {
    case "initialize": send({ id, result: { user: { sessionId: "agent-chat-test-session" } } }); break;
    case "initialized": break;
    case "thread/start":
    case "thread/resume": {
      if (message.method === "thread/resume" && typeof message.params?.threadId === "string")
        threadId = message.params.threadId;
      send({ id, result: { thread: { id: threadId, sessionId: "agent-chat-test-session" } } });
      break;
    }
    case "thread/read":
      send({ id, result: {
        thread: { id: threadId, status: { type: "idle" }, turns: [] },
      } });
      break;
    case "turn/start": {
      turnNumber += 1;
      const turnId = `agent-chat-turn-${process.pid}-${turnNumber}`;
      const turn = { turnId, number: turnNumber, step: 0,
        completionContract: completionContractFrom(message.params?.input ?? message.params) };
      note({ event: "turn_start", turn: turnNumber });
      send({ id, result: { turn: { id: turnId, status: "inProgress" } } });
      send({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
      tool(turn, "get_task_context", {}, context => {
        turn.companyId = context?.company?.id;
        turn.issueId = context?.activeTask?.id;
        turn.activeTask = context?.activeTask;
        turn.workMode = context?.activeTask?.workMode;
        note({ event: "task_context", turn: turn.number, workMode: turn.workMode ?? null });
        tool(turn, "get_task_history", { limit: 100 }, history =>
          actionAfterHistory(turn, Array.isArray(history?.comments) ? history.comments : []));
      });
      break;
    }
    case "turn/interrupt": {
      const turnId = message.params?.turnId;
      const turn = heldTurns.get(turnId);
      if (turn) {
        heldTurns.delete(turnId);
        finish(turn, "Stopped.");
      }
      if (id !== undefined) send({ id, result: {} });
      break;
    }
    default: if (id !== undefined) send({ id, error: { code: -32601, message: "Unsupported test app-server method" } });
  }
});
