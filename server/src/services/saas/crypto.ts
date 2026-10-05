import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
export function equalDigest(a: string, b: string): boolean {
  return (
    /^[a-f0-9]{64}$/i.test(a) &&
    /^[a-f0-9]{64}$/i.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export function recipientHash(email: string, keyHex: string): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(email.trim().toLowerCase())
    .digest("hex");
}
export function seal(value: unknown, keyHex: string, context: string): string {
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error("Invalid encryption key");
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    nonce,
  );
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function open<T>(sealed: string, keyHex: string, context: string): T {
  const [version, nonce, tag, body, ...extra] = sealed.split(".");
  if (
    version !== "v1" ||
    !nonce ||
    !tag ||
    !body ||
    extra.length ||
    !/^[a-f0-9]{64}$/i.test(keyHex)
  )
    throw new Error("Invalid encrypted envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(nonce, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
export function publicJson<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}
