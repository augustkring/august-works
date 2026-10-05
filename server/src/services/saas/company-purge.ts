import { is, sql, type SQL } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@paperclipai/db";
import { companies, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";

// Minimal ownership/billing/erasure receipts survive content deletion. Never physically drop the company tombstone.
const retained = new Set([
  "companies",
  "company_deletion_operations",
  "billing_account_companies",
  "billing_subscriptions",
  "billing_entitlement_overrides",
  "entitlement_snapshots",
  "usage_events",
  "usage_aggregates",
  "runtime_cells",
  "runtime_operations",
  "runtime_operation_attempts",
  "runtime_host_commands",
  "runtime_backups",
  "platform_admin_audit",
  "support_sessions",
]);
export async function purgeCompanyContent(
  db: Db,
  companyId: string,
  options: { restoreQuarantine?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    if (!options.restoreQuarantine) {
      const alive = await tx.execute<{ present: boolean }>(
        sql`select exists(select 1 from runtime_cells where company_id=${companyId}::uuid and deleted_at is null) as present`,
      );
      if (alive[0]?.present)
        throw conflict(
          "Physical runtime erasure must be confirmed before content purge",
        );
    }
    const tables = [
      ...new Set(
        (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
          is(value, PgTable),
        ),
      ),
    ];
    const scopes = new Map<PgTable, SQL>();
    for (const table of tables) {
      const config = getTableConfig(table);
      const column = config.columns.find((v) => v.name === "company_id");
      if (column && !retained.has(config.name))
        scopes.set(table, sql`${column} = ${companyId}::uuid`);
    }
    // Child records without a company column inherit only an already-owned parent's exact FK scope.
    let changed = true;
    while (changed) {
      changed = false;
      for (const table of tables) {
        if (
          scopes.has(table) ||
          retained.has(getTableConfig(table).name) ||
          getTableConfig(table).columns.some((c) => c.name === "company_id")
        )
          continue;
        const parents = getTableConfig(table)
          .foreignKeys.map((fk) => fk.reference())
          .filter((ref) => scopes.has(ref.foreignTable));
        if (!parents.length) continue;
        scopes.set(
          table,
          sql.join(
            parents.map(
              (ref) =>
                sql`exists (select 1 from ${ref.foreignTable} where ${scopes.get(ref.foreignTable)!} and ${sql.join(
                  ref.columns.map(
                    (column, index) =>
                      sql`${column} = ${ref.foreignColumns[index]!}`,
                  ),
                  sql` and `,
                )})`,
            ),
            sql` or `,
          ),
        );
        changed = true;
      }
    }
    // Retained runtime receipts must not keep customer agents/provider profiles or credential references alive.
    await tx.execute(
      sql`update runtime_cells set dedicated_agent_id=null,provider_binding_id=null,gateway_secret_ref=null,state_storage_ref=null,model_secret_ref=null,model_secret_version=null,model_provider=null,model_id=null where company_id=${companyId}::uuid ${options.restoreQuarantine ? sql`` : sql`and deleted_at is not null`}`,
    );
    await tx.execute(
      sql`update runtime_backups set encryption_key_ref='erased',manifest=null where company_id=${companyId}::uuid ${options.restoreQuarantine ? sql`` : sql`and deleted_at is not null`}`,
    );
    await tx.execute(
      sql`update billing_entitlement_overrides set revoked_at=coalesce(revoked_at,now()),reason='Erased company override' where company_id=${companyId}::uuid`,
    );
    await tx.execute(
      sql`delete from entitlement_snapshots where company_id=${companyId}::uuid`,
    );
    await tx.execute(
      sql`update support_sessions set reason='Erased company support session',revoked_at=coalesce(revoked_at,now()) where company_id=${companyId}::uuid`,
    );
    for (const [table, scope] of scopes) {
      const found = await tx.execute<{ present: boolean }>(
        sql`select exists(select 1 from ${table} where ${scope}) as present`,
      );
      if (!found[0]?.present) scopes.delete(table);
    }
    const pending = new Set(scopes.keys());
    const edges = new Map<PgTable, Set<PgTable>>();
    for (const table of pending) {
      const parents = new Set<PgTable>();
      for (const fk of getTableConfig(table).foreignKeys) {
        const ref = fk.reference();
        if (!pending.has(ref.foreignTable) || ref.foreignTable === table)
          continue;
        // Unlink nullable intra-company references before ordering; no outside-company row is changed.
        if (
          ref.columns.some((column) => !column.notNull) &&
          getTableConfig(table).columns.some(
            (column) => column.name === "company_id",
          )
        ) {
          await tx.execute(
            sql`update ${table} set ${sql.join(
              ref.columns
                .filter((column) => !column.notNull)
                .map((column) => sql`${sql.identifier(column.name)} = null`),
              sql`, `,
            )} where ${scopes.get(table)!}`,
          );
          continue;
        }
        parents.add(ref.foreignTable);
      }
      edges.set(table, parents);
    }
    const deleted: string[] = [];
    while (pending.size) {
      const leaves = [...pending].filter(
        (table) =>
          ![...pending].some(
            (child) => child !== table && edges.get(child)?.has(table),
          ),
      );
      if (!leaves.length)
        throw conflict(
          "Company content has a non-null reference cycle; scoped migration required",
        );
      for (const table of leaves) {
        await tx.execute(sql`delete from ${table} where ${scopes.get(table)!}`);
        pending.delete(table);
        deleted.push(getTableConfig(table).name);
      }
    }
    await tx.execute(
      sql`update agent_identities set name='Deleted agent',description=null,base_profile='{}'::jsonb,appearance=null,provider_preference=null,created_by_user_id=null,status='archived',updated_at=now() where home_company_id=${companyId}::uuid and not exists(select 1 from agents where agents.agent_identity_id=agent_identities.id)`,
    );
    await tx.execute(
      sql`update ${companies} set name='Deleted company',description=null,default_responsible_user_id=null,interaction_resolver_governance='{}'::jsonb,feedback_data_sharing_enabled=false,feedback_data_sharing_consent_at=null,feedback_data_sharing_consent_by_user_id=null,feedback_data_sharing_terms_version=null,status='archived',pause_reason='company_deleted',updated_at=now() where id=${companyId}::uuid`,
    );
    return { tables: deleted.sort(), companyTombstoneRetained: true };
  });
}
