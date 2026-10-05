import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("V5 identity migration", () => {
  it("backfills more than one batch, preserves local authority and rejects duplicate/cross-identity runtime associations", async () => {
    const database = await startEmbeddedPostgresTestDatabase("aw-v5-identity-migration-");
    const sql = postgres(database.connectionString, { max: 1 });
    try {
      // Recreate only the pre-V5 part of this disposable database, then apply
      // the real expansion SQL against populated V4 rows.
      await sql`DROP TRIGGER IF EXISTS aw_v5_provider_binding_on_insert ON agents`;
      await sql`DROP FUNCTION IF EXISTS aw_v5_ensure_provider_binding()`;
      await sql`DROP TRIGGER IF EXISTS aw_v5_agent_identity_lifecycle ON agents`;
      await sql`DROP TRIGGER IF EXISTS aw_v5_home_company_lifecycle ON companies`;
      await sql`DROP TRIGGER aw_v5_agent_identity_on_insert ON agents`;
      await sql`DROP FUNCTION aw_v5_ensure_agent_identity()`;
      await sql`DROP TABLE agent_execution_manifest_items`;
      await sql`DROP TABLE agent_execution_authorizations`;
      await sql`DROP TABLE agent_execution_scope_requests`;
      await sql`DROP TABLE agent_execution_manifests`;
      await sql`DROP TABLE provider_shared_runtime_acknowledgements`;
      await sql`DROP TABLE agent_presence_runtime_bindings`;
      // V6 adds this dependency after the V5 expansion. Detach it only in
      // this disposable pre-V5 fixture and restore it once V5 is reapplied.
      await sql`ALTER TABLE runtime_cells DROP CONSTRAINT runtime_cells_provider_binding_id_agent_provider_bindings_id_fk`;
      await sql`DROP TABLE agent_provider_bindings`;
      await sql`ALTER TABLE agents DROP COLUMN agent_identity_id CASCADE`;
      await sql`DROP TABLE agent_identities`;
      const home = randomUUID(), guest = randomUUID();
      await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${home}, 'Home', 'H'), (${guest}, 'Guest', 'G')`;
      await sql`INSERT INTO agents (company_id, name, permissions, budget_monthly_cents)
        SELECT ${home}, 'Agent ' || n, '{"canCreateAgents":false,"canCreateSkills":false}'::jsonb, n
        FROM generate_series(1,1005) n`;
      const expansion = await readFile(new URL("./migrations/0321_broken_northstar.sql", import.meta.url), "utf8");
      for (const statement of expansion.split("--> statement-breakpoint")) if (statement.trim()) await sql.unsafe(statement);
      await sql`ALTER TABLE agents ALTER COLUMN agent_identity_id SET DEFAULT NULL`;
      await sql`ALTER TABLE agents ALTER COLUMN agent_identity_id SET NOT NULL`;
      await sql`ALTER TABLE runtime_cells ADD CONSTRAINT runtime_cells_provider_binding_id_agent_provider_bindings_id_fk
        FOREIGN KEY (provider_binding_id) REFERENCES agent_provider_bindings(id)`;
      const [reconciliation] = await sql`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE agent_identity_id IS NOT NULL)::int AS linked,
        count(*) FILTER (WHERE permissions = '{"canCreateAgents":false,"canCreateSkills":false}'::jsonb)::int AS preserved
        FROM agents WHERE company_id = ${home}`;
      expect(reconciliation).toEqual({ total: 1005, linked: 1005, preserved: 1005 });
      const [first] = await sql`SELECT id, agent_identity_id FROM agents WHERE company_id = ${home} ORDER BY id LIMIT 1`;
      const presenceId = randomUUID();
      await sql`INSERT INTO agents (id, company_id, name, agent_identity_id) VALUES (${presenceId}, ${guest}, 'Guest Agent', ${first!.agent_identity_id})`;
      await expect(sql`INSERT INTO agents (company_id, name, agent_identity_id) VALUES (${guest}, 'Duplicate', ${first!.agent_identity_id})`).rejects.toMatchObject({ code: "23505" });
      const newId = randomUUID();
      const [newAgent] = await sql`INSERT INTO agents (id, company_id, name) VALUES (${newId}, ${guest}, 'Fresh') RETURNING agent_identity_id`;
      expect(newAgent!.agent_identity_id).toBe(newId);
      const provider = randomUUID();
      await sql`INSERT INTO agent_provider_bindings (id, agent_identity_id, provider_type, provider_agent_ref) VALUES (${provider}, ${newId}, 'paperclip_native', 'native')`;
      await expect(sql`INSERT INTO agent_presence_runtime_bindings (company_id, agent_id, agent_identity_id, provider_binding_id, provider_profile_ref, provider_session_namespace)
        VALUES (${guest}, ${presenceId}, ${first!.agent_identity_id}, ${provider}, 'profile', 'namespace')`).rejects.toMatchObject({ code: "23503" });
    } finally {
      await sql.end();
      await database.cleanup();
    }
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
