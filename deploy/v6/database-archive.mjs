import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

function keyBytes(key) {
  if (!/^[a-f0-9]{64}$/i.test(key ?? ""))
    throw Error("A separate 256-bit database backup key is required");
  return Buffer.from(key, "hex");
}
function metadataValid(value) {
  return (
    value?.format === "aw-database-archive-v1" &&
    /^[a-f0-9-]{36}$/.test(value.id ?? "") &&
    ["staging", "production"].includes(value.environment) &&
    /^[a-f0-9]{40}$/.test(value.sourceSha ?? "") &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion.length <= 100 &&
    typeof value.keyId === "string" &&
    value.keyId.length > 0 &&
    value.keyId.length <= 80 &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}
export async function encryptDatabaseArchive(
  source,
  destination,
  metadata,
  key,
  maxBytes = 32 * 1024 ** 3,
) {
  if (
    !metadataValid(metadata) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0
  )
    throw Error("Invalid database backup metadata or size bound");
  const header = Buffer.from(JSON.stringify(metadata));
  if (header.length > 4096) throw Error("Database backup header is too large");
  const prefix = Buffer.alloc(8);
  prefix.write("AWD6");
  prefix.writeUInt32BE(header.length, 4);
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(Buffer.concat([prefix, header]));
  const temporary = destination + ".partial";
  const file = await open(temporary, "wx", 0o600);
  let size = 0,
    written = prefix.length + header.length + nonce.length;
  const hash = createHash("sha256");
  try {
    const initial = Buffer.concat([prefix, header, nonce]);
    hash.update(initial);
    await file.write(initial);
    const bound = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(
          size > maxBytes
            ? Error("Database dump exceeded backup size bound")
            : null,
          chunk,
        );
      },
    });
    const evidence = new Transform({
      transform(chunk, _encoding, callback) {
        written += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      source,
      bound,
      cipher,
      evidence,
      createWriteStream(temporary, {
        fd: file.fd,
        autoClose: false,
        start: initial.length,
      }),
    );
    const tag = cipher.getAuthTag();
    hash.update(tag);
    await file.write(tag, 0, tag.length, written);
    written += tag.length;
    await file.sync();
    await file.close();
    await rename(temporary, destination);
    return {
      metadata,
      ciphertextSha256: hash.digest("hex"),
      byteSize: written,
      dumpBytes: size,
    };
  } catch (error) {
    await file.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

/** The caller may restore only the returned file. Failed authentication removes all quarantine plaintext. */
export async function authenticateDatabaseArchive(
  source,
  destination,
  keys,
  expected,
) {
  const input = await open(source, "r");
  const partial = destination + ".partial";
  let output;
  try {
    const stat = await input.stat();
    if (
      stat.size < 40 ||
      stat.size > (expected.maxBytes ?? 32 * 1024 ** 3) + 8192
    )
      throw Error("Database archive size is invalid");
    const prefix = Buffer.alloc(8);
    await input.read(prefix, 0, 8, 0);
    const length = prefix.readUInt32BE(4);
    if (
      prefix.subarray(0, 4).toString() !== "AWD6" ||
      length < 2 ||
      length > 4096 ||
      stat.size < length + 40
    )
      throw Error("Invalid database archive header");
    const header = Buffer.alloc(length);
    await input.read(header, 0, length, 8);
    const metadata = JSON.parse(header.toString());
    if (
      !metadataValid(metadata) ||
      metadata.environment !== expected.environment ||
      (expected.id && metadata.id !== expected.id)
    )
      throw Error("Database archive scope mismatch");
    const nonce = Buffer.alloc(12);
    await input.read(nonce, 0, 12, 8 + length);
    const tag = Buffer.alloc(16);
    await input.read(tag, 0, 16, stat.size - 16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyBytes(keys[metadata.keyId]),
      nonce,
    );
    decipher.setAAD(Buffer.concat([prefix, header]));
    decipher.setAuthTag(tag);
    output = await open(partial, "wx", 0o600);
    await pipeline(
      createReadStream(source, { start: 20 + length, end: stat.size - 17 }),
      decipher,
      createWriteStream(partial, { fd: output.fd, autoClose: false }),
    );
    await output.sync();
    await output.close();
    output = undefined;
    await rename(partial, destination);
    return { metadata, file: destination };
  } catch (error) {
    await output?.close().catch(() => {});
    await rm(partial, { force: true });
    throw error;
  } finally {
    await input.close();
  }
}
