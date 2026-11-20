import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  guardChildStdin,
  isExpectedChildStdinError,
  writeChildStdin,
} from "./child-stdin.js";
import { runChildProcess } from "./server-utils.js";

// Several megabytes: far more than a pipe buffer, so the write is still in
// flight when a child that never reads stdin exits.
const LARGE_STDIN = "x".repeat(8 * 1024 * 1024);
const EXIT_WITHOUT_READING = "process.exit(0)";
// Closes its stdin, says so on stdout, and exits with `code` a little later:
// every write the parent makes in between meets a closed pipe.
const CLOSE_STDIN_THEN_EXIT = (code: number) =>
  `require('fs').closeSync(0);process.stdout.write('closed');setTimeout(()=>process.exit(${code}),400);`;

let uncaught: unknown[] = [];
const captureUncaught = (err: unknown) => {
  uncaught.push(err);
};

beforeEach(() => {
  uncaught = [];
  process.on("uncaughtException", captureUncaught);
});

afterEach(() => {
  process.off("uncaughtException", captureUncaught);
});

function waitForClose(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

function settle(ms = 200) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("isExpectedChildStdinError", () => {
  it("accepts the codes a child that stopped reading raises", () => {
    expect(isExpectedChildStdinError(errorWithCode("EPIPE"))).toBe(true);
    expect(isExpectedChildStdinError(errorWithCode("ERR_STREAM_DESTROYED"))).toBe(true);
    expect(isExpectedChildStdinError(errorWithCode("ECONNRESET"))).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isExpectedChildStdinError(errorWithCode("EACCES"))).toBe(false);
    expect(isExpectedChildStdinError(new Error("boom"))).toBe(false);
    expect(isExpectedChildStdinError(null)).toBe(false);
  });
});

describe("writeChildStdin", () => {
  it("does not raise an uncaught EPIPE when the child exits without reading a large payload", async () => {
    const child = spawn(process.execPath, ["-e", EXIT_WITHOUT_READING], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const closed = waitForClose(child);
    const expected: Error[] = [];
    const unexpected: Error[] = [];

    writeChildStdin(child, LARGE_STDIN, {
      onError: (err) => unexpected.push(err),
      onExpectedError: (err) => expected.push(err),
    });

    await expect(closed).resolves.toEqual({ code: 0, signal: null });
    await settle();
    expect(uncaught).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(expected.map((err) => (err as NodeJS.ErrnoException).code)).toEqual(["EPIPE"]);
  });

  it("does not raise an uncaught EPIPE when a running child closed its stdin before the write", async () => {
    const child = spawn(process.execPath, ["-e", CLOSE_STDIN_THEN_EXIT(4)], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const closed = waitForClose(child);
    await new Promise((resolve) => child.stdout!.once("data", resolve));

    const expected: Error[] = [];
    const unexpected: Error[] = [];
    expect(
      writeChildStdin(child, LARGE_STDIN, {
        onError: (err) => unexpected.push(err),
        onExpectedError: (err) => expected.push(err),
      }),
    ).toBe(true);

    await expect(closed).resolves.toEqual({ code: 4, signal: null });
    await settle();
    expect(uncaught).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(expected.map((err) => (err as NodeJS.ErrnoException).code)).toEqual(["EPIPE"]);
  });

  it("delivers the data and ends stdin for a child that reads it", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "let n=0;process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>process.stdout.write(String(n)));",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let stdout = "";
    child.stdout!.on("data", (chunk) => {
      stdout += String(chunk);
    });
    const closed = waitForClose(child);

    expect(writeChildStdin(child, LARGE_STDIN)).toBe(true);

    await expect(closed).resolves.toEqual({ code: 0, signal: null });
    expect(stdout).toBe(String(LARGE_STDIN.length));
  });

  it("reports an unexpected stdin error through onError", async () => {
    const failure = errorWithCode("EACCES");
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(failure);
      },
    });
    const unexpected: Error[] = [];

    writeChildStdin(stream, "data", { onError: (err) => unexpected.push(err) });

    await settle(20);
    expect(unexpected).toEqual([failure]);
    expect(uncaught).toEqual([]);
  });

  it("skips a destroyed or ended stream", () => {
    const destroyed = new PassThrough();
    destroyed.destroy();
    expect(writeChildStdin(destroyed, "data")).toBe(false);
    const ended = new PassThrough();
    ended.end();
    expect(writeChildStdin(ended, "data")).toBe(false);
    expect(writeChildStdin(null, "data")).toBe(false);
  });

  it("attaches one listener however many times a stream is guarded", () => {
    const stream = new PassThrough();
    guardChildStdin(stream);
    guardChildStdin(stream);
    writeChildStdin(stream, "data", { end: false });
    expect(stream.listenerCount("error")).toBe(1);
  });
});

describe("runChildProcess stdin", () => {
  const baseOptions = {
    cwd: process.cwd(),
    env: {},
    timeoutSec: 10,
    graceSec: 1,
    onLog: async () => {},
  };

  it("resolves with the child's exit status when the child exits without reading a large stdin", async () => {
    const logErrors: unknown[] = [];
    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      ["-e", "process.exit(3)"],
      {
        ...baseOptions,
        stdin: LARGE_STDIN,
        onLogError: (err) => logErrors.push(err),
      },
    );
    await settle();

    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(uncaught).toEqual([]);
    expect(logErrors).toEqual([]);
  });

  it("does not raise an uncaught error when the child closed stdin before the deferred write", async () => {
    // onSpawn holds the write back until the child has closed its stdin, so
    // the whole payload goes into a closed pipe while the child still runs.
    const logErrors: unknown[] = [];
    let wroteAfter = false;
    const result = await runChildProcess(
      randomUUID(),
      process.execPath,
      ["-e", CLOSE_STDIN_THEN_EXIT(5)],
      {
        ...baseOptions,
        stdin: LARGE_STDIN,
        onLogError: (err) => logErrors.push(err),
        onSpawn: async () => {
          await settle(150);
          wroteAfter = true;
        },
      },
    );
    await settle();

    expect(wroteAfter).toBe(true);
    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe("closed");
    expect(uncaught).toEqual([]);
    expect(logErrors).toEqual([]);
  });
});
