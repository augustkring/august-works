import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  open,
  readdir,
  lstat,
  mkdir,
  rm,
  chmod,
  chown,
  statfs,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
const MAGIC = Buffer.from("AWB6");
export function backupContext(spec) {
  return JSON.stringify({
    format: "aw-state-archive-v1",
    backupId: spec.id,
    companyId: spec.companyId,
    cellId: spec.cellId,
    generation: spec.generation,
    imageDigest: spec.imageDigest,
    stateFormat: spec.stateFormat,
  });
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.split("/").some((v) => !v || v === "." || v === "..")
  )
    throw Error("unsafe_archive_path");
  return value;
}
async function ensureScratchCapacity(filename, bytes) {
  const space = await statfs(path.dirname(filename), { bigint: true });
  if (space.bavail * space.bsize < bytes + 2n * 1024n * 1024n * 1024n)
    throw Error("backup_scratch_capacity_unavailable");
}
export async function createEncryptedBackup(stateDir, filename, spec) {
  if (!/^[a-f0-9]{64}$/.test(spec.key) || !/^\d+$/.test(spec.maxBytes))
    throw Error("invalid_backup_configuration");
  const paths = [];
  let total = 0n;
  async function walk(relative = "") {
    for (const entry of await readdir(path.join(stateDir, relative), {
      withFileTypes: true,
    })) {
      const name = safePath(
          relative ? relative + "/" + entry.name : entry.name,
        ),
        stat = await lstat(path.join(stateDir, name));
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw Error("unsupported_backup_file_type");
      if (stat.isDirectory()) await walk(name);
      else {
        total += BigInt(stat.size);
        if (total > BigInt(spec.maxBytes) || paths.length >= 100000)
          throw Error("backup_state_limit");
        paths.push({ name, size: stat.size });
      }
    }
  }
  await walk();
  await ensureScratchCapacity(
    filename,
    total +
      BigInt(
        paths.reduce(
          (sum, entry) =>
            sum +
            Buffer.byteLength(
              JSON.stringify({ path: entry.name, size: entry.size }),
            ) +
            2,
          65536,
        ),
      ),
  );
  paths.sort((a, b) => a.name.localeCompare(b.name));
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(spec.key, "hex"), nonce);
  cipher.setAAD(Buffer.from(backupContext(spec)));
  const source = Readable.from(
    (async function* () {
      yield Buffer.from(
        JSON.stringify({
          context: backupContext(spec),
          files: paths.length,
          bytes: total.toString(),
        }) + "\n",
      );
      for (const entry of paths) {
        yield Buffer.from(
          JSON.stringify({ path: entry.name, size: entry.size }) + "\n",
        );
        let size = 0;
        const handle = await open(
          path.join(stateDir, entry.name),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size !== entry.size)
            throw Error("backup_state_changed");
          for await (const chunk of handle.createReadStream({
            autoClose: false,
          })) {
            size += chunk.length;
            yield chunk;
          }
        } finally {
          await handle.close();
        }
        if (size !== entry.size) throw Error("backup_state_changed");
        yield Buffer.from("\n");
      }
    })(),
  );
  const header = Buffer.concat([MAGIC, nonce]);
  const output = createWriteStream(filename, { flags: "wx", mode: 0o600 });
  output.write(header);
  try {
    await pipeline(source, cipher, output, { end: false });
    output.end(cipher.getAuthTag());
    await new Promise((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
    });
  } catch (error) {
    output.destroy();
    await rm(filename, { force: true });
    throw error;
  }
  const fd = await open(filename, "r+");
  await fd.sync();
  const stat = await fd.stat();
  await fd.close();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return {
    sha256: hash.digest("hex"),
    bytes: String(stat.size),
    files: paths.length,
    plaintextBytes: total.toString(),
  };
}
/** Authenticate the entire ciphertext before reading any archive paths or mounting recovered state. */
export async function restoreEncryptedBackup(
  filename,
  targetDir,
  spec,
  expectedSha256,
) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest("hex") !== expectedSha256)
    throw Error("backup_checksum_mismatch");
  const fd = await open(filename, "r"),
    stat = await fd.stat(),
    header = Buffer.alloc(16),
    tag = Buffer.alloc(16);
  await fd.read(header, 0, 16, 0);
  await fd.read(tag, 0, 16, stat.size - 16);
  await fd.close();
  if (stat.size < 32 || !header.subarray(0, 4).equals(MAGIC))
    throw Error("invalid_backup_format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(spec.key, "hex"),
    header.subarray(4),
  );
  decipher.setAAD(Buffer.from(backupContext(spec)));
  decipher.setAuthTag(tag);
  await ensureScratchCapacity(filename, BigInt(stat.size));
  const plaintext = filename + ".quarantine";
  try {
    await pipeline(
      createReadStream(filename, { start: 16, end: stat.size - 17 }),
      decipher,
      createWriteStream(plaintext, { flags: "wx", mode: 0o600 }),
    );
    const reader = await open(plaintext, "r");
    let position = 0,
      total = 0n;
    async function line() {
      const bytes = [];
      const one = Buffer.alloc(1);
      while (true) {
        const { bytesRead } = await reader.read(one, 0, 1, position++);
        if (!bytesRead) throw Error("truncated_backup_archive");
        if (one[0] === 10)
          return JSON.parse(Buffer.from(bytes).toString("utf8"));
        bytes.push(one[0]);
        if (bytes.length > 32768) throw Error("backup_header_limit");
      }
    }
    try {
      const manifest = await line();
      if (
        manifest.context !== backupContext(spec) ||
        !Number.isInteger(manifest.files) ||
        manifest.files < 0 ||
        manifest.files > 100000 ||
        BigInt(manifest.bytes) > BigInt(spec.maxBytes)
      )
        throw Error("backup_manifest_mismatch");
      await mkdir(targetDir, { recursive: false, mode: 0o700 });
      const seen = new Set();
      for (let i = 0; i < manifest.files; i++) {
        const entry = await line(),
          relative = safePath(entry.path);
        if (
          seen.has(relative) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0
        )
          throw Error("invalid_archive_entry");
        seen.add(relative);
        total += BigInt(entry.size);
        if (total > BigInt(spec.maxBytes)) throw Error("restore_state_limit");
        const name = path.join(targetDir, relative);
        await mkdir(path.dirname(name), { recursive: true, mode: 0o700 });
        const out = await open(name, "wx", 0o600);
        try {
          let remaining = entry.size;
          while (remaining) {
            const chunk = Buffer.alloc(Math.min(remaining, 65536)),
              read = await reader.read(chunk, 0, chunk.length, position);
            if (!read.bytesRead) throw Error("truncated_backup_archive");
            await out.write(chunk.subarray(0, read.bytesRead));
            position += read.bytesRead;
            remaining -= read.bytesRead;
          }
          await out.sync();
        } finally {
          await out.close();
        }
        const separator = Buffer.alloc(1);
        if (
          (await reader.read(separator, 0, 1, position++)).bytesRead !== 1 ||
          separator[0] !== 10
        )
          throw Error("invalid_archive_separator");
      }
      if (
        position !== (await reader.stat()).size ||
        total.toString() !== manifest.bytes
      )
        throw Error("backup_archive_length_mismatch");
    } finally {
      await reader.close();
    }
    // Quarantine is an offline directory, with no container or network. Provider credentials must be re-entered.
    async function scrub(dir) {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const name = path.join(dir, item.name);
        if (
          /^(credentials|auth-profiles\.json|auth\.json|openclaw\.json|gateway\.json|\.env(?:\..*)?|device(?:s)?|identity)$/i.test(
            item.name,
          )
        ) {
          await rm(name, { recursive: true, force: true });
          continue;
        }
        if (item.isDirectory()) await scrub(name);
        await chmod(name, item.isDirectory() ? 0o700 : 0o600);
        await chown(name, 1000, 1000);
      }
    }
    await scrub(targetDir);
    await chmod(targetDir, 0o700);
    await chown(targetDir, 1000, 1000);
    return { quarantined: true, credentialsRemoved: true };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(plaintext, { force: true });
  }
}
