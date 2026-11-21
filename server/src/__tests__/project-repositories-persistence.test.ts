import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, companyMemberships, companySecrets, connectionGrants, connectionGrantMembers, toolApplications, toolConnections, createDb, projects as projectTable } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { toolAccessService } from "../services/tool-access.js";
import { projectService } from "../services/projects.js";
import { secretService } from "../services/secrets.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

vi.mock("../services/secrets.js", async () => {
  const actual = await vi.importActual<typeof import("../services/secrets.js")>("../services/secrets.js");
  return { ...actual, secretService: (db: Parameters<typeof actual.secretService>[0]) => {
    const service = actual.secretService(db);
    return { ...service, resolveSecretValue: async (_companyId: string, secretId: string) => secretId };
  } };
});

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("project repository persistence", () => {
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  const repo = (id: string) => ({ id, fullName: `org/repo-${id}`, url: `https://github.com/org/repo-${id}`, connections: [] });
  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }
  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("paperclip-repositories-");
    db = createDb(temp.connectionString);
    [companyId] = (await db.insert(companies).values({ name: "Repositories", issuePrefix: "REPO" }).returning()).map((company) => company.id);
  }, 20_000);
  afterAll(async () => { await temp?.cleanup(); });
  afterEach(() => vi.unstubAllGlobals());

  it("creates multiple source repos atomically and persists them across reads", async () => {
    const svc = projectService(db);
    const created = await svc.createWithRepositories(companyId, { name: "Multi" }, [repo("1"), repo("2")]);
    const fetched = await svc.getById(created.id);
    expect(fetched?.workspaces.map((workspace) => workspace.repoUrl).sort()).toEqual([repo("1").url, repo("2").url]);
    expect(fetched?.workspaces.filter((workspace) => workspace.isPrimary)).toHaveLength(1);
    expect(fetched?.workspaces.every((workspace) => workspace.companyId === companyId)).toBe(true);
  });
  it("adds/removes repos, promotes the remaining primary, and preserves legacy and local config", async () => {
    const svc = projectService(db);
    const created = await svc.createWithRepositories(companyId, { name: "Edit" }, [repo("3"), repo("4")]);
    const legacy = await svc.createWorkspace(created.id, { repoUrl: "https://git.example/legacy/repo" });
    const local = await svc.createWorkspace(created.id, { cwd: "/tmp/local-project", repoUrl: repo("5").url, metadata: { githubRepositoryId: "5", retained: true } });
    const updated = await svc.replaceRepositories(created.id, [repo("4"), repo("6")]);
    expect(updated?.workspaces.find((workspace) => workspace.id === legacy!.id)?.repoUrl).toBe("https://git.example/legacy/repo");
    expect(updated?.workspaces.find((workspace) => workspace.id === local!.id)).toMatchObject({ cwd: "/tmp/local-project", repoUrl: null, metadata: { retained: true } });
    expect(updated?.workspaces.some((workspace) => workspace.repoUrl === repo("3").url)).toBe(false);
    expect(updated?.workspaces.filter((workspace) => workspace.isPrimary)).toHaveLength(1);
    const repeated = await svc.replaceRepositories(created.id, [repo("4"), repo("6")]);
    expect(repeated?.workspaces).toHaveLength(updated!.workspaces.length);
  });
  it("handles a repo recreated at the same URL with a new GitHub identity", async () => {
    const svc = projectService(db);
    const original = repo("20");
    const created = await svc.createWithRepositories(companyId, { name: "Recreated" }, [original]);
    const updated = await svc.replaceRepositories(created.id, [{ ...original, id: "21" }]);
    expect(updated?.workspaces).toHaveLength(1);
    expect(updated?.workspaces[0]?.metadata?.githubRepositoryId).toBe("21");
  });

  it("refreshes renamed and transferred repositories without replacing workspace identity or configuration", async () => {
    const svc = projectService(db);
    const created = await svc.createWithRepositories(companyId, { name: "Renamed" }, [repo("22")]);
    const workspace = created.workspaces[0];
    await svc.updateWorkspace(created.id, workspace.id, { cwd: "/tmp/renamed-project", repoRef: "release", metadata: { ...workspace.metadata, retained: true } });
    const renamed = { ...repo("22"), fullName: "new-owner/new-name", url: "https://github.com/new-owner/new-name" };
    const updated = await svc.replaceRepositories(created.id, [renamed]);
    expect(updated?.workspaces).toHaveLength(1);
    expect(updated?.workspaces[0]).toMatchObject({ id: workspace.id, name: renamed.fullName, repoUrl: renamed.url, cwd: "/tmp/renamed-project", repoRef: "release", isPrimary: true, metadata: { githubRepositoryId: "22", retained: true } });
    expect(updated?.codebase.repoUrl).toBe(renamed.url);
  });

  it("loads only usable connection grants, deduplicates repos, and reports partial provider failures", async () => {
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: "alice", membershipRole: "admin" });
    const [otherCompany] = await db.insert(companies).values({ name: "Other", issuePrefix: "OTHER" }).returning();
    const tokenRepos = new Map<string, Array<{ id: number; full_name: string }>>();
    async function connection(name: string, kind: "user" | "organization", owner: string | null, audience: string[] = [], targetCompanyId = companyId) {
      const [app] = await db.insert(toolApplications).values({ companyId: targetCompanyId, name, type: "mcp_http" }).returning();
      const [secret] = await db.insert(companySecrets).values({ companyId: targetCompanyId, name, key: name }).returning();
      const [conn] = await db.insert(toolConnections).values({ companyId: targetCompanyId, applicationId: app.id, name, uid: name, status: "active", enabled: true,
        transport: "mcp_remote", authKind: "api_key", credentialPolicy: kind === "user" ? "per_user" : "shared", config: { sourceTemplateKey: "github" } }).returning();
      const [grant] = await db.insert(connectionGrants).values({ companyId: targetCompanyId, connectionId: conn.id, kind, subjectUserId: owner,
        credentialSecretRefs: [{ secretId: secret.id, configPath: "credentials.authorization", versionSelector: "latest" }] }).returning();
      for (const subjectId of audience) await db.insert(connectionGrantMembers).values({ companyId: targetCompanyId, grantId: grant.id, subjectType: "user", subjectId });
      return secret.id;
    }
    const personal = await connection("personal", "user", "alice");
    const shared = await connection("shared", "organization", null);
    const otherPerson = await connection("other-person", "user", "bob");
    const restricted = await connection("restricted", "organization", null, ["bob"]);
    const crossCompany = await connection("cross-company", "organization", null, [], otherCompany.id);
    const broken = await connection("broken", "organization", null);
    tokenRepos.set(personal, [{ id: 10, full_name: "org/common" }, { id: 11, full_name: "alice/private" }]);
    tokenRepos.set(shared, [{ id: 10, full_name: "org/common" }, { id: 12, full_name: "org/shared" }]);
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
      if (token === broken) return new Response("secret-provider-error", { status: 503 });
      expect([otherPerson, restricted, crossCompany]).not.toContain(token);
      return Response.json(tokenRepos.get(token) ?? []);
    });
    vi.stubGlobal("fetch", request);
    const result = await toolAccessService(db).listProjectRepositories(companyId, "alice", false, true);
    expect(result.connectionCount).toBe(3);
    expect(result.failedConnectionCount).toBe(1);
    expect(result.repositories.map((repo) => repo.id).sort()).toEqual(["10", "11", "12"]);
    expect(result.repositories.find((repo) => repo.id === "10")?.connections.sort()).toEqual(["personal", "shared"]);
    expect(JSON.stringify(result)).not.toContain("secret-provider-error");
    expect(request).toHaveBeenCalledTimes(3);
    const revokedMembership = await db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.principalId, "alice")).returning();
    expect(revokedMembership).toHaveLength(1);
    expect((await toolAccessService(db).listProjectRepositories(companyId, "alice")).repositories).toEqual([]);
    await expect(toolAccessService(db).assertProjectRepositoryAuthorizationWitnessesCurrent({ companyId, userId: "alice",
      repositoryIds: ["10"], witnesses: result.repositoryAuthorizationWitnesses?.["10"] ?? [] })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rechecks each selected repository's original grant path and serializes revocation without provider I/O", async () => {
    const [tenant] = await db.insert(companies).values({ name: "Repository grant race", issuePrefix: `R${Date.now()}` }).returning();
    const userId = `human-${tenant.id}`;
    await db.insert(companyMemberships).values({ companyId: tenant.id, principalType: "user", principalId: userId,
      membershipRole: "admin", status: "active" });
    const tokenRepos = new Map<string, Array<{ id: number; full_name: string }>>();
    async function connection(name: string, kind: "user" | "organization", owner: string | null,
      repositories: Array<{ id: number; full_name: string }>) {
      const [app] = await db.insert(toolApplications).values({ companyId: tenant.id, name, type: "mcp_http" }).returning();
      const [secret] = await db.insert(companySecrets).values({ companyId: tenant.id, name, key: name }).returning();
      const [conn] = await db.insert(toolConnections).values({ companyId: tenant.id, applicationId: app.id, name, uid: name,
        status: "active", enabled: true, transport: "mcp_remote", authKind: "api_key",
        credentialPolicy: kind === "user" ? "per_user" : "shared", config: { sourceTemplateKey: "github" } }).returning();
      const [grant] = await db.insert(connectionGrants).values({ companyId: tenant.id, connectionId: conn.id, kind,
        subjectUserId: owner, credentialSecretRefs: [{ secretId: secret.id, configPath: "credentials.authorization", versionSelector: "latest" }] }).returning();
      tokenRepos.set(secret.id, repositories);
      return { connectionId: conn.id, grantId: grant.id };
    }
    const personal = await connection("witness-personal", "user", userId, [
      { id: 40, full_name: "org/shared-repo" }, { id: 41, full_name: "org/personal-only" },
    ]);
    await connection("witness-organization", "organization", null, [
      { id: 40, full_name: "org/shared-repo" },
    ]);
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
      return Response.json(tokenRepos.get(token) ?? []);
    });
    vi.stubGlobal("fetch", request);
    const listing = await toolAccessService(db).listProjectRepositories(tenant.id, userId, false, true);
    const witnesses = listing.repositoryAuthorizationWitnesses;
    expect(witnesses?.["40"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ repositoryId: "40", connectionId: personal.connectionId, grantId: personal.grantId,
        authorizationVersion: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]));
    expect(witnesses?.["41"]).toEqual([expect.objectContaining({ repositoryId: "41", connectionId: personal.connectionId,
      grantId: personal.grantId, authorizationVersion: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(witnesses?.["40"]).toHaveLength(2);
    const personalOnly = witnesses?.["41"] ?? [];
    const originalVersion = personalOnly[0]?.authorizationVersion;
    expect(originalVersion).toMatch(/^[0-9a-f]{64}$/);
    const rotatedCredential = await secretService(db).create(tenant.id, { name: `Rotated repository credential ${randomUUID()}`,
      key: `github.rotated.${randomUUID()}`, provider: "local_encrypted", value: "rotated-repository-token" }, { userId });
    tokenRepos.set(rotatedCredential.id, [{ id: 40, full_name: "org/shared-repo" }, { id: 41, full_name: "org/personal-only" }]);
    await db.update(connectionGrants).set({ credentialSecretRefs: [{ secretId: rotatedCredential.id,
      configPath: "credentials.authorization", versionSelector: "latest" }] }).where(eq(connectionGrants.id, personal.grantId));
    await expect(toolAccessService(db).assertProjectRepositoryAuthorizationWitnessesCurrent({
      companyId: tenant.id, userId, repositoryIds: ["41"], witnesses: personalOnly,
    })).rejects.toThrow();
    const refreshedListing = await toolAccessService(db).listProjectRepositories(tenant.id, userId, false, true);
    const refreshedPersonalOnly = refreshedListing.repositoryAuthorizationWitnesses?.["41"] ?? [];
    expect(refreshedPersonalOnly[0]?.authorizationVersion).not.toBe(originalVersion);
    const locked = deferred<number>();
    const release = deferred<void>();
    const ownerTransaction = db.transaction(async (tx) => {
      await toolAccessService(tx as unknown as typeof db).assertProjectRepositoryAuthorizationWitnessesCurrent({
        companyId: tenant.id, userId, repositoryIds: ["41"], witnesses: refreshedPersonalOnly,
      });
      const [pid] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      locked.resolve(Number(pid!.pid));
      await release.promise;
    });
    const ownerOutcome = ownerTransaction.then(() => null, error => error);
    let revoker: Promise<unknown> | null = null;
    let revokePid: number | null = null;
    try {
      const ownerPid = await Promise.race([locked.promise, ownerOutcome.then(error => {
        throw error ?? new Error("repository witness transaction completed before it acquired the grant lock");
      })]);
      revoker = db.transaction(async (tx) => {
        const [pid] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        revokePid = Number(pid!.pid);
        await tx.update(connectionGrants).set({ status: "revoked", revokedAt: new Date() })
          .where(eq(connectionGrants.id, personal.grantId));
      });
      let waiting = false;
      for (let attempt = 0; attempt < 300; attempt++) {
        if (revokePid !== null) {
          const [row] = await db.execute<{ waiting: number }>(sql`select count(*)::int as waiting
            from pg_stat_activity a where a.datname=current_database() and a.pid=${revokePid}::int
              and a.wait_event_type='Lock' and ${ownerPid}::int = any(pg_blocking_pids(a.pid))`);
          if ((row?.waiting ?? 0) > 0) { waiting = true; break; }
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting, "grant revocation must wait while the source-qualified Project owner holds the exact grant").toBe(true);
    } finally {
      release.resolve();
    }
    expect(await ownerOutcome).toBeNull();
    await revoker;
    expect(request).toHaveBeenCalledTimes(4);
    await expect(db.transaction(tx => toolAccessService(tx as unknown as typeof db)
      .assertProjectRepositoryAuthorizationWitnessesCurrent({ companyId: tenant.id, userId,
        repositoryIds: ["40"], witnesses: witnesses?.["40"] ?? [] }))).resolves.toBeUndefined();
    await expect(db.transaction(tx => toolAccessService(tx as unknown as typeof db)
      .assertProjectRepositoryAuthorizationWitnessesCurrent({ companyId: tenant.id, userId,
        repositoryIds: ["41"], witnesses: personalOnly }))).rejects.toThrow("authorization changed");
    await expect(db.transaction(tx => toolAccessService(tx as unknown as typeof db)
      .assertProjectRepositoryAuthorizationWitnessesCurrent({ companyId: tenant.id, userId,
        repositoryIds: ["40", "41"], witnesses: [...(witnesses?.["40"] ?? []), ...personalOnly] })))
      .rejects.toThrow("authorization changed");
  });

  it("tracks the selected grant secret's latest version without requiring unused parent credentials", async () => {
    const [tenant] = await db.insert(companies).values({ name: "Repository secret version", issuePrefix: `S${Date.now()}` }).returning();
    const userId = `human-${tenant.id}`;
    await db.insert(companyMemberships).values({ companyId: tenant.id, principalType: "user", principalId: userId,
      membershipRole: "admin", status: "active" });
    const credential = await secretService(db).create(tenant.id, { name: `Repository token ${randomUUID()}`,
      key: `github.repository.${randomUUID()}`, provider: "local_encrypted", value: "repository-token-v1" }, { userId });
    const [app] = await db.insert(toolApplications).values({ companyId: tenant.id,
      name: "Repository secret version", type: "mcp_http" }).returning();
    const [connection] = await db.insert(toolConnections).values({ companyId: tenant.id, applicationId: app!.id,
      name: "Repository secret version", uid: `repository-secret-${randomUUID()}`, status: "active", enabled: true,
      transport: "mcp_remote", authKind: "api_key", credentialPolicy: "shared",
      config: { sourceTemplateKey: "github" }, credentialRefs: [],
      // This obsolete parent reference is not selected while the usable grant below owns the credential.
      credentialSecretRefs: [{ secretId: randomUUID(), configPath: "credentials.obsolete", versionSelector: "latest" }] }).returning();
    const [grant] = await db.insert(connectionGrants).values({ companyId: tenant.id, connectionId: connection!.id,
      kind: "organization", credentialSecretRefs: [{ secretId: credential.id,
        configPath: "credentials.authorization", versionSelector: "latest" }], status: "active" }).returning();
    await db.insert(connectionGrantMembers).values({ companyId: tenant.id, grantId: grant!.id,
      subjectType: "user", subjectId: userId });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json([
      { id: 91, full_name: "org/versioned-repository" },
    ])));

    const original = await toolAccessService(db).listProjectRepositories(tenant.id, userId, false, true);
    const originalWitness = original.repositoryAuthorizationWitnesses?.["91"] ?? [];
    expect(original.repositories.map(repository => repository.id)).toEqual(["91"]);
    expect(originalWitness).toHaveLength(1);
    const originalVersion = originalWitness[0]!.authorizationVersion;
    await secretService(db).rotate(credential.id, { value: "repository-token-v2", expectedLatestVersion: 1 }, { userId });
    const refreshed = await toolAccessService(db).listProjectRepositories(tenant.id, userId, false, true);
    const refreshedWitness = refreshed.repositoryAuthorizationWitnesses?.["91"] ?? [];
    expect(refreshed.repositories.map(repository => repository.id)).toEqual(["91"]);
    expect(refreshedWitness[0]?.authorizationVersion).not.toBe(originalVersion);
    await expect(toolAccessService(db).assertProjectRepositoryAuthorizationWitnessesCurrent({ companyId: tenant.id,
      userId, repositoryIds: ["91"], witnesses: originalWitness })).rejects.toThrow();
  });

  it("rolls back the project if a later repository insert fails", async () => {
    const svc = projectService(db);
    await expect(svc.createWithRepositories(companyId, { name: "Rollback" }, [repo("7"), { ...repo("8"), fullName: "invalid" + String.fromCharCode(0) + "name" }])).rejects.toThrow();
    expect(await db.select().from(projectTable).where(eq(projectTable.name, "Rollback"))).toEqual([]);
  });
});
