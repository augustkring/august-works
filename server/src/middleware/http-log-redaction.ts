export const HTTP_LOG_SENSITIVE_HEADERS = [
  "x-blentera-expected-user",
  "x-blentera-expected-session",
  "x-paperclip-cloud-tenant-token",
  "x-paperclip-cloud-session-id",
  "x-paperclip-cloud-runtime-identity",
  "x-paperclip-cloud-control",
  "x-paperclip-cloud-inspection",
  "x-paperclip-tool-gateway-token",
  "x-paperclip-workspace-readiness-token",
  "x-paperclip-dev-server-status-token",
  "x-openclaw-token",
  "x-openclaw-auth",
  "x-aw-relay-token",
] as const;

export const HTTP_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  // Redirects can carry a one-time login ticket or OAuth authorization code.
  "res.headers.location",
  'req.headers["proxy-authorization"]',
  "req.headers.cookie",
  // "set-cookie" is normally a response header; keep the request-side
  // path as defensive coverage in case a proxy forwards it inbound.
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  // Credential- and session-paired headers with no debugging value.
  'req.headers["x-csrf-token"]',
  'req.headers["x-xsrf-token"]',
  'req.headers["x-api-key"]',
  ...HTTP_LOG_SENSITIVE_HEADERS.map((name) => `req.headers["${name}"]`),
  // Runtime GitHub capabilities authorize credential acquisition for a live run.
  'req.headers["x-paperclip-github-capability"]',
  // Telegram's optional webhook verification header is a reusable bearer
  // secret sent on every provider callback.
  'req.headers["x-telegram-bot-api-secret-token"]',
  // The structured failure logger adds a sanitized request-body copy under
  // `reqBody`. Keep the standard connector credential envelope covered again
  // at the final serialization boundary in case a future custom serializer
  // bypasses the recursive redactor.
  "reqBody.credentials",
  "errorContext.details.credentials",
] as const;
