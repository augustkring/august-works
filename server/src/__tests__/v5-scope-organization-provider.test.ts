import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agents, companyMemberships, createDb, orgUnitMemberships } from "@paperclipai/db";
import { crossCompanyPolicySchema, PROVIDER_CAPABILITY_FEATURES, createOrgUnitSchema, type EvidenceItem } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Companies, seedV5Presences } from "./helpers/v5-fixtures.js";
import { agentProviderBindingService } from "../services/agent-provider-bindings.js";
import { crossCompanyContextService, crossCompanyEvidencePolicy } from "../services/cross-company-context.js";
import { organizationService } from "../services/organization.js";
import { assertV5Authorization } from "../services/v5-authorization.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 company boundaries", () => {
  let db!: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("aw-v5-boundaries-");
    db = createDb(database.connectionString);
    await enableV5ForTest(db);
  });
  afterAll(async () => { await database?.cleanup(); });

  async function qualify(f: Awaited<ReturnType<typeof seedV5Presences>>, companyId: string, agentId: string) {
    const service = agentProviderBindingService(db);
    const binding = await service.create(f.actor, companyId, agentId, { providerType: "paperclip_native", providerAgentRef: agentId, providerEndpointRef: null, isolationMode: "isolated_per_presence" });
    await service.attach(f.actor, companyId, agentId, { providerBindingId: binding.id, providerProfileRef: agentId });
    const features = Object.fromEntries(PROVIDER_CAPABILITY_FEATURES.map((key) => [key, false])) as Record<(typeof PROVIDER_CAPABILITY_FEATURES)[number], boolean>;
    await service.recordDiscovery(companyId, agentId, { provider: "paperclip_native", version: "test-contract-1", features, skills: [], tools: [], discoveredAt: new Date().toISOString() }, { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true });
    return binding;
  }

  it("isolated bindings cannot be attached to two presences; shared state requires each company's acknowledgement", async () => {
    const f = await seedV5Presences(db), svc = agentProviderBindingService(db);
    const isolated = await qualify(f, f.home, f.presence.id);
    await expect(svc.attach(f.actor, f.guest, f.guestPresence.id, { providerBindingId: isolated.id, providerProfileRef: "same" })).rejects.toMatchObject({ status: 409 });
    const shared = await svc.create(f.actor, f.home, f.presence.id, { providerType: "custom", providerEndpointRef: null, providerAgentRef: "shared", isolationMode: "shared_trusted_runtime" });
    await expect(svc.attach(f.actor, f.home, f.presence.id, { providerBindingId: shared.id, providerProfileRef: "shared" })).rejects.toMatchObject({ status: 409 });
    await svc.acknowledgeShared(f.actor, f.home, f.presence.id, shared.id);
    await svc.attach(f.actor, f.home, f.presence.id, { providerBindingId: shared.id, providerProfileRef: "shared" });
    await expect(svc.attach(f.actor, f.guest, f.guestPresence.id, { providerBindingId: shared.id, providerProfileRef: "shared" })).rejects.toMatchObject({ status: 409 });
    await svc.acknowledgeShared(f.actor, f.guest, f.guestPresence.id, shared.id);
    await svc.attach(f.actor, f.guest, f.guestPresence.id, { providerBindingId: shared.id, providerProfileRef: "shared" });
    await expect(svc.assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 }); // Metadata never qualifies itself.
  });

  it("explicit read delegation needs matching active presences, local policy and current human authority; it cannot mutate", async () => {
    const f = await seedV5Presences(db), svc = crossCompanyContextService(db);
    await qualify(f, f.home, f.presence.id); await qualify(f, f.guest, f.guestPresence.id);
    const scope = { primaryCompanyId: f.home, primaryAgentPresenceId: f.presence.id, delegatedScopes: [{ companyId: f.guest, agentPresenceId: f.guestPresence.id, accessMode: "read" as const, purpose: "Compare approved strategies" }] };
    await expect(svc.resolve(f.actor, scope)).rejects.toMatchObject({ status: 403 });
    await svc.setPolicy(f.actor, f.guest, crossCompanyPolicySchema.parse({ allowRead: true }));
    expect((await svc.resolve(f.actor, scope)).scopes).toHaveLength(2);
    expect((await svc.assertAction(f.actor, scope, f.guest, "company_scope:read", { type: "company", companyId: f.guest })).agentId).toBe(f.guestPresence.id);
    await expect(svc.assertAction(f.actor, scope, f.guest, "issue:mutate", { type: "company", companyId: f.guest })).rejects.toMatchObject({ status: 403 });
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, f.guestPresence.id));
    await expect(svc.resolve(f.actor, scope)).rejects.toMatchObject({ status: 403 });
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.guestPresence.id));
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
    await expect(svc.resolve(f.actor, scope)).rejects.toMatchObject({ status: 403 });
  });

  it("requires target acceptance of relationships and relationships confer no data access", async () => {
    const f = await seedV5Companies(db), svc = organizationService(db);
    const relation = await svc.proposeRelationship(f.actor, f.home, { targetCompanyId: f.guest, relationshipType: "portfolio_company" });
    await expect(svc.transitionRelationship(f.actor, f.home, relation.id, "accept")).rejects.toMatchObject({ status: 409 });
    expect((await svc.transitionRelationship(f.actor, f.guest, relation.id, "accept")).status).toBe("active");
    await db.delete(companyMemberships).where(and(eq(companyMemberships.companyId, f.guest), eq(companyMemberships.principalId, f.userId)));
    await expect(assertV5Authorization(db, f.actor, f.guest, "company_scope:read")).rejects.toMatchObject({ status: 403 });
  });

  it("units reject cycles, cross-company principals and invented company access", async () => {
    const f = await seedV5Presences(db), svc = organizationService(db);
    const root = await svc.createUnit(f.actor, f.home, createOrgUnitSchema.parse({ name: "Engineering", slug: `engineering-${randomUUID()}` }));
    const child = await svc.createUnit(f.actor, f.home, createOrgUnitSchema.parse({ name: "Backend", slug: `backend-${randomUUID()}`, parentId: root.id }));
    await expect(svc.updateUnit(f.actor, f.home, root.id, { parentId: child.id })).rejects.toMatchObject({ status: 422 });
    await expect(svc.setMembership(f.actor, f.home, root.id, { principalType: "agent", principalId: f.guestPresence.id, role: "member", status: "active" })).rejects.toMatchObject({ status: 422 });
    await svc.setMembership(f.actor, f.home, root.id, { principalType: "agent", principalId: f.presence.id, role: "member", status: "active" });
    expect(await db.select().from(orgUnitMemberships).where(eq(orgUnitMemberships.orgUnitId, root.id))).toHaveLength(1);
    await expect(svc.listUnits({ type: "agent", source: "agent_key", companyId: f.guest, agentId: f.guestPresence.id }, f.home)).rejects.toMatchObject({ status: 403 });
  });

  it("provider configuration changes invalidate proof and repeated discovery cannot clear drift", async () => {
    const f = await seedV5Presences(db), svc = agentProviderBindingService(db);
    await qualify(f, f.home, f.presence.id);
    const original = await svc.assertRuntime(f.home, f.presence.id);
    await db.update(agents).set({ adapterConfig: { endpoint: "changed" } }).where(eq(agents.id, f.presence.id));
    await expect(svc.assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
    const snapshot = { ...original.provider.capabilitySnapshot!, version: "changed-provider", discoveredAt: new Date().toISOString() };
    const checks = { connect: true, identity: true, start: true, stream: true, wait: true, cancel: true, memoryScoping: true };
    expect((await svc.recordDiscovery(f.home, f.presence.id, snapshot, checks)).status).toBe("degraded");
    expect((await svc.recordDiscovery(f.home, f.presence.id, snapshot, checks)).status).toBe("degraded");
    await expect(svc.assertRuntime(f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
  });
});

it("private memory and sensitive source restrictions survive cross-company normalization", () => {
  const evidence = { sourceClass: "private_memory", sensitivity: "internal", metadata: { crossCompanyUsePolicy: "allow" } } as EvidenceItem;
  expect(crossCompanyEvidencePolicy(evidence)).toBe("no_export");
  expect(crossCompanyEvidencePolicy({ ...evidence, sourceClass: "artifact", sensitivity: "confidential", metadata: {} })).toBe("no_export");
  expect(crossCompanyEvidencePolicy({ ...evidence, sourceClass: "artifact", sensitivity: "confidential", metadata: { crossCompanyUsePolicy: "allow" } })).toBe("allow");
});
