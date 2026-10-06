import { describe, expect, it } from "vitest";
import express from "express";
import { applyTrustProxy, parseTrustProxyEnv } from "../middleware/trust-proxy.js";

function appWithEnv(raw: string | undefined): express.Express {
  const app = express();
  applyTrustProxy(app, parseTrustProxyEnv(raw));
  return app;
}

describe("parseTrustProxyEnv", () => {
  it("unset leaves Express at its safe default (trust nothing)", () => {
    // Express's default trust-proxy setting is `false`. We verify the
    // setting is unchanged by comparing against a vanilla express()
    // instance that never had `applyTrustProxy` called on it.
    const baseline = express().get("trust proxy");
    const app = appWithEnv(undefined);
    expect(parseTrustProxyEnv(undefined)).toBeUndefined();
    expect(app.get("trust proxy")).toBe(baseline);
  });

  it("empty / false / 0 are treated as unset", () => {
    expect(parseTrustProxyEnv("")).toBeUndefined();
    expect(parseTrustProxyEnv("false")).toBeUndefined();
    expect(parseTrustProxyEnv("0")).toBeUndefined();
    const baseline = express().get("trust proxy");
    expect(appWithEnv("0").get("trust proxy")).toBe(baseline);
  });

  it("'true' yields boolean true and sets app accordingly", () => {
    expect(parseTrustProxyEnv("true")).toBe(true);
    expect(appWithEnv("true").get("trust proxy")).toBe(true);
  });

  it("positive integer is parsed as a number", () => {
    expect(parseTrustProxyEnv("2")).toBe(2);
    expect(appWithEnv("2").get("trust proxy")).toBe(2);
  });

  it("'01' throws (strict integer, no leading zeros)", () => {
    expect(() => parseTrustProxyEnv("01")).toThrow(/invalid integer/);
  });

  it("integer with internal whitespace throws", () => {
    // A value like "1 2" (digits + whitespace + digits) is clearly not
    // a single int and not a subnet list either — must be rejected.
    // This is distinct from " 2 " (surrounding whitespace), which the
    // outer `raw.trim()` accepts; see the next test for that contract.
    // The parser happens to reach the subnet-token path for "1 2"
    // (the inner-whitespace integer guard only fires when the whole
    // string is `^\s*\d+\s*$`), so we match the unrecognized-token
    // error rather than the "invalid integer" branch.
    expect(() => parseTrustProxyEnv("1 2")).toThrow(/unrecognized token "1 2"/);
  });

  it("integer with surrounding whitespace is accepted (trimmed)", () => {
    // The parser intentionally trims the *outer* value before matching,
    // so " 2 " is equivalent to "2". Locking this in so the contract
    // doesn't drift relative to the "internal whitespace throws" case.
    expect(parseTrustProxyEnv(" 2 ")).toBe(2);
    expect(appWithEnv(" 2 ").get("trust proxy")).toBe(2);
  });

  it("'loopback' yields a single-element array", () => {
    const v = parseTrustProxyEnv("loopback");
    expect(v).toEqual(["loopback"]);
    const app = appWithEnv("loopback");
    expect(app.get("trust proxy")).toEqual(["loopback"]);
  });

  it("'loopback,uniquelocal' yields a 2-element array", () => {
    expect(parseTrustProxyEnv("loopback,uniquelocal")).toEqual([
      "loopback",
      "uniquelocal",
    ]);
  });

  it("IPv4 CIDR is accepted", () => {
    expect(parseTrustProxyEnv("10.0.0.0/8")).toEqual(["10.0.0.0/8"]);
  });

  it("mixed IPv4 + IPv6 CIDR list is accepted with whitespace tolerance", () => {
    expect(parseTrustProxyEnv(" 10.0.0.0/8 , fd00::/8 ")).toEqual([
      "10.0.0.0/8",
      "fd00::/8",
    ]);
  });

  it("'bogus' throws with a helpful message naming the bad token", () => {
    expect(() => parseTrustProxyEnv("bogus")).toThrow(/bogus/);
    expect(() => parseTrustProxyEnv("bogus")).toThrow(/loopback/);
  });

  it("partial-garbage list throws on the bad token, not silently dropped", () => {
    expect(() => parseTrustProxyEnv("loopback,not-a-cidr")).toThrow(
      /not-a-cidr/,
    );
  });

  it.each([
    "999.1.1.1", "127.00.0.1", ":::1", "1:2:3", "gggg::1", "fe80::1%eth0",
    "10.0.0.0/33", "::1/129", "::1/01", "::1/64/1", "::1/", "9007199254740992",
  ])("rejects malformed trust configuration: %s", (value) => {
    expect(() => parseTrustProxyEnv(value)).toThrow(/TRUST_PROXY/);
  });

  it("does not trust IPv4 peers through a short IPv6 prefix (GHSA-jqcg-44mw-7w3h)", () => {
    expect(() => parseTrustProxyEnv("::ffff:10.0.0.0/8")).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxyEnv("::FFFF:10.0.0.0/95")).toThrow(/TRUST_PROXY/);
    const broadIpv6Trust = appWithEnv("::/1").get("trust proxy fn");
    expect(broadIpv6Trust("203.0.113.10", 0)).toBe(false);
    expect(broadIpv6Trust("10.1.2.3", 0)).toBe(false);
    const trust = appWithEnv("::ffff:10.0.0.0/104").get("trust proxy fn");
    expect(trust("10.1.2.3", 0)).toBe(true);
    expect(trust("203.0.113.10", 0)).toBe(false);
  });

  it("ignores spoofed forwarding headers from an untrusted peer", () => {
    const app = appWithEnv("10.0.0.0/8");
    const req = Object.create(app.request);
    req.app = app;
    req.socket = { remoteAddress: "203.0.113.10" };
    req.headers = { "x-forwarded-for": "127.0.0.1", "x-forwarded-proto": "https" };
    expect(req.ip).toBe("203.0.113.10");
    expect(req.ips).toEqual([]);
    expect(req.protocol).toBe("http");

    req.socket.remoteAddress = "10.1.2.3";
    req.headers["x-forwarded-for"] = "127.0.0.1, 203.0.113.10";
    expect(req.ip).toBe("203.0.113.10");
    expect(req.ips).toEqual(["203.0.113.10"]);
    expect(req.protocol).toBe("https");
  });
});
