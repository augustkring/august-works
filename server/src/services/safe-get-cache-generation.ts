import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Invalidation generations for in-process safe-GET result caches (today the
 * compact Tasks list in `routes/issues.ts`).
 *
 * A cached or in-flight GET result may only be reused while the generation it
 * captured is still current. The generation advances:
 *
 * - process-wide, when any HTTP request with a non-safe method writes its
 *   response headers (after the route committed its write, before the client
 *   can see the response) and again when the response finishes; and
 * - per company, whenever a company live event is published (background
 *   writers such as heartbeat runs announce their changes this way).
 *
 * The generation only decides reuse. Cache keys stay per actor and permission
 * context, and every reused body is still re-authorized by the route.
 */

let globalWriteGeneration = 0;
const companyEventGeneration = new Map<string, number>();
const hookedResponses = new WeakSet<Response>();

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function currentSafeGetCacheGeneration(companyId: string): string {
  return `${globalWriteGeneration}:${companyEventGeneration.get(companyId) ?? 0}`;
}

export function bumpSafeGetCacheGenerationForWrite() {
  globalWriteGeneration += 1;
}

export function bumpSafeGetCacheGenerationForCompany(companyId: string) {
  companyEventGeneration.set(companyId, (companyEventGeneration.get(companyId) ?? 0) + 1);
}

/**
 * Advances the write generation for every non-safe HTTP request right before
 * its response headers are written and again when it finishes. Install it
 * before any router that can write. Installing it more than once is harmless.
 */
export function safeGetCacheWriteInvalidation(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method.toUpperCase()) || hookedResponses.has(res)) {
      next();
      return;
    }
    hookedResponses.add(res);
    const originalWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithCacheInvalidation(this: Response, ...args: unknown[]) {
      bumpSafeGetCacheGenerationForWrite();
      return (originalWriteHead as (...inner: unknown[]) => Response).apply(this, args);
    } as typeof res.writeHead;
    res.once("finish", bumpSafeGetCacheGenerationForWrite);
    res.once("close", bumpSafeGetCacheGenerationForWrite);
    next();
  };
}
