import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { authUsers, createDb } from "../../../packages/db/src/index.js";
import { boardAuthService } from "../../../server/src/services/board-auth.js";
import { seedCurrentHumanSourceActor } from "../../../server/src/__tests__/helpers/current-human-source-fixture.js";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const configPath = arg("--config");
  const companyId = arg("--company-id");
  if (!configPath || !companyId) {
    throw new Error("Usage: create-agent-chat-board-key.ts --config <path> --company-id <id>");
  }

  const config = JSON.parse(readFileSync(path.resolve(configPath), "utf8")) as {
    database?: { mode?: string; connectionString?: string; embeddedPostgresDataDir?: string };
  };
  let databaseUrl = config.database?.connectionString;
  if (config.database?.mode !== "postgres") {
    const dataDir = config.database?.embeddedPostgresDataDir;
    if (!dataDir) throw new Error("Embedded chat fixture requires its configured database directory");
    const pidLines = readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split(/\r?\n/);
    if (realpathSync(pidLines[1] ?? "") !== realpathSync(dataDir)) {
      throw new Error("Embedded chat fixture database directory does not match its running postmaster");
    }
    const pid = Number(pidLines[0]);
    const port = Number(pidLines[3]);
    if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid embedded chat fixture postmaster identity");
    }
    process.kill(pid, 0);
    databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  }
  if (!databaseUrl) throw new Error("Could not resolve the isolated chat fixture database");

  const db = createDb(databaseUrl);
  const closableDb = db as typeof db & { $client?: { end?: () => Promise<void> } };
  try {
    // This browser suite uses local_trusted mode, which does not expose the
    // BetterAuth signup endpoints. Seed the canonical current-Human session
    // fixture and authenticate chat traffic with a current owner Board API key.
    // The fixture provides structural session proof; WebAuthn ceremonies are
    // covered by the dedicated authenticated browser suite.
    const now = new Date();
    const userId = randomUUID();
    await db.insert(authUsers).values({
      id: userId,
      name: "Authenticated agent-chat reviewer",
      email: `agent-chat-${userId}@fixture.invalid`,
      emailVerified: true,
      locale: "en",
      createdAt: now,
      updatedAt: now,
    });
    const actor = await seedCurrentHumanSourceActor(db, [companyId], userId);
    const key = await boardAuthService(db).createNamedBoardApiKey({
      actor,
      name: "Disposable authenticated agent-chat browser fixture",
      requestedCompanyId: companyId,
    });
    process.stdout.write(JSON.stringify({ id: key.id, token: key.token }));
  } finally {
    await closableDb.$client?.end?.().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
