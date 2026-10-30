/** 0565 PostgreSQL acceptance tests use isolated fixture tables in disposable
 * embedded databases. */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, authUsers, boardApiKeys, companies, companyMemberships, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, principalPermissionGrants, supportCases } from "@paperclipai/db";
import { updateCompanySchema } from "@paperclipai/shared";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { RESPONSIBILITY_SCAN_KINDS, runResponsibilityScanOnce, type NativeResponsibilityMetadataSource } from "../services/experience/private-0565/responsibility-scan.js";
import { enqueueResponsibilityScan, enqueueNextFairResponsibilityScan, postgresResponsibilityScanStore, readResponsibilityPointersForResolution } from "../services/experience/private-0565/responsibility-scan-store.js";
import { readAuthorizedResponsibilitySubset, type NativeResponsibilityReader } from "../services/experience/private-0565/authorized-subset-reader.js";
import { bindNativeResponsibilityReaders } from "../services/experience/private-0565/native-reader-ports.js";
import { bindKnownNativeResponsibilityPorts, nativeAgentResponsibilityReader } from "../services/experience/private-0565/native-reader-adapters.js";
import { nativeResponsibilityMetadataSources } from "../services/experience/private-0565/native-metadata-sources.js";
import { canSubjectPerformNativeRead, responsibilityPolicySubject } from "../services/experience/private-0565/native-subject-policy.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";
import { accessService } from "../services/access.js";
import { authorizationService } from "../services/authorization.js";
import { companyResponsibilityContactsService } from "../services/company-responsibility-contacts.js";
import { companyService } from "../services/companies.js";

const supportDataPolicy = { schemaVersion: 1, policyVersion: "test.support.0565.v1", recipientName: "Test Support",
  privacyNoticeUrl: "https://example.test/privacy", processingRegion: "test region",
  retentionTrigger: "after_last_customer_or_support_message", retentionDays: 30,
  backupMaxDays: 7, restoreLagDays: 2, deletionMarkerDays: 10, legalHoldPolicyId: "test.support.hold.v1" };

