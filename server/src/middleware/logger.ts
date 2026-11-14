import pino from "pino";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { HTTP_LOG_REDACT_PATHS } from "./http-log-redaction.js";
import {
  isPrivateWebhookHttpRequest,
  isPrivateExperienceHttpRequest,
  privateExperienceLogUrl,
  isSecretSensitiveHttpRequest,
  shouldSilenceHttpSuccessLog,
} from "./http-log-policy.js";
import {
  redactSensitive,
  stripSecretBearingUrlParts,
} from "./redact-sensitive.js";

const sharedOpts = {
  translateTime: "SYS:HH:MM:ss",
  ignore: "pid,hostname",
  singleLine: true,
};

const SAFE_ERROR_TYPES = new Set([
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError",
  "URIError", "EvalError", "AggregateError", "AbortError", "TimeoutError",
  "DatabaseError", "HttpError",
]);
const SAFE_ERROR_MESSAGES = new Set([
  "Private experience request failed",
  "SaaS ingress request failed",
  "Chat webhook request failed",
  "Secret-sensitive request failed",
]);

function errorField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try { return (value as Record<string, unknown>)[key]; } catch { return undefined; }
}

function safeErrorType(value: unknown, sqlState?: string, status?: number): string {
  if (sqlState) return "DatabaseError";
  if (status !== undefined) return "HttpError";
  const projectedType = errorField(value, "type");
  if (typeof projectedType === "string" && SAFE_ERROR_TYPES.has(projectedType)) return projectedType;
  const name = errorField(value, "name");
  return typeof name === "string" && SAFE_ERROR_TYPES.has(name) ? name : "Error";
}

function safeErrorLocation(value: unknown): { line: number; column: number } | undefined {
  const projected = errorField(value, "location");
  if (projected && typeof projected === "object") {
    const line = errorField(projected, "line"), column = errorField(projected, "column");
    if (typeof line === "number" && Number.isInteger(line) && line > 0 &&
      typeof column === "number" && Number.isInteger(column) && column > 0)
      return { line, column };
  }
  const stack = errorField(value, "stack");
  if (typeof stack !== "string") return undefined;
  // Keep numeric location only. Filenames, paths, function names and source text
  // can contain user data when an Error is constructed from untrusted input.
  for (const line of stack.split(/\r?\n/).slice(1, 8)) {
    const match = /:(\d+):(\d+)\)?\s*$/.exec(line);
    if (match) return { line: Number(match[1]), column: Number(match[2]) };
  }
  return undefined;
}

/** A content-free projection for every application logger error field. */
export function safeErrorLogProjection(value: unknown): Record<string, unknown> {
  const seen = new Set<object>();
  const project = (current: unknown, depth: number): Record<string, unknown> => {
    if (!current || typeof current !== "object" || seen.has(current) || depth > 3)
      return { type: "Error" };
    seen.add(current);
    const rawCode = errorField(current, "code") ?? errorField(current, "sqlState");
    const sqlState = typeof rawCode === "string" && /^[0-9A-Z]{5}$/.test(rawCode) ? rawCode : undefined;
    const rawStatus = errorField(current, "statusCode") ?? errorField(current, "status");
    const status = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus : undefined;
    const projection: Record<string, unknown> = { type: safeErrorType(current, sqlState, status) };
    if (sqlState) projection.sqlState = sqlState;
    if (status !== undefined) projection.status = status;
    const rawMessage = errorField(current, "message");
    if (typeof rawMessage === "string" && SAFE_ERROR_MESSAGES.has(rawMessage)) projection.message = rawMessage;
    const location = safeErrorLocation(current);
    if (location) projection.location = location;
    const cause = errorField(current, "cause");
    if (cause !== undefined && depth < 3) projection.cause = project(cause, depth + 1);
    return projection;
  };
  try { return project(value, 0); } catch { return { type: "Error" }; }
}

const errorSerializers = {
  err: safeErrorLogProjection,
  error: safeErrorLogProjection,
};

const isProduction = process.env.NODE_ENV === "production";
export const logger = isProduction
  ? pino({
      level: process.env.PAPERCLIP_LOG_LEVEL?.trim() || "info",
      redact: [...HTTP_LOG_REDACT_PATHS],
      serializers: errorSerializers,
    })
  : pino(
      {
        level: process.env.PAPERCLIP_LOG_LEVEL?.trim() || "debug",
        redact: [...HTTP_LOG_REDACT_PATHS],
        serializers: errorSerializers,
      },
      pino.transport({
        target: "pino-pretty",
        options: {
          ...sharedOpts,
          ignore: "pid,hostname,req,res,responseTime",
          colorize: true,
          destination: 1,
        },
      }),
    );

function requestClassificationUrl(req: {
  originalUrl?: unknown;
  url?: unknown;
}): string | undefined {
  return typeof req.originalUrl === "string"
    ? req.originalUrl
    : typeof req.url === "string"
      ? req.url
      : undefined;
}

function isPrivateWebhook(req: {
  method?: string;
  originalUrl?: unknown;
  url?: unknown;
}) {
  return isPrivateWebhookHttpRequest(
    req.method,
    requestClassificationUrl(req),
  );
}

function privateWebhookLogUrl(url: unknown) {
  if (typeof url === "string" && /\/api\/webhooks(?:\/|\?|$)/i.test(url)) return "/api/webhooks/:provider";
  if (typeof url === "string" && /\/api\/internal\/runtime(?:\/|\?|$)/i.test(url)) return "/api/internal/runtime/:operation";
  return typeof url === "string" && /\/routine-triggers\/public(?:\/|$)/i.test(url)
    ? "/api/routine-triggers/public/:publicId/fire"
    : "/api/chat-webhooks/:publicId/:provider";
}

