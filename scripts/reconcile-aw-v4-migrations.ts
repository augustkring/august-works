import { createDb } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { awV4MigrationReconciliationService } from "../server/src/services/aw-v4-migration-reconciliation.js";

const MAX_BATCHES = 10_000;

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function integerFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} requires a positive integer`);
  }
  return value;
}

function printSnapshot(
  label: string,
  snapshot: Awaited<
    ReturnType<
      ReturnType<typeof awV4MigrationReconciliationService>["inspect"]
    >
  >,
) {
  console.log(
    JSON.stringify(
      {
        label,
        ...snapshot,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const apply = hasFlag("--apply");
  const requireReady = hasFlag("--require-ready");
  const batchSize = integerFlag("--batch-size", 250);

  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim() ||
    config.databaseUrl ||
    `postgres://paperclip:paperclip@127.0.0.1:${config.embeddedPostgresPort}/paperclip`;

  const db = createDb(dbUrl);
  const reconciliation = awV4MigrationReconciliationService(db);

  const initial = await reconciliation.inspect();
  printSnapshot("before", initial);

  if (apply) {
    for (let batch = 1; batch <= MAX_BATCHES; batch += 1) {
      const result = await reconciliation.repairBatch({ batchSize });
      console.log(
        `[aw-v4-migration] batch=${batch} routines=${result.routinesRepaired} pipelines=${result.pipelineExecutionsRepaired} repaired=${result.repaired}`,
      );
      if (result.repaired === 0) break;
      if (batch === MAX_BATCHES) {
        throw new Error(
          `AW V4 migration reconciliation exceeded ${MAX_BATCHES} batches without converging`,
        );
      }
    }
  }

  const final = apply ? await reconciliation.inspect() : initial;
  if (apply) printSnapshot("after", final);

  if (requireReady && !final.cutoverReady) {
    console.error(
      `[aw-v4-migration] cutover blocked: repairable=${final.repairableCount} blockers=${final.blockerCount}`,
    );
    process.exitCode = 1;
    return;
  }

  if (apply && final.repairableCount > 0) {
    console.error(
      `[aw-v4-migration] repair did not converge: ${final.repairableCount} safe legacy rows remain`,
    );
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[aw-v4-migration] reconciliation failed: ${message}`);
  process.exitCode = 1;
});
