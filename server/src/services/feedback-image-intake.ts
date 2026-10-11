import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, isAbsolute } from "node:path";
import sharp from "sharp";
import { unprocessable } from "../errors.js";

export const FEEDBACK_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const SCAN_TIMEOUT_MS = 15_000;
const DEFINITIONS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const imageFormats = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" } as const;
export type FeedbackImageMediaType = keyof typeof imageFormats;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function rejected(code: string) {
  return unprocessable("This image could not be safely accepted. Choose another image or try again later.", { code });
}
function assertBody(body: Buffer) {
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > FEEDBACK_IMAGE_MAX_BYTES)
    throw rejected("FEEDBACK_IMAGE_SIZE");
}
/** Closed image allowlist, independent of the general attachment environment.
 * Decode and re-encode actual bytes; names and MIME headers cannot qualify them.
 * Metadata, animation and arbitrary appended payloads do not survive output. */
export async function normalizeFeedbackImage(body: Buffer, reportedMediaType: string) {
  assertBody(body);
  if (!Object.hasOwn(imageFormats, reportedMediaType)) throw rejected("FEEDBACK_IMAGE_TYPE");
  const mediaType = reportedMediaType as FeedbackImageMediaType;
  try {
    const input = sharp(body, { limitInputPixels: MAX_PIXELS, failOn: "warning", animated: true });
    const metadata = await input.metadata();
    if (metadata.format !== imageFormats[mediaType] || (metadata.pages ?? 1) !== 1 ||
        !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS)
      throw rejected("FEEDBACK_IMAGE_CONTENT");
    // Sharp removes EXIF/XMP/IPTC by default. Never call withMetadata/keepMetadata.
    const normalized = await input.rotate().toFormat(imageFormats[mediaType]).toBuffer();
    assertBody(normalized);
    return { body: normalized, mediaType, byteSize: normalized.length,
      sha256: sha256(normalized), originalSha256: sha256(body) };
  } catch {
    // Decoder messages can include user-controlled image metadata.
    throw rejected("FEEDBACK_IMAGE_CONTENT");
  }
}

type Version = { engine: string; definitions: number; publishedAt: string; token: string };
function parseVersion(reply: string): Version {
  const match = /^ClamAV (\d+\.\d+\.\d+(?:[-+.][A-Za-z0-9.]+)?)\/([1-9]\d{0,9})\/([^\x00-\x1f]{1,100})\x00$/.exec(reply);
  if (!match) throw rejected("FEEDBACK_SCANNER_UNAVAILABLE");
  const definitions = Number(match[2]), published = Date.parse(match[3]!);
  if (!Number.isSafeInteger(definitions) || !Number.isFinite(published) ||
      published > Date.now() + 300_000 || Date.now() - published > DEFINITIONS_MAX_AGE_MS)
    throw rejected("FEEDBACK_SCANNER_DEFINITIONS_STALE");
  const engine = match[1]!, publishedAt = new Date(published).toISOString();
  return { engine, definitions, publishedAt, token: sha256(Buffer.from(JSON.stringify({ engine, definitions, publishedAt }))) };
}

/** Local Unix IPC only. There is no customer-selected scanner endpoint and no
 * upload to a third-party analysis API. Both socket and containing directory
 * must belong to the startup-configured daemon identity, with no writable
 * directory audience that could substitute a scanner. */