describe("PRIVATE 0565 responsibility scan store", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("responsibility-scan-0565-");
    db = createDb(database.connectionString, { maxConnections: 4 });
    await db.execute(sql`create table if not exists responsibility_scan_runs (
      id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade,
      contract_version integer not null default 1, status text not null default 'queued', cursor_json jsonb not null default '{}'::jsonb,
      requested_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(), lease_owner text,
      lease_token uuid, lease_expires_at timestamptz, attempt_count integer not null default 0, last_error_code text,
      started_at timestamptz, completed_at timestamptz, expires_at timestamptz not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now())`);
    await db.execute(sql`create unique index if not exists responsibility_scan_runs_one_active_per_company
      on responsibility_scan_runs(company_id) where status in ('queued','running','failed')`);
    await db.execute(sql`create table if not exists responsibility_scan_candidates (
      id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade,
      scan_run_id uuid not null references responsibility_scan_runs(id) on delete cascade, resource_kind text not null,
      resource_id text not null, source_version text not null, observed_at timestamptz not null default now(), expires_at timestamptz not null,
      unique(scan_run_id,resource_kind,resource_id))`);
    await db.execute(sql`alter table companies add column if not exists security_contact_user_id text`);
    await db.execute(sql`alter table companies add column if not exists support_incident_contact_user_id text`);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  beforeEach(async () => {
    await db.execute(sql`delete from responsibility_scan_candidates`);
    await db.execute(sql`delete from responsibility_scan_runs`);
  });

  async function company() {
    const id = randomUUID();
    await db.insert(companies).values({ id, name: "0565 scan fixture", issuePrefix: `RS${id.slice(0, 6)}` });
    return id;
  }

  it("evaluates an offline subject through current membership and native policy without a session actor", async () => {
    const companyId = await company(), userId = `subject-${randomUUID()}`, now = new Date();
    await db.insert(authUsers).values({ id: userId, name: "Offline policy subject", email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({
      companyId, principalType: "user" as const, principalId: userId, ...grant,
    })));
    const subject = responsibilityPolicySubject(userId);
    expect(subject).toMatchObject({ type: "board", userId, ignoreInstanceAdmin: true, isInstanceAdmin: false });
    expect(subject).not.toHaveProperty("source");
    expect(subject).not.toHaveProperty("sessionId");
    expect(subject).not.toHaveProperty("keyId");
    expect(await canSubjectPerformNativeRead({ db, companyId, userId, action: "company_scope:read",
      resource: { type: "company", companyId } })).toBe(true);
    await db.update(companyMemberships).set({ status: "archived" }).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
    expect(await canSubjectPerformNativeRead({ db, companyId, userId, action: "company_scope:read",
      resource: { type: "company", companyId } })).toBe(false);
  });
  const emptySources = (agentPage?: NativeResponsibilityMetadataSource): NativeResponsibilityMetadataSource[] => RESPONSIBILITY_SCAN_KINDS.map(kind =>
    kind === "agent" && agentPage ? agentPage : { kind, async readPage() { return { pointers: [], nextCursor: null, complete: true }; } });

  it("persists bounded keyset progress and resumes rather than truncating a kind", async () => {
    const companyId = await company(), now = new Date(), store = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, now);
    const firstId = randomUUID(), secondId = randomUUID();
    let pages = 0;
    const agentSource: NativeResponsibilityMetadataSource = { kind: "agent", async readPage(_company, after, limit) {
      expect(limit).toBe(40); pages++;
      if (after === null) return { pointers: [{ kind: "agent", id: firstId, sourceVersion: "a".repeat(64) }], nextCursor: firstId, complete: false };
      return { pointers: [{ kind: "agent", id: secondId, sourceVersion: "b".repeat(64) }], nextCursor: null, complete: true };
    } };
    const sources = emptySources(agentSource);
    expect(await runResponsibilityScanOnce({ store, sources, worker: "worker-a", now: () => now })).toBe("progressed");
    const lease = await store.claimDue({ worker: "inspector", now, leaseMs: 30_000, cursorTtlMs: 86_400_000 });
    expect(lease?.cursor.agent).toEqual({ after: firstId, complete: false });
    await store.releaseForNextPage({ runId: lease!.runId, owner: lease!.owner, token: lease!.token, now });
    // Continue with the regular one-page worker and confirm both pointers survive
    // the cursor boundary without a caller-visible hasMore/overflow signal.
    for (let i = 0; i < RESPONSIBILITY_SCAN_KINDS.length; i++)
      await runResponsibilityScanOnce({ store, sources, worker: `worker-${i}`, now: () => now });
    expect(pages).toBe(2);
    const pointers = await readResponsibilityPointersForResolution(db, companyId, now);
    expect(pointers.map(item => item.resource_id)).toEqual(expect.arrayContaining([firstId, secondId]));
  });

  it("admits distinct companies fairly and schedules the next full scan five minutes after completion", async () => {
    await db.update(companies).set({ status: "archived" });
    const companyIds = await Promise.all([company(), company(), company()]);
    const now = new Date(), selected: string[] = [];
    for (let i = 0; i < companyIds.length; i++) {
      const next = await enqueueNextFairResponsibilityScan(db, now);
      expect(next).toBeTruthy();
      selected.push(next!.company_id);
    }
    expect(new Set(selected).size).toBe(3);
    expect(new Set(selected)).toEqual(new Set(companyIds));

    await db.execute(sql`delete from responsibility_scan_runs where company_id in (${sql.join(companyIds.map(id => sql`${id}::uuid`), sql`,`)})`);
    const periodicCompanyId = await company();
    await enqueueResponsibilityScan(db, periodicCompanyId, now);
    const store = postgresResponsibilityScanStore(db);
    const sources = emptySources();
    let status: string | undefined;
    for (let i = 0; i < RESPONSIBILITY_SCAN_KINDS.length; i++)
      status = await runResponsibilityScanOnce({ store, sources, worker: `fair-${i}`, now: () => now });
    expect(status).toBe("complete");
    expect(await store.claimDue({ worker: "too-early", now: new Date(now.getTime() + 299_999), leaseMs: 30_000, cursorTtlMs: 86_400_000 }))
      .toBeNull();
    expect(await store.claimDue({ worker: "due", now: new Date(now.getTime() + 300_000), leaseMs: 30_000, cursorTtlMs: 86_400_000 }))
      .toMatchObject({ companyId: periodicCompanyId });
  });

  it("backs off an exhausted source company for five minutes before its next fair scan", async () => {
    await db.update(companies).set({ status: "archived" });
    const companyId = await company(), now = new Date();
    await db.execute(sql`insert into responsibility_scan_runs (company_id,status,updated_at,expires_at)
      values (${companyId}::uuid,'abandoned',${now.toISOString()},${new Date(now.getTime() + 86_400_000).toISOString()})`);
    expect(await enqueueNextFairResponsibilityScan(db, now)).toBeNull();
    expect(await enqueueNextFairResponsibilityScan(db, new Date(now.getTime() + 300_000)))
      .toMatchObject({ company_id: companyId });
  });

  it("allows exactly four persisted source-failure claims before abandoning", async () => {
    await db.update(companies).set({ status: "archived" });
    const companyId = await company(), start = new Date(), store = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, start);
    const failingSources = emptySources({ kind: "agent", async readPage() {
      throw new Error("native source is temporarily unavailable");
    } });
    const claimOffsets = [0, 5_000, 15_000, 35_000];
    for (let index = 0; index < claimOffsets.length; index++) {
      const now = new Date(start.getTime() + claimOffsets[index]!);
      const status = await runResponsibilityScanOnce({ store, sources: failingSources, worker: `failure-${index}`, now: () => now });
      const [row] = await db.execute<{ status: string; attempt_count: number; next_attempt_at: string }>(sql`
        select status, attempt_count, next_attempt_at from responsibility_scan_runs where company_id=${companyId}::uuid`);
      expect(row?.attempt_count).toBe(index + 1);
      if (index < 3) {
        expect(status).toBe("retrying");
        expect(row?.status).toBe("failed");
        expect(Date.parse(row!.next_attempt_at)).toBe(now.getTime() + 5_000 * 2 ** index);
      } else {
        expect(status).toBe("abandoned");
        expect(row?.status).toBe("abandoned");
      }
    }
    expect(await runResponsibilityScanOnce({ store, sources: failingSources, worker: "after-abandonment",
      now: () => new Date(start.getTime() + 40_000) })).toBe("idle");
  });

  it("fences an expired worker lease and lets only the new token commit", async () => {
    const companyId = await company(), now = new Date(), store = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, now);
    const old = await store.claimDue({ worker: "old", now, leaseMs: 30_000, cursorTtlMs: 86_400_000 });
    const later = new Date(now.getTime() + 31_000);
    const current = await store.claimDue({ worker: "new", now: later, leaseMs: 30_000, cursorTtlMs: 86_400_000 });
    expect(old?.token).toBeTruthy();
    expect(current?.token).not.toBe(old?.token);
    const staleCommit = await store.commitPage({ runId: old!.runId, companyId, owner: old!.owner, token: old!.token,
      now: later, kind: "agent", pointers: [], nextCursor: null, complete: true,
      pointerExpiresAt: new Date(later.getTime() + 1_800_000), cursorExpiresAt: new Date(later.getTime() + 86_400_000) });
    expect(staleCommit).toBe(false);
  });

  it("expires candidate pointers without changing the native source or returning stale identities", async () => {
    const companyId = await company(), now = new Date(), store = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, now);
    const id = randomUUID();
    const sources = emptySources({ kind: "agent", async readPage() {
      return { pointers: [{ kind: "agent", id, sourceVersion: "c".repeat(64) }], nextCursor: null, complete: true };
    } });
    for (let i = 0; i < RESPONSIBILITY_SCAN_KINDS.length; i++)
      await runResponsibilityScanOnce({ store, sources, worker: `worker-${i}`, now: () => now });
    expect((await readResponsibilityPointersForResolution(db, companyId, now)).map(item => item.resource_id)).toContain(id);
    const expired = new Date(now.getTime() + 1_800_001);
    expect(await readResponsibilityPointersForResolution(db, companyId, expired)).toEqual([]);
    // This table is only a candidate cache; no native agent/resource row exists
    // and expiry did not create, delete, or transfer any source record.
    const [count] = await db.execute<{ count: string }>(sql`select count(*)::text as count from agents where company_id=${companyId}::uuid`);
    expect(Number(count?.count ?? 0)).toBe(0);
  });
  it("produces zero output for private pointers and recomputes effective owner coverage after revocation", async () => {
    const companyId = await company(), now = new Date(), store = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, now);
    const agentId = randomUUID(), privateWorkflowId = randomUUID();
    const sources = emptySources({ kind: "agent", async readPage(_company, after) {
      if (after === null) return { pointers: [{ kind: "agent", id: agentId, sourceVersion: "d".repeat(64) }], nextCursor: null, complete: true };
      return { pointers: [], nextCursor: null, complete: true };
    } });
    // Also persist a private workflow pointer through its own native metadata page.
    sources.find(source => source.kind === "workflow")!.readPage = async () => ({
      pointers: [{ kind: "workflow", id: privateWorkflowId, sourceVersion: "e".repeat(64) }], nextCursor: null, complete: true,
    });
    for (let i = 0; i < RESPONSIBILITY_SCAN_KINDS.length; i++)
      await runResponsibilityScanOnce({ store, sources, worker: `worker-${i}`, now: () => now });
    let ownerStillAuthorized = true;
    const nativeReaders: NativeResponsibilityReader[] = RESPONSIBILITY_SCAN_KINDS.map(kind => ({
      kind, title: kind, href: "/native-owner",
      async inspectCurrent(_actor, _company, resourceId) {
        if (resourceId === privateWorkflowId) return { state: "hidden" };
        return { state: "visible", currentSourceVersion: "d".repeat(64), coveredByAuthorizedHumanOrNativeGroup: ownerStillAuthorized };
      },
    }));
    const input = { db, actor: { type: "board" as const, source: "session" as const, userId: "viewer" }, companyId,
      signal: new AbortController().signal, mayReviewCompanyResponsibility: async () => true, nativeReaders, now: () => now };
    const beforeRevocation = await readAuthorizedResponsibilitySubset(input);
    expect(beforeRevocation.needsYou).toEqual([]);
    expect(JSON.stringify(beforeRevocation)).not.toContain(privateWorkflowId);
    expect(JSON.stringify(beforeRevocation)).not.toContain(agentId);
    ownerStillAuthorized = false;
    const afterRevocation = await readAuthorizedResponsibilitySubset(input);
    expect(afterRevocation.needsYou.map(card => card.source.resourceId)).toEqual(["agent"]);
    expect(afterRevocation.needsYou[0]?.evidence).toContain("company_responsibility_MUST_REASSIGN");
    expect(JSON.stringify(afterRevocation)).not.toContain(privateWorkflowId);
    expect(JSON.stringify(afterRevocation)).not.toContain(agentId);
    expect(JSON.stringify(afterRevocation)).not.toContain("viewer");
    expect(afterRevocation.coverage).toBe("currently_authorized_subset");
  });

  it("binds a concrete native source reader for every applicable §17 kind", () => {
    const ports = bindKnownNativeResponsibilityPorts(db);
    expect(Object.keys(ports).sort()).toEqual([...RESPONSIBILITY_SCAN_KINDS].sort());
    const bound = bindNativeResponsibilityReaders(ports);
    expect(bound.map(reader => reader.kind).sort()).toEqual([...RESPONSIBILITY_SCAN_KINDS].sort());
    expect(new Set(bound.map(reader => reader.kind)).size).toBe(RESPONSIBILITY_SCAN_KINDS.length);
  });

  it("projects the two canonical contact settings through the complete 17-kind reader set", async () => {
    const companyId = await company(), now = new Date(), userId = `contact-reviewer-${randomUUID()}`;
    await db.insert(authUsers).values({ id: userId, name: userId, email: `${userId}@test.invalid`,
      emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({
      companyId, principalType: "user" as const, principalId: userId, ...grant,
    })));
    const store = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, now);
    const sources = nativeResponsibilityMetadataSources(db);
    for (let i = 0; i < RESPONSIBILITY_SCAN_KINDS.length; i++)
      await runResponsibilityScanOnce({ store, sources, worker: `contact-projection-${i}`, now: () => now });
    const result = await readAuthorizedResponsibilitySubset({ db,
      actor: { type: "board", source: "session", userId, isInstanceAdmin: false, ignoreInstanceAdmin: true },
      companyId, signal: new AbortController().signal, mayReviewCompanyResponsibility: async () => true,
      nativeReaders: bindNativeResponsibilityReaders(bindKnownNativeResponsibilityPorts(db)), now: () => now });
    expect(result.needsYou.map(card => card.source.resourceId).sort()).toEqual(["security_contact", "support_incident_contact"]);
    expect(JSON.stringify(result)).not.toContain(userId);
    expect(result).not.toHaveProperty("overflow");
    expect(result).not.toHaveProperty("hasMore");
  });

  it("returns no metadata or responsibility signal for a native Agent hidden by its current source ACL", async () => {
    const companyId = await company();
    const [agent] = await db.insert(agents).values({ companyId, name: "private ownerless agent", role: "general", status: "idle" })
      .returning({ id: agents.id });
    const viewerId = `unrelated-${randomUUID()}`;
    const actor = { type: "board" as const, source: "session" as const, userId: viewerId, isInstanceAdmin: false, ignoreInstanceAdmin: true };
    const result = await nativeAgentResponsibilityReader(db)(actor, companyId, agent!.id);
    expect(result).toEqual({ state: "hidden" });
    expect(JSON.stringify(result)).not.toContain(agent!.id);
    expect(JSON.stringify(result)).not.toContain("private ownerless agent");
    expect(JSON.stringify(result)).not.toContain(viewerId);
  });

  it("uses the current native Agent authority of the configured default and revokes coverage immediately", async () => {
    const companyId = await company(), now = new Date();
    const managerId = `agent-manager-${randomUUID()}`, ownerId = `agent-owner-${randomUUID()}`;
    await db.insert(authUsers).values([managerId, ownerId].map(id => ({ id, name: id,
      email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now })));
    const [manager, owner] = await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: managerId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: ownerId, status: "active", membershipRole: "operator" },
    ]).returning();
    await db.insert(principalPermissionGrants).values([
      ...grantsForHumanRole("owner").map(grant => ({ companyId, principalType: "user" as const, principalId: managerId, ...grant })),
      { companyId, principalType: "user", principalId: ownerId, permissionKey: "agents:configure", scope: null },
    ]);
    await db.update(companies).set({ defaultResponsibleUserId: ownerId }).where(eq(companies.id, companyId));
    const [agent] = await db.insert(agents).values({ companyId, name: "source-visible only to actual authority", role: "general", status: "idle" })
      .returning({ id: agents.id });
    const actor = { type: "board" as const, source: "session" as const, userId: managerId };
    const reader = nativeAgentResponsibilityReader(db);
    const before = await reader(actor, companyId, agent!.id);
    expect(before.state).toBe("visible");
    expect(before.state === "visible" && before.coveredByAuthorizedHumanOrNativeGroup).toBe(true);
    expect(JSON.stringify(before)).not.toContain(agent!.id);
    expect(JSON.stringify(before)).not.toContain(ownerId);

    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, owner!.id));
    const after = await reader(actor, companyId, agent!.id);
    expect(after.state).toBe("visible");
    expect(after.state === "visible" && after.coveredByAuthorizedHumanOrNativeGroup).toBe(false);
    expect(after.state === "visible" && after.classification).toBe("MUST_REASSIGN");
    expect(JSON.stringify(after)).not.toContain(agent!.id);
    expect(JSON.stringify(after)).not.toContain(ownerId);
    expect(JSON.stringify(after)).not.toContain(manager!.principalId);

    const [pausedAgent] = await db.insert(agents).values({ companyId, name: "paused unowned safe-state agent",
      role: "general", status: "paused" }).returning({ id: agents.id });
    const paused = await reader(actor, companyId, pausedAgent!.id);
    expect(paused).toMatchObject({ state: "visible", coveredByAuthorizedHumanOrNativeGroup: false,
      classification: "CAN_BE_UNOWNED_TEMPORARILY" });
  });

  it("resolves optional tenant contacts only from active verified same-company Humans and emits no IDs", async () => {
    const companyId = await company(), foreignCompanyId = await company(), now = new Date();
    const managerId = `contact-manager-${randomUUID()}`, contactId = `contact-human-${randomUUID()}`;
    const foreignId = `foreign-contact-${randomUUID()}`, inactiveId = `inactive-contact-${randomUUID()}`, outsiderId = `contact-outsider-${randomUUID()}`;
    await db.insert(authUsers).values([managerId, contactId, foreignId, inactiveId, outsiderId].map(id => ({
      id, name: id, email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now,
    })));
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: managerId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: contactId, status: "active", membershipRole: "viewer" },
      { companyId, principalType: "user", principalId: inactiveId, status: "archived", membershipRole: "viewer" },
      { companyId: foreignCompanyId, principalType: "user", principalId: foreignId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: outsiderId, status: "active", membershipRole: "viewer" },
    ]);
    await db.insert(principalPermissionGrants).values(grantsForHumanRole("owner").map(grant => ({
      companyId, principalType: "user" as const, principalId: managerId, ...grant,
    })));
    const actor = { type: "board" as const, source: "session" as const, userId: managerId };
    const reader = bindKnownNativeResponsibilityPorts(db).security_contact;
    const contactsService = companyResponsibilityContactsService(db);
    const eligibleIds = (await contactsService.listEligibleUsers(companyId)).map(user => user.id);
    expect(eligibleIds).toEqual(expect.arrayContaining([managerId, contactId]));
    expect(eligibleIds).not.toEqual(expect.arrayContaining([foreignId, inactiveId, outsiderId]));
    await expect(contactsService.assertEligible(companyId, [contactId])).resolves.toBeUndefined();
    await expect(contactsService.assertEligible(companyId, [foreignId])).rejects.toMatchObject({ status: 400 });
    await expect(contactsService.assertEligible(companyId, [inactiveId])).rejects.toMatchObject({ status: 400 });
    await db.update(companies).set({ securityContactUserId: contactId }).where(eq(companies.id, companyId));
    const genericCompany = await companyService(db).getById(companyId);
    expect(genericCompany).not.toHaveProperty("securityContactUserId");
    expect(genericCompany).not.toHaveProperty("supportIncidentContactUserId");
    expect(JSON.stringify(genericCompany)).not.toContain(contactId);
    expect(updateCompanySchema.safeParse({ securityContactUserId: contactId }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ supportIncidentContactUserId: contactId }).success).toBe(false);
    const genericUpdate = await companyService(db).update(companyId, { description: "generic response privacy check" });
    expect(genericUpdate).not.toHaveProperty("securityContactUserId");
    expect(genericUpdate).not.toHaveProperty("supportIncidentContactUserId");
    expect(JSON.stringify(genericUpdate)).not.toContain(contactId);
    const valid = await reader(actor, companyId, companyId);
    expect(valid.state).toBe("visible");
    expect(valid.state === "visible" && valid.coveredByAuthorizedHumanOrNativeGroup).toBe(true);
    expect(await canSubjectPerformNativeRead({ db, companyId, userId: contactId, action: "users:manage_permissions",
      resource: { type: "company", companyId } })).toBe(false);
    expect(JSON.stringify(valid)).not.toContain(contactId);
    expect(JSON.stringify(valid)).not.toContain(managerId);
    expect(await reader({ type: "board", source: "session", userId: outsiderId }, companyId, companyId))
      .toEqual({ state: "hidden" });

    await db.update(companies).set({ securityContactUserId: foreignId }).where(eq(companies.id, companyId));
    const foreign = await reader(actor, companyId, companyId);
    expect(foreign.state).toBe("visible");
    expect(foreign.state === "visible" && foreign.coveredByAuthorizedHumanOrNativeGroup).toBe(false);
    expect(JSON.stringify(foreign)).not.toContain(foreignId);

    await db.update(companyMemberships).set({ status: "suspended" }).where(and(
      eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, contactId)));
    await expect(contactsService.assertEligible(companyId, [contactId])).rejects.toMatchObject({ status: 400 });
    await db.update(companies).set({ supportIncidentContactUserId: contactId }).where(eq(companies.id, companyId));
    const revoked = await bindKnownNativeResponsibilityPorts(db).support_incident_contact(actor, companyId, companyId);
    expect(revoked.state).toBe("visible");
    expect(revoked.state === "visible" && revoked.coveredByAuthorizedHumanOrNativeGroup).toBe(false);
    expect(JSON.stringify(revoked)).not.toContain(contactId);
  });

  it("keeps support case details inside its native customer getter and separates the configured responder group", async () => {
    const companyId = await company(), now = new Date();
    const openerId = `support-opener-${randomUUID()}`, operatorId = `configured-operator-${randomUUID()}`;
    const memberId = `support-member-${randomUUID()}`;
    const key = `support-key-${randomUUID()}`, memberKey = `support-member-key-${randomUUID()}`;
    await db.insert(authUsers).values([openerId, operatorId, memberId].map(id => ({ id, name: id,
      email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: openerId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: memberId, status: "active", membershipRole: "member" },
    ]);
    const keyHash = createHash("sha256").update(key).digest("hex");
    const [apiKey] = await db.insert(boardApiKeys).values({ userId: openerId, name: "support reader fixture", keyHash }).returning();
    const memberKeyHash = createHash("sha256").update(memberKey).digest("hex");
    const [memberApiKey] = await db.insert(boardApiKeys).values({ userId: memberId, name: "support stranger fixture", keyHash: memberKeyHash }).returning();
    const lastMessageAt = new Date(Date.now() + 60_000);
    const [supportCase] = await db.insert(supportCases).values({ companyId, openedByUserId: openerId,
      subject: "private support case subject canary", description: "private support case body canary",
      customerStatus: "RECEIVED", dataPolicy: supportDataPolicy as never, lastMessageAt,
      expiresAt: new Date(lastMessageAt.getTime() + 30 * 86_400_000),
    }).returning({ id: supportCases.id });
    const actor = { type: "board" as const, source: "board_key" as const, userId: openerId,
      keyId: apiKey!.id, authenticatedKeyHash: keyHash };
    const withoutOperator = await bindKnownNativeResponsibilityPorts(db).support_case(actor, companyId, supportCase!.id);
    expect(withoutOperator).toEqual({ state: "hidden" });
    expect(JSON.stringify(withoutOperator)).not.toContain(supportCase!.id);
    expect(JSON.stringify(withoutOperator)).not.toContain("private support case");
    const scanStore = postgresResponsibilityScanStore(db);
    await enqueueResponsibilityScan(db, companyId, now);
    const sources = nativeResponsibilityMetadataSources(db);
    for (let i = 0; i < RESPONSIBILITY_SCAN_KINDS.length; i++)
      await runResponsibilityScanOnce({ store: scanStore, sources, worker: `support-private-${i}`, now: () => now });
    const tenantProjection = await readAuthorizedResponsibilitySubset({ db, actor, companyId,
      signal: new AbortController().signal, mayReviewCompanyResponsibility: async () => true,
      nativeReaders: bindNativeResponsibilityReaders(bindKnownNativeResponsibilityPorts(db)), now: () => now });
    expect(tenantProjection.needsYou).toEqual([]);
    expect(JSON.stringify(tenantProjection)).not.toContain(supportCase!.id);
    expect(JSON.stringify(tenantProjection)).not.toContain("private support case");
    const withOperator = await bindKnownNativeResponsibilityPorts(db, [operatorId]).support_case(actor, companyId, supportCase!.id);
    expect(withOperator).toMatchObject({ state: "visible", classification: "CAN_FALL_BACK_TO_AUTHORIZED_GROUP" });
    expect(withOperator.state === "visible" && withOperator.coveredByAuthorizedHumanOrNativeGroup).toBe(true);
    expect(JSON.stringify(withOperator)).not.toContain(operatorId);
    const stranger = { type: "board" as const, source: "board_key" as const, userId: memberId,
      keyId: memberApiKey!.id, authenticatedKeyHash: memberKeyHash };
    const hidden = await bindKnownNativeResponsibilityPorts(db, [operatorId]).support_case(stranger, companyId, supportCase!.id);
    expect(hidden).toEqual({ state: "hidden" });
    expect(JSON.stringify(hidden)).not.toContain(supportCase!.id);
    expect(JSON.stringify(hidden)).not.toContain(openerId);
  });

  it("rejects duplicate/missing per-kind native readers instead of rendering partial coverage", () => {
    const ports = Object.fromEntries(RESPONSIBILITY_SCAN_KINDS.map(kind => [kind, async () => ({ state: "hidden" as const })]));
    const bound = bindNativeResponsibilityReaders(ports as Parameters<typeof bindNativeResponsibilityReaders>[0]);
    expect(bound.map(reader => reader.kind).sort()).toEqual([...RESPONSIBILITY_SCAN_KINDS].sort());
    expect(new Set(bound.map(reader => reader.kind)).size).toBe(RESPONSIBILITY_SCAN_KINDS.length);
    expect(() => bindNativeResponsibilityReaders({ ...ports, approval: undefined } as never)).toThrow();
  });

  it("scans native agent metadata in stable 40-row pages without selecting content fields", async () => {
    const companyId = await company();
    const fixture = Array.from({ length: 41 }, (_, index) => ({ companyId, name: `private metadata agent ${index}`, role: "general", status: "idle" }));
    const created = await db.insert(agents).values(fixture).returning({ id: agents.id });
    const source = nativeResponsibilityMetadataSources(db).find(item => item.kind === "agent")!;
    const first = await source.readPage(companyId, null, 40);
    expect(first.pointers).toHaveLength(40);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).toBe(first.pointers.at(-1)?.id);
    const second = await source.readPage(companyId, first.nextCursor, 40);
    expect(second.pointers).toHaveLength(1);
    expect(second.complete).toBe(true);
    expect(second.nextCursor).toBeNull();
    expect([...first.pointers, ...second.pointers].map(pointer => pointer.id).sort())
      .toEqual(created.map(row => row.id).sort());
    expect(JSON.stringify([...first.pointers, ...second.pointers])).not.toContain("private metadata agent");
  });

  it("keeps membership and contact revocation committed when the post-commit scan enqueue fails", async () => {
    await db.update(companies).set({ status: "archived" });
    const companyId = await company(), now = new Date();
    const ownerId = `offboard-owner-${randomUUID()}`, memberId = `offboard-member-${randomUUID()}`,
      defaultHolderId = `offboard-default-holder-${randomUUID()}`, securityHolderId = `offboard-security-holder-${randomUUID()}`;
    await db.insert(authUsers).values([ownerId, memberId, defaultHolderId, securityHolderId].map(id => ({ id, name: id,
      email: `${id}@test.invalid`, emailVerified: true, createdAt: now, updatedAt: now })));
    const members = await db.insert(companyMemberships).values([
      { companyId, principalType: "user", principalId: ownerId, status: "active", membershipRole: "owner" },
      { companyId, principalType: "user", principalId: memberId, status: "active", membershipRole: "operator" },
      { companyId, principalType: "user", principalId: defaultHolderId, status: "active", membershipRole: "operator" },
      { companyId, principalType: "user", principalId: securityHolderId, status: "active", membershipRole: "operator" },
    ]).returning();
    const member = members.find(row => row.principalId === memberId);
    await db.insert(principalPermissionGrants).values([
      ...grantsForHumanRole("owner").map(grant => ({ companyId, principalType: "user" as const, principalId: ownerId, ...grant })),
      ...grantsForHumanRole("operator").map(grant => ({ companyId, principalType: "user" as const, principalId: memberId, ...grant })),
    ]);
    await db.update(companies).set({ defaultResponsibleUserId: defaultHolderId, securityContactUserId: securityHolderId,
      supportIncidentContactUserId: memberId }).where(eq(companies.id, companyId));
    await db.execute(sql`alter table responsibility_scan_runs rename to responsibility_scan_runs_offboard_failure`);
    try {
      await expect(accessService(db).updateMember(companyId, member!.id, { status: "suspended" }, ownerId)).resolves.toMatchObject({ status: "suspended" });
      const [current] = await db.select({ status: companyMemberships.status }).from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, memberId))).limit(1);
      expect(current?.status).toBe("suspended");
      const [companyRow] = await db.select({ defaultResponsibleUserId: companies.defaultResponsibleUserId,
        securityContactUserId: companies.securityContactUserId, supportIncidentContactUserId: companies.supportIncidentContactUserId })
        .from(companies).where(eq(companies.id, companyId));
      expect(companyRow).toEqual({ defaultResponsibleUserId: defaultHolderId, securityContactUserId: securityHolderId,
        supportIncidentContactUserId: null });
      const denied = await authorizationService(db).decide({ actor: responsibilityPolicySubject(memberId),
        action: "company_scope:read", resource: { type: "company", companyId } });
      expect(denied.allowed).toBe(false);
    } finally {
      await db.execute(sql`alter table responsibility_scan_runs_offboard_failure rename to responsibility_scan_runs`);
    }
  });

});
