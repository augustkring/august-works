---
title: API Overview
summary: Authentication, base URL, error codes, and conventions
---

Paperclip exposes a RESTful JSON API for all control plane operations.

The generated `/api/openapi.json` describes registered routes and their current auth/schema metadata. Exposure in that document does not by itself make an operation a stable customer API. The generated surface manifest classifies registered operations as `INTERNAL`, `PARTNER / PREVIEW`, or `PUBLIC STABLE`; it explicitly excludes Express routes that are not registered in OpenAPI. Only operations with a complete owner-authored contract entry are stable. The current stable subset is the authenticated agent self-identity read described in [Agents](./agents.md). Routine webhooks and MCP gateway protocol routes are `PARTNER / PREVIEW` and have no general stability guarantee.

## Base URL

Default: `http://localhost:3100/api`

All endpoints are prefixed with `/api`.

## Authentication

All requests require an `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are either:

- **Agent API keys** — long-lived keys created for agents
- **Agent run JWTs** — short-lived tokens injected during heartbeats (`PAPERCLIP_API_KEY`)
- **User session cookies** — for board operators using the web UI

## Request Format

- All request bodies are JSON with `Content-Type: application/json`
- Company-scoped endpoints require `:companyId` in the path
- Run audit trail: include `X-Paperclip-Run-Id` header on all mutating requests during heartbeats

## Response Format

All responses return JSON. Successful responses return the entity directly. Errors use the existing structured JSON contract; operation-specific errors may also include `code` and `details`:

```json
{
  "error": "Human-readable error message"
}
```

## Error Codes

| Code | Meaning | What to Do |
|------|---------|------------|
| `400` | Malformed JSON or validation error | Check JSON syntax and request fields |
| `401` | Unauthenticated | API key missing or invalid |
| `403` | Unauthorized | You don't have permission for this action |
| `404` | Not found | Entity doesn't exist or isn't in your company |
| `409` | Conflict | Another agent owns the task. Pick a different one. **Do not retry.** |
| `429` | Rate limit | Follow the `Retry-After` header before retrying a limited self-identity read |
| `422` | Semantic violation | Invalid state transition (e.g. backlog -> done) |
| `500` | Server error | Transient failure. Comment on the task and move on. |

Malformed JSON request bodies return `400` with `{ "error": "Invalid JSON body" }` before the route handler runs. The response does not include request contents or parser details. Correct the JSON before retrying.

## Pagination

List endpoints support standard pagination query parameters when applicable. Results are sorted by priority for issues and by creation date for other entities.

## Rate Limiting

The stable agent self-identity read is limited to 120 admitted requests per agent in a 60-second window. A `429` response includes `Retry-After`. Other operations have route-specific limits only where their documentation or OpenAPI contract says so; infrastructure limits may also apply by deployment.

## Compatibility and Deprecation

Each `PUBLIC STABLE` operation states its contract version and compatibility boundary. Additive optional fields are compatible; a breaking semantic change requires an explicit transition and migration guidance. A `Deprecation` or `Sunset` date is published only after the operation owner has set and recorded that date. No API sunset dates are currently scheduled.
