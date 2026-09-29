import { createDb } from "@paperclipai/db";
import { workflowExecutorService } from "../../services/workflows/workflow-executor.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const databaseUrl = required("WORKFLOW_PROCESS_KILL_DATABASE_URL");
const companyId = required("WORKFLOW_PROCESS_KILL_COMPANY_ID");
const workflowId = required("WORKFLOW_PROCESS_KILL_WORKFLOW_ID");
const userId = required("WORKFLOW_PROCESS_KILL_USER_ID");
const idempotencyKey = required("WORKFLOW_PROCESS_KILL_IDEMPOTENCY_KEY");

const db = createDb(databaseUrl);

const heartbeat = {
  wakeup: async () => {
    process.stdout.write("WORKFLOW_PROCESS_KILL_READY\n");
    await new Promise<never>(() => {});
  },
};

await workflowExecutorService(db, { heartbeat }).startManualRun(
  companyId,
  workflowId,
  { input: { processKill: true } },
  {
    principal: { type: "user", userId },
    responsibleUserId: userId,
  },
  idempotencyKey,
);

throw new Error(
  "Process-kill fixture unexpectedly completed instead of waiting for SIGKILL",
);
