import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockTelemetryClient = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../telemetry.ts", () => ({ getTelemetryClient: () => mockTelemetryClient }));

import {
  NATIVE_PAID_ADMISSION_REASON,
  NATIVE_PAID_RUNTIME_UNAVAILABLE_MESSAGE,
} from "../services/native-runtime/paid-transport-admission.ts";
import { buildConfigurationIncompleteRecoveryNoticeSeed } from "../services/recovery/stranded-notice.ts";
import { recoveryService } from "../services/recovery/service.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres stranded recovery notice tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

// A legacy paid transport that is not qualified fails its Run with
// `configuration_incomplete` before dispatch. Two writers then escalate the
// same Task: the Run's own release path (with the structured notice seed) and
// the periodic stranded-issue sweep (with only a generic comment). The Task
// must retain exactly one notice for that Run, and it must name the gap.
describeEmbeddedPostgres("stranded recovery notice idempotency", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-stranded-notice-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRecoveryActions);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedUnqualifiedPaidTransportFailure() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "ACP fixture",
      role: "engineer",
      status: "active",
      adapterType: "claude_local",
      adapterConfig: { engine: "acp" },
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Unqualified paid transport",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });
    const finishedAt = new Date(Date.now() - 1_000);
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "failed",
      invocationSource: "assignment",
      contextSnapshot: { issueId },
      error: NATIVE_PAID_RUNTIME_UNAVAILABLE_MESSAGE,
      errorCode: "configuration_incomplete",
      resultJson: {
        configurationIncomplete: {
          reason: NATIVE_PAID_ADMISSION_REASON,
          owner: "Managed model gateway owner",
          provider: "anthropic",
          companyId,
          agentId,
          actionUrl: `/agents/${agentId}/runtime`,
        },
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
      },
      createdAt: new Date(finishedAt.getTime() - 1_000),
      startedAt: new Date(finishedAt.getTime() - 1_000),
      finishedAt,
    });
    return { companyId, agentId, issueId, runId };
  }

  async function notices(issueId: string, runId: string) {
    const rows = await db
      .select()
      .from(issueComments)
      .where(and(eq(issueComments.issueId, issueId), eq(issueComments.authorType, "system")));
    return rows.filter((row) => {
      const metadata = row.metadata as { sourceRunId?: string | null } | null;
      const presentation = row.presentation as { title?: string | null } | null;
      return metadata?.sourceRunId === runId && presentation?.title === "Configuration incomplete";
    });
  }

  async function loadEscalationInputs(issueId: string, runId: string) {
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    return { issue: issue!, run: run! };
  }

  it("retains one notice when the release path and the sweep escalate the same Run concurrently", async () => {
    const { agentId, issueId, runId } = await seedUnqualifiedPaidTransportFailure();
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });
    const { issue, run } = await loadEscalationInputs(issueId, runId);
    const configurationIncomplete = (run.resultJson as { configurationIncomplete: Record<string, unknown> })
      .configurationIncomplete;

    // The release path and the sweep each read the Task before either one
    // blocked it, so both escalate from the same `todo` snapshot.
    const releasePath = () =>
      recovery.escalateStrandedAssignedIssue({
        issue,
        previousStatus: "todo",
        latestRun: run,
        notice: buildConfigurationIncompleteRecoveryNoticeSeed(configurationIncomplete),
        recoveryCause: "configuration_incomplete",
      });
    const sweep = () =>
      recovery.escalateStrandedAssignedIssue({
        issue,
        previousStatus: "todo",
        latestRun: run,
        recoveryCause: "configuration_incomplete",
        comment:
          "Paperclip classified the latest adapter failure as `configuration_incomplete`. " +
          "Moving the issue to `blocked` with the configuration fix recorded instead of creating a recovery takeover.",
      });
    await Promise.all([releasePath(), sweep(), releasePath(), sweep()]);

    const retained = await notices(issueId, runId);
    expect(retained).toHaveLength(1);
    expect(retained[0]!.body).toContain(NATIVE_PAID_RUNTIME_UNAVAILABLE_MESSAGE);
    expect(retained[0]!.body).toContain(`[Runtime settings](/agents/${agentId}/runtime)`);
    const [blocked] = await db.select({ status: issues.status }).from(issues).where(eq(issues.id, issueId));
    expect(blocked?.status).toBe("blocked");

    // A later sequential escalation of the same Run stays idempotent.
    await sweep();
    expect(await notices(issueId, runId)).toHaveLength(1);
  });

  it("gives a sweep-posted notice the same runtime-unavailable content as the release path", async () => {
    const { agentId, issueId, runId } = await seedUnqualifiedPaidTransportFailure();
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    const result = await recovery.reconcileStrandedAssignedIssues();
    expect(result.escalated).toBe(1);
    expect(result.issueIds).toEqual([issueId]);

    const retained = await notices(issueId, runId);
    expect(retained).toHaveLength(1);
    expect(retained[0]!.body).toContain(NATIVE_PAID_RUNTIME_UNAVAILABLE_MESSAGE);
    expect(retained[0]!.body).toContain(`[Runtime settings](/agents/${agentId}/runtime)`);
    expect(retained[0]!.body).not.toContain("Paperclip classified the latest adapter failure");
  });
});
