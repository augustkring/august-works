import { and, eq } from "drizzle-orm";
import { authUsers, companyMemberships, type Db } from "@paperclipai/db";
import type { AuthorizationActor } from "../../authorization.js";
import type { ExperienceCard } from "@paperclipai/shared";
import { authorizationService } from "../../authorization.js";
import { readAuthorizedResponsibilitySubset } from "./authorized-subset-reader.js";
import { bindNativeResponsibilityReaders } from "./native-reader-ports.js";
import { bindKnownNativeResponsibilityPorts } from "./native-reader-adapters.js";

/** User-facing recovery is a fresh authorized subset of durable scan pointers.
 * The cursor, raw totals, hidden identifiers and cached ownership never escape. */
export async function readCompanyResponsibilityAttention(db: Db, actor: AuthorizationActor, companyId: string,
  signal: AbortSignal, configuredOperatorUserIds: readonly string[] = []): Promise<{
    needsYou: ExperienceCard[];
    coverage: "currently_authorized_subset" | { state: "partial"; reason: "overflow" | "source_stale" | "source_unavailable" };
  }> {
  const mayReview = async (viewer: AuthorizationActor, targetCompanyId: string) => {
    if (viewer.type !== "board" || !viewer.userId || viewer.source === "local_implicit") return false;
    const [membership] = await db.select({ id: companyMemberships.id }).from(companyMemberships)
      .innerJoin(authUsers, and(eq(authUsers.id, companyMemberships.principalId), eq(authUsers.emailVerified, true)))
      .where(and(eq(companyMemberships.companyId, targetCompanyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, viewer.userId), eq(companyMemberships.status, "active"))).limit(1);
    if (!membership) return false;
    const managerActor = { ...viewer, isInstanceAdmin: false, ignoreInstanceAdmin: true };
    const auth = authorizationService(db);
    const [scope, manage] = await Promise.all([
      auth.decide({ actor: managerActor, action: "company_scope:read", resource: { type: "company", companyId: targetCompanyId } }),
      auth.decide({ actor: managerActor, action: "users:manage_permissions", resource: { type: "company", companyId: targetCompanyId } }),
    ]);
    return scope.allowed && manage.allowed;
  };
  const ports = bindKnownNativeResponsibilityPorts(db, configuredOperatorUserIds);
  return readAuthorizedResponsibilitySubset({ db, actor, companyId, signal, mayReviewCompanyResponsibility: mayReview,
    nativeReaders: bindNativeResponsibilityReaders(ports) });
}