function requestLogUrl(req: {
  method?: string;
  originalUrl?: unknown;
  url?: unknown;
}) {
  if (isPrivateExperienceHttpRequest(req.method, requestClassificationUrl(req)))
    return privateExperienceLogUrl(requestClassificationUrl(req)!);
  return isPrivateWebhook(req)
    ? privateWebhookLogUrl(requestClassificationUrl(req))
    : stripSecretBearingUrlParts(typeof req.url === "string" ? req.url : "");
}

function isContentPrivate(req: { method?: string; originalUrl?: unknown; url?: unknown }) {
  return isPrivateWebhook(req) || isPrivateExperienceHttpRequest(req.method, requestClassificationUrl(req));
}

export function createHttpLogger(baseLogger: Logger) {
  return pinoHttp({
    logger: baseLogger,
    serializers: {
      err: safeErrorLogProjection,
      req(req: Record<string, unknown> & { url?: unknown }) {
        if (
          isContentPrivate({
            method: typeof req.method === "string" ? req.method : undefined,
            url: req.url,
          })
        ) {
          // pino's standard request serializer has already selected originalUrl.
          // A closed projection also excludes params, arbitrary headers and any
          // parser/SDK-added body copies, including Buffer numeric byte keys.
          return {
            id: req.id,
            method: req.method,
            url: requestLogUrl({method: typeof req.method === "string" ? req.method : undefined, url: req.url}),
          };
        }
        return {
          ...req,
          url:
            typeof req.url === "string"
              ? stripSecretBearingUrlParts(req.url)
              : req.url,
          // The URL policy intentionally drops all query parameters. The default
          // serializer also exposes the parsed query separately, so omit that
          // duplicate path instead of letting credentials bypass the URL scrub.
          query: undefined,
        };
      },
      res(
        res: Record<string, unknown> & {
          raw?: {
            req?: { method?: string; originalUrl?: unknown; url?: unknown };
          };
        },
      ) {
        // A provider error may also be reflected in response headers. Keep the
        // same content-free contract on both sides of a webhook request.
        return res.raw?.req && isContentPrivate(res.raw.req)
          ? { statusCode: res.statusCode }
          : res;
      },
    },
    customLogLevel(_req, res, err) {
      if (shouldSilenceHttpSuccessLog(_req.method, _req.url, res.statusCode)) {
        return "silent";
      }
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${requestLogUrl(req)} ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      if (
        isSecretSensitiveHttpRequest(req.method, requestClassificationUrl(req))
      ) {
        return `${req.method} ${requestLogUrl(req)} ${res.statusCode} — request failed`;
      }
      const ctx = (res as any).__errorContext;
      const safeError = safeErrorLogProjection(ctx?.error ?? err ?? (res as any).err);
      return `${req.method} ${stripSecretBearingUrlParts(req.url ?? "")} ${res.statusCode} — request failed (${safeError.type})`;
    },
    customErrorObject(req, _res, err, value) {
      // pino-http serializes res.err independently of customProps/errorContext.
      // Do not rely on a particular error handler having sanitized an SDK Error.
      return isContentPrivate(req)
        ? {
            ...value,
            err: {
              type: "Error",
              message: isPrivateExperienceHttpRequest(req.method, requestClassificationUrl(req)) ? "Private experience request failed" : /^\/api\/(?:webhooks|internal\/runtime)\//.test(
                privateWebhookLogUrl(requestClassificationUrl(req)),
              )
                ? "SaaS ingress request failed"
                : "Chat webhook request failed",
            },
          }
        : {
            ...value,
            err: safeErrorLogProjection(err ?? (value as Record<string, unknown>).err),
          };
    },
    customProps(req, res) {
      if (res.statusCode >= 400) {
        const ctx = (res as any).__errorContext;
        if (isContentPrivate(req)) {
          // Omit, rather than recursively redact, the entire provider payload.
          // This applies equally before/after parsing and with/without context.
          return {
            reqBody: "[REDACTED]",
            ...(ctx || (res as any).err
              ? { errorContext: { name: "Error" } }
              : {}),
          };
        }
        if (ctx) {
          const secretSensitiveRoute = isSecretSensitiveHttpRequest(
            req.method,
            requestClassificationUrl(req),
          );
          return {
            // Provider SDK and validation errors sometimes echo the supplied
            // credential in their prose. Keep only a non-sensitive type marker
            // for setup routes; the status, route, and redacted body remain.
            errorContext: secretSensitiveRoute
              ? { name: "Error" }
              : safeErrorLogProjection(ctx.error),
            reqBody: redactSensitive(ctx.reqBody),
            reqParams: redactSensitive(ctx.reqParams),
          };
        }
        const props: Record<string, unknown> = {};
        const { body, params } = req as any;
        if (body && typeof body === "object" && Object.keys(body).length > 0) {
          props.reqBody = redactSensitive(body);
        }
        if (
          params &&
          typeof params === "object" &&
          Object.keys(params).length > 0
        ) {
          props.reqParams = redactSensitive(params);
        }
        if ((req as any).route?.path) {
          props.routePath = (req as any).route.path;
        }
        return props;
      }
      return {};
    },
  });
}

export const httpLogger = createHttpLogger(logger);
