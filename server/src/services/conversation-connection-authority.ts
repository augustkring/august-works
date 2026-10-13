import { and, eq } from "drizzle-orm";
import { issues, type Db } from "@paperclipai/db";
import { forbidden, notFound } from "../errors.js";
import { assertConversationRoutineAuthoring } from "./routine-authoring-authority.js";
import { lockAnalyticalCompany } from "./analytical-privacy.js";
import { lockMemoryPrivacy } from "./memory/memory-privacy.js";

/** Connection intent remains the Original Human-only interaction. In a
 * conversation it must also belong to the current admitted generation and
 * Original sources. Ordinary task connection requests retain their owner. */
export async function assertConversationConnectionIntentCurrent(db: Db, context: {
  companyId: string; issueId: string; agentId: string; runId: string; userId: string;
}, lockPrivacy = false) {
  const [issue] = await db.select({ conversationAgentId: issues.conversationAgentId, retiredAt: issues.conversationRetiredAt }).from(issues)
    .where(and(eq(issues.companyId, context.companyId), eq(issues.id, context.issueId)));
  if (!issue) throw notFound("The connection intent task is unavailable");
  if (issue.retiredAt) throw forbidden("The connection intent conversation has retired");
  if (!issue.conversationAgentId) return;
  if (lockPrivacy) {
    await lockAnalyticalCompany(db, context.companyId);
    await lockMemoryPrivacy(db, context.companyId);
  }
  const current = await assertConversationRoutineAuthoring(db, context);
  if (current.conversation.id !== context.issueId || current.responsibleUserId !== context.userId)
    throw forbidden("The connection intent no longer belongs to the current conversation user");
}
