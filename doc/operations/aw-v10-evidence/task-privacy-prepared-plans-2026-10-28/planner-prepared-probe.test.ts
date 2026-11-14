import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { it, expect } from 'vitest';
import { companies, agents, issues, heartbeatRuns, orchestrationModelReservations, orchestrationPlans, completionContracts, createDb } from '@paperclipai/db';
import { canActorReadIssuePrivacy, withReadPinnedNativeTaskSnapshot } from '../services/authorization.js';
import { startEmbeddedPostgresTestDatabase } from './helpers/embedded-postgres.js';
import { seedCurrentHumanSourceActor } from './helpers/current-human-source-fixture.js';

it('measures prepared plan reuse without caching reader authorization results', async () => {
  const database = await startEmbeddedPostgresTestDatabase('v10-planner-collapse-');
  const db = createDb(database.connectionString, { maxConnections: 1 });
  try {
    const companyId = randomUUID(), aliceId = randomUUID(), bobId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: 'Planner synthetic fixture', issuePrefix: randomUUID() });
    const alice = await seedCurrentHumanSourceActor(db, [companyId], aliceId);
    const bob = await seedCurrentHumanSourceActor(db, [companyId], bobId);
    const [task] = await db.insert(issues).values({ companyId, title: 'Canonical private Task', visibility: 'private', responsibleUserId: aliceId, createdByUserId: aliceId }).returning();
    const queries: Record<string, { sql: string; params: any[] }> = {};
    await db.transaction(async tx => {
      for (const [name, actor, expected] of [['alice', alice, true], ['bob', bob, false]] as const) {
        let captured: any;
        const originalSelect = tx.select.bind(tx);
        const wrap = (builder: any): any => new Proxy(builder, { get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          if (key === 'then') return value.bind(target);
          return (...args: any[]) => { const next = value.apply(target, args); if (key === 'limit') captured = next; return next && typeof next === 'object' && 'toSQL' in next ? wrap(next) : next; };
        } });
        (tx as any).select = (...args: any[]) => wrap((originalSelect as any)(...args));
        try { expect(await canActorReadIssuePrivacy(tx, actor, { companyId, id: task!.id })).toBe(expected); }
        finally { (tx as any).select = originalSelect; }
        expect(captured).toBeDefined();
        queries[name] = captured.toSQL();
      }
    });
    expect(queries.alice.sql).toBe(queries.bob.sql);
    const client = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    const observations: any[] = [];
    try {
      await client.begin(async tx => {
        const [settings] = await tx.unsafe("select current_setting('plan_cache_mode') as mode");
        const run = async (phase: string, reader: 'alice'|'bob', prepare: boolean, expected: boolean) => {
          const query = queries[reader];
          const start = performance.now();
          const rows = prepare ? await tx.unsafe(query.sql, query.params, { prepare: true }) : await tx.unsafe(query.sql, query.params);
          const elapsedMs = performance.now() - start;
          expect(rows.length > 0).toBe(expected);
          const plans = await tx.unsafe('select name, generic_plans, custom_plans from pg_prepared_statements where statement=$1', [query.sql]);
          const observation = { phase, reader, prepare, result: rows.length > 0, elapsedMs, plans: Array.from(plans), sqlLength: query.sql.length, parameterCount: query.params.length, queryHash: createHash('sha256').update(query.sql).digest('hex') };
          observations.push(observation);
          console.log('PREPARED_OBSERVATION', JSON.stringify(observation));
        };
        try {
          for (let round=0; round<7; round++) {
            // Alternate readers and whether prepared or unsafe executes first.
            for (const prepare of round % 2 ? [true, false] : [false, true]) {
              for (const reader of round % 2 ? ['bob','alice'] as const : ['alice','bob'] as const)
                await run(`auto-${round}`, reader, prepare, reader === 'alice');
            }
          }
          const lastPrepared = observations.filter(row=>row.prepare).at(-1);
          if (!lastPrepared?.plans.some((plan: any)=>Number(plan.generic_plans)>0)) {
            await tx.unsafe("select set_config('plan_cache_mode','force_generic_plan',true)");
            for (let round=0; round<3; round++) for (const reader of ['alice','bob'] as const)
              await run(`forced-generic-${round}`, reader, true, reader === 'alice');
          }
          await tx.unsafe("update company_memberships set status='suspended' where company_id=$1 and principal_type='user' and principal_id=$2", [companyId, aliceId]);
          for (const prepare of [false,true]) for (const reader of ['alice','bob'] as const)
            await run('alice-membership-revoked', reader, prepare, false);
          await tx.unsafe("update company_memberships set status='active' where company_id=$1 and principal_type='user' and principal_id=$2", [companyId, aliceId]);
          for (const prepare of [true,false]) await run('alice-membership-restored', 'alice', prepare, true);
        } finally { await tx.unsafe("select set_config('plan_cache_mode',$1,true)", [settings.mode]); }
        const [restored] = await tx.unsafe("select current_setting('plan_cache_mode') as mode");
        expect(restored.mode).toBe(settings.mode);
        console.log('PREPARED_SETTINGS_RESTORED', JSON.stringify(restored));
      });
    } finally { await client.end({ timeout: 1 }); }
    writeFileSync('/workspace/v10-preparation/planner-prepared-observations.json', JSON.stringify(observations, null, 2));
  } finally { await database.cleanup(); }
}, 30000);
