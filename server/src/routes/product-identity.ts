import { Router } from "express";
import { PRODUCT_IDENTITY } from "@paperclipai/shared";

/** Public contact metadata, never an assertion that inbox/TLS/legal readiness
 * has been operationally qualified. Expiry requires an explicit release review. */
export function productIdentityRoutes(now: () => number = Date.now) {
  const router = Router();
  router.get("/security.txt", (_req, res) => res.redirect(308, "/.well-known/security.txt"));
  router.get("/.well-known/security.txt", (_req, res) => {
    const current = now();
    const expires = Date.parse(PRODUCT_IDENTITY.securityContactExpiresAt);
    res.set("X-Content-Type-Options", "nosniff").type("text/plain");
    if (!Number.isFinite(expires) || expires <= current) {
      res.set("Cache-Control", "no-store").status(503).send("Security contact publication requires renewal.\n");
      return;
    }
    res.set("Cache-Control", `public, max-age=${Math.min(3600, Math.floor((expires - current) / 1000))}`);
    res.send([
      `Contact: mailto:${PRODUCT_IDENTITY.securityEmail}`,
      `Expires: ${PRODUCT_IDENTITY.securityContactExpiresAt}`,
      "Preferred-Languages: en, da",
      "",
    ].join("\n"));
  });
  return router;
}
