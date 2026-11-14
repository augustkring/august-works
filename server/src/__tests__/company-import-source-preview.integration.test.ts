import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { ImportSourceChangedError } from "../errors.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const remote = vi.hoisted(() => ({ files: {} as Record<string, string>, requests: [] as string[], sha: "a".repeat(40),
  treeSha: "b".repeat(40), missingRefs: new Set<string>(), treeTruncated: false, treeStatus: 200,
  commitStatus: 200, invalidCommitIdentity: false, mismatchTree: false }));
vi.mock("../services/github-fetch.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/github-fetch.js")>(),
  ghFetch: vi.fn(async (url: string) => {
    remote.requests.push(url);
    if (url.endsWith(`/repos/example/reviewed`)) return Response.json({ id: 42 });
    if (url.includes("/commits/")) {
      if (remote.commitStatus !== 200) return Response.json({}, { status: remote.commitStatus });
      const ref = decodeURIComponent(new URL(url).pathname.split("/commits/")[1] ?? "");
      if (remote.missingRefs.has(ref)) return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json({ sha: remote.invalidCommitIdentity ? "not-a-commit" : remote.sha,
        commit: { tree: { sha: remote.treeSha } } });
    }
    if (url.includes("/git/trees/")) {
      if (remote.treeStatus !== 200) return Response.json({}, { status: remote.treeStatus });
      return Response.json({ sha: remote.mismatchTree ? "f".repeat(40) : remote.treeSha, truncated: remote.treeTruncated,
        tree: Object.keys(remote.files).map(path => ({ path, type: "blob" })) });
    }
    const marker = `/${remote.sha}/`;
    const filePath = new URL(url).pathname.split(marker)[1];
    return new Response(remote.files[filePath] ?? "missing", { status: filePath in remote.files ? 200 : 404 });
  }),
}));
const { companyPortabilityService } = await import("../services/company-portability.js");

