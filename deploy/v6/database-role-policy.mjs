/** postgres.js tagged-query client; no role names or credentials are interpolated into SQL source. */
export async function assertApplicationDatabaseRole(sql) {
  const [unsafe] = await sql`
    select exists (
      select 1 from pg_roles r where pg_has_role(current_user,r.oid,'MEMBER') and (
        r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls
        or has_schema_privilege(r.oid,'public','CREATE')
        or (case when exists(select 1 from pg_namespace where nspname='drizzle')
          then has_schema_privilege(r.oid,'drizzle','CREATE') else false end)
        or has_database_privilege(r.oid,current_database(),'CREATE')
      )
    ) as unsafe
  `;
  if (!unsafe || unsafe.unsafe) throw Error('Application role must have DML access only, including every reachable role');
  const [owned] = await sql`
    select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','drizzle') and c.relkind in ('r','p','S')
      and pg_has_role(current_user,c.relowner,'MEMBER')) as unsafe
  `;
  if (owned.unsafe) throw Error('Application role must not own application or migration tables through role membership');
}
