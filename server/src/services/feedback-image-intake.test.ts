import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredFeedbackImageScanner, FEEDBACK_IMAGE_MAX_BYTES, normalizeFeedbackImage, prepareFeedbackImage } from "./feedback-image-intake.js";

const owned: Array<{ server: Server; directory: string; sockets: Set<Socket> }> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const item of owned.splice(0)) {
    for (const socket of item.sockets) socket.destroy();
    await new Promise<void>(resolve => item.server.close(() => resolve()));
    await rm(item.directory, { recursive: true, force: true });
  }
});
async function image(format: "png" | "jpeg" | "webp" = "png") {
  return sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).toFormat(format).toBuffer();
}
// Actual Unix socket transport with deliberately synthetic daemon answers.
// These checks certify framing/failure handling, not deployed antivirus coverage.
async function daemon(options: { infected?: boolean; alwaysClean?: boolean; reply?: string; date?: Date; versionChanges?: boolean; withheldReply?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "aw-feedback-scanner-wire-"));
  await chmod(directory, 0o700);
  const path = join(directory, "clam.sock"), scanned: Buffer[] = [], sockets = new Set<Socket>();
  let versions = 0;
  const publishedAt = (options.date ?? new Date()).toUTCString();
  let receivedVersion = () => {};
  const versionRequest = new Promise<void>(resolve => { receivedVersion = resolve; });
  const server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    let input = Buffer.alloc(0);
    socket.on("data", bytes => {
      input = Buffer.concat([input, bytes]);
      if (input.equals(Buffer.from("zVERSION\0"))) {
        receivedVersion();
        if (options.withheldReply) return;
        const definitions = options.versionChanges ? 100 + versions++ : 100;
        socket.end(`ClamAV 1.4.3/${definitions}/${publishedAt}\0`); return;
      }
      const prefix = Buffer.from("zINSTREAM\0");
      if (input.length < prefix.length || !input.subarray(0, prefix.length).equals(prefix)) return;
      const chunks: Buffer[] = []; let cursor = prefix.length;
      while (cursor + 4 <= input.length) {
        const length = input.readUInt32BE(cursor); cursor += 4;
        if (length === 0) {
          const body = Buffer.concat(chunks); scanned.push(body);
          const eicar = body.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"));
          socket.end(options.reply ?? ((!options.alwaysClean && (eicar || options.infected)) ? "stream: FixtureSignature FOUND\0" : "stream: OK\0")); return;
        }
        if (cursor + length > input.length) return;
        chunks.push(input.subarray(cursor, cursor + length)); cursor += length;
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve)); await chmod(path, 0o600);
  owned.push({ server, directory, sockets });
  const scanner = configuredFeedbackImageScanner({ AW_FEEDBACK_CLAMD_SOCKET: path, AW_FEEDBACK_CLAMD_UID: String(process.getuid?.()) })!;
  return { scanner, scanned, directory, versionRequest };
}
describe("selected feedback image content", () => {
  it.each(["png", "jpeg", "webp"] as const)("decodes actual %s bytes under their exact MIME contract", async format => {
    const bytes = await image(format), type = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    const normalized = await normalizeFeedbackImage(bytes, type);
    expect(normalized.mediaType).toBe(type);
    expect((await sharp(normalized.body).metadata()).format).toBe(format);
    expect(normalized.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects mislabeled, malformed, empty and oversized content without decoder prose", async () => {
    for (const [bytes, mime] of [[await image(), "image/jpeg"], [Buffer.from("private-error-input"), "image/png"],
      [Buffer.alloc(0), "image/png"], [Buffer.alloc(FEEDBACK_IMAGE_MAX_BYTES + 1), "image/png"], [await image(), "image/svg+xml"]] as const)
      await expect(normalizeFeedbackImage(bytes, mime)).rejects.toMatchObject({ status: 422 });
    await expect(normalizeFeedbackImage(Buffer.from("private-error-input"), "image/png")).rejects.not.toThrow("private-error-input");
  });
  it("strips actual EXIF orientation/metadata and appended arbitrary bytes", async () => {
    const bytes = await sharp(await image("jpeg")).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const normalized = await normalizeFeedbackImage(Buffer.concat([bytes, Buffer.from("private-appended-payload")]), "image/jpeg");
    const metadata = await sharp(normalized.body).metadata();
    expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
    expect(metadata.width).toBe(3); expect(metadata.height).toBe(4);
    expect(normalized.body.includes(Buffer.from("private-appended-payload"))).toBe(false);
  });
});
describe("local scanner IPC admission", () => {
  it("enforces the fixed total IPC deadline even when the peer remains connected", async () => {
    const { scanner, versionRequest } = await daemon({ withheldReply: true }), bytes = await image();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = scanner.scan(bytes).then(() => ({ accepted: true }), error => ({ error }));
    await versionRequest;
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({ error: { status: 422, details: { code: "FEEDBACK_SCANNER_UNAVAILABLE" } } });
    vi.useRealTimers();
  });
  it("keeps missing startup configuration closed and rejects customer-style network endpoints", () => {
    expect(configuredFeedbackImageScanner({})).toBeNull();
    expect(() => configuredFeedbackImageScanner({ AW_FEEDBACK_CLAMD_SOCKET: "https://scanner.invalid", AW_FEEDBACK_CLAMD_UID: "0" })).toThrow("Invalid local feedback scanner configuration");
  });
  it("actually frames and scans both original and different normalized bytes with separate hashes", async () => {
    const { scanner, scanned } = await daemon(), bytes = await image();
    const prepared = await prepareFeedbackImage(scanner, bytes, "image/png");
    expect(scanned).toHaveLength(4); // two actual control scans plus two image byte scans
    expect(scanned[1]!.equals(bytes)).toBe(true); expect(scanned[3]!.equals(prepared.body)).toBe(true);
    expect(prepared.scan.scannedSha256).toBe(prepared.sha256);
  });
  it("rejects an engine that accepts its harmless antivirus control or reports infected content", async () => {
    const unverified = await daemon({ alwaysClean: true });
    await expect(unverified.scanner.scan(await image())).rejects.toMatchObject({ status: 422 });
    const infected = await daemon({ infected: true });
    await expect(infected.scanner.scan(await image())).rejects.toMatchObject({ details: { code: "FEEDBACK_IMAGE_REJECTED" } });
  });
  it("rejects stale/future definitions and changes between actual control/read phases", async () => {
    for (const date of [new Date(Date.now() - 25 * 3600000), new Date(Date.now() + 3600000)]) {
      const { scanner } = await daemon({ date });
      await expect(scanner.scan(await image())).rejects.toMatchObject({ details: { code: "FEEDBACK_SCANNER_DEFINITIONS_STALE" } });
    }
    const changed = await daemon({ versionChanges: true });
    await expect(changed.scanner.scan(await image())).rejects.toMatchObject({ details: { code: "FEEDBACK_SCANNER_CHANGED" } });
  });
  it("rejects protocol errors and writable endpoint audiences without exposing daemon output", async () => {
    const malformed = await daemon({ reply: "private-scanner-error\0" });
    await expect(malformed.scanner.scan(await image())).rejects.not.toThrow("private-scanner-error");
    const writable = await daemon(); await chmod(writable.directory, 0o777);
    await expect(writable.scanner.scan(await image())).rejects.toMatchObject({ details: { code: "FEEDBACK_SCANNER_UNAVAILABLE" } });
    expect(writable.scanned).toEqual([]);
  });
});
