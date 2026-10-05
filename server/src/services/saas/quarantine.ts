import { sql } from "drizzle-orm";
import { applyPendingMigrations, type Db } from "@paperclipai/db";
import { purgeCompanyContent } from "./company-purge.js";
import { reapplyMemoryDeletionMarkers } from "../memory/memory-privacy.js";

export interface RestoreDeletionLedger {
  companies: { company_id: string }[];
  identityHomes?: { id: string; home_company_id: string }[];
  memory: {
    company_id: string;
    key: string;
    kind: "record" | "operation" | "source";
    record_id: string | null;
    deleted_at: string;
  }[];
}
export async function assertDatabaseRestoreAdmission(db: Db) {
  const rows = await db.execute<{ quarantine: unknown }>(
    sql`select general->'awV6RestoreQuarantine' as quarantine from instance_settings where singleton_key='default'`,
  );
  if (rows.some((row) => row.quarantine != null))
    throw Error(
      "Restored database remains quarantined; operator recovery qualification is required before application startup",
    );
}
/** The operator authenticates the archive/ledger and verifies an isolated empty restore target first. */
export async function prepareRestoredQuarantine(
  db: Db,
  connectionString: string,
  ledger: RestoreDeletionLedger,
) {
  const target = new URL(connectionString);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !/^\/aw_restore_[a-z0-9_]+$/.test(target.pathname)
  )
    throw Error("Isolated quarantine database required");
  await applyPendingMigrations(connectionString);
  await db.transaction(async (tx) => {
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
  for (const marker of ledger.memory)
    await db.execute(
      sql`insert into memory_deletion_markers(company_id,key,kind,record_id,deleted_at) select ${marker.company_id}::uuid,${marker.key},${marker.kind},${marker.record_id}::uuid,${marker.deleted_at}::timestamptz where exists(select 1 from companies where id=${marker.company_id}::uuid) on conflict do nothing`,
    );
  for (const companyId of new Set(
    ledger.memory.map((marker) => marker.company_id),
  ))
    await reapplyMemoryDeletionMarkers(db, companyId);
}
