import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { ImportSourceChangedError } from "../errors.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const remote = vi.hoisted(() => ({ files: {} as Record<string, string>, requests: [] as string[] }));
vi.mock("../services/github-fetch.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/github-fetch.js")>(),
  ghFetch: vi.fn(async (url: string) => {
    remote.requests.push(url);
    if (url.includes("/git/trees/")) return Response.json({ tree: Object.keys(remote.files).map(path => ({ path, type: "blob" })) });
    const filePath = new URL(url).pathname.split("/main/")[1];
    return new Response(remote.files[filePath] ?? "missing", { status: filePath in remote.files ? 200 : 404 });
  }),
}));
const { companyPortabilityService } = await import("../services/company-portability.js");

describe("native import rejects a changed reviewed GitHub file map", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("import-source-preview-");
    db = createDb(database.connectionString, { maxConnections: 4 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await database?.cleanup(); }, 30_000);

  it("refuses drift at the same URL before changing the target or creating an Agent", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Original target", issuePrefix: `ISP${companyId.slice(0, 5)}` });
    remote.files = {
      "COMPANY.md": "---\nname: Reviewed company\nincludes:\n  - agents/worker/AGENTS.md\n---\n",
      "agents/worker/AGENTS.md": "---\nname: Worker\nslug: worker\nkind: agent\n---\nReviewed worker body\n",
      ".paperclip.yaml": "schema: paperclip/v1\nagents:\n  worker:\n    adapter:\n      type: codex_local\n      config: {}\n",
    };
    remote.requests = [];
    const owner = companyPortabilityService(db);
    const input = { source: { type: "github" as const, url: "https://github.com/example/reviewed/tree/main" },
      include: { company: true, agents: true, projects: false, issues: false, skills: false },
      target: { mode: "existing_company" as const, companyId }, collisionStrategy: "rename" as const };
    const preview = await owner.previewImport(input);
    expect(preview.errors).toEqual([]);
    expect(preview.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(remote.requests.some(url => url.includes("/main/agents/worker/AGENTS.md"))).toBe(true);
    remote.files["agents/worker/AGENTS.md"] += "Changed after review\n";
    await expect(owner.importBundle({ ...input, expectedSourceFingerprint: preview.sourceFingerprint }, null))
      .rejects.toBeInstanceOf(ImportSourceChangedError);
    expect(await db.select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId))).toEqual([]);
    const [target] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.name, "Original target")));
    expect(target?.id).toBe(companyId);
  }, 60_000);
});