describe("native import binds a reviewed GitHub source to one commit", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("import-source-preview-");
    db = createDb(database.connectionString, { maxConnections: 4 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);
  beforeEach(() => {
    remote.files = {};
    remote.requests = [];
    remote.sha = "a".repeat(40);
    remote.treeSha = "b".repeat(40);
    remote.missingRefs = new Set();
    remote.treeTruncated = false;
    remote.treeStatus = 200;
    remote.commitStatus = 200;
    remote.invalidCommitIdentity = false;
    remote.mismatchTree = false;
  });

  it("refuses drift at the same URL before changing the target or creating an Agent", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Original target", issuePrefix: `ISP${companyId.slice(0, 5)}` });
    remote.files = {
      "COMPANY.md": "---\nname: Reviewed company\nincludes:\n  - agents/worker/AGENTS.md\n---\n",
      "agents/worker/AGENTS.md": "---\nname: Worker\nslug: worker\nkind: agent\n---\nReviewed worker body\n",
      ".paperclip.yaml": "schema: paperclip/v1\nagents:\n  worker:\n    adapter:\n      type: codex_local\n      config: {}\n",
    };
    remote.sha = "a".repeat(40);
    remote.missingRefs = new Set();
    remote.treeTruncated = false;
    remote.treeStatus = 200;
    remote.commitStatus = 200;
    remote.invalidCommitIdentity = false;
    remote.mismatchTree = false;
    remote.requests = [];
    const owner = companyPortabilityService(db);
    const input = { source: { type: "github" as const, url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: true, projects: false, issues: false, skills: false },
      target: { mode: "existing_company" as const, companyId }, collisionStrategy: "rename" as const };
    const preview = await owner.previewImport(input);
    expect(preview.errors).toEqual([]);
    expect(preview.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(remote.requests.some(url => url.includes(`/${remote.sha}/agents/worker/AGENTS.md`))).toBe(true);
    expect(remote.requests.some(url => url.includes(`/${remote.sha}/COMPANY.md`))).toBe(true);
    expect(remote.requests.some(url => url.includes(`/${remote.sha}/.paperclip.yaml`))).toBe(true);
    expect(remote.requests.filter(url => url.includes("raw.githubusercontent.com")).every(url => url.includes(`/${remote.sha}/`))).toBe(true);
    remote.sha = "c".repeat(40);
    await expect(owner.importBundle({ ...input, expectedSourceFingerprint: preview.sourceFingerprint }, null))
      .rejects.toBeInstanceOf(ImportSourceChangedError);
    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId))).toEqual([]);
    const [target] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.name, "Original target")));
    expect(target?.id).toBe(companyId);
  }, 60_000);

  it("rejects changed file bytes at the same source commit before making changes", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Changed bytes target", issuePrefix: `CB${companyId.slice(0, 5)}` });
    remote.files = { "COMPANY.md": "---\nname: Reviewed bytes\n---\n" };
    const input = { source: { type: "github" as const, url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company" as const, companyId }, collisionStrategy: "rename" as const };
    const owner = companyPortabilityService(db);
    const preview = await owner.previewImport(input);
    remote.files["COMPANY.md"] += "Changed after preview\n";
    await expect(owner.importBundle({ ...input, expectedSourceFingerprint: preview.sourceFingerprint }, null))
      .rejects.toBeInstanceOf(ImportSourceChangedError);
    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId))).toEqual([]);
  }, 60_000);

  it("falls back only when main ref resolution returns 404", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Fallback target", issuePrefix: `FB${companyId.slice(0, 5)}` });
    remote.files = { "COMPANY.md": "---\nname: Fallback\n---\n" };
    remote.requests = [];
    remote.sha = "d".repeat(40);
    remote.missingRefs = new Set(["main"]);
    const preview = await companyPortabilityService(db).previewImport({ source: { type: "github", url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename" });
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toContain("GitHub ref main not found; falling back to master.");
    expect(remote.requests.some(url => url.endsWith("/commits/main"))).toBe(true);
    expect(remote.requests.some(url => url.endsWith("/commits/master"))).toBe(true);
    expect(remote.requests.some(url => url.includes(`/${remote.sha}/COMPANY.md`))).toBe(true);
    remote.missingRefs = new Set();
  }, 60_000);

  it.each([
    ["truncated tree", () => { remote.treeTruncated = true; }],
    ["failed tree", () => { remote.treeStatus = 403; }],
  ])("rejects an incomplete %s", async (_label, configure) => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Incomplete tree target", issuePrefix: `IT${companyId.slice(0, 5)}` });
    remote.files = { "COMPANY.md": "---\nname: Incomplete\n---\n" };
    remote.sha = "e".repeat(40);
    remote.missingRefs = new Set();
    remote.treeTruncated = false;
    remote.treeStatus = 200;
    remote.invalidCommitIdentity = false;
    remote.mismatchTree = false;
    configure();
    await expect(companyPortabilityService(db).previewImport({ source: { type: "github", url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename" })).rejects.toThrow();
    remote.treeTruncated = false;
    remote.treeStatus = 200;
  }, 60_000);

  it.each([
    ["missing commit", () => { remote.missingRefs = new Set(["main", "master"]); }],
    ["invalid commit identity", () => { remote.invalidCommitIdentity = true; }],
    ["tree identity mismatch", () => { remote.mismatchTree = true; }],
  ])("rejects a %s before reading package files", async (_label, configure) => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Invalid revision target", issuePrefix: `IR${companyId.slice(0, 5)}` });
    remote.files = { "COMPANY.md": "---\nname: Invalid revision\n---\n" };
    remote.requests = [];
    remote.sha = "9".repeat(40);
    remote.missingRefs = new Set();
    remote.invalidCommitIdentity = false;
    remote.mismatchTree = false;
    configure();
    await expect(companyPortabilityService(db).previewImport({ source: { type: "github", url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename" })).rejects.toThrow();
    expect(remote.requests.some(url => url.includes("raw.githubusercontent.com"))).toBe(false);
    remote.invalidCommitIdentity = false;
    remote.mismatchTree = false;
    remote.missingRefs = new Set();
  }, 60_000);

  it("does not treat a GitHub API failure as a missing main ref", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "API failure target", issuePrefix: `AF${companyId.slice(0, 5)}` });
    remote.requests = [];
    remote.commitStatus = 403;
    await expect(companyPortabilityService(db).previewImport({ source: { type: "github", url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename" })).rejects.toThrow();
    expect(remote.requests.some(url => url.endsWith("/commits/master"))).toBe(false);
    remote.commitStatus = 200;
  }, 60_000);

  it("does not use master when COMPANY.md is missing at the resolved main commit", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Missing company doc target", issuePrefix: `MC${companyId.slice(0, 5)}` });
    remote.files = {};
    await expect(companyPortabilityService(db).previewImport({ source: { type: "github", url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename" })).rejects.toThrow("missing COMPANY.md");
    expect(remote.requests.some(url => url.endsWith("/commits/main"))).toBe(true);
    expect(remote.requests.some(url => url.endsWith("/commits/master"))).toBe(false);
  }, 60_000);

  it("rejects a requested full SHA that resolves to another commit before package reads", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Wrong SHA target", issuePrefix: `WS${companyId.slice(0, 5)}` });
    remote.files = { "COMPANY.md": "---\nname: Wrong SHA\n---\n" };
    const requestedSha = "c".repeat(40);
    await expect(companyPortabilityService(db).previewImport({ source: { type: "github", url: `https://github.com/example/reviewed/tree/${requestedSha}` },
      include: { company: true, agents: false, projects: false, issues: false, skills: false },
      target: { mode: "existing_company", companyId }, collisionStrategy: "rename" })).rejects.toThrow("different commit");
    expect(remote.requests.some(url => url.includes("raw.githubusercontent.com"))).toBe(false);
  }, 60_000);
});