class FeedbackClamdScanner {
  constructor(private readonly socketPath: string, private readonly daemonUid: number) {}
  private async endpoint() {
    const [directory, socket] = await Promise.all([lstat(dirname(this.socketPath)), lstat(this.socketPath)]);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.mode & 0o022 ||
        ![this.daemonUid, process.getuid?.()].includes(directory.uid) ||
        !socket.isSocket() || socket.isSymbolicLink() || socket.uid !== this.daemonUid || socket.mode & 0o002)
      throw rejected("FEEDBACK_SCANNER_UNAVAILABLE");
    // A protected immediate directory is insufficient if another principal
    // can replace a writable ancestor between validation and connect.
    for (let path = dirname(this.socketPath);; path = dirname(path)) {
      const ancestor = await lstat(path);
      const trustedStickyRoot = ancestor.uid === 0 && Boolean(ancestor.mode & 0o1000);
      if (!ancestor.isDirectory() || ancestor.isSymbolicLink() ||
        ![0, this.daemonUid, process.getuid?.()].includes(ancestor.uid) ||
        ((ancestor.mode & 0o022) && !trustedStickyRoot)) throw rejected("FEEDBACK_SCANNER_UNAVAILABLE");
      if (path === dirname(path)) break;
    }
  }
  private async exchange(command: Buffer): Promise<string> {
    try {
      await this.endpoint();
      return await new Promise<string>((resolve, reject) => {
        const socket = connect(this.socketPath);
        let reply = Buffer.alloc(0), settled = false;
        const deadline = setTimeout(() => finish(), SCAN_TIMEOUT_MS);
        const finish = (value?: string) => {
          if (settled) return;
          settled = true; clearTimeout(deadline); socket.destroy();
          value === undefined ? reject(rejected("FEEDBACK_SCANNER_UNAVAILABLE")) : resolve(value);
        };
        socket.setTimeout(SCAN_TIMEOUT_MS, () => finish());
        socket.once("error", () => finish());
        socket.once("connect", () => socket.write(command, error => { if (error) finish(); }));
        socket.on("data", bytes => {
          if (reply.length + bytes.length > 8192) return finish();
          reply = Buffer.concat([reply, bytes]);
          const end = reply.indexOf(0);
          if (end >= 0) end === reply.length - 1 ? finish(reply.toString("utf8")) : finish();
        });
        socket.once("close", () => finish());
      });
    } catch { throw rejected("FEEDBACK_SCANNER_UNAVAILABLE"); }
  }
  private async version() { return parseVersion(await this.exchange(Buffer.from("zVERSION\0"))); }
  private async stream(body: Buffer) {
    const parts: Buffer[] = [Buffer.from("zINSTREAM\0")];
    for (let offset = 0; offset < body.length; offset += 1024 * 1024) {
      const chunk = body.subarray(offset, offset + 1024 * 1024), length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length); parts.push(length, chunk);
    }
    parts.push(Buffer.alloc(4));
    const reply = await this.exchange(Buffer.concat(parts));
    if (reply === "stream: OK\0") return "clean" as const;
    if (/^stream: [^\x00-\x1f]{1,200} FOUND\x00$/.test(reply)) return "infected" as const;
    throw rejected("FEEDBACK_SCANNER_UNAVAILABLE");
  }
  async verify() {
    const before = await this.version();
    // Standard harmless antivirus test. An engine that returns OK for every
    // input cannot qualify this intake. This is not general malware coverage.
    const test = Buffer.from("X5O!P%@AP[4" + "\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    if (await this.stream(test) !== "infected") throw rejected("FEEDBACK_SCANNER_UNAVAILABLE");
    const after = await this.version();
    if (before.token !== after.token) throw rejected("FEEDBACK_SCANNER_CHANGED");
    return after;
  }
  async scan(body: Buffer) {
    assertBody(body);
    const before = await this.verify();
    if (await this.stream(body) !== "clean") throw rejected("FEEDBACK_IMAGE_REJECTED");
    const after = await this.version();
    if (before.token !== after.token) throw rejected("FEEDBACK_SCANNER_CHANGED");
    return Object.freeze({ scannerToken: after.token, scannedSha256: sha256(body), checkedAt: new Date().toISOString() });
  }
}

/** Startup configuration only; missing configuration keeps attachment intake
 * unavailable. Version/definition freshness and the actual IPC scan are checked
 * for each intake, rather than trusting an enabled flag or client assertion. */
export function configuredFeedbackImageScanner(env: Readonly<Record<string, string | undefined>> = process.env) {
  const path = env.AW_FEEDBACK_CLAMD_SOCKET, rawUid = env.AW_FEEDBACK_CLAMD_UID;
  if (path === undefined && rawUid === undefined) return null;
  if (!path || !isAbsolute(path) || path.includes("\0") || path.length > 100 ||
      !rawUid || !/^(0|[1-9]\d{0,9})$/.test(rawUid) || !Number.isSafeInteger(Number(rawUid)) || Number(rawUid) > 4_294_967_295)
    throw new Error("Invalid local feedback scanner configuration");
  return new FeedbackClamdScanner(path, Number(rawUid));
}

/** Scan original bytes before decoding and scan the stripped image separately.
 * A clean original cannot certify different generated bytes. No storage or
 * feedback write occurs here; their original owners must recheck authority. */
export async function prepareFeedbackImage(scanner: NonNullable<ReturnType<typeof configuredFeedbackImageScanner>>, body: Buffer, mediaType: string) {
  assertBody(body);
  const original = await scanner.scan(body);
  const image = await normalizeFeedbackImage(body, mediaType);
  const normalized = await scanner.scan(image.body);
  if (original.scannerToken !== normalized.scannerToken || original.scannedSha256 !== image.originalSha256 || normalized.scannedSha256 !== image.sha256)
    throw rejected("FEEDBACK_SCANNER_CHANGED");
  return { ...image, scan: normalized };
}
