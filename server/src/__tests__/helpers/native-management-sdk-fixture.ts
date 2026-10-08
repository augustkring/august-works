import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, authUsers, companyMemberships, heartbeatRuns, issues, analyticalContextRoots, type Db } from "@paperclipai/db";
import type { ManagementChatToolName } from "@paperclipai/shared";
import { contextManifestService } from "../../services/context/context-manifest.js";
import { instanceSettingsService } from "../../services/instance-settings.js";
import { PaperclipRunnerToolAuthority } from "../../services/native-runtime/paperclip-runner-tool-authority.js";
import { heartbeatMemoryPayloadRetained } from "../../services/memory/memory-privacy.js";

/** Actual native software conversation for an already captured original Source.
 * Persisted identities, membership and Context are prerequisites. This performs
 * the real SDK dispatcher/retention path, not a provider or Human trial. */
export async function nativeManagementSdkFixture(db: Db, companyId: string, userId = "local-board") {
  await instanceSettingsService(db, { runtimeEnv: {} }).updateExperimental({ analytical_lineage_v8: true, business_metrics_v8: true, management_reviews_v8: true, management_chat_tools_v8: true, enableContextEngineV1: true });
  await db.insert(authUsers).values({ id: userId, name: "Native SDK software Human", email: `${userId}@sdk.example.test`, createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "admin", status: "active" }).onConflictDoNothing();
  const agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
  await db.insert(agents).values({ id: agentId, companyId, name: "Actual bound native SDK software reader", role: "engineer", status: "active", adapterType: "paperclip_runner" });
  await db.insert(issues).values({ id: issueId, companyId, title: "Private native SDK software conversation", assigneeAgentId: agentId, conversationAgentId: agentId, conversationUserId: userId, conversationState: "active", responsibleUserId: userId });
  await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, nativeIssueId: issueId, runtimeMode: "native", status: "running", responsibleUserId: userId, contextSnapshot: { issueId } });
  await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
  await contextManifestService(db).create({ companyId, agentId, issueId, runId, query: "Read this exact original analytical Source", policySnapshot: { softwareFixture: true }, selected: [] });
  const tools = new PaperclipRunnerToolAuthority(db, { companyId, agentId, issueId, runId, managementToolsEnabled: true });
  return { agentId, issueId, runId, userId,
    read: (tool: ManagementChatToolName, argumentsValue: unknown) => tools.execute({ tool, callId: randomUUID(), arguments: argumentsValue }),
    retainCopy: async (payload: unknown) => { await db.update(heartbeatRuns).set({ resultJson: { sdk: payload } }).where(eq(heartbeatRuns.id, runId)); },
    roots: () => db.select().from(analyticalContextRoots).where(eq(analyticalContextRoots.companyId, companyId)),
    retained: () => heartbeatMemoryPayloadRetained(db, companyId, runId),
  };
}
