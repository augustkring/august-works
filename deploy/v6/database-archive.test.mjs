import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  authenticateDatabaseArchive,
  encryptDatabaseArchive,
} from "./database-archive.mjs";
const dir = await mkdtemp(join(tmpdir(), "aw-db-archive-"));
after(() => rm(dir, { recursive: true, force: true }));
const key = "e".repeat(64),
  metadata = {
    format: "aw-database-archive-v1",
    id: "66666666-6666-4666-8666-666666666666",
    environment: "staging",
    sourceSha: "a".repeat(40),
    schemaVersion: "0344",
    keyId: "fixture",
    createdAt: new Date().toISOString(),
  };
test("streams an authenticated database dump and rejects tampered or wrong-scope archives before restore", async () => {
  const raw = Buffer.from("PGDMP\0private customer data ".repeat(10000)),
    file = join(dir, "database.awd6");
  const evidence = await encryptDatabaseArchive(
    Readable.from([raw]),
    file,
    metadata,
    key,
  );
  assert.equal(evidence.dumpBytes, raw.length);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(
    (await readFile(file)).includes(Buffer.from("private customer data")),
    false,
  );
  const recovered = await authenticateDatabaseArchive(
    file,
    join(dir, "dump"),
    { fixture: key },
    { environment: "staging" },
  );
  assert.deepEqual(await readFile(recovered.file), raw);
  await assert.rejects(
    authenticateDatabaseArchive(
      file,
      join(dir, "wrong"),
      { fixture: key },
      { environment: "production" },
    ),
    /scope/,
  );
  const corrupt = await readFile(file);
  corrupt[corrupt.length - 50] ^= 1;
  await writeFile(join(dir, "bad"), corrupt);
  await assert.rejects(
    authenticateDatabaseArchive(
      join(dir, "bad"),
      join(dir, "tampered"),
      { fixture: key },
      { environment: "staging" },
    ),
  );
  await assert.rejects(stat(join(dir, "tampered")));
  await assert.rejects(stat(join(dir, "tampered.partial")));
});
test("aborts oversized streams and does not leave a partial archive", async () => {
  const file = join(dir, "oversized");
  await assert.rejects(
    encryptDatabaseArchive(
      Readable.from([Buffer.alloc(20)]),
      file,
      metadata,
      key,
      10,
    ),
    /size bound/,
  );
  await assert.rejects(stat(file));
  await assert.rejects(stat(file + ".partial"));
});
