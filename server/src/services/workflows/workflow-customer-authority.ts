import { and, eq } from "drizzle-orm";
import {
  companyMemberships,
  instanceSettings,
  principalPermissionGrants,
  type Db,
  workflowRuns,
} from "@paperclipai/db";
import {
  v9FeatureEnabled,
  type PermissionKey,
  type ExecutionPrincipal,
} from "@paperclipai/shared";
import { forbidden, notFound } from "../../errors.js";
import {
  hasCurrentInstanceAdminRole,
  type AuthorizationActor,
} from "../authorization.js";
import { assertV5Authorization, v5HumanActorId } from "../v5-authorization.js";
import { instanceSettingsService } from "../instance-settings.js";
import { lockAnalyticalCompany } from "../analytical-privacy.js";
import { lockMemoryPrivacy } from "../memory/memory-privacy.js";
/** The native cancellation route also retains the board viewer write fence.
 * Read the current membership, not the role copied into a request snapshot. */
export async function currentCustomerWorkflowWriteRoleAllows(
  db: Db,
  companyId: string,
  authority: AuthorizationActor,
) {
  if (authority.source === "local_implicit") return true;
  const principal = v5HumanActorId(authority);
  if (await hasCurrentInstanceAdminRole(db, principal)) return true;
  const [membership] = await db
    .select({ role: companyMemberships.membershipRole })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, principal),
        eq(companyMemberships.status, "active"),
      ),
    );
  return !!membership && membership.role !== "viewer";
}
/** Native mutation lock ordering shared by customer workflow controls. This
 * helper locks current authority only; each native owner then locks its object. */
export async function lockCustomerWorkflowControlAuthority(
  tx: Db,
  companyId: string,
  authority: AuthorizationActor,
  actions: readonly PermissionKey[],
) {
  const principal = v5HumanActorId(authority);
  await lockAnalyticalCompany(tx, companyId);
  await lockMemoryPrivacy(tx, companyId);
  await instanceSettingsService(tx).getExperimental();
  await tx
    .select({ id: instanceSettings.id })
    .from(instanceSettings)
    .for("share");
  const flags = await instanceSettingsService(tx).getExperimental();
  if (
    !flags.enableWorkflowsV1 ||
    !v9FeatureEnabled(flags, "progressive_shell_v9")
  )
    throw notFound("Customer workflow controls are not enabled");
  if (authority.source !== "local_implicit") {
    const currentAdmin = await hasCurrentInstanceAdminRole(tx, principal, true);
    const memberships = await tx
      .select({
        id: companyMemberships.id,
        role: companyMemberships.membershipRole,
      })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, principal),
          eq(companyMemberships.status, "active"),
        ),
      )
      .for("share");
    if (!currentAdmin && memberships[0]?.role === "viewer")
      throw forbidden("Viewer access is read-only");
    await tx
      .select({ id: principalPermissionGrants.id })
      .from(principalPermissionGrants)
      .where(
        and(
          eq(principalPermissionGrants.companyId, companyId),
          eq(principalPermissionGrants.principalType, "user"),
          eq(principalPermissionGrants.principalId, principal),
        ),
      )
      .for("share");
  }
  for (const action of actions)
    await assertV5Authorization(tx, authority, companyId, action);
}

export function customerWorkflowTestActor(
  principal: ExecutionPrincipal | null,
): AuthorizationActor {
  return principal?.type === "user"
    ? { type: "board", source: "session", userId: principal.userId }
    : principal?.type === "system" && principal.service === "local-board"
      ? { type: "board", source: "local_implicit" }
      : { type: "none" };
}
/** Each native test attempt preserves its original human's current authority. */
export async function assertCustomerWorkflowTestAuthority(
  db: Db,
  companyId: string,
  principal: ExecutionPrincipal | null,
) {
  const authority = customerWorkflowTestActor(principal);
  for (const action of [
    "workflows:read",
    "workflows:edit",
    "workflows:run",
  ] as const)
    await assertV5Authorization(db, authority, companyId, action);
  if (!(await currentCustomerWorkflowWriteRoleAllows(db, companyId, authority)))
    throw forbidden("Workflow test authority is no longer current");
}
/** Recovery owns the lease, but cannot replace the test's initiating human. */
export async function assertCustomerWorkflowTestRuntimeAuthority(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
) {
  await assertCustomerWorkflowTestAuthority(
    db,
    run.companyId,
    run.executionPrincipal,
  );
}
