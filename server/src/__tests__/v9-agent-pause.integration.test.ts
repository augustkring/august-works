import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activityLog, agents, closeRegisteredClients, companyMemberships, createDb, heartbeatRuns } from "@paperclipai/db";
import { agentPauseService } from "../services/experience/agent-pause.js";
import { agentService } from "../services/agents.js";
import { heartbeatService } from "../services/heartbeat.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { enableV5ForTest, seedV5Presences } from "./helpers/v5-fixtures.js";

describe("V9 customer pause through Original admission and receipt owners", () => {
  let fixture: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
  let f: Awaited<ReturnType<typeof seedV5Presences>>;
  beforeAll(async () => {
    expect((await getEmbeddedPostgresTestSupport()).supported, "Pause qualification requires actual PostgreSQL").toBe(true);
    fixture = await startEmbeddedPostgresTestDatabase("aw-v9-customer-pause-"); db = createDb(fixture.connectionString);
    await instanceSettingsService(db).getExperimental(); await enableV5ForTest(db);
  }, 60000);
  afterAll(async () => { if (fixture) { await closeRegisteredClients(fixture.connectionString); await fixture.cleanup(); } }, 30000);
  beforeEach(async () => { f = await seedV5Presences(db); await instanceSettingsService(db).updateExperimental({ experience_projection_v9: true, progressive_shell_v9: true }); });
  const rows = () => db.select().from(activityLog).where(and(eq(activityLog.companyId, f.home), eq(activityLog.action, "agent.paused")));
  async function command(owner = agentPauseService(db), policy: "drain" | "cancel" = "drain") {
    return { requestId: randomUUID(), expectedSourceToken: (await owner.review(f.actor, f.home, f.presence.id)).sourceToken, pendingWork: policy, confirmPause: true as const };
  }
  it("reviews actual source without private configuration or writes", async () => {
    const before = await rows(), agent = await db.select().from(agents).where(eq(agents.id, f.presence.id));
    const view = await agentPauseService(db).review(f.actor, f.home, f.presence.id);
    expect(view).toMatchObject({ companyId: f.home, agentId: f.presence.id, canPause: true });
    expect(Object.keys(view).sort()).toEqual(["agentId", "canPause", "companyId", "name", "nativeStatus", "sourceToken"]);
    expect(await rows()).toEqual(before); expect(await db.select().from(agents).where(eq(agents.id, f.presence.id))).toEqual(agent);
  });
  it("drains without cancellation and replays the exact Original receipt once", async () => {
    const cancel = vi.fn(), owner = agentPauseService(db, cancel), input = await command(owner);
    const receipt = await owner.pause(f.actor, f.home, f.presence.id, input);
    expect(receipt).toMatchObject({ requestId: input.requestId, pendingWork: "drain", admissionClosedAtAcceptance: true, workSettled: false });
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]).toMatchObject({ status: "paused", pauseReason: "manual" });
    expect(await owner.pause(f.actor, f.home, f.presence.id, input)).toEqual(receipt);
    expect(await owner.receipt(f.actor, f.home, f.presence.id, input.requestId)).toEqual(receipt);
    expect(await rows()).toHaveLength(1); expect(cancel).not.toHaveBeenCalled();
  });
  it("retains the pause before an unknown remote stop and never cancels again on reads or replay", async () => {
    const cancel = vi.fn(async () => {
      expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]?.status).toBe("paused");
      expect(await rows()).toHaveLength(1); throw new Error("PRIVATE provider cancellation detail");
    });
    const owner = agentPauseService(db, cancel), input = await command(owner, "cancel");
    await expect(owner.pause(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 502, details: { code: "agent_pause_cancellation_unknown" } });
    const receipt = await owner.receipt(f.actor, f.home, f.presence.id, input.requestId);
    expect(receipt).toMatchObject({ requestId: input.requestId, pendingWork: "cancel", workSettled: false });
    expect(await owner.pause(f.actor, f.home, f.presence.id, input)).toEqual(receipt);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(f.presence.id, []); expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
  });
  it("cancels a real Original queued run through the default heartbeat owner", async () => {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId: f.home, agentId: f.presence.id, invocationSource: "on_demand", triggerDetail: "manual", status: "queued" });
    const owner = agentPauseService(db), input = await command(owner, "cancel"); await owner.pause(f.actor, f.home, f.presence.id, input);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0]?.status).toBe("cancelled"); expect(await rows()).toHaveLength(1);
  });
  it("serializes concurrent confirmations and cancellation into one decision", async () => {
    const cancel = vi.fn(async () => 0), owner = agentPauseService(db, cancel), input = await command(owner, "cancel");
    const result = await Promise.all([owner.pause(f.actor, f.home, f.presence.id, input), owner.pause(f.actor, f.home, f.presence.id, input)]);
    expect(result[0]).toEqual(result[1]); expect(await rows()).toHaveLength(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("keeps the Original receipt and exact replay available when later work exceeds new-review bounds", async () => {
    const owner = agentPauseService(db), input = await command(owner), receipt = await owner.pause(f.actor, f.home, f.presence.id, input);
    await db.insert(heartbeatRuns).values(Array.from({ length: 1001 }, () => ({ companyId: f.home, agentId: f.presence.id, invocationSource: "on_demand", triggerDetail: "manual", status: "queued" })));
    await expect(owner.review(f.actor, f.home, f.presence.id)).rejects.toMatchObject({ status: 409 });
    expect(await owner.receipt(f.actor, f.home, f.presence.id, input.requestId)).toEqual(receipt);
    expect(await owner.pause(f.actor, f.home, f.presence.id, input)).toEqual(receipt); expect(await rows()).toHaveLength(1);
  });
  it("does not expand cancellation to work admitted after a subsequent resume", async () => {
    const oldRun = randomUUID(), laterRun = randomUUID();
    await db.insert(heartbeatRuns).values({ id: oldRun, companyId: f.home, agentId: f.presence.id, invocationSource: "on_demand", triggerDetail: "manual", status: "queued" });
    const cancel = vi.fn(async (id: string, runIds: readonly string[]) => {
      await agentService(db).resume(id);
      await db.insert(heartbeatRuns).values({ id: laterRun, companyId: f.home, agentId: id, invocationSource: "on_demand", triggerDetail: "manual", status: "queued" });
      return heartbeatService(db).cancelActiveForAgent(id, undefined, runIds);
    });
    const owner = agentPauseService(db, cancel), input = await command(owner, "cancel"); await owner.pause(f.actor, f.home, f.presence.id, input);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(f.presence.id, [oldRun]);
    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, f.presence.id));
    expect(runs.find(run => run.id === oldRun)?.status).toBe("cancelled"); expect(runs.find(run => run.id === laterRun)?.status).toBe("queued");
  });
  it("requires a new review when admitted work changes before confirmation", async () => {
    const cancel = vi.fn(), owner = agentPauseService(db, cancel), input = await command(owner, "cancel");
    await db.insert(heartbeatRuns).values({ companyId: f.home, agentId: f.presence.id, invocationSource: "on_demand", triggerDetail: "manual", status: "queued" });
    await expect(owner.pause(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 409 });
    expect(await rows()).toHaveLength(0); expect(cancel).not.toHaveBeenCalled();
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]?.status).toBe("idle");
  });
  it("rejects stale source, changed policy and cross-company nonce reuse without another mutation", async () => {
    const owner = agentPauseService(db, vi.fn()), input = await command(owner);
    await db.update(agents).set({ name: "Changed source" }).where(eq(agents.id, f.presence.id));
    await expect(owner.pause(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 409 }); expect(await rows()).toHaveLength(0);
    const fresh = await command(owner); await owner.pause(f.actor, f.home, f.presence.id, fresh);
    await expect(owner.pause(f.actor, f.home, f.presence.id, { ...fresh, pendingWork: "cancel" })).rejects.toMatchObject({ status: 409 });
    await expect(owner.pause(f.actor, f.guest, f.guestPresence.id, { ...fresh, expectedSourceToken: (await owner.review(f.actor, f.guest, f.guestPresence.id)).sourceToken })).rejects.toMatchObject({ status: 409 });
    expect(await owner.receipt(f.actor, f.guest, f.guestPresence.id, fresh.requestId)).toBeNull(); expect(await rows()).toHaveLength(1);
  });
  it("does not overwrite a budget pause or act on a pending/retired Agent", async () => {
    const owner = agentPauseService(db, vi.fn());
    for (const status of ["paused", "pending_approval", "terminated"]) {
      const company = status === "terminated" ? f.guest : f.home, presence = status === "terminated" ? f.guestPresence : f.presence;
      await db.update(agents).set({ status, pauseReason: status === "paused" ? "budget" : null }).where(eq(agents.id, presence.id));
      const view = await owner.review(f.actor, company, presence.id); expect(view.canPause).toBe(false);
      await expect(owner.pause(f.actor, company, presence.id, { requestId: randomUUID(), expectedSourceToken: view.sourceToken, pendingWork: "cancel", confirmPause: true })).rejects.toMatchObject({ status: 409 });
    }
    expect(await rows()).toHaveLength(0);
  });
  it("uses current human membership even for an instance administrator", async () => {
    const owner = agentPauseService(db, vi.fn()), input = await command(owner);
    await db.update(companyMemberships).set({ status: "disabled" }).where(and(eq(companyMemberships.companyId, f.home), eq(companyMemberships.principalId, f.userId)));
    await expect(owner.pause({ ...f.actor, isInstanceAdmin: true }, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 403 }); expect(await rows()).toHaveLength(0);
  });
  it("rolls back admission when the actual audit write fails", async () => {
    const cancel = vi.fn(), owner = agentPauseService(db, cancel), input = await command(owner, "cancel");
    await db.execute(sql`create function aw_v9_pause_audit_failure() returns trigger language plpgsql as $body$ begin if new.action='agent.paused' then raise exception 'fixture_pause_audit_failure'; end if; return new; end $body$`);
    await db.execute(sql`create trigger aw_v9_pause_audit_failure before insert on activity_log for each row execute function aw_v9_pause_audit_failure()`);
    try { await expect(owner.pause(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ cause: { code: "P0001" } }); }
    finally { await db.execute(sql`drop trigger aw_v9_pause_audit_failure on activity_log`); await db.execute(sql`drop function aw_v9_pause_audit_failure()`); }
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]?.status).toBe("idle");
    expect(await rows()).toHaveLength(0); expect(cancel).not.toHaveBeenCalled(); expect(await owner.receipt(f.actor, f.home, f.presence.id, input.requestId)).toBeNull();
  });
  it("rechecks authority after the last write and rolls back a late withdrawal", async () => {
    const cancel = vi.fn(), owner = agentPauseService(db, cancel), input = await command(owner, "cancel");
    await db.execute(sql`create function aw_v9_pause_authority_withdrawal() returns trigger language plpgsql as $body$ begin if new.action='agent.paused' then update company_memberships set status='disabled' where company_id=new.company_id and principal_type='user' and principal_id=new.actor_id; end if; return new; end $body$`);
    await db.execute(sql`create trigger aw_v9_pause_authority_withdrawal after insert on activity_log for each row execute function aw_v9_pause_authority_withdrawal()`);
    try { await expect(owner.pause(f.actor, f.home, f.presence.id, input)).rejects.toMatchObject({ status: 403 }); }
    finally { await db.execute(sql`drop trigger aw_v9_pause_authority_withdrawal on activity_log`); await db.execute(sql`drop function aw_v9_pause_authority_withdrawal()`); }
    expect((await db.select().from(agents).where(eq(agents.id, f.presence.id)))[0]?.status).toBe("idle");
    expect(await rows()).toHaveLength(0); expect(cancel).not.toHaveBeenCalled(); expect(await owner.receipt(f.actor, f.home, f.presence.id, input.requestId)).toBeNull();
  });
});
