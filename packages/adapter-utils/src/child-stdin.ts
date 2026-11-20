import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

/**
 * Error codes a child's stdin pipe raises when the child stopped reading:
 * it exited, closed its stdin, or was killed before it consumed the input.
 * These are expected. The child's own exit status and stdout/stderr decide
 * the outcome of the run, so these errors are not reported.
 */
export const EXPECTED_CHILD_STDIN_ERROR_CODES: ReadonlySet<string> = new Set([
  "EPIPE",
  "ERR_STREAM_DESTROYED",
  "ECONNRESET",
]);

export function isExpectedChildStdinError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === "string" && EXPECTED_CHILD_STDIN_ERROR_CODES.has(code);
}

export interface ChildStdinErrorOptions {
  /**
   * Receives any stdin error that is not an expected "child stopped reading"
   * error. Route it to the caller's existing error path. Without it the error
   * is written to `console.warn` so it is never swallowed silently.
   */
  onError?: (err: Error) => void;
  /** Receives the expected EPIPE / ERR_STREAM_DESTROYED / ECONNRESET errors. */
  onExpectedError?: (err: Error) => void;
}

type StdinTarget = Pick<ChildProcess, "stdin"> | Writable | null | undefined;

const guardedStreams = new WeakSet<Writable>();

function resolveStream(target: StdinTarget): Writable | null {
  if (!target) return null;
  if ("stdin" in target && !("write" in target)) return target.stdin ?? null;
  return target as Writable;
}

/**
 * Attaches an `error` listener to a child's stdin so an EPIPE (or any other
 * stdin error) can never become an uncaught exception that stops the process.
 * Attach it before the first write. Calling it again on the same stream is a
 * no-op, so a stream gets one listener however many writers share it.
 * Returns the stream, or null when there is none.
 */
export function guardChildStdin(
  target: StdinTarget,
  options: ChildStdinErrorOptions = {},
): Writable | null {
  const stream = resolveStream(target);
  if (!stream || guardedStreams.has(stream)) return stream;
  // Only an event emitter can raise a stream error; a stand-in without one
  // (a test double that records writes) has nothing to guard.
  if (typeof stream.on !== "function") return stream;
  guardedStreams.add(stream);
  stream.on("error", (err: Error) => {
    if (isExpectedChildStdinError(err)) {
      options.onExpectedError?.(err);
      return;
    }
    if (options.onError) {
      options.onError(err);
      return;
    }
    console.warn({ err }, "child process stdin error");
  });
  return stream;
}

export interface WriteChildStdinOptions extends ChildStdinErrorOptions {
  /** End stdin after the write. Default true. */
  end?: boolean;
}

/**
 * Writes `data` to a child's stdin with an error listener attached first,
 * then ends stdin (unless `end: false`). Returns false when nothing was
 * written because the stream is missing, destroyed or already ended.
 */
export function writeChildStdin(
  target: StdinTarget,
  data: string | Uint8Array | null | undefined,
  options: WriteChildStdinOptions = {},
): boolean {
  const stream = guardChildStdin(target, options);
  if (!stream || stream.destroyed || stream.writableEnded) return false;
  const end = options.end ?? true;
  if (data != null && data.length > 0) stream.write(data);
  if (end) stream.end();
  return true;
}
