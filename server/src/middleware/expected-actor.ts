import type { RequestHandler } from "express";

/** A request binding, never an authentication or authorization mechanism. */
export function expectedActorGuard(): RequestHandler {
  return (req, res, next) => {
    const expected = req.query.expectedActorId;
    if (expected === undefined) return next();
    if (typeof expected !== "string" || !expected || expected.length > 512) {
      res.status(400).json({ error: "Invalid account binding", code: "INVALID_ACCOUNT_BINDING" });
      return;
    }
    const current = req.actor.type !== "board" ? null
      : req.actor.source === "local_implicit" ? "local-board"
      : req.actor.userId ? `user:${req.actor.userId}` : null;
    if (current !== expected) {
      res.status(409).json({ error: "The account changed. Reload this page before continuing.", code: "ACCOUNT_CHANGED" });
      return;
    }
    // This reserved transport parameter is not part of a domain query. Express
    // derives req.query from req.url, so remove it there before strict domain
    // validation. Keep originalUrl intact for request attribution and logging.
    const queryAt = req.url.indexOf("?");
    const params = new URLSearchParams(req.url.slice(queryAt + 1));
    params.delete("expectedActorId");
    const query = params.toString();
    req.url = req.url.slice(0, queryAt) + (query ? `?${query}` : "");
    next();
  };
}
