import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authRateLimits, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { admitAgentSelfApiRead, AGENT_SELF_API_READ_LIMIT } from "./agent-api-rate-limit.js";

const embedded = await getEmbeddedPostgresTestSupport();
(embedded.supported ? describe.sequential : describe.skip)("agent self API durable rate limit", () => {
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const agentId = "agent-secret-principal-should-not-be-persisted";

  beforeAll(async () => {
    fixture = await startEmbeddedPostgresTestDatabase("agent-self-api-rate-limit-");
    db = createDb(fixture.connectionString, { maxConnections: 16 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  beforeEach(async () => { await db.delete(authRateLimits); });
  afterAll(async () => { await fixture?.cleanup(); }, 30_000);

  it("atomically enforces a fixed window without moving its start on admitted or denied reads", async () => {
    const results = await Promise.all(Array.from({ length: 160 }, () => admitAgentSelfApiRead(db, agentId)));
    expect(results.filter(result => result.allowed)).toHaveLength(AGENT_SELF_API_READ_LIMIT);
    expect(results.filter(result => !result.allowed).every(result => result.retryAfterSeconds >= 1)).toBe(true);

    const key = `agent-self-api:v1:${createHash("sha256").update(agentId).digest("hex")}`;
    const [row] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(row).toMatchObject({ key, count: AGENT_SELF_API_READ_LIMIT + 1 });
    expect(row!.key).not.toContain(agentId);
    await expect(admitAgentSelfApiRead(db, agentId)).resolves.toMatchObject({ allowed: false, remaining: 0 });
    const [afterDeniedRetry] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(afterDeniedRetry!.lastRequest).toBe(row!.lastRequest);

    // Put the full window near its end, with one admission left. That
    // admission must not restart the clock and turn the fixed quota into a
    // cooldown measured from the last request.
    const windowStart = Date.now() - 30_000;
    await db.update(authRateLimits).set({ lastRequest: windowStart, count: AGENT_SELF_API_READ_LIMIT - 1 })
      .where(eq(authRateLimits.key, key));
    await expect(admitAgentSelfApiRead(db, agentId)).resolves.toMatchObject({
      allowed: true, remaining: 0,
    });
    const [atLimit] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(atLimit!.count).toBe(AGENT_SELF_API_READ_LIMIT);
    expect(atLimit!.lastRequest).toBe(windowStart);
    const denied = await admitAgentSelfApiRead(db, agentId);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(30);
    const [afterWindowDenial] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(afterWindowDenial!.lastRequest).toBe(windowStart);

    await db.update(authRateLimits).set({ lastRequest: Date.now() - 60_001 }).where(eq(authRateLimits.key, key));
    await expect(admitAgentSelfApiRead(db, agentId)).resolves.toMatchObject({ allowed: true, remaining: AGENT_SELF_API_READ_LIMIT - 1 });
    const [reset] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key));
    expect(reset!.count).toBe(1);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
});
