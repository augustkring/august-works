/**
 * Parser for the `TRUST_PROXY` env var, which mirrors Express 5's
 * `trust proxy` setting. The default is intentionally *unset* — Express
 * then trusts nothing and `req.ip` / `X-Forwarded-For` cannot be spoofed
 * by arbitrary clients. Operators opt in only when there is a real LB
 * in front of the server.
 *
 * Accepted forms (case-sensitive for the keywords, matching Express):
 *
 *   unset | "" | "false" | "0"   -> undefined (caller skips `app.set`)
 *   "true"                       -> true   (UNSAFE behind untrusted LBs)
 *   "<positive integer>"         -> number (trust N hops)
 *   comma-separated tokens       -> string[] of named subnets + CIDRs
 *
 * Named subnets accepted verbatim by Express: loopback, linklocal,
 * uniquelocal. Other entries must be valid IP addresses with an optional
 * prefix length for that address family. Invalid trust configuration fails
 * at startup, before it can affect client identity or rate limiting.
 */
import { isIP } from "node:net";

export type TrustProxyValue = boolean | number | string[];

const NAMED_SUBNETS: ReadonlySet<string> = new Set([
  "loopback",
  "linklocal",
  "uniquelocal",
]);

// Strict positive integer: no leading zeros, no whitespace, no sign.
const STRICT_POS_INT_RE = /^[1-9]\d*$/;

function isValidSubnetToken(token: string): boolean {
  if (NAMED_SUBNETS.has(token)) return true;
  const [address, prefix, extra] = token.split("/");
  const family = isIP(address);
  if (!family || address.includes("%") || extra !== undefined) return false;
  if (prefix === undefined) return true;
  return /^(0|[1-9]\d*)$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parse a raw env-var value into the form Express's `app.set("trust proxy", …)`
 * accepts, or `undefined` to mean "leave Express at its safe default."
 *
 * Throws `Error` with an explanatory message if the value is malformed.
 */
export function parseTrustProxyEnv(raw: string | undefined): TrustProxyValue | undefined {
  if (raw === undefined) return undefined;
  // We intentionally trim only the *outer* value — tokens inside the
  // comma list are trimmed individually below. Leading/trailing whitespace
  // around the whole value (e.g. " 2 ") is accepted because trim() reduces
  // it to "2" before STRICT_POS_INT_RE is applied; only *internal*
  // whitespace (e.g. "1 2") falls through to the subnet path and errors as
  // an unrecognised token.
  const value = raw.trim();
  if (value === "" || value === "false" || value === "0") return undefined;
  if (value === "true") return true;
  if (STRICT_POS_INT_RE.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  // Digits with leading zeros or an unsafe integer value are typos,
  // not subnet lists. Surrounding whitespace was already trimmed.
  if (/^\s*\d+\s*$/.test(raw)) {
    throw new Error(
      `TRUST_PROXY: invalid integer value ${JSON.stringify(raw)} — use a safe positive integer with no leading zeros`,
    );
  }
  const tokens = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  for (const token of tokens) {
    if (!isValidSubnetToken(token)) {
      throw new Error(
        `TRUST_PROXY: unrecognized token ${JSON.stringify(token)} — expected one of {loopback, linklocal, uniquelocal} or a CIDR like 10.0.0.0/8 or fd00::/8`,
      );
    }
  }
  return tokens;
}

/**
 * Apply the parsed value to the given Express app. No-op when the value
 * is `undefined`, preserving Express's default (trust nothing).
 */
export function applyTrustProxy(
  app: { set: (key: string, value: TrustProxyValue) => unknown },
  value: TrustProxyValue | undefined,
): void {
  if (value === undefined) return;
  app.set("trust proxy", value);
}
