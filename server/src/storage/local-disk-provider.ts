import { createReadStream, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { StorageProvider, GetObjectResult, HeadObjectResult } from "./types.js";
import { notFound, badRequest } from "../errors.js";
import { storageScopeIdentity } from "./object-scope.js";

function normalizeObjectKey(objectKey: string): string {
  const normalized = objectKey.replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/")) {
    throw badRequest("Invalid object key");
  }

  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw badRequest("Invalid object key");
  }

  return parts.join("/");
}

function resolveWithin(baseDir: string, objectKey: string): string {
  const normalizedKey = normalizeObjectKey(objectKey);
  const resolved = path.resolve(baseDir, normalizedKey);
  const base = path.resolve(baseDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw badRequest("Invalid object key path");
  }
  return resolved;
}

async function statOrNull(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function createLocalDiskStorageProvider(baseDir: string): StorageProvider {
  const root = path.resolve(baseDir);

  return {
    id: "local_disk",
    scopeId: storageScopeIdentity(["local_disk", root]),

    async putObject(input) {
      const targetPath = resolveWithin(root, input.objectKey);
      const dir = path.dirname(targetPath);
      await fs.mkdir(dir, { recursive: true });

      const tempPath = `${targetPath}.tmp-${randomUUID()}`;
      // Allocate exclusively before owning cleanup. Never remove another
      // writer's file if allocation itself fails. Temporary private bytes
      // have the same deletion obligations as the committed object.
      const file = await fs.open(tempPath, "wx", 0o600);
      try {
        await file.writeFile(input.body);
        await file.close();
        await fs.rename(tempPath, targetPath);
      } finally {
        await file.close();
        await fs.rm(tempPath, { force: true });
      }
    },

    async getObject(input): Promise<GetObjectResult> {
      const filePath = resolveWithin(root, input.objectKey);
      const stat = await statOrNull(filePath);
      if (!stat || !stat.isFile()) {
        throw notFound("Object not found");
      }
      const streamOptions = input.range
        ? { start: input.range.start, end: input.range.end }
        : undefined;
      const contentLength = input.range
        ? input.range.end - input.range.start + 1
        : stat.size;
      return {
        stream: createReadStream(filePath, streamOptions),
        contentLength,
        lastModified: stat.mtime,
      };
    },

    async headObject(input): Promise<HeadObjectResult> {
      const filePath = resolveWithin(root, input.objectKey);
      const stat = await statOrNull(filePath);
      if (!stat || !stat.isFile()) {
        return { exists: false };
      }
      return {
        exists: true,
        contentLength: stat.size,
        lastModified: stat.mtime,
      };
    },

    async deleteObject(input): Promise<void> {
      const filePath = resolveWithin(root, input.objectKey);
      // Include copies left by an interrupted process and the legacy writer.
      // Match only this exact allocated filename; never recurse or erase a
      // neighboring object. The protected-feedback owner separately requires
      // transport quiescence before it can authorize this deletion.
      const directory = path.dirname(filePath);
      let names: string[];
      try {
        names = await fs.readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      const temporaryPrefix = `${path.basename(filePath)}.tmp-`;
      for (const name of names) {
        if (!name.startsWith(temporaryPrefix)) continue;
        try { await fs.unlink(path.join(directory, name)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      try {
        await fs.unlink(filePath);
      } catch (error) {
        // Only actual absence is an idempotent deletion acknowledgement.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
