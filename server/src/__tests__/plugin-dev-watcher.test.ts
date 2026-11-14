import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chokidarMock = vi.hoisted(() => ({
  watch: vi.fn(),
}));

vi.mock("chokidar", () => ({
  default: chokidarMock,
}));

import { createPluginDevWatcher, resolvePluginWatchTargets } from "../services/plugin-dev-watcher.js";

const tempDirs: string[] = [];

beforeEach(() => {
  vi.useRealTimers();
  chokidarMock.watch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempPluginDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paperclip-plugin-watch-"));
  tempDirs.push(dir);
  return dir;
}

function writePluginPackage(pluginDir: string): void {
  mkdirSync(path.join(pluginDir, "dist", "ui"), { recursive: true });
  writeFileSync(
    path.join(pluginDir, "package.json"),
    JSON.stringify({
      name: "@acme/example",
      paperclipPlugin: {
        manifest: "./dist/manifest.js",
        worker: "./dist/worker.js",
        ui: "./dist/ui",
      },
    }),
  );
  writeFileSync(path.join(pluginDir, "dist", "manifest.js"), "export default {};\n");
  writeFileSync(path.join(pluginDir, "dist", "worker.js"), "export default {};\n");
  writeFileSync(path.join(pluginDir, "dist", "ui", "index.js"), "export default {};\n");
  writeFileSync(path.join(pluginDir, "dist", "ui", "index.css"), "body {}\n");
}

function createLifecycle() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    restartWorker: vi.fn().mockResolvedValue(undefined),
  });
}

function installMockFsWatcher() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const fakeWatcher = {
    close: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      handlers[event] = listener;
      return fakeWatcher;
    }),
  };
  chokidarMock.watch.mockReturnValue(fakeWatcher);
  return { fakeWatcher, handlers };
}

describe("resolvePluginWatchTargets", () => {
  it("watches package metadata plus concrete declared runtime files", () => {
    const pluginDir = makeTempPluginDir();
    writePluginPackage(pluginDir);

    const targets = resolvePluginWatchTargets(pluginDir);

    expect(targets).toEqual([
      { path: path.join(pluginDir, "dist", "manifest.js"), recursive: false, kind: "file" },
      { path: path.join(pluginDir, "dist", "ui", "index.css"), recursive: false, kind: "file" },
      { path: path.join(pluginDir, "dist", "ui", "index.js"), recursive: false, kind: "file" },
      { path: path.join(pluginDir, "dist", "worker.js"), recursive: false, kind: "file" },
      { path: path.join(pluginDir, "package.json"), recursive: false, kind: "file" },
    ]);
  });

  it("falls back to dist when package metadata does not declare entrypoints", () => {
    const pluginDir = makeTempPluginDir();
    mkdirSync(path.join(pluginDir, "dist", "nested"), { recursive: true });
    writeFileSync(path.join(pluginDir, "package.json"), JSON.stringify({ name: "@acme/example" }));
    writeFileSync(path.join(pluginDir, "dist", "manifest.js"), "export default {};\n");
    writeFileSync(path.join(pluginDir, "dist", "nested", "chunk.js"), "export default {};\n");

    const targets = resolvePluginWatchTargets(pluginDir);

    expect(targets).toEqual([
      { path: path.join(pluginDir, "package.json"), recursive: false, kind: "file" },
      { path: path.join(pluginDir, "dist", "manifest.js"), recursive: false, kind: "file" },
      { path: path.join(pluginDir, "dist", "nested", "chunk.js"), recursive: false, kind: "file" },
    ]);
  });
});

