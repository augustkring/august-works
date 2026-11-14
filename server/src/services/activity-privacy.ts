import { sql } from "drizzle-orm";
import { activityLog, heartbeatRuns, issues, projects, type Db } from "@paperclipai/db";
import { heartbeatRunReadSqlCondition, issueReadSqlCondition, projectReadSqlCondition,
  type AuthorizationActor } from "./authorization.js";

/** Native source privacy only; original company/audit action authorization is
 * independent. Apply before LIMIT, cursors, enrichment and export pagination. */
export async function activitySourceReadSqlCondition(db: Db, actor: AuthorizationActor) {
  const issue = await issueReadSqlCondition(db, actor), project = await projectReadSqlCondition(db, actor);
  const run = await heartbeatRunReadSqlCondition(db, actor);
  const entityId = sql`case when ${activityLog.entityId} ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then ${activityLog.entityId}::uuid end`;
  const task = sql`exists(select 1 from ${issues} where ${issues.companyId}=${activityLog.companyId}
    and ${issues.id}=${entityId} and ${issue})`;
  return sql<boolean>`(
    (${activityLog.runId} is null or exists(select 1 from ${heartbeatRuns}
      where ${heartbeatRuns.companyId}=${activityLog.companyId} and ${heartbeatRuns.id}=${activityLog.runId} and ${run}))
    and case ${activityLog.entityType}
      when 'issue' then ${task}
      when 'project' then exists(select 1 from ${projects} where ${projects.companyId}=${activityLog.companyId}
        and ${projects.id}=${entityId} and ${project})
      when 'heartbeat_run' then exists(select 1 from ${heartbeatRuns} where ${heartbeatRuns.companyId}=${activityLog.companyId}
        and ${heartbeatRuns.id}=${entityId} and ${run})
      when 'issue_comment' then exists(select 1 from issue_comments c join ${issues}
        on ${issues.id}=c.issue_id and ${issues.companyId}=c.company_id
        where c.company_id=${activityLog.companyId} and c.id=${entityId} and ${issue})
      when 'issue_document' then exists(select 1 from issue_documents d
        where d.company_id=${activityLog.companyId} and (d.id=${entityId} or d.document_id=${entityId}))
        and not exists(select 1 from issue_documents d where d.company_id=${activityLog.companyId}
          and (d.id=${entityId} or d.document_id=${entityId}) and not exists(select 1 from ${issues}
            join documents doc on doc.id=d.document_id and doc.company_id=d.company_id
            where ${issues.id}=d.issue_id and ${issues.companyId}=d.company_id and ${issue}))
      else true end
  )`;
}
