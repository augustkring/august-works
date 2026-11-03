import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents, authSessions, authUsers, companyMemberships, companies, completionContracts, createDb,
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issueAccessGrants, issues, issueThreadInteractions,
  nativeRunResults, statusDecisions, workAssessments,
} from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { canActorReadIssuePrivacy, type AuthorizationActor } from "../authorization.js";
import { buildExecutionContinuation } from "../execution-continuation.js";
import { issueService } from "../issues.js";
import { PaperclipRunnerToolAuthority } from "./paperclip-runner-tool-authority.js";

describe("native child review outcome privacy", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("child-review-outcomes-privacy-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => { await database?.cleanup(); }, 30_000);

  it.each(["tool", "continuation"] as const)("does not expose an Alice-private child outcome to Bob through %s", async caller => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const parentId = randomUUID();
    const parentRunId = randomUUID();
    const aliceId = randomUUID();
    const bobId = randomUUID();
    const issuePrefix = `CRO${companyId.slice(0, 5).toUpperCase()}`;
    const now = new Date();
    await db.insert(companies).values({ id: companyId, name: "Review outcome privacy", issuePrefix });
    await db.insert(authUsers).values([
      { id: aliceId, name: "Alice", email: `${aliceId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now },
      { id: bobId, name: "Bob", email: `${bobId}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now },
    ]);
    await db.insert(companyMemberships).values([aliceId, bobId].map(principalId => ({
      companyId, principalType: "user" as const, principalId, membershipRole: "member", status: "active",
    })));
    const aliceSessionId = randomUUID();
    await db.insert(authSessions).values({ id: aliceSessionId, userId: aliceId, token: randomUUID(), createdAt: now,
      updatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) });
    await db.insert(agents).values({ id: agentId, companyId, name: "Review projection agent", adapterType: "paperclip_runner", status: "active" });
    await db.insert(issues).values({ id: parentId, companyId, issueNumber: 1, identifier: `${issuePrefix}-1`,
      title: "Open parent", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: parentRunId, companyId, agentId, responsibleUserId: bobId,
      status: "running", runtimeMode: "native", nativeIssueId: parentId, contextSnapshot: { issueId: parentId } });
    await db.update(issues).set({ executionRunId: parentRunId }).where(eq(issues.id, parentId));

    const openChild = (await db.insert(issues).values({ companyId, parentId, title: `Open review ${randomUUID()}`, status: "in_review" }).returning())[0]!;
    const privateChild = await issueService(db).create(companyId, {
      title: `Alice private review ${randomUUID()}`, parentId, visibility: "private",
      createdByUserId: aliceId, responsibleUserId: aliceId, actorResponsibleUserId: aliceId,
      trustExplicitResponsibleUserId: true,
    });

    // These rows reproduce the stored native review projection's relational shape.
    // They are fixtures for the consumer projection only, not provider success,
    // complete input history, or source/permission qualification evidence.
    async function storedReview(childId: string, key: string) {
      const sourceRunId = randomUUID(), reviewerRunId = randomUUID();
      const sourceContractId = randomUUID(), reviewerContractId = randomUUID();
      const sourceResultId = randomUUID(), reviewerResultId = randomUUID();
      const assessmentId = randomUUID(), decisionId = randomUUID(), interactionId = randomUUID();
      for (const [contractId, runId, resultId] of [
        [sourceContractId, sourceRunId, sourceResultId], [reviewerContractId, reviewerRunId, reviewerResultId],
      ]) {
        await db.insert(completionContracts).values({ id: contractId, companyId, issueId: childId, revision: contractId === sourceContractId ? 1 : 2,
          schemaVersion: "paperclip.completion-contract.v1", policyVersion: "test-projection",
          risk: "standard", completionAuthority: "server_arbiter", incompleteCriteriaPolicy: "preserve_non_terminal",
          contractJson: {}, canonicalSha256: `${key}-${contractId}`, createdByActorType: "system", createdByActorId: "projection-test" });
        await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "succeeded", runtimeMode: "native",
          nativeIssueId: childId, responsibleUserId: childId === privateChild.id ? aliceId : bobId, completionContractId: contractId,
          completionContractSha256: `${key}-${contractId}`, contextSnapshot: { issueId: childId } });
        await db.insert(nativeRunResults).values({ id: resultId, companyId, issueId: childId, runId,
          completionContractId: contractId, serverFingerprint: `${key}-${resultId}`, schemaStatus: "accepted",
          resultJson: {}, canonicalSha256: `${key}-digest-${resultId}` });
      }
      await db.insert(workAssessments).values({ id: assessmentId, companyId, issueId: childId,
        runId: sourceRunId, contractId: sourceContractId, resultId: sourceResultId,
        triggerKind: "turn_finished", triggerActorCompanyId: companyId, priorIssueStatus: "in_progress",
        priorStatusVersion: 0, policyVersion: "test-projection", assessmentJson: {}, inputDigest: `${key}-${assessmentId}` });
      await db.insert(statusDecisions).values({ id: decisionId, companyId, issueId: childId, runId: sourceRunId,
        assessmentId, decisionVersion: 1, policyVersion: "test-projection", fromStatus: "in_review", toStatus: "done",
        reasonCode: "completed", decisionJson: {}, decisionDigest: `${key}-${decisionId}`,
        applicationState: "applied", appliedAt: now });
      await db.insert(issueThreadInteractions).values({ id: interactionId, companyId, issueId: childId,
        kind: "request_confirmation", status: "accepted", sourceRunId, resolvedByAgentId: agentId,
        resolvedByRunId: reviewerRunId, resolvedAt: now,
        payload: { version: 1, prompt: "Stored review projection", target: { type: "custom", key: "native_completion_review", revisionId: decisionId } } });
      return interactionId;
    }
    const openReviewId = await storedReview(openChild.id, "open");
    const privateReviewId = await storedReview(privateChild.id, "private");

    const bobActor: AuthorizationActor = { type: "agent", source: "agent_jwt", companyId, agentId,
      runId: parentRunId, onBehalfOfUserId: bobId };
    const aliceActor: AuthorizationActor = { type: "board", source: "session", userId: aliceId,
      sessionId: aliceSessionId, companyIds: [companyId] };
    expect(await canActorReadIssuePrivacy(db, bobActor, privateChild)).toBe(false);
    expect(await canActorReadIssuePrivacy(db, aliceActor, privateChild)).toBe(true);
    expect(await canActorReadIssuePrivacy(db, bobActor, openChild)).toBe(true);

    const authority = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId: parentId, runId: parentRunId });
    async function readOutcomes(options: { runId?: string; context?: Record<string, unknown> } = {}) {
      return caller === "tool"
        ? (await authority.execute({ tool: "get_task_context", callId: randomUUID(), arguments: {} }) as { childReviewOutcomes: unknown }).childReviewOutcomes
        : (await buildExecutionContinuation({ db, companyId, issueId: parentId, agentId,
          ...(options.runId ? { runId: options.runId } : {}), context: options.context ?? {},
          summary: null, exposeLowTrustRaw: false })).interactionOutcomes;
    }
    const outcomes = await readOutcomes({ runId: parentRunId });
    expect(JSON.stringify(outcomes)).toContain(openReviewId);
    expect(JSON.stringify(outcomes)).not.toContain(privateReviewId);

    if (caller === "continuation") {
      const preflight = await readOutcomes({ context: {
        runId: parentRunId, responsibleUserId: aliceId, accountableHumanId: aliceId,
      } });
      expect(JSON.stringify(preflight)).toContain(openReviewId);
      expect(JSON.stringify(preflight)).not.toContain(privateReviewId);
    }

    const [grant] = await db.insert(issueAccessGrants).values({ companyId, issueId: privateChild.id,
      subjectType: "user", subjectId: bobId, source: "explicit", grantedByUserId: aliceId }).returning();
    expect(grant).toBeDefined();
    expect(await canActorReadIssuePrivacy(db, bobActor, privateChild)).toBe(true);
    const grantedOutcomes = await readOutcomes({ runId: parentRunId });
    expect(JSON.stringify(grantedOutcomes)).toContain(privateReviewId);

    await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, grant!.id));
    expect(await canActorReadIssuePrivacy(db, bobActor, privateChild)).toBe(false);
    const revokedOutcomes = await readOutcomes({ runId: parentRunId });
    expect(JSON.stringify(revokedOutcomes)).not.toContain(privateReviewId);

    const [openReview] = await db.select({ id: issueThreadInteractions.id, reviewerRunId: issueThreadInteractions.resolvedByRunId }).from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.id, openReviewId));
    expect(openReview).toBeDefined();
    await db.update(issueThreadInteractions).set({ resolvedByRunId: parentRunId })
      .where(eq(issueThreadInteractions.id, openReviewId));
    const wrongReviewerBinding = await readOutcomes({ runId: parentRunId });
    expect(JSON.stringify(wrongReviewerBinding)).not.toContain(openReviewId);
    const otherAgentId = randomUUID();
    await db.insert(agents).values({ id: otherAgentId, companyId, name: "Unrelated creator", adapterType: "paperclip_runner", status: "active" });
    await db.update(issueThreadInteractions).set({ resolvedByRunId: openReview!.reviewerRunId, createdByAgentId: otherAgentId })
      .where(eq(issueThreadInteractions.id, openReviewId));
    expect(JSON.stringify(await readOutcomes({ runId: parentRunId }))).not.toContain(openReviewId);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
