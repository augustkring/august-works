import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { it, expect } from 'vitest';
import { companies, agents, issues, heartbeatRuns, orchestrationModelReservations, orchestrationPlans, completionContracts, createDb } from '@paperclipai/db';
import { canActorReadIssuePrivacy, withReadPinnedNativeTaskSnapshot } from '../services/authorization.js';
import { startEmbeddedPostgresTestDatabase } from './helpers/embedded-postgres.js';
import { seedCurrentHumanSourceActor } from './helpers/current-human-source-fixture.js';

it('measures ordinary private Task ACL before and after transaction local collapse settings', async () => {
  const database = await startEmbeddedPostgresTestDatabase('v10-planner-collapse-');
  const db = createDb(database.connectionString, { maxConnections: 1 });
  try {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: 'Planner synthetic fixture', issuePrefix: randomUUID() });
    const alice = await seedCurrentHumanSourceActor(db, [companyId], aliceId);
    const bob = await seedCurrentHumanSourceActor(db, [companyId], bobId);
    const [task] = await db.insert(issues).values({ companyId, title: 'Canonical private Task', visibility: 'private', responsibleUserId: aliceId, createdByUserId: aliceId }).returning();
    const observations: unknown[] = [];
    await db.transaction(async tx => {
      const getSettings = async () => (await tx.execute(sql`select current_setting('join_collapse_limit') as j, current_setting('from_collapse_limit') as f`))[0];
      const settings = await getSettings();
      const setSettings = async (j: string, f: string) => { await tx.execute(sql`select set_config('join_collapse_limit',${j},true),set_config('from_collapse_limit',${f},true)`); };
      try {
        for (const [name, actor, expected] of [['alice', alice, true], ['bob', bob, false]] as const) {
          await (async () => {
            let captured: any;
            const originalSelect = tx.select.bind(tx);
            const wrap = (builder: any): any => new Proxy(builder, { get(target, key) {
              const value = Reflect.get(target, key);
              if (typeof value !== 'function') return value;
              if (key === 'then') return value.bind(target);
              return (...args: any[]) => { const next = value.apply(target, args); if (key === 'limit') captured = next; return next && typeof next === 'object' && 'toSQL' in next ? wrap(next) : next; };
            } });
            (tx as any).select = (...args: any[]) => wrap((originalSelect as any)(...args));
            let allowed;
            try { allowed = await canActorReadIssuePrivacy(tx, actor, { companyId, id: task!.id }); }
            finally { (tx as any).select = originalSelect; }
            expect(allowed).toBe(expected);
            expect(captured).toBeDefined();
            const compiled = captured.toSQL();
            const queryHash = createHash('sha256').update(compiled.sql).digest('hex');
            for (const mode of ['baseline', 'collapse1', 'restored'] as const) {
              await setSettings(mode === 'collapse1' ? '1' : settings!.j as string, mode === 'collapse1' ? '1' : settings!.f as string);
              const start = performance.now();
              const rows = await tx.execute(captured);
              const elapsedMs = performance.now() - start;
              expect(rows.length > 0).toBe(expected);
              const [explained] = await tx.execute(sql`explain (analyze, buffers, format json) ${captured}`);
              const plan = (explained!['QUERY PLAN'] as any)[0];
              const observation = { actor: name, mode, queryHash, sqlLength: compiled.sql.length, params: compiled.params.length, result: rows.length > 0, elapsedMs, settings: await getSettings(), planningMs: plan['Planning Time'], executionMs: plan['Execution Time'], totalCost: plan.Plan['Total Cost'] };
              observations.push(observation);
              console.log('PLANNER_OBSERVATION', JSON.stringify(observation));
              writeFileSync(`/workspace/v10-preparation/planner-collapse-${name}-${mode}-plan.json`, JSON.stringify(plan, null, 2));
            }
          })();
        }
      } finally { await setSettings(settings!.j as string, settings!.f as string); }
      expect(await getSettings()).toEqual(settings);
      console.log('PLANNER_RESTORED', JSON.stringify(await getSettings()));
    });
    writeFileSync('/workspace/v10-preparation/planner-collapse-observations.json', JSON.stringify(observations, null, 2));
  } finally { await database.cleanup(); }
}, 30000);
