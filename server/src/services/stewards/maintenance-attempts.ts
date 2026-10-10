import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  PACKAGE_MAINTENANCE_LIMITS,
  type PackageStewardReview,
} from "./maintenance-policy.js";

/** Called only under the native company privacy lock and installation row lock.
 * Starts consume budget even if their effect fails or its acknowledgement is lost.
 * Legacy configured receipts count once; linked configured receipts do not double count. */
export async function readMaintenanceAttemptCounts(
  tx: Db,
  companyId: string,
  installationId: string,
) {
  const [row] = await tx.execute<{
    resource_count: number;
    company_count: number;
  }>(sql`
    select count(*) filter (where entity_id=${installationId})::int as resource_count,
      count(*)::int as company_count
    from activity_log where company_id=${companyId}::uuid and actor_type='system' and actor_id='core-stewards'
      and entity_type='agent_package_installation' and created_at > now()-interval '24 hours'
      and (action='agent_package.maintenance_attempt_started'
        or (action='agent_package.low_risk_update_configured' and details->>'attemptId' is null))`);
  return {
    resource: Number(row?.resource_count),
    company: Number(row?.company_count),
  };
}

/** Unknown outcomes do not expire with the daily budget. A native owner source
 * change supersedes the old tuple; elapsed time alone never grants a retry. */
export async function hasUnconfirmedMaintenanceAttempt(
  tx: Db,
  companyId: string,
  installationId: string,
  review: PackageStewardReview,
  expiredOnly = false,
) {
  const [row] = await tx.execute<{ pending: boolean }>(sql`
    select exists(select 1 from activity_log a where a.company_id=${companyId}::uuid
      and a.entity_type='agent_package_installation' and a.entity_id=${installationId}
      and a.actor_type='system' and a.actor_id='core-stewards' and a.action='agent_package.maintenance_attempt_started'
      and (not ${expiredOnly} or a.created_at + ${PACKAGE_MAINTENANCE_LIMITS.maximumTransactionSeconds} * interval '1 second' <= clock_timestamp())
      and a.details->'reviewedSource'->>'expectedInstallationVersion'=${String(review.expectedInstallationVersion)}
      and a.details->'reviewedSource'->>'expectedInstalledVersionId'=${review.expectedInstalledVersionId}
      and a.details->'reviewedSource'->>'expectedUpdatedAt'=${review.expectedUpdatedAt}
      and not exists(select 1 from activity_log r where r.company_id=a.company_id
        and r.entity_type=a.entity_type and r.entity_id=a.entity_id and r.actor_type='system' and r.actor_id='core-stewards'
        and r.action='agent_package.maintenance_attempt_finished' and r.details->>'attemptId'=a.details->>'attemptId')) as pending`);
  return row?.pending === true;
}

export async function maintenanceAttemptIsCurrent(
  tx: Db,
  companyId: string,
  installationId: string,
  attemptId: string,
  candidateVersion: string,
  review: PackageStewardReview,
  requireOpen = true,
) {
  const [row] = await tx.execute<{ current: boolean }>(sql`
    select exists(select 1 from activity_log a where a.company_id=${companyId}::uuid
      and a.entity_type='agent_package_installation' and a.entity_id=${installationId}
      and a.actor_type='system' and a.actor_id='core-stewards' and a.action='agent_package.maintenance_attempt_started'
      and a.details->>'attemptId'=${attemptId} and a.details->>'candidateVersion'=${candidateVersion}
      and a.created_at + ${PACKAGE_MAINTENANCE_LIMITS.maximumTransactionSeconds} * interval '1 second' > clock_timestamp()
      and a.details->'reviewedSource'=${JSON.stringify(review)}::jsonb
      and (not ${requireOpen} or not exists(select 1 from activity_log r where r.company_id=a.company_id
        and r.entity_type=a.entity_type and r.entity_id=a.entity_id and r.actor_type='system' and r.actor_id='core-stewards'
        and r.action='agent_package.maintenance_attempt_finished' and r.details->>'attemptId'=${attemptId}))) as current`);
  return row?.current === true;
}