describe("createPluginDevWatcher", () => {
  it("starts watching local plugins announced by lifecycle events", async () => {
    const pluginDir = makeTempPluginDir();
    writePluginPackage(pluginDir);
    installMockFsWatcher();
    const lifecycle = createLifecycle();

    const devWatcher = createPluginDevWatcher(
      lifecycle as never,
      async (pluginId) => (pluginId === "plugin-1" ? pluginDir : null),
    );

    lifecycle.emit("plugin.loaded", { pluginId: "plugin-1", pluginKey: "example" });

    await vi.waitFor(() => expect(chokidarMock.watch).toHaveBeenCalledTimes(1));
    const [watchedPaths] = chokidarMock.watch.mock.calls[0] ?? [];
    expect(watchedPaths).toContain(path.join(pluginDir, "dist", "worker.js"));

    devWatcher.close();
  });

  it("excludes bundled catalog paths while continuing to watch editable local plugins", async () => {
    const catalogRoot = makeTempPluginDir();
    const bundledDir = path.join(catalogRoot, "sandbox-providers", "example");
    writePluginPackage(bundledDir);
    const localDir = makeTempPluginDir();
    writePluginPackage(localDir);
    installMockFsWatcher();
    const lifecycle = createLifecycle();
    const devWatcher = createPluginDevWatcher(
      lifecycle as never,
      async (pluginId) => pluginId === "bundled" ? bundledDir : localDir,
      undefined,
      { unwatchedRoots: [catalogRoot] },
    );

    lifecycle.emit("plugin.loaded", { pluginId: "bundled", pluginKey: "bundled" });
    devWatcher.watch("bundled-direct", bundledDir);
    lifecycle.emit("plugin.loaded", { pluginId: "local", pluginKey: "local" });

    await vi.waitFor(() => expect(chokidarMock.watch).toHaveBeenCalledTimes(1));
    const watched = chokidarMock.watch.mock.calls.flatMap(([targets]) => targets as string[]);
    expect(watched).toContain(path.join(localDir, "dist", "worker.js"));
    expect(watched.every((target) => !target.startsWith(catalogRoot))).toBe(true);
    devWatcher.close();
  });

  it("excludes bundled paths through real and symbolic root forms", () => {
    const realRoot = makeTempPluginDir();
    const linkParent = makeTempPluginDir();
    const linkedRoot = path.join(linkParent, "catalog");
    symlinkSync(realRoot, linkedRoot, "dir");
    const bundledDir = path.join(realRoot, "sandbox-providers", "example");
    writePluginPackage(bundledDir);
    installMockFsWatcher();
    const devWatcher = createPluginDevWatcher(createLifecycle() as never, undefined, undefined, { unwatchedRoots: [linkedRoot] });

    devWatcher.watch("bundled-real", bundledDir);
    devWatcher.watch("bundled-link", path.join(linkedRoot, "sandbox-providers", "example"));

    expect(chokidarMock.watch).not.toHaveBeenCalled();
    devWatcher.close();
  });

  it("closes a local watcher and cancels its pending restart when lifecycle lookup moves into the bundle root", async () => {
    vi.useFakeTimers();
    const localDir = makeTempPluginDir();
    writePluginPackage(localDir);
    const catalogRoot = makeTempPluginDir();
    const bundledDir = path.join(catalogRoot, "sandbox-providers", "example");
    writePluginPackage(bundledDir);
    const { fakeWatcher, handlers } = installMockFsWatcher();
    const lifecycle = createLifecycle();
    let resolvedPath = localDir;
    const devWatcher = createPluginDevWatcher(
      lifecycle as never,
      async () => resolvedPath,
      undefined,
      { unwatchedRoots: [catalogRoot] },
    );

    lifecycle.emit("plugin.loaded", { pluginId: "moving", pluginKey: "moving" });
    await vi.waitFor(() => expect(chokidarMock.watch).toHaveBeenCalledTimes(1));
    handlers.all?.("change", path.join(localDir, "dist", "worker.js"));
    resolvedPath = bundledDir;
    lifecycle.emit("plugin.enabled", { pluginId: "moving", pluginKey: "moving" });
    await vi.waitFor(() => expect(fakeWatcher.close).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(lifecycle.restartWorker).not.toHaveBeenCalled();
    expect(chokidarMock.watch).toHaveBeenCalledTimes(1);
    devWatcher.close();
  });

  it("ignores stale asynchronous package lookups after unload and out-of-order lifecycle events", async () => {
    const firstDir = makeTempPluginDir();
    writePluginPackage(firstDir);
    const secondDir = makeTempPluginDir();
    writePluginPackage(secondDir);
    installMockFsWatcher();
    const lifecycle = createLifecycle();
    const lookups: Array<(value: string | null) => void> = [];
    const devWatcher = createPluginDevWatcher(lifecycle as never, () => new Promise((resolve) => {
      lookups.push(resolve);
    }));

    lifecycle.emit("plugin.loaded", { pluginId: "race", pluginKey: "race" });
    await vi.waitFor(() => expect(lookups).toHaveLength(1));
    lifecycle.emit("plugin.enabled", { pluginId: "race", pluginKey: "race" });
    await vi.waitFor(() => expect(lookups).toHaveLength(2));
    lookups[1]!(secondDir);
    await vi.waitFor(() => expect(chokidarMock.watch).toHaveBeenCalledTimes(1));
    lookups[0]!(firstDir);
    await Promise.resolve();
    expect(chokidarMock.watch).toHaveBeenCalledTimes(1);
    expect(chokidarMock.watch.mock.calls[0]?.[0]).toContain(path.join(secondDir, "dist", "worker.js"));

    lifecycle.emit("plugin.loaded", { pluginId: "unloaded-race", pluginKey: "unloaded-race" });
    await vi.waitFor(() => expect(lookups).toHaveLength(3));
    lifecycle.emit("plugin.unloaded", { pluginId: "unloaded-race", pluginKey: "unloaded-race" });
    lookups[2]!(firstDir);
    await Promise.resolve();
    expect(chokidarMock.watch).toHaveBeenCalledTimes(1);
    devWatcher.close();
  });

  it("debounces watched file changes and restarts the plugin worker", async () => {
    vi.useFakeTimers();
    const pluginDir = makeTempPluginDir();
    writePluginPackage(pluginDir);
    const { handlers } = installMockFsWatcher();
    const lifecycle = createLifecycle();

    const devWatcher = createPluginDevWatcher(lifecycle as never);
    devWatcher.watch("plugin-1", pluginDir);

    handlers.all?.("change", path.join(pluginDir, "dist", "worker.js"));
    await vi.advanceTimersByTimeAsync(500);

    expect(lifecycle.restartWorker).toHaveBeenCalledWith("plugin-1");

    devWatcher.close();
  });
});
