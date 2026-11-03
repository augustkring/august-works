import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, companyUserSidebarPreferences, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { sidebarPreferenceService } from "../services/sidebar-preferences.js";

const postgresSupport = await getEmbeddedPostgresTestSupport();
(postgresSupport.supported ? describe : describe.skip)("sidebar preferred Co-worker service", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-preferred-coworker-");
    db = createDb(database.connectionString);
  }, 60_000);
  afterAll(async () => { await database?.cleanup(); });

  it("accepts only a current non-terminated Co-worker in the selected company and clears stale choices", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const currentAgentId = randomUUID();
    const foreignAgentId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "Preference company", issuePrefix: "PREF" },
      { id: otherCompanyId, name: "Other company", issuePrefix: "OTHER" },
    ]);
    await db.insert(agents).values([
      { id: currentAgentId, companyId, name: "Current Co-worker" },
      { id: foreignAgentId, companyId: otherCompanyId, name: "Foreign Co-worker" },
    ]);
    const preferences = sidebarPreferenceService(db);

    await expect(preferences.setPreferredCoworker(companyId, "user-a", foreignAgentId)).rejects.toMatchObject({ status: 404 });
    expect((await preferences.setPreferredCoworker(companyId, "user-a", currentAgentId)).agentId).toBe(currentAgentId);
    expect((await preferences.getPreferredCoworker(companyId, "user-a")).agentId).toBe(currentAgentId);

    await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, currentAgentId));
    expect((await preferences.getPreferredCoworker(companyId, "user-a")).agentId).toBeNull();
    await preferences.setPreferredCoworker(companyId, "user-a", null);
    expect((await preferences.getPreferredCoworker(companyId, "user-a")).agentId).toBeNull();

    await db.delete(companyUserSidebarPreferences);
    await db.delete(agents);
    await db.delete(companies);
  });
});
