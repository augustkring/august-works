import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, rolePackItems, rolePacks, rolePackVersions } from "@paperclipai/db";
import { mergeRolePackItems, rolePackItemSchema, rolePackVersionInputSchema } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";
import { rolePackService } from "../services/role-packs.js";
import { skillResolverService } from "../services/skill-resolver.js";

it("Role Pack overlays can remove recommendations but cannot remove mandatory policies or conflict with pins", () => {
  const mandatory = rolePackItemSchema.parse({ type: "required_policy", ref: "budget_hard_stop" });
  expect(() => rolePackItemSchema.parse({ ...mandatory, operation: "remove" })).toThrow();
  const optional = rolePackItemSchema.parse({ type: "recommended_skill", ref: "optional" });
  expect(mergeRolePackItems([[mandatory, optional], [{ ...optional, operation: "remove" }]])).toEqual([mandatory]);
  const required = rolePackItemSchema.parse({ type: "required_skill", ref: "required", versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  expect(() => mergeRolePackItems([[required], [{ ...required, versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]])).toThrow("Conflicting");
});

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("V5 immutable local Role Packs", () => {
  let db!: ReturnType<typeof createDb>, database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => { database = await startEmbeddedPostgresTestDatabase("aw-v5-role-packs-"); db = createDb(database.connectionString); await enableV5ForTest(db); });
  afterAll(async () => { await database?.cleanup(); });
  it("requires missing task-specific procedures only for matching tasks while preserving mandatory baselines", async () => {
    const f = await seedV5Presences(db), resolver = skillResolverService(db);
    const requirement = rolePackItemSchema.parse({ type: "required_skill", ref: "database-change-safety", triggerTerms: ["migration"], excludeTerms: ["explain only"] });
    expect((await resolver.resolve(f.actor, f.home, "Summarize the approved context", [requirement])).skills).toEqual([]);
    expect((await resolver.resolve(f.actor, f.home, "Explain only the migration process", [requirement])).skills).toEqual([]);
    await expect(resolver.resolve(f.actor, f.home, "Apply the database migration", [requirement])).rejects.toMatchObject({ status: 409 });
    await expect(resolver.resolve(f.actor, f.home, "Summarize the approved context", [{ ...requirement, loadPoint: "always" }])).rejects.toMatchObject({ status: 409 });
  });
  it("pins published versions, rejects stale publication and keeps system security requirements", async () => {
    const f = await seedV5Presences(db), svc = rolePackService(db);
    const pack = await svc.create(f.actor, f.home, { key: "local-overlay", name: "Local", description: "" });
    const draft = await svc.createVersion(f.actor, f.home, pack.id, rolePackVersionInputSchema.parse({ items: [{ type: "recommended_skill", ref: "local-context" }] }));
    await svc.publish(f.actor, f.home, pack.id, draft.id, null);
    await svc.assign(f.actor, f.home, { scopeType: "agent", scopeId: f.presence.id, rolePackId: pack.id, versionPolicy: "pinned", pinnedVersionId: draft.id });
    const next = await svc.createVersion(f.actor, f.home, pack.id, rolePackVersionInputSchema.parse({ items: [{ type: "recommended_skill", ref: "changed" }] }));
    await expect(svc.publish(f.actor, f.home, pack.id, next.id, null)).rejects.toMatchObject({ status: 409 });
    await svc.publish(f.actor, f.home, pack.id, next.id, draft.id);
    const resolved = await svc.resolve(f.actor, f.home, f.presence.id);
    expect(resolved.pins[0]!.versionId).toBe(draft.id);
    expect(resolved.items).toEqual(expect.arrayContaining([expect.objectContaining({ ref: "budget_hard_stop" }), expect.objectContaining({ ref: "source_provenance" }), expect.objectContaining({ ref: "local-context" })]));
    await expect(db.update(rolePackVersions).set({ summary: "rewrite" }).where(eq(rolePackVersions.id, draft.id))).rejects.toThrow();
    await expect(db.update(rolePackItems).set({ item: rolePackItemSchema.parse({ type: "required_policy", ref: "budget_hard_stop" }) }).where(eq(rolePackItems.versionId, draft.id))).rejects.toThrow();
    await expect(db.insert(rolePackItems).values({ companyId: f.home, versionId: draft.id, ordinal: 9, item: rolePackItemSchema.parse({ type: "required_skill", ref: "injected" }) })).rejects.toThrow();
  });
  it("rejects foreign local assignments and cross-company version pointers at the database boundary", async () => {
    const f = await seedV5Presences(db), svc = rolePackService(db);
    const local = await svc.create(f.actor, f.home, { key: "home", name: "Home", description: "" }), foreign = await svc.create(f.actor, f.guest, { key: "guest", name: "Guest", description: "" });
    const draft = await svc.createVersion(f.actor, f.guest, foreign.id, rolePackVersionInputSchema.parse({ items: [] }));
    await expect(svc.assign(f.actor, f.home, { scopeType: "agent", scopeId: f.guestPresence.id, rolePackId: local.id, versionPolicy: "follow_published", pinnedVersionId: null })).rejects.toMatchObject({ status: 422 });
    await expect(db.update(rolePacks).set({ publishedVersionId: draft.id }).where(eq(rolePacks.id, local.id))).rejects.toThrow();
    await expect(svc.getVersion(f.actor, f.home, foreign.id, draft.id)).rejects.toMatchObject({ status: 404 });
  });
});
