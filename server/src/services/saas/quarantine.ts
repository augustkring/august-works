import { sql } from "drizzle-orm";
import {
  accountDeletionOperations,
  authUsers,
  companySecrets,
  customerFeedbackDeletionMarkers,
  supportCaseDeletionMarkers,
  applyPendingMigrations,
  type Db,
} from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { eraseAccountAccess } from "./account-deletion.js";
import { purgeCompanyContent } from "./company-purge.js";
import { reapplyMemoryDeletionMarkers } from "../memory/memory-privacy.js";
import { suppressAnalyticalSource } from "../analytical-privacy.js";
import { suppressBusinessEventSource } from "../business-event-privacy.js";
import { accessService } from "../access.js";
export { assertDatabaseRestoreAdmission } from "./database-admission.js";

export interface RestoreDeletionLedger {
  companies: { company_id: string }[];
  analyticalSources: { company_id: string; input_type: "issue" | "project" | "goal" | "document" | "document_revision"; input_ref: string; suppressed_at: string }[];
  businessEvents: { company_id: string; source_ref: string; suppressed_at: string }[];
  feedback: { subject_id: string; company_id: string; feedback_id: string; target_kind: "case" | "image"; erased_at: string }[];
  supportCases: { subject_id: string; company_id: string; case_id: string; target_kind: "case" | "event"; erased_at: string; retain_until: string }[];
  identityHomes?: { id: string; home_company_id: string }[];
  users?: { id: string; user_id: string; created_at: string }[];
  memory: {
    company_id: string;
    key: string;
    kind: "record" | "operation" | "source";
    record_id: string | null;
    deleted_at: string;
  }[];
}
/** The operator authenticates the archive/ledger and verifies an isolated empty restore target first. */
export async function prepareRestoredQuarantine(
  db: Db,
  connectionString: string,
  ledger: RestoreDeletionLedger,
) {
  // A freshly exported V8-aware ledger is required even when the backup predates
  // V8. Absence cannot establish that no post-backup projection was suppressed.
  if (!Array.isArray(ledger.businessEvents) || !Array.isArray(ledger.analyticalSources))
    throw Error("V8-aware event and analytical-source deletion ledger required");
  if (!Array.isArray(ledger.feedback))
    throw Error("V9-aware feedback deletion ledger required");
  if (!Array.isArray(ledger.supportCases))
    throw Error("V10-aware support case deletion ledger required");
  const supportMarkers = z.array(z.strictObject({
    subject_id: z.uuid().toLowerCase(), company_id: z.uuid().toLowerCase(), case_id: z.uuid().toLowerCase(),
    target_kind: z.enum(["case", "event"]), erased_at: z.iso.datetime({ offset: true }), retain_until: z.iso.datetime({ offset: true }),
  }).superRefine((row, context) => {
    if ((row.target_kind === "case") !== (row.subject_id === row.case_id))
      context.addIssue({ code: "custom", message: "Support erasure identity is invalid" });
    if (Date.parse(row.retain_until) <= Date.parse(row.erased_at))
      context.addIssue({ code: "custom", message: "Support restore horizon is invalid" });
  })).max(100000).parse(ledger.supportCases);
  const feedbackMarkers = z.array(z.strictObject({ subject_id: z.uuid().toLowerCase(), company_id: z.uuid().toLowerCase(),
    feedback_id: z.uuid().toLowerCase(), target_kind: z.enum(["case", "image"]), erased_at: z.iso.datetime({ offset: true }) })
    .refine(row => row.target_kind !== "case" || row.subject_id === row.feedback_id, "Feedback case erasure identity is invalid"))
    .max(100000).parse(ledger.feedback);
  const target = new URL(connectionString);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !/^\/aw_restore_[a-z0-9_]+$/.test(target.pathname)
  )
    throw Error("Isolated quarantine database required");
  await applyPendingMigrations(connectionString);
  await db.transaction(async (tx) => {
    // A raw database archive can predate a revocation that committed after
    // its snapshot. Never let restored Human routing receipts regain effect
    // when the operator later clears restore admission. Migrations run above
    // so this also covers archives that predate the coverage table.
    await accessService(db).revokeAllWorkflowCoveragesForRestore(tx, new Date());
    await tx.execute(sql`delete from "session"`);
    await tx.execute(sql`delete from verification`);
    await tx.execute(sql`update agent_api_keys set revoked_at=now()`);
    await tx.execute(
      sql`update email_deliveries set status='expired',payload_ciphertext=null,lease_owner=null,lease_until=null`,
    );
    await tx.execute(
      sql`update runtime_host_commands set status='CANCELED',claim_token_hash=null`,
    );
    await tx.execute(
      sql`update runtime_operations set status='NEEDS_RECONCILIATION',error_code='quarantine_restore',updated_at=now() where status in ('REQUESTED','WAITING_FOR_CAPACITY','RUNNING')`,
    );
    await tx.execute(
      sql`update runtime_hosts set credential_revoked_at=now(),credential_version=credential_version+1`,
    );
    await tx.execute(sql`delete from runtime_host_enrollments`);
    await tx.execute(sql`delete from platform_scheduler_leases`);
    await tx.execute(
      sql`update runtime_backup_policies set enabled=false,phase='idle',operation_id=null,cycle_id=null,cycle_generation=null,resume_after_backup=false,error_code='quarantine_restore',updated_at=now()`,
    );
    await tx.execute(
      sql`update runtime_cells set status='DEGRADED',generation=generation+1,active_since=null,active_image_digest=null,model_secret_ref=null,model_secret_version=null,last_error_code='quarantine_restore',updated_at=now() where deleted_at is null`,
    );
    await tx.execute(
      sql`update agent_presence_runtime_bindings set status='revoked',qualified_configuration_hash=null,conformance_snapshot_hash=null,updated_at=now()`,
    );
    await tx.execute(
      sql`update agent_provider_bindings set status='unqualified',capability_snapshot=null,capability_snapshot_hash=null,conformance='{}'::jsonb,updated_at=now() where status <> 'revoked'`,
    );
    await tx.execute(
      sql`update agents set status='paused',pause_reason='quarantine_restore',paused_at=now(),updated_at=now() where status not in ('paused','terminated')`,
    );
    await tx.execute(
      sql`insert into instance_settings(singleton_key,general,experimental) values('default',jsonb_build_object('awV6RestoreQuarantine',jsonb_build_object('restoredAt',now(),'admission','blocked')),'{}'::jsonb) on conflict(singleton_key) do update set general=instance_settings.general||excluded.general,experimental='{}'::jsonb,updated_at=now()`,
    );
  });
  // These identities came from the current independently authenticated ledger,
  // not the archive being restored. Import before removing old private bodies.
  // The database remains quarantined through both phases and after completion.
  await db.transaction(async tx => {
    for (const marker of supportMarkers) {
      const [collision] = await tx.execute<{ present: boolean }>(sql`select
        exists(select 1 from support_cases c where c.id=${marker.subject_id}::uuid
          and (${marker.target_kind}<>'case' or c.company_id<>${marker.company_id}::uuid))
        or exists(select 1 from support_case_events e where e.id=${marker.subject_id}::uuid
          and (${marker.target_kind}<>'event' or e.company_id<>${marker.company_id}::uuid or e.case_id<>${marker.case_id}::uuid)) as present`);
      if (collision?.present) throw Error("Conflicting restored support content identity");
      await tx.insert(supportCaseDeletionMarkers).values({ subjectId: marker.subject_id, companyId: marker.company_id,
        caseId: marker.case_id, targetKind: marker.target_kind, erasedAt: new Date(marker.erased_at), retainUntil: new Date(marker.retain_until) })
        .onConflictDoNothing();
      const [retained] = await tx.select().from(supportCaseDeletionMarkers)
        .where(eq(supportCaseDeletionMarkers.subjectId, marker.subject_id));
      if (!retained || retained.companyId !== marker.company_id || retained.caseId !== marker.case_id
        || retained.targetKind !== marker.target_kind || retained.erasedAt.getTime() !== Date.parse(marker.erased_at))
        throw Error("Conflicting support erasure identity in restore ledger");
      if (retained.retainUntil.getTime() < Date.parse(marker.retain_until))
        await tx.update(supportCaseDeletionMarkers).set({ retainUntil: new Date(marker.retain_until) })
          .where(eq(supportCaseDeletionMarkers.subjectId, marker.subject_id));
    }
    // Current independently authenticated erasure facts precede old bodies.
    // A stale hold in the archive cannot resurrect already-erased content.
    await tx.execute(sql`delete from support_case_events e using support_case_deletion_markers m
      where m.target_kind='event' and e.id=m.subject_id and e.company_id=m.company_id and e.case_id=m.case_id`);
    await tx.execute(sql`delete from support_cases c using support_case_deletion_markers m
      where m.target_kind='case' and c.id=m.subject_id and c.company_id=m.company_id`);
    for (const marker of feedbackMarkers) {
      await tx.insert(customerFeedbackDeletionMarkers).values({ subjectId: marker.subject_id, companyId: marker.company_id,
        feedbackId: marker.feedback_id, targetKind: marker.target_kind, erasedAt: new Date(marker.erased_at) })
        .onConflictDoNothing();
      const [retained] = await tx.select().from(customerFeedbackDeletionMarkers)
        .where(eq(customerFeedbackDeletionMarkers.subjectId, marker.subject_id));
      if (!retained || retained.companyId !== marker.company_id || retained.feedbackId !== marker.feedback_id || retained.targetKind !== marker.target_kind)
        throw Error("Conflicting feedback erasure identity in restore ledger");
    }
    await tx.execute(sql`delete from customer_feedback f using customer_feedback_deletion_markers m
      where m.target_kind='case' and f.id=m.subject_id`);
    // Individual images retain their Original allocated key until the native
    // deletion worker confirms the same provider namespace and physical absence.
    // Closing their read state is distinct from confirming physical erasure.
    await tx.execute(sql`insert into feedback_image_deletions(image_id,company_id,object_key,storage_scope_id,transport_settled_at)
      select i.id,i.company_id,i.object_key,i.storage_scope_id,i.transport_settled_at from customer_feedback_images i
      where i.object_key is not null and i.status<>'deleted' and exists(
        select 1 from customer_feedback_deletion_markers m where m.subject_id=i.id or (m.target_kind='case' and m.subject_id=i.feedback_id))
      on conflict(image_id) do nothing`);
    const mismatched = await tx.execute(sql`select i.id from customer_feedback_images i join feedback_image_deletions d on d.image_id=i.id
      where exists(select 1 from customer_feedback_deletion_markers m where m.subject_id=i.id or (m.target_kind='case' and m.subject_id=i.feedback_id))
      and (d.company_id<>i.company_id or d.object_key is distinct from i.object_key or d.storage_scope_id is distinct from i.storage_scope_id) limit 1`);
    if (mismatched.length) throw Error("Conflicting original feedback image allocation during restore");
    await tx.execute(sql`update customer_feedback_images i set status='deleting'
      where i.status not in ('deleting','deleted') and exists(
        select 1 from customer_feedback_deletion_markers m where m.subject_id=i.id or (m.target_kind='case' and m.subject_id=i.feedback_id))`);
  });
  // Replay explicit, authoritative rehomes. Never choose a different tenant as a new home automatically.
  const deletedCompanies = new Set(
    ledger.companies.map((row) => row.company_id),
  );
  for (const home of deletedCompanies.size
    ? (ledger.identityHomes ?? [])
    : []) {
    if (deletedCompanies.has(home.home_company_id)) continue;
    await db.execute(
      sql`update agent_identities i set home_company_id=${home.home_company_id}::uuid,updated_at=now() where i.id=${home.id}::uuid and i.home_company_id in (${sql.join(
        [...deletedCompanies].map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) and exists(select 1 from companies c where c.id=${home.home_company_id}::uuid and c.status='active')`,
    );
  }
  for (const company of ledger.companies)
    await purgeCompanyContent(db, company.company_id, {
      restoreQuarantine: true,
    });
  for (const marker of ledger.businessEvents) {
    await db.transaction(async (tx) => {
      const company = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from companies where id=${marker.company_id}::uuid) as present`);
      if (company[0]?.present)
        await suppressBusinessEventSource(tx, marker.company_id, marker.source_ref, new Date(marker.suppressed_at));
    });
  }
  for (const marker of ledger.analyticalSources) {
    await db.transaction(async (tx) => {
      const company = await tx.execute<{ present: boolean }>(sql`select exists(select 1 from companies where id=${marker.company_id}::uuid) as present`);
      if (company[0]?.present) await suppressAnalyticalSource(tx, marker.company_id, marker.input_type, marker.input_ref, new Date(marker.suppressed_at));
    });
  }
  for (const marker of ledger.memory)
    await db.execute(
      sql`insert into memory_deletion_markers(company_id,key,kind,record_id,deleted_at) select ${marker.company_id}::uuid,${marker.key},${marker.kind},${marker.record_id}::uuid,${marker.deleted_at}::timestamptz where exists(select 1 from companies where id=${marker.company_id}::uuid) on conflict do nothing`,
    );
  for (const companyId of new Set(
    ledger.memory.map((marker) => marker.company_id),
  ))
    await reapplyMemoryDeletionMarkers(db, companyId);
  for (const user of ledger.users ?? []) {
    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, user.user_id))
        .for("update");
      await tx
        .insert(accountDeletionOperations)
        .values({
          userId: user.user_id,
          id: user.id,
          idempotencyKey: "quarantine:" + user.id,
          status: "requested",
          createdAt: new Date(user.created_at),
        })
        .onConflictDoNothing();
      await eraseAccountAccess(tx, user.user_id, profile?.email);
      await tx
        .update(companySecrets)
        .set({
          status: "deleted",
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companySecrets.scope, "user"),
            eq(companySecrets.ownerUserId, user.user_id),
          ),
        );
      const retainedSupport = await tx.execute(sql`select 1 where
        exists(select 1 from support_cases where opened_by_user_id=${user.user_id})
        or exists(select 1 from support_case_events where author_user_id=${user.user_id})`);
      if (retainedSupport.length) {
        // Keep only the scrubbed FK principal while actual support erasure is
        // pending. Replaying an old completed receipt cannot bypass this fence.
        await tx.update(accountDeletionOperations).set({
          status: "requested", errorCode: "account_erasure_pending",
          completedAt: null, notBefore: new Date(),
        }).where(eq(accountDeletionOperations.userId, user.user_id));
      } else {
        await tx.delete(authUsers).where(eq(authUsers.id, user.user_id));
      }
    });
  }
}
