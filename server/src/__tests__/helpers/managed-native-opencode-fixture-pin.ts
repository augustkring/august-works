import { createHash } from "node:crypto";
import { createReadStream, closeSync, fstatSync, openSync } from "node:fs";

/** Existing 1.18.32 fixture pin, shared by the pre-quote image gate and the
 * actual signed-start producer. It confers no provider/Host qualification. */
export const MANAGED_NATIVE_OPENCODE_IMAGE_PIN = Object.freeze({ version: "1.18.32",
  sha256: "513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080" });

export async function assertManagedFixtureOpenCodeImage(path: string, deadlineAt = Date.now() + 10_000) {
  if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now()) throw new Error("fixture_opencode_image_deadline");
  const fd = openSync(path, "r"); let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > 512 * 1024 * 1024) throw new Error("fixture_opencode_image_invalid");
    stream = createReadStream(path, { fd, autoClose: false, highWaterMark: 1024 * 1024 });
    const digest = createHash("sha256"); let bytes = 0;
    for await (const chunk of stream) {
      if (Date.now() >= deadlineAt) throw new Error("fixture_opencode_image_deadline");
      digest.update(chunk); bytes += chunk.length;
    }
    const after = fstatSync(fd);
    if (bytes !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || digest.digest("hex") !== MANAGED_NATIVE_OPENCODE_IMAGE_PIN.sha256)
      throw new Error("fixture_opencode_image_pin_changed");
    return { sha256: MANAGED_NATIVE_OPENCODE_IMAGE_PIN.sha256, size: before.size };
  } finally { if (stream) stream.destroy(); else closeSync(fd); }
}
